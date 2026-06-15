// services/workshopNotesService.js
//
// Workshop-mode LLM wrapper for the Workshop Notes overlay.
//
// This module wraps services/aiService.js chatCompletion directly with a
// workshop-mode prompt; it does NOT call services/chatService.js
// streamChat (the conversational chat-overlay path). Keeping the two
// paths separate is intentional: workshop notes are batched and
// structured, chat is conversational and grounded, and bundling the two
// LLM-invocation styles would force a compromise on both.
//
// What pushNotesToAi does:
//   - Returns { processedMarkdown, mappings, runId, mutatedAt, modelUsed }.
//   - Builds a workshop-mode system prompt that instructs the LLM to:
//       (a) group raw bullets under canonical headings:
//           ## Customer concerns
//           ## Drivers identified
//           ## Current state captured
//           ## Desired state directions
//           ## Gaps proposed
//           ## Action items / follow-ups
//       (b) emit ActionProposal-shaped mappings (per schema/actionProposal.js)
//           for each canvas-mappable bullet
//       (c) attach HIGH/MEDIUM/LOW confidence + rationale to each mapping
//   - Validates each emitted mapping via ActionProposalSchema.safeParse
//     (the single source of truth; no parallel schema definitions).
//   - Drops invalid mappings with console.warn.
//   - Supports "delta" mode (only new bullets re-processed; upper pane
//     appends) and "full" mode (Re-evaluate all; upper pane regenerates).
//
// Real-LLM only, via the active provider configured in core/aiConfig.js
// — the same provider that powers chat and skills.

import { loadAiConfig } from "../core/aiConfig.js";
import { chatCompletion } from "./aiService.js";
import { ActionProposalSchema } from "../schema/actionProposal.js";

// Build a compact engagement snapshot for the LLM. Workshop notes are
// brief by design; we don't need the full Layer 4 selector pipeline ·
// just enough context to anchor mappings against existing entities.
function buildEngagementContext(engagement) {
  if (!engagement) return "(no engagement loaded)";
  const lines = [];
  const customer = engagement.customer || {};
  const customerName = (customer.name || "").trim() || "(customer name not set)";
  const vertical = (customer.verticalLabel || customer.vertical || "").trim() || "(vertical not set)";
  lines.push("Customer: " + customerName + " · Vertical: " + vertical);

  const envs = engagement.environments && Array.isArray(engagement.environments.allIds)
    ? engagement.environments.allIds.map(id => engagement.environments.byId[id]).filter(Boolean)
    : [];
  lines.push("Environments (" + envs.length + "):");
  envs.forEach(e => {
    if (e && !e.hidden) {
      lines.push("  - " + (e.label || "(no label)") + " · uuid=" + (e.id || "?") + " · catalogId=" + (e.envCatalogId || "?"));
    }
  });

  const drivers = engagement.drivers && Array.isArray(engagement.drivers.allIds)
    ? engagement.drivers.allIds.map(id => engagement.drivers.byId[id]).filter(Boolean)
    : [];
  if (drivers.length > 0) {
    lines.push("Existing drivers (" + drivers.length + "):");
    drivers.forEach(d => {
      lines.push("  - " + (d.businessDriverId || "?") + " · priority=" + (d.priority || "?"));
    });
  }

  const gaps = engagement.gaps && Array.isArray(engagement.gaps.allIds)
    ? engagement.gaps.allIds.map(id => engagement.gaps.byId[id]).filter(Boolean)
    : [];
  if (gaps.length > 0) {
    lines.push("Existing gaps (" + gaps.length + "):");
    gaps.slice(0, 20).forEach(g => {
      lines.push("  - " + (g.id || "?") + " · " + (g.description || "(no description)").slice(0, 80));
    });
    if (gaps.length > 20) lines.push("  - … + " + (gaps.length - 20) + " more (truncated)");
  }

  return lines.join("\n");
}

// Workshop-mode system prompt. Distinct from the chat layer's Rule
// 1..N system prompt (services/systemPromptAssembler.js). Workshop
// mode is batched + structured-output; chat mode is conversational +
// tool-using.
function buildWorkshopSystemPrompt(engagementContext) {
  return [
    "You are Dell Discovery Canvas's Workshop Notes Assistant.",
    "",
    "The presales engineer is in a live customer workshop and is typing rough bullets",
    "describing what the customer is saying. Your job: structure those bullets into a",
    "discovery-notes document AND emit canvas-mappable proposals as a JSON payload.",
    "",
    "OUTPUT FORMAT (strict JSON · no markdown fences · no prose preamble · no commentary outside the JSON):",
    "{",
    '  "processedMarkdown": "## Customer concerns\\n- ...\\n\\n## Drivers identified\\n- ...\\n...",',
    '  "mappings": [',
    "    {",
    '      "kind": "add-driver" | "add-instance-current" | "add-instance-desired" | "close-gap",',
    '      "payload": { ...kind-specific shape... },',
    '      "confidence": "HIGH" | "MEDIUM" | "LOW",',
    '      "rationale": "1-2 sentence reason citing the engineer bullet"',
    "    }",
    "    , ...",
    "  ]",
    "}",
    "",
    "CANONICAL HEADINGS for processedMarkdown (use exactly these section names; omit empty sections):",
    "  ## Customer concerns",
    "  ## Drivers identified",
    "  ## Current state captured",
    "  ## Desired state directions",
    "  ## Gaps proposed",
    "  ## Action items / follow-ups",
    "",
    "MAPPING PAYLOAD SHAPES per kind:",
    "  add-driver           · payload: {businessDriverId, priority?, outcomes?}",
    "                         businessDriverId is from a fixed catalog — emit your best-guess id (camelCase, e.g. 'cybersecurity', 'regulatory', 'businessAgility', 'costOptimization', 'modernization', 'dataValue', 'operationalEfficiency'). The importer validates against the live catalog.",
    "                         priority: 'High' | 'Medium' | 'Low'.",
    "                         outcomes: free-text summary of what the customer wants out of this driver.",
    "  add-instance-current · payload: {layerId, environmentId, label, vendor?, vendorGroup?, criticality?}",
    "                         layerId is one of: compute, network, storage, dataProtection, workload.",
    "                         environmentId is the UUID of an existing env (cite the engagement context above).",
    "                         vendorGroup: 'dell' | 'nonDell' | 'custom'.",
    "                         criticality: 'High' | 'Medium' | 'Low'.",
    "  add-instance-desired · payload: {layerId, environmentId, label, disposition?, originId?, vendor?, vendorGroup?}",
    "                         disposition: keep | enhance | replace | consolidate | retire | introduce.",
    "                         originId: UUID of existing current-state instance this replaces (if any).",
    "  close-gap            · payload: {gapId, status: 'closed', closeReason}",
    "                         gapId is the UUID of an existing gap (cite the engagement context above).",
    "                         status is the literal string 'closed'.",
    "                         closeReason: 1-2 sentence customer-confirmed reason for closure.",
    "",
    "RULES:",
    "  - Emit a mapping ONLY when the engineer's bullet is structurally clear and maps to one of the 4 v1 kinds.",
    "  - Cite the existing engagement context (envs, drivers, gaps) when emitting add-instance-* or close-gap mappings.",
    "  - Use HIGH confidence only when the bullet unambiguously names the action + entity. MEDIUM when interpretation is reasonable but a human should review. LOW when speculative.",
    "  - Do NOT emit mappings for engagement-meta details (customer name, vertical, environments) — those are managed on Tab 1 directly by the engineer.",
    "  - Do NOT invent gapIds or environmentIds that aren't in the engagement context. If you want to propose a NEW gap, describe it in the markdown under '## Gaps proposed' without an ActionProposal (Path B add-gap is out of v1 scope per SPEC §S47.2).",
    "  - Keep processedMarkdown TIGHT — engineer-readable bullets, no padding.",
    "",
    "ENGAGEMENT CONTEXT (live snapshot · cite UUIDs verbatim when referencing):",
    engagementContext
  ].join("\n");
}

// Build the user prompt for delta or full mode. In delta mode the LLM
// sees only the new bullets but is told the previousProcessed exists
// (so it doesn't duplicate sections). In full mode it sees ALL bullets
// and is told to regenerate.
function buildUserPrompt({ bullets, previousProcessed, mode }) {
  const lines = [];
  if (mode === "full") {
    lines.push("Mode: [Re-evaluate all] · regenerate the full processedMarkdown + complete mappings list from these bullets.");
    lines.push("");
    lines.push("ALL BULLETS:");
    bullets.forEach((b, i) => lines.push((i + 1) + ". " + b));
  } else {
    lines.push("Mode: [Push notes to AI] · DELTA-only — process only the NEW bullets below.");
    if (previousProcessed && previousProcessed.trim().length > 0) {
      lines.push("");
      lines.push("PREVIOUSLY STRUCTURED (for context · do not duplicate · APPEND new content):");
      lines.push(previousProcessed.trim());
    }
    lines.push("");
    lines.push("NEW BULLETS:");
    bullets.forEach((b, i) => lines.push((i + 1) + ". " + b));
  }
  return lines.join("\n");
}

// Repair common LLM JSON-output failure modes. Returns a string still
// needing JSON.parse, or null when the input is structurally beyond
// repair. Targets two failure modes:
//   (1) Truncation mid-string from the max_tokens ceiling: the response
//       ends inside an unclosed string value; we close the string and
//       any open braces/brackets to make a parseable (if incomplete)
//       document.
//   (2) Literal newlines inside string values: the LLM emits a raw \n
//       where it should emit the \\n escape, which JSON.parse rejects;
//       we escape them.
export function repairTruncatedJson(body) {
  if (typeof body !== "string" || body.length === 0) return null;
  let s = body;
  // Step 1: escape stray literal newlines that appear inside a string.
  // Heuristic: scan char-by-char tracking whether we're inside a "..."
  // string · escape any unescaped \n / \r / \t while inside the string.
  let out = "";
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escapeNext) { out += c; escapeNext = false; continue; }
    if (c === "\\") { out += c; escapeNext = true; continue; }
    if (c === '"') { inString = !inString; out += c; continue; }
    if (inString && (c === "\n" || c === "\r" || c === "\t")) {
      out += (c === "\n" ? "\\n" : (c === "\r" ? "\\r" : "\\t"));
      continue;
    }
    out += c;
  }
  s = out;
  // Step 2: if we exited the scan still inside a string, close it.
  if (inString) s += '"';
  // Step 3: count unmatched braces / brackets and close them in order.
  // We track the stack of open structural chars (ignoring those inside
  // strings since Step 1 already neutralised newlines · strings can still
  // contain { } [ ] which we must not count). Re-scan with the inString
  // tracker now correct.
  const stack = [];
  inString = false;
  escapeNext = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (c === "\\") { escapeNext = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") {
      // Pop matching only · keep stack consistent · if mismatched, bail.
      const expected = (c === "}") ? "{" : "[";
      if (stack.length === 0 || stack[stack.length - 1] !== expected) return null;
      stack.pop();
    }
  }
  // Step 4: close any remaining open structures in LIFO order.
  while (stack.length > 0) {
    const open = stack.pop();
    s += (open === "{") ? "}" : "]";
  }
  // Step 5: if the document ends with a trailing comma before our forced
  // closers, JSON.parse rejects · strip dangling commas before } or ].
  s = s.replace(/,(\s*[}\]])/g, "$1");
  // Step 6: strip dangling-key patterns where the LLM emitted `"key"}`
  // (a key WITHOUT a colon-value) before truncation forced the closer.
  // JSON.parse rejects `{"a":1,"b"}` and `{"b"}`. Strip the orphan key
  // entirely — better to lose the field than fail the whole parse. Two
  // patterns handled:
  //   (a) `, "key"` immediately before a closer `}` or `]` (comma-prefixed
  //       orphan key · most common)
  //   (b) `{ "key" }` or `[ "key" ]` (orphan key as the ONLY content of an
  //       object/array · rarer)
  // Iterate up to 3 passes because closing one orphan may reveal another.
  for (let pass = 0; pass < 3; pass++) {
    let next = s;
    // Pattern (a): strip `, "key"` immediately preceding `}` or `]`.
    next = next.replace(/,\s*"[^"\\]*(?:\\.[^"\\]*)*"\s*(?=[}\]])/g, "");
    // Pattern (b): strip a single orphan key as the ONLY content of {...} or [...].
    next = next.replace(/(\{|\[)\s*"[^"\\]*(?:\\.[^"\\]*)*"\s*(?=[}\]])/g, "$1");
    if (next === s) break;
    s = next;
  }
  // Re-run the trailing-comma strip in case Step 6 created one.
  s = s.replace(/,(\s*[}\]])/g, "$1");
  return s;
}

// Extract the FIRST balanced JSON object or array from `body`. Returns
// the matched substring (start to closer inclusive), or null if no
// balanced structure is found. Used by parseLlmResponse to strip trailing
// prose, code fences, or rationale blocks the LLM appends AFTER the JSON
// answer. Inside-string aware, so nested quotes/braces/brackets within
// string values don't confuse the stack counter.
export function extractFirstBalancedJson(body) {
  if (typeof body !== "string" || body.length === 0) return null;
  // Find the first { or [ position.
  let start = -1;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "{" || c === "[") { start = i; break; }
  }
  if (start < 0) return null;
  const stack = [];
  let inString = false;
  let escapeNext = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (c === "\\") { escapeNext = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") {
      if (stack.length === 0) return null; // unmatched closer · bail
      const expected = (c === "}") ? "{" : "[";
      if (stack[stack.length - 1] !== expected) return null; // mismatch · bail
      stack.pop();
      if (stack.length === 0) return body.slice(start, i + 1);
    }
  }
  return null; // unbalanced · let repairTruncatedJson handle truncation
}

// Parse the LLM's strict-JSON response. Tolerant of leading/trailing
// whitespace and accidental markdown code fences (some providers wrap
// JSON in ```json blocks despite the "no fences" instruction).
//
// Recovery chain:
//   Step A · standard JSON.parse on the de-fenced body
//   Step B · if A throws, attempt repairTruncatedJson + re-parse
//   Step C · if B throws or repair returns null, return {ok:false} with
//            engineer-actionable error text + the rawHead for the retry
//            logic in pushNotesToAi to consult
//
// A balanced-JSON extraction step runs first: if the body contains a
// complete balanced { ... } or [ ... ] followed by trailing prose, a
// closing fence, or a rationale block, only the balanced portion is kept.
// This handles the "rationale appended after JSON" failure mode that
// fence-stripping alone doesn't cover.
export function parseLlmResponse(text) {
  if (typeof text !== "string" || text.trim().length === 0) {
    return { ok: false, error: "Empty LLM response", repairAttempted: false };
  }
  let body = text.trim();
  // Strip markdown code fences if present.
  if (body.startsWith("```")) {
    body = body.replace(/^```(?:json|javascript|js)?\s*/i, "");
    body = body.replace(/```\s*$/, "");
    body = body.trim();
  }
  // If there's a balanced JSON object/array followed by trailing prose
  // (e.g. "**Rationale:** ..." appended after the JSON), truncate to just
  // the balanced portion. Skip when extraction returns null (unbalanced;
  // let Step B repair handle it).
  const extracted = extractFirstBalancedJson(body);
  if (extracted !== null && extracted.length < body.length) {
    body = extracted;
  }
  // Step A: standard parse.
  let parsed;
  let parseErr;
  try { parsed = JSON.parse(body); }
  catch (e) { parseErr = e; }
  // Step B: if A failed, attempt repair.
  let repairAttempted = false;
  if (parseErr) {
    repairAttempted = true;
    const repaired = repairTruncatedJson(body);
    if (repaired) {
      try { parsed = JSON.parse(repaired); parseErr = null; }
      catch (e2) { parseErr = e2; }
    }
  }
  // Step C: if both failed, return engineer-actionable error.
  if (parseErr) {
    return {
      ok: false,
      error: "JSON parse failed" + (repairAttempted ? " (repair attempted)" : "") +
             ": " + (parseErr.message || String(parseErr)) +
             " · raw response head: " + body.slice(0, 200),
      repairAttempted,
      rawHead: body.slice(0, 500)
    };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, error: "Parsed JSON is not an object", repairAttempted };
  }
  const processedMarkdown = typeof parsed.processedMarkdown === "string" ? parsed.processedMarkdown : "";
  const rawMappings = Array.isArray(parsed.mappings) ? parsed.mappings : [];
  return { ok: true, processedMarkdown, rawMappings, repairAttempted };
}

// pushNotesToAi · main exported entry point.
//
//   opts.engagement          · v3 engagement object (the live state)
//   opts.bullets             · string[] of raw bullet text (delta: only new · full: all)
//   opts.previousProcessed   · string · last upper-pane content (delta mode context)
//   opts.mode                · "delta" | "full"
//   opts.providerOverride    · optional · use a specific provider key (defaults to active)
//   opts.fetchImpl           · optional · test override
//   opts.waitImpl            · optional · test override
//
// Returns:
//   { ok: true,  processedMarkdown, mappings, runId, mutatedAt, modelUsed, providerKey, droppedCount }
//   { ok: false, error, providerKey }
export async function pushNotesToAi(opts) {
  opts = opts || {};
  const engagement = opts.engagement;
  const bullets = Array.isArray(opts.bullets) ? opts.bullets.filter(b => typeof b === "string" && b.trim().length > 0) : [];
  const previousProcessed = typeof opts.previousProcessed === "string" ? opts.previousProcessed : "";
  const mode = opts.mode === "full" ? "full" : "delta";

  if (bullets.length === 0) {
    return { ok: false, error: "No bullets to process" };
  }

  const config = loadAiConfig();
  const providerKey = opts.providerOverride || config.activeProvider;
  const active = config.providers && config.providers[providerKey];
  if (!active || !active.baseUrl) {
    return { ok: false, error: "No active provider configured · set up a provider in Settings before pushing notes to AI", providerKey };
  }

  const runId = "wn-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  const mutatedAt = new Date().toISOString();

  const systemPrompt = buildWorkshopSystemPrompt(buildEngagementContext(engagement));
  const userPrompt = buildUserPrompt({ bullets, previousProcessed, mode });

  // maxTokens 8192 gives ample headroom for the structured JSON envelope.
  // Workshop bullets routinely emit 3000-5000 chars of JSON (~750-1250
  // tokens); a lower ceiling clips mid-string and triggers
  // "Unterminated string in JSON" parse errors.
  //
  // If the first parse fails, retry once with a stricter prompt: the
  // retry appends a JSON-discipline reminder to nudge the LLM toward
  // strict output. Capped at one retry — no infinite loop.
  const STRICT_JSON_RETRY_REMINDER =
    "\n\n[RETRY] The previous response failed JSON parsing. EMIT STRICT JSON ONLY:" +
    "\n  - NO literal newlines inside string values · use \\n escape" +
    "\n  - NO trailing commas before } or ]" +
    "\n  - Close every opening { with a matching } and every [ with a ]" +
    "\n  - NO markdown code fences · NO prose preamble · just the bare JSON object";

  async function callLlm(extraSystemSuffix) {
    return chatCompletion({
      providerKey:    providerKey,
      baseUrl:        active.baseUrl,
      model:          active.model,
      fallbackModels: Array.isArray(active.fallbackModels) ? active.fallbackModels : [],
      apiKey:         active.apiKey,
      maxTokens:      8192,
      messages: [
        { role: "system", content: systemPrompt + (extraSystemSuffix || "") },
        { role: "user",   content: userPrompt }
      ],
      fetchImpl: opts.fetchImpl,
      waitImpl:  opts.waitImpl
    });
  }

  let res;
  try {
    res = await callLlm("");
  } catch (e) {
    return { ok: false, error: "LLM call failed: " + (e.message || String(e)), providerKey };
  }

  let parsed = parseLlmResponse(res.text || "");

  // Retry-once with strict-JSON reminder if first parse failed.
  let retryUsed = false;
  if (!parsed.ok) {
    retryUsed = true;
    console.warn("[workshopNotesService] first parse failed (" + parsed.error.slice(0, 120) + ") · retrying with strict-JSON reminder");
    let retryRes;
    try {
      retryRes = await callLlm(STRICT_JSON_RETRY_REMINDER);
    } catch (e) {
      return {
        ok: false,
        error: "LLM call failed on retry: " + (e.message || String(e)) + " · original parse error: " + parsed.error,
        providerKey,
        retryUsed
      };
    }
    parsed = parseLlmResponse(retryRes.text || "");
    if (parsed.ok) res = retryRes;
  }

  if (!parsed.ok) {
    return {
      ok: false,
      error: parsed.error + (retryUsed ? " (retry-with-strict-JSON also failed · try Re-evaluate all OR simplify your bullets)" : ""),
      providerKey,
      modelUsed: res.modelUsed,
      retryUsed,
      rawHead: parsed.rawHead
    };
  }

  // Validate each raw mapping via ActionProposalSchema and drop invalid
  // entries with console.warn — no silent acceptance, no parallel-shape
  // tolerance.
  const mappings = [];
  let droppedCount = 0;
  for (let i = 0; i < parsed.rawMappings.length; i++) {
    const raw = parsed.rawMappings[i];
    // Inject required shared fields if the LLM omitted them.
    const enriched = Object.assign({}, raw, {
      source: "discovery-note"  // Mode 1 overlay path · per schema/actionProposal.js ACTION_SOURCES
    });
    const result = ActionProposalSchema.safeParse(enriched);
    if (result.success) {
      mappings.push(result.data);
    } else {
      droppedCount++;
      console.warn("[workshopNotesService] dropped invalid mapping at index " + i + ": " +
        (result.error && result.error.message ? result.error.message : "(no error message)") +
        " · raw=" + JSON.stringify(raw).slice(0, 200));
    }
  }

  return {
    ok: true,
    processedMarkdown: parsed.processedMarkdown,
    mappings:          mappings,
    runId:             runId,
    mutatedAt:         mutatedAt,
    modelUsed:         res.modelUsed,
    providerKey:       providerKey,
    droppedCount:      droppedCount,
    repairAttempted:   !!parsed.repairAttempted,
    retryUsed:         retryUsed
  };
}
