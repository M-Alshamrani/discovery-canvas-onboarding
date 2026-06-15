// ui/views/CanvasChatOverlay.js
//
// Canvas Chat overlay. Dark-theme modal with monospace input, send
// affordance, scrolling transcript, token-budget meter, and a Clear-chat
// affordance. Reuses ui/components/Overlay.js for the modal frame so it
// inherits Esc/X/backdrop close + persist semantics.
//
// Wires:
//   - state/engagementStore     (active engagement is the chat context)
//   - state/chatMemory          (per-engagement transcript persistence)
//   - services/chatService      (streamChat orchestration)
//   - services/realChatProvider (active provider via aiService)
//   - core/aiConfig             (provider config)
//
// This view is read-only with respect to engagement collections; it never
// imports the collection action modules.

import { openOverlay, closeOverlay }         from "../components/Overlay.js";
import { getActiveEngagement }                from "../../state/engagementStore.js";
import { commitAiInstanceMutation }           from "../../state/adapter.js";
import {
  loadTranscript, saveTranscript, clearTranscript, summarizeIfNeeded
}                                              from "../../state/chatMemory.js";
import { streamChat }                          from "../../services/chatService.js";
import { createRealChatProvider }             from "../../services/realChatProvider.js";
import { loadAiConfig, saveAiConfig, isActiveProviderReady, PROVIDERS } from "../../core/aiConfig.js";
import { chatCompletion }                      from "../../services/aiService.js";
import { openSettingsModal }                   from "./SettingsModal.js";
import { confirmAction }                       from "../components/Notify.js";
// Markdown is rendered on assistant bubbles only; user bubbles stay
// textContent (no HTML interpretation) as an XSS guard. marked escapes
// raw HTML by default, and we add a defensive sanitize step for
// javascript: URLs after parsing.
import { marked }                              from "../../vendor/marked/marked.min.js";
// The chat right-rail is populated with saved skills. Clicking a card opens
// a mini parameter form (or drops a one-shot prompt for a parameter-less
// skill); the resolved prompt drops into the chat input. Skill Builder
// access lives in the rail's "+ Author new skill" footer button.
import { loadV3Skills }                        from "../../state/v3SkillStore.js";
import { resolveTemplate }                     from "../../services/pathResolver.js";
import { openSkillBuilderOverlay }             from "../skillBuilderOpener.js";
// Streaming-time handshake strip. A model may emit the contract-ack
// handshake mid-stream, so onToken applies the shared strip to the
// accumulated buffer before each markdown re-parse to keep it from flashing.
import { stripHandshake }                      from "../../services/chatHandshake.js";
// Streaming-time UUID scrub. Same defense as the handshake: scrub bare
// UUIDs in prose with resolved labels at every onToken so the bubble never
// flashes a raw UUID even if a model slips one in mid-stream.
import { buildLabelMap, buildManifestLabelMap, scrubUuidsInProse } from "../../services/uuidScrubber.js";
// Dynamic "try asking" empty-state prompts.
import { generateTryAskingPrompts }            from "../../services/tryAskingPrompts.js";

// Skill-runtime resolver context. _buildSkillRunCtx routes through these
// catalog snapshots + selectors (rather than walking the engagement
// directly) to feed the label-resolved + insights namespaces.
import BUSINESS_DRIVERS_SNAP                    from "../../catalogs/snapshots/business_drivers.js";
import ENV_CATALOG_SNAP                         from "../../catalogs/snapshots/env_catalog.js";
import LAYERS_SNAP                              from "../../catalogs/snapshots/layers.js";
import GAP_TYPES_SNAP                           from "../../catalogs/snapshots/gap_types.js";
import DISPOSITION_ACTIONS_SNAP                 from "../../catalogs/snapshots/disposition_actions.js";
import SERVICE_TYPES_SNAP                       from "../../catalogs/snapshots/service_types.js";
import CUSTOMER_VERTICALS_SNAP                  from "../../catalogs/snapshots/customer_verticals.js";
// Unwrap each {catalogId, catalogVersion, entries[]} snapshot to its
// `entries` array; the helpers below treat them as flat catalog lists.
var BUSINESS_DRIVERS_CAT    = (BUSINESS_DRIVERS_SNAP    && BUSINESS_DRIVERS_SNAP.entries)    || [];
var ENV_CATALOG_CAT         = (ENV_CATALOG_SNAP         && ENV_CATALOG_SNAP.entries)         || [];
var LAYERS_CAT              = (LAYERS_SNAP              && LAYERS_SNAP.entries)              || [];
var GAP_TYPES_CAT           = (GAP_TYPES_SNAP           && GAP_TYPES_SNAP.entries)           || [];
var DISPOSITION_ACTIONS_CAT = (DISPOSITION_ACTIONS_SNAP && DISPOSITION_ACTIONS_SNAP.entries) || [];
var SERVICE_TYPES_CAT       = (SERVICE_TYPES_SNAP       && SERVICE_TYPES_SNAP.entries)       || [];
var CATALOGS_CUSTOMER_VERTICALS = (CUSTOMER_VERTICALS_SNAP && CUSTOMER_VERTICALS_SNAP.entries) || [];
// Selectors for the insights namespace (reuses the Reporting machinery).
import { computeDiscoveryCoverage, computeRiskPosture, buildProjects, generateSessionBrief } from "../../services/roadmapService.js";
import { getHealthSummary }                     from "../../services/healthMetrics.js";
import { computeMixByLayer }                    from "../../services/vendorMixService.js";
import { groupProjectsByProgram }               from "../../services/programsService.js";
import { getEngagementAsSession }               from "../../state/projection.js";
// PICKER_METADATA tells _buildEngagementDataBlock which entity each
// selected path belongs to, so it can group the path under the right
// markdown table.
import { PICKER_METADATA as PICKER_METADATA_LOCAL } from "../../core/dataContract.js";

// Module-scope state for the open overlay. Only one chat overlay is open
// at a time; Overlay.js enforces the singleton pattern. The chat always
// uses the user's configured active provider from aiConfig.
let state = {
  engagement:   null,
  engagementId: null,
  transcript:   { messages: [], summary: null },
  isStreaming:  false
};

// Fallback example prompts. The live empty-state painter calls
// generateTryAskingPrompts(state.engagement) and renders its output;
// this static set is the fallback used when the engagement is empty.
const EXAMPLE_PROMPTS = [
  "How many High-urgency gaps are open?",
  "Which environments have the most non-Dell instances?",
  "What initiatives serve our cyber resilience driver?",
  "Summarize the customer's strategic drivers in two sentences."
];

// Human-readable status message per tool. The chat overlay paints these
// in a status pill during tool-use rounds so the user sees what the AI is
// doing rather than a flat "thinking...". Unknown tool names fall back to
// the __default__ entry.
const TOOL_STATUS_MESSAGES = {
  "selectGapsKanban":           "Reading the gaps board...",
  "selectMatrixView":           "Cross-referencing the architecture...",
  "selectVendorMix":            "Computing vendor mix...",
  "selectLinkedComposition":    "Walking entity links...",
  "selectConcept":              "Looking up the concept dictionary...",
  "selectWorkflow":             "Reading the workflow steps...",
  "selectExecutiveSummaryInputs": "Gathering executive summary...",
  "selectAnalyticalCanvas":     "Computing canvas analytics...",
  "selectProjects":             "Reading projects + roadmap...",
  "selectHealthSummary":        "Analyzing engagement health...",
  "__default__":                "Looking up data..."
};

// openCanvasChat() — entry point from app.js topbar handler.
export function openCanvasChat() {
  state.engagement = getActiveEngagement();
  state.engagementId = (state.engagement && state.engagement.meta && state.engagement.meta.engagementId) || null;
  state.transcript = state.engagementId ? loadTranscript(state.engagementId) : { messages: [], summary: null };
  // Reset the per-open try-asking seed so the empty-state shows fresh
  // prompts on each open, but stays stable while one session is on screen.
  state._tryAskingSeed = (Date.now() & 0x7FFFFFFF) || 1;

  const body   = buildBody();
  const footer = buildFooter();

  openOverlay({
    title:   "Canvas AI Assistant",
    lede:    "Ask anything about your discovery canvas. Grounded in the data model + your live engagement.",
    body:    body,
    footer:  footer,
    kind:    "canvas-chat",
    size:    "chat",
    persist: true
  });

  // Inject the provider toggle + Clear button into the head-extras slot.
  injectHeaderExtras();

  // Focus input on open + render initial transcript.
  setTimeout(function() {
    const input = body.querySelector(".canvas-chat-input");
    if (input) input.focus();
    paintTranscript(body);
  }, 50);
}

function buildBody() {
  // Body layout:
  //   <tabs>       ← permanent Chat + permanent Skills + dynamic [Skill: <name>]
  //   <chat-tab>   ← chat surface (main column + skills rail)
  //   <skills-tab> ← read-only launcher list
  //   <skill-tab>  ← dynamic, one at a time
  const body = document.createElement("div");
  body.className = "canvas-chat-body";

  // ── Tab strip ──────────────────────────────────────────────────
  const tabs = document.createElement("div");
  tabs.className = "canvas-chat-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("data-canvas-chat-tabs", "");
  const chatTabBtn = _buildTabButton("chat", "Chat", true);
  const skillsTabBtn = _buildTabButton("skills", "Skills", false);
  tabs.appendChild(chatTabBtn);
  tabs.appendChild(skillsTabBtn);
  body.appendChild(tabs);

  // ── Chat tab content (main column + rail) ──────────────────────
  const chatPane = document.createElement("div");
  chatPane.className = "canvas-chat-tab-content canvas-chat-chat-pane is-active";
  chatPane.setAttribute("data-canvas-chat-tab-content", "chat");
  body.appendChild(chatPane);

  // ── Main column ─────────────────────────────────────────────────
  const main = document.createElement("div");
  main.className = "canvas-chat-main";
  chatPane.appendChild(main);

  // Transcript scroll region.
  const scroll = document.createElement("div");
  scroll.className = "canvas-chat-transcript";
  scroll.setAttribute("data-canvas-chat-transcript", "");
  main.appendChild(scroll);

  // Empty-state hint (rendered conditionally by paintTranscript).
  const empty = document.createElement("div");
  empty.className = "canvas-chat-empty";
  empty.style.display = "none";
  empty.innerHTML =
    '<div class="canvas-chat-empty-eyebrow">Try asking</div>' +
    '<div class="canvas-chat-empty-grid"></div>';
  scroll.appendChild(empty);

  // Token-budget meter (above the input).
  const meter = document.createElement("div");
  meter.className = "canvas-chat-meter";
  meter.setAttribute("data-canvas-chat-meter", "");
  meter.textContent = "ready";
  main.appendChild(meter);

  // Input row.
  const inputRow = document.createElement("div");
  inputRow.className = "canvas-chat-input-row";

  const input = document.createElement("textarea");
  input.className = "canvas-chat-input";
  input.placeholder = "Ask the canvas anything...";
  input.rows = 1;
  input.spellcheck = true;
  input.setAttribute("aria-label", "Chat input");

  const send = document.createElement("button");
  send.type = "button";
  send.className = "canvas-chat-send";
  send.setAttribute("aria-label", "Send");
  send.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<line x1="22" y1="2" x2="11" y2="13"/>' +
    '<polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';

  inputRow.appendChild(input);
  inputRow.appendChild(send);
  main.appendChild(inputRow);

  // Wire send + Enter keystroke.
  send.addEventListener("click", function() { handleSend(body); });
  input.addEventListener("keydown", function(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(body);
    }
  });
  input.addEventListener("input", function() {
    // Auto-grow up to 6 rows.
    input.style.height = "auto";
    const lines = Math.min(6, Math.max(1, input.value.split("\n").length));
    input.style.height = (lines * 22 + 16) + "px";
  });

  // ── Right rail (Skills) ────────────────────────────────────────
  // Populated with saved skills. Clicking a card opens a mini parameter
  // form (or drops a one-shot prompt for a parameter-less skill); the
  // resolved prompt populates the chat input.
  const rail = document.createElement("aside");
  rail.className = "canvas-chat-rail";
  rail.setAttribute("data-canvas-chat-rail", "");
  rail.innerHTML =
    '<div class="canvas-chat-rail-head">' +
      '<div class="canvas-chat-rail-eyebrow">Shortcuts</div>' +
      '<div class="canvas-chat-rail-title">Skills</div>' +
    '</div>' +
    '<div class="canvas-chat-rail-body" data-canvas-chat-rail-body></div>';
  chatPane.appendChild(rail);
  paintSkillRail(body);

  // ── Skills tab content (read-only launcher list) ───────────────
  const skillsPane = document.createElement("div");
  skillsPane.className = "canvas-chat-tab-content canvas-chat-skills-pane";
  skillsPane.setAttribute("data-canvas-chat-tab-content", "skills");
  skillsPane.setAttribute("data-canvas-chat-skills-content", "");
  body.appendChild(skillsPane);
  paintSkillsLauncher(skillsPane);

  // Tab click handlers
  chatTabBtn.addEventListener("click", function() { _switchCanvasChatTab(body, "chat"); });
  skillsTabBtn.addEventListener("click", function() { _switchCanvasChatTab(body, "skills"); });

  return body;
}

// ─── Tab system helpers ─────────────────────────────────────────────

function _buildTabButton(tabId, label, isActive) {
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "canvas-chat-tab" + (isActive ? " is-active" : "");
  btn.setAttribute("role", "tab");
  btn.setAttribute("data-canvas-chat-tab", tabId);
  btn.setAttribute("aria-selected", isActive ? "true" : "false");
  btn.textContent = label;
  return btn;
}

function _switchCanvasChatTab(body, tabId) {
  if (!body) return;
  // Update tab buttons
  body.querySelectorAll("[data-canvas-chat-tab]").forEach(function(b) {
    var match = b.getAttribute("data-canvas-chat-tab") === tabId;
    b.classList.toggle("is-active", match);
    b.setAttribute("aria-selected", match ? "true" : "false");
  });
  // Update tab content panes
  body.querySelectorAll("[data-canvas-chat-tab-content]").forEach(function(p) {
    p.classList.toggle("is-active", p.getAttribute("data-canvas-chat-tab-content") === tabId);
  });
}

// ─── Skills launcher list (read-only) ───────────────────────────────

function paintSkillsLauncher(host) {
  host.innerHTML = "";
  var head = document.createElement("div");
  head.className = "canvas-chat-skills-head";
  head.innerHTML =
    '<div class="canvas-chat-skills-eyebrow">Skills launcher</div>' +
    '<div class="canvas-chat-skills-title">Run a saved skill</div>' +
    '<div class="canvas-chat-skills-help">Click Run to launch a skill in a dedicated tab. ' +
    'Author + edit skills in Settings → Skills builder.</div>';
  host.appendChild(head);

  var skills = [];
  try { skills = Object.values(loadV3Skills() || {}); } catch (_e) { skills = []; }

  if (skills.length === 0) {
    var empty = document.createElement("div");
    empty.className = "canvas-chat-skills-empty";
    empty.textContent = "No saved skills yet. Open Settings → Skills builder to author your first.";
    host.appendChild(empty);
    return;
  }

  var list = document.createElement("div");
  list.className = "canvas-chat-skills-list";
  skills.forEach(function(skill) {
    list.appendChild(_buildLauncherRow(skill));
  });
  host.appendChild(list);
}

function _buildLauncherRow(skill) {
  var row = document.createElement("div");
  row.className = "canvas-chat-skills-row";
  row.setAttribute("data-launcher-skill-id", skill.skillId);

  var info = document.createElement("div");
  info.className = "canvas-chat-skills-row-info";
  var labelEl = document.createElement("div");
  labelEl.className = "canvas-chat-skills-row-label";
  labelEl.textContent = skill.label || skill.skillId;
  info.appendChild(labelEl);
  if (skill.description) {
    var descEl = document.createElement("div");
    descEl.className = "canvas-chat-skills-row-desc";
    descEl.textContent = skill.description;
    info.appendChild(descEl);
  }
  if (skill.outputFormat) {
    var meta = document.createElement("div");
    meta.className = "canvas-chat-skills-row-meta";
    meta.textContent = skill.outputFormat + (skill.mutationPolicy ? " · " + skill.mutationPolicy : "");
    info.appendChild(meta);
  }
  row.appendChild(info);

  var runBtn = document.createElement("button");
  runBtn.type = "button";
  runBtn.className = "btn-primary canvas-chat-skills-row-run";
  runBtn.textContent = "Run";
  runBtn.addEventListener("click", function() { launchSkill(skill); });
  row.appendChild(runBtn);

  return row;
}

// paintSkillRail — renders saved-skill cards into the right rail.
// Called on overlay open and after a skill is run. The empty state shows
// a hint plus a button that opens the Skill Builder; the populated state
// appends a "+ Author new skill" footer button.
function paintSkillRail(body) {
  const railBody = body.querySelector("[data-canvas-chat-rail-body]");
  if (!railBody) return;
  railBody.innerHTML = "";

  const skillsById = loadV3Skills();
  const ids = Object.keys(skillsById);

  if (ids.length === 0) {
    const empty = document.createElement("div");
    empty.className = "canvas-chat-rail-empty";
    empty.innerHTML = "Saved skills will appear here as one-click shortcuts.<br/>Author one to get started.";
    railBody.appendChild(empty);
    railBody.appendChild(buildAuthorSkillButton());
    return;
  }

  const list = document.createElement("div");
  list.className = "canvas-chat-rail-list";
  for (const id of ids) {
    list.appendChild(buildSkillCard(skillsById[id], body));
  }
  railBody.appendChild(list);
  railBody.appendChild(buildAuthorSkillButton());
}

// buildAuthorSkillButton — secondary affordance routing power-users to
// the Skill Builder overlay.
function buildAuthorSkillButton() {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "canvas-chat-rail-author-btn";
  btn.setAttribute("data-canvas-chat-rail-author-btn", "");
  btn.textContent = "+ Author new skill";
  btn.title = "Open the Skill Builder to author a new AI skill";
  btn.addEventListener("click", function() { openSkillBuilderOverlay(); });
  return btn;
}

// buildSkillCard — one card per saved skill. Click → expand inline
// parameter form; "Use" submits resolved prompt to the chat input.
function buildSkillCard(skill, body) {
  const card = document.createElement("div");
  card.className = "canvas-chat-rail-card";
  card.setAttribute("data-canvas-chat-rail-card", "");
  card.setAttribute("data-skill-id", skill.skillId);

  const head = document.createElement("button");
  head.type = "button";
  head.className = "canvas-chat-rail-card-head";
  const title = document.createElement("div");
  title.className = "canvas-chat-rail-card-title";
  title.textContent = skill.label || skill.skillId;
  head.appendChild(title);
  if (skill.description) {
    const desc = document.createElement("div");
    desc.className = "canvas-chat-rail-card-desc";
    desc.textContent = skill.description;
    head.appendChild(desc);
  }
  const meta = document.createElement("div");
  meta.className = "canvas-chat-rail-card-meta";
  const paramCount = (skill.parameters || []).length;
  meta.textContent = paramCount === 0
    ? "Engagement-wide · click to use"
    : paramCount + " parameter" + (paramCount === 1 ? "" : "s");
  head.appendChild(meta);
  card.appendChild(head);

  const formHost = document.createElement("div");
  formHost.className = "canvas-chat-rail-card-form";
  formHost.style.display = "none";
  card.appendChild(formHost);

  head.addEventListener("click", function() {
    const isOpen = formHost.style.display !== "none";
    // Close every other open card so only one form is visible.
    body.querySelectorAll(".canvas-chat-rail-card-form").forEach(function(f) {
      f.style.display = "none";
      f.innerHTML = "";
    });
    body.querySelectorAll(".canvas-chat-rail-card").forEach(function(c) {
      c.classList.remove("is-open");
    });
    if (isOpen) return;   // toggle close

    if (paramCount === 0) {
      // Parameter-less skill: resolve immediately and drop into input.
      dropResolvedPromptIntoInput(skill, {}, body);
      return;
    }
    // Parameterized skill: render the inline form.
    card.classList.add("is-open");
    formHost.style.display = "";
    formHost.appendChild(buildParameterForm(skill, body, formHost));
  });

  return card;
}

function buildParameterForm(skill, body, formHost) {
  const form = document.createElement("form");
  form.className = "canvas-chat-rail-form";
  const eng = getActiveEngagement();

  const values = {};
  for (const p of (skill.parameters || [])) {
    const field = document.createElement("label");
    field.className = "canvas-chat-rail-field";
    const lbl = document.createElement("span");
    lbl.className = "canvas-chat-rail-field-label";
    lbl.textContent = p.description || p.name;
    if (p.required) {
      const req = document.createElement("span");
      req.className = "canvas-chat-rail-field-required";
      req.textContent = " *";
      lbl.appendChild(req);
    }
    field.appendChild(lbl);

    if (p.type === "entityId") {
      const sel = document.createElement("select");
      sel.className = "canvas-chat-rail-field-input";
      const kindKey = entityKindKeyFromHint(p.description) || entityKindKeyFromName(p.name);
      const collection = (kindKey && eng && eng[kindKey]) || null;
      const allIds = (collection && collection.allIds) || [];
      sel.innerHTML = '<option value="">— pick —</option>' +
        allIds.map(function(id) {
          const ent = collection.byId[id] || {};
          const text = ent.label || ent.name || ent.description || id;
          return '<option value="' + escapeAttr(id) + '">' + escapeText(String(text).slice(0, 60)) + '</option>';
        }).join("");
      if (allIds.length === 0) {
        sel.disabled = true;
        sel.innerHTML = '<option value="">no ' + (kindKey || "entities") + ' loaded</option>';
      }
      sel.addEventListener("change", function(e) { values[p.name] = e.target.value; });
      field.appendChild(sel);
    } else {
      const inp = document.createElement("input");
      inp.type = p.type === "number" ? "number" : "text";
      inp.className = "canvas-chat-rail-field-input";
      inp.placeholder = p.type === "boolean" ? "true / false" : p.type;
      inp.addEventListener("input", function(e) {
        values[p.name] = p.type === "number"
          ? (e.target.value === "" ? "" : Number(e.target.value))
          : (p.type === "boolean" ? /^true$/i.test(e.target.value) : e.target.value);
      });
      field.appendChild(inp);
    }
    form.appendChild(field);
  }

  const actions = document.createElement("div");
  actions.className = "canvas-chat-rail-form-actions";
  const useBtn = document.createElement("button");
  useBtn.type = "submit";
  useBtn.className = "btn-primary canvas-chat-rail-use-btn";
  useBtn.textContent = "Use skill";
  actions.appendChild(useBtn);
  form.appendChild(actions);

  const errEl = document.createElement("div");
  errEl.className = "canvas-chat-rail-form-error";
  errEl.style.display = "none";
  form.appendChild(errEl);

  form.addEventListener("submit", function(e) {
    e.preventDefault();
    // Validate required params filled.
    const missing = (skill.parameters || []).filter(function(p) {
      return p.required && (values[p.name] === undefined || values[p.name] === "" || values[p.name] === null);
    });
    if (missing.length > 0) {
      errEl.style.display = "";
      errEl.textContent = "Missing: " + missing.map(function(p) { return p.name; }).join(", ");
      return;
    }
    errEl.style.display = "none";
    dropResolvedPromptIntoInput(skill, values, body);
    // Close the form once dropped.
    formHost.style.display = "none";
    formHost.innerHTML = "";
    const card = formHost.closest(".canvas-chat-rail-card");
    if (card) card.classList.remove("is-open");
  });

  return form;
}

// dropResolvedPromptIntoInput — resolves the skill template against the
// active engagement + the supplied parameter values and drops the
// resolved string into the chat input. The user clicks Send to dispatch
// it, so they always see what's being sent first.
function dropResolvedPromptIntoInput(skill, paramValues, body) {
  const eng = getActiveEngagement() || {};
  const ctx = {
    engagement:     eng,
    customer:       eng.customer || {},
    engagementMeta: eng.meta || {},
    catalogVersions: eng.catalogVersions || {}
  };
  // Bind parameter primitives directly, and entityId parameters under
  // ctx.context.<name>.<field> so {{context.<name>.field}} resolves.
  for (const p of (skill.parameters || [])) {
    if (!(p.name in paramValues)) continue;
    ctx[p.name] = paramValues[p.name];
    if (p.type === "entityId") {
      const kindKey = entityKindKeyFromHint(p.description) || entityKindKeyFromName(p.name);
      const ent = kindKey && eng[kindKey] && eng[kindKey].byId && eng[kindKey].byId[paramValues[p.name]];
      if (ent) {
        if (!ctx.context) ctx.context = {};
        ctx.context[p.name] = ent;
      }
    }
  }
  const resolved = resolveTemplate(skill.promptTemplate || "", ctx, { skillId: skill.skillId });
  const input = body.querySelector(".canvas-chat-input");
  if (input) {
    input.value = resolved;
    input.dispatchEvent(new Event("input"));
    input.focus();
  }
}

// Map a parameter description hint to an engagement collection key, so the
// rail resolves entityId parameters by the same convention SkillBuilder uses.
function entityKindKeyFromHint(description) {
  if (typeof description !== "string") return null;
  const lower = description.toLowerCase();
  if (lower.includes("gap"))         return "gaps";
  if (lower.includes("driver"))      return "drivers";
  if (lower.includes("environment")) return "environments";
  if (lower.includes("instance"))    return "instances";
  return null;
}

function entityKindKeyFromName(name) {
  if (typeof name !== "string") return null;
  const lower = name.toLowerCase();
  if (lower === "gap"         || lower === "gapid")         return "gaps";
  if (lower === "driver"      || lower === "driverid")      return "drivers";
  if (lower === "environment" || lower === "environmentid") return "environments";
  if (lower === "instance"    || lower === "instanceid")    return "instances";
  return null;
}

function escapeAttr(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
function escapeText(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Thinking-state paint helpers. Each owns a small DOM region so the chat
// overlay's onToken / onToolUse / onRoundStart callbacks can paint cleanly.

function paintTypingIndicator() {
  // Clear any prior indicator before re-painting.
  clearTypingIndicator();
  const scroll = document.querySelector(".overlay[data-kind='canvas-chat'] .canvas-chat-transcript");
  if (!scroll) return;
  const ind = document.createElement("div");
  ind.className = "canvas-chat-typing-indicator";
  ind.setAttribute("aria-label", "AI is thinking");
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement("span");
    dot.className = "canvas-chat-typing-dot";
    ind.appendChild(dot);
  }
  scroll.appendChild(ind);
  scroll.scrollTop = scroll.scrollHeight;
}
function clearTypingIndicator() {
  document.querySelectorAll(".overlay[data-kind='canvas-chat'] .canvas-chat-typing-indicator")
    .forEach(el => el.remove());
}

function paintToolStatus(toolName) {
  clearToolStatus();
  const scroll = document.querySelector(".overlay[data-kind='canvas-chat'] .canvas-chat-transcript");
  if (!scroll) return;
  const pill = document.createElement("div");
  pill.className = "canvas-chat-tool-status";
  pill.setAttribute("data-tool-name", toolName || "");
  pill.textContent = TOOL_STATUS_MESSAGES[toolName] || TOOL_STATUS_MESSAGES.__default__;
  scroll.appendChild(pill);
  scroll.scrollTop = scroll.scrollHeight;
}
function clearToolStatus() {
  document.querySelectorAll(".overlay[data-kind='canvas-chat'] .canvas-chat-tool-status")
    .forEach(el => el.remove());
}

function paintRoundBadge(evt) {
  // Only paint for round >= 2; the first round is implicit.
  const round = evt && evt.round;
  if (typeof round !== "number" || round < 2) return;
  const host = document.querySelector(".overlay[data-kind='canvas-chat'] .canvas-chat-meter") ||
               document.querySelector(".overlay[data-kind='canvas-chat'] .canvas-chat-transcript");
  if (!host) return;
  document.querySelectorAll(".overlay[data-kind='canvas-chat'] .canvas-chat-round-badge")
    .forEach(el => el.remove());
  const badge = document.createElement("span");
  badge.className = "canvas-chat-round-badge";
  badge.textContent = "Round " + round + (evt.totalRounds ? " of " + evt.totalRounds : "");
  host.appendChild(badge);
  setTimeout(() => {
    badge.classList.add("is-fading");
    setTimeout(() => { badge.remove(); }, 400);
  }, 2000);
}

// Test handles - synthetic invocation paths so the diagnostic suite can
// drive each painter without orchestrating a full streamChat round-trip.
export function _paintTypingIndicatorForTests() { paintTypingIndicator(); }
export function _clearTypingIndicatorForTests() { clearTypingIndicator(); }
export function _paintToolStatusForTests(toolName) { paintToolStatus(toolName); }
export function _paintRoundBadgeForTests(evt) { paintRoundBadge(evt); }

// ─── Skill launch + dynamic-tab system ──────────────────────────────

// Module-level state — a single skill runs at a time.
var _activeRunningSkill = null;

// launchSkill(skill) — launch flow. If another skill is currently active,
// prompt the user to cancel it before launching the new one (single-skill
// invariant). Otherwise open the dynamic [Skill: <label>] tab + the skill
// panel right-rail.
//
// _activeRunningSkill is tracked even when the overlay is not mounted: the
// cancel-confirm modal mounts on document.body, and the test surface drives
// launchSkill directly without opening the overlay.
export function launchSkill(skill) {
  if (!skill || !skill.skillId) return;
  // If another skill is running, surface the cancel-confirm modal.
  if (_activeRunningSkill && _activeRunningSkill.skillId !== skill.skillId) {
    var bodyForModal = document.querySelector(".overlay[data-kind='canvas-chat'] .canvas-chat-body");
    _showCancelConfirmModal(bodyForModal, _activeRunningSkill, skill);
    return;
  }
  var body = document.querySelector(".overlay[data-kind='canvas-chat'] .canvas-chat-body");
  if (!body) {
    // Overlay not mounted -- still record the active running skill so a
    // subsequent launch trips the cancel-confirm path.
    _activeRunningSkill = skill;
    return;
  }
  _openDynamicSkillTab(body, skill);
}

function _showCancelConfirmModal(body, currentSkill, nextSkill) {
  // Remove any existing confirm modal first (idempotent).
  var existing = document.querySelector("[data-skill-cancel-confirm]");
  if (existing) existing.remove();
  var modal = document.createElement("div");
  modal.className = "skill-cancel-confirm-modal";
  modal.setAttribute("data-skill-cancel-confirm", "");
  modal.innerHTML =
    '<div class="skill-cancel-confirm-card">' +
      '<div class="skill-cancel-confirm-title">Cancel running skill?</div>' +
      '<div class="skill-cancel-confirm-msg">Currently running: <b>' +
        escapeText(currentSkill.label || currentSkill.skillId) + '</b><br>' +
        'Launch instead: <b>' + escapeText(nextSkill.label || nextSkill.skillId) + '</b><br>' +
        'The current skill\'s output and conversation will be lost.</div>' +
      '<div class="skill-cancel-confirm-actions">' +
        '<button type="button" class="btn-secondary" data-skill-cancel-stay>Stay on current</button>' +
        '<button type="button" class="btn-primary" data-skill-cancel-and-launch>Cancel and launch new</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);
  modal.querySelector("[data-skill-cancel-stay]").addEventListener("click", function() { modal.remove(); });
  modal.querySelector("[data-skill-cancel-and-launch]").addEventListener("click", function() {
    modal.remove();
    _closeDynamicSkillTab(body);
    _openDynamicSkillTab(body, nextSkill);
  });
}

function _openDynamicSkillTab(body, skill) {
  // Insert tab button into the tab strip (after Skills tab).
  var tabs = body.querySelector("[data-canvas-chat-tabs]");
  if (!tabs) return;
  // Remove any existing dynamic tab (single-skill invariant).
  var existingDynBtn = tabs.querySelector("[data-canvas-chat-tab^='skill-']");
  if (existingDynBtn) existingDynBtn.remove();
  var existingDynPane = body.querySelector("[data-canvas-chat-tab-content^='skill-']");
  if (existingDynPane) existingDynPane.remove();

  var dynTabId = "skill-" + skill.skillId;
  var dynBtn = document.createElement("button");
  dynBtn.type = "button";
  dynBtn.className = "canvas-chat-tab canvas-chat-tab-dynamic";
  dynBtn.setAttribute("role", "tab");
  dynBtn.setAttribute("data-canvas-chat-tab", dynTabId);
  dynBtn.setAttribute("aria-selected", "false");
  var dynLabel = document.createElement("span");
  dynLabel.className = "canvas-chat-tab-dynamic-label";
  dynLabel.textContent = "Skill: " + (skill.label || skill.skillId);
  dynBtn.appendChild(dynLabel);
  // Use <span role="button"> to avoid invalid nested-button HTML.
  // The dynBtn is itself a <button>; nesting another would be invalid.
  var closeX = document.createElement("span");
  closeX.className = "canvas-chat-tab-dynamic-close";
  closeX.setAttribute("role", "button");
  closeX.setAttribute("tabindex", "0");
  closeX.setAttribute("aria-label", "Close skill tab");
  closeX.textContent = "×";
  closeX.addEventListener("click", function(e) {
    e.stopPropagation();
    e.preventDefault();
    _closeDynamicSkillTab(body);
    _switchCanvasChatTab(body, "chat");
  });
  dynBtn.appendChild(closeX);
  dynBtn.addEventListener("click", function() { _switchCanvasChatTab(body, dynTabId); });
  tabs.appendChild(dynBtn);

  // Build dynamic tab content: chat dialog (left) + skill panel (right).
  var dynPane = document.createElement("div");
  dynPane.className = "canvas-chat-tab-content canvas-chat-skill-pane";
  dynPane.setAttribute("data-canvas-chat-tab-content", dynTabId);
  dynPane.setAttribute("data-canvas-chat-skill-pane", skill.skillId);

  var dialog = document.createElement("div");
  dialog.className = "canvas-chat-skill-dialog";
  dialog.setAttribute("data-canvas-chat-skill-dialog", "");
  dialog.innerHTML = '<div class="canvas-chat-skill-dialog-empty">' +
    'Skill conversation will stream here when you click <b>Run</b> on the right. ' +
    '(Run wiring lands at rc.8.b R6.)</div>';
  dynPane.appendChild(dialog);

  var panel = document.createElement("aside");
  panel.className = "canvas-chat-skill-panel";
  panel.setAttribute("data-canvas-chat-skill-panel", "");
  renderSkillPanelForRun(skill, panel);
  dynPane.appendChild(panel);

  body.appendChild(dynPane);

  // Switch to the new tab + record state.
  _activeRunningSkill = skill;
  _switchCanvasChatTab(body, dynTabId);
}

function _closeDynamicSkillTab(body) {
  if (!body) return;
  var dynBtn = body.querySelector("[data-canvas-chat-tab^='skill-']");
  if (dynBtn) dynBtn.remove();
  var dynPane = body.querySelector("[data-canvas-chat-tab-content^='skill-']");
  if (dynPane) dynPane.remove();
  _activeRunningSkill = null;
}

// renderSkillPanelForRun(skill, host) — renders the skill panel:
// description + parameters (with file slot) + Run button + output preview.
export function renderSkillPanelForRun(skill, host) {
  if (!host) return;
  host.innerHTML = "";

  var head = document.createElement("div");
  head.className = "canvas-chat-skill-panel-head";
  var labelEl = document.createElement("div");
  labelEl.className = "canvas-chat-skill-panel-label";
  labelEl.textContent = (skill && skill.label) || "(unnamed skill)";
  head.appendChild(labelEl);
  if (skill && skill.description) {
    var descEl = document.createElement("div");
    descEl.className = "canvas-chat-skill-panel-desc";
    descEl.textContent = skill.description;
    head.appendChild(descEl);
  }
  if (skill && skill.outputFormat) {
    var meta = document.createElement("div");
    meta.className = "canvas-chat-skill-panel-meta";
    meta.textContent = "Output: " + skill.outputFormat +
      (skill.mutationPolicy ? " · policy: " + skill.mutationPolicy : "");
    head.appendChild(meta);
  }
  host.appendChild(head);

  // Parameters section
  var paramsSection = document.createElement("div");
  paramsSection.className = "canvas-chat-skill-panel-params";
  var paramsHead = document.createElement("div");
  paramsHead.className = "canvas-chat-skill-panel-section-head";
  paramsHead.textContent = "Inputs";
  paramsSection.appendChild(paramsHead);

  var params = (skill && Array.isArray(skill.parameters)) ? skill.parameters : [];
  if (params.length === 0) {
    var noParams = document.createElement("div");
    noParams.className = "canvas-chat-skill-panel-no-params";
    noParams.textContent = "(this skill has no run-time inputs)";
    paramsSection.appendChild(noParams);
  } else {
    params.forEach(function(p) {
      paramsSection.appendChild(_buildSkillPanelParamRow(p));
    });
  }
  host.appendChild(paramsSection);

  // Run button.
  var runRow = document.createElement("div");
  runRow.className = "canvas-chat-skill-panel-run-row";
  var runBtn = document.createElement("button");
  runBtn.type = "button";
  runBtn.className = "btn-primary canvas-chat-skill-panel-run";
  runBtn.setAttribute("data-skill-panel-run", "");
  runBtn.textContent = "Run skill";
  runBtn.addEventListener("click", async function() {
    runBtn.disabled = true;
    var origLabel = runBtn.textContent;
    runBtn.textContent = "Running...";
    try {
      await runSkill(skill, host);
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = origLabel;
    }
  });
  runRow.appendChild(runBtn);
  host.appendChild(runRow);

  // Output preview.
  var preview = document.createElement("div");
  preview.className = "canvas-chat-skill-panel-output";
  preview.setAttribute("data-skill-panel-output", "");
  host.appendChild(preview);
}

function _buildSkillPanelParamRow(p) {
  var row = document.createElement("div");
  row.className = "canvas-chat-skill-panel-param-row";

  var labelEl = document.createElement("label");
  labelEl.className = "canvas-chat-skill-panel-param-label";
  labelEl.textContent = (p.name || "(unnamed)") + (p.required ? " *" : "");
  row.appendChild(labelEl);

  if (p.description) {
    var hint = document.createElement("div");
    hint.className = "canvas-chat-skill-panel-param-hint";
    hint.textContent = p.description;
    row.appendChild(hint);
  }

  var input;
  if (p.type === "file") {
    // File parameter; read client-side on Run.
    input = document.createElement("input");
    input.type = "file";
    input.setAttribute("data-skill-param", p.name || "");
    input.setAttribute("data-skill-param-type", "file");
    if (p.accepts) input.setAttribute("accept", p.accepts);
  } else if (p.type === "boolean") {
    input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("data-skill-param", p.name || "");
    input.setAttribute("data-skill-param-type", "boolean");
  } else if (p.type === "number") {
    input = document.createElement("input");
    input.type = "number";
    input.className = "settings-input";
    input.setAttribute("data-skill-param", p.name || "");
    input.setAttribute("data-skill-param-type", "number");
  } else {
    // string / entityId — plain text input.
    input = document.createElement("input");
    input.type = "text";
    input.className = "settings-input";
    input.setAttribute("data-skill-param", p.name || "");
    input.setAttribute("data-skill-param-type", p.type || "string");
  }
  row.appendChild(input);
  return row;
}

// Test helper — close the overlay cleanly.
export function _closeCanvasChatForTests() {
  try {
    _activeRunningSkill = null;
    closeOverlay();
  } catch (_e) { /* best-effort */ }
}

// ─── Skill run-time ─────────────────────────────────────────────────

// runSkill(skill, panelHost) — run-time wiring.
//
// Reads parameter inputs from the skill panel right-rail (panelHost),
// substitutes them into the saved skill.improvedPrompt (a CARE-structured
// XML prompt), calls the LLM via services/aiService.js chatCompletion, and
// renders the response into the dynamic Skill tab's left chat dialog.
//
// Output-format dispatch:
//   text          → render as an AI turn in the chat dialog
//   dimensional   → render as JSON in the Skill panel output area
//   json-array    → render as a proposed-mutation list; applyMutations
//                   wires the apply-gate per skill.mutationPolicy
//   scalar        → same as json-array (single-mutation case)
//
// File parameters are read client-side via FileReader.readAsText at
// run-time; their content never persists with the skill.
//
// The chatCompletion call routes through whatever provider is active in
// loadAiConfig() — the same transport the regular Chat tab uses.
export async function runSkill(skill, panelHost) {
  if (!skill || typeof skill !== "object") return;
  if (typeof skill.improvedPrompt !== "string" || !skill.improvedPrompt.trim()) {
    _appendSkillDialogTurn("error",
      "This skill has no improved prompt. Open Settings → Skills builder, click Improve, then Save.");
    return;
  }

  // Step 1 — collect parameter values (file params resolve via FileReader).
  var paramValues;
  try {
    paramValues = await _collectSkillParamValues(skill, panelHost);
  } catch (e) {
    _appendSkillDialogTurn("error", "Failed to read parameters: " + (e && e.message || e));
    return;
  }

  // Step 2 — build the user message (pure function). Combines the
  // <engagement-data> block of resolved dataPoint values with the data-
  // path-resolved + parameter-substituted improvedPrompt.
  var engagement = getActiveEngagement();
  var userMessage = _buildSkillUserMessage(skill, paramValues, engagement);

  // Step 3 — do NOT render the resolved prompt as a "user turn". The
  // prompt sent to the LLM is internal plumbing; the dialog shows only AI
  // responses plus any clarifying turns the user types back. Rendering it
  // would leak the entire CARE XML into the visible chat.

  // Step 4 — LLM call.
  try {
    var cfg = loadAiConfig();
    var activeKey = cfg && cfg.activeProvider;
    var active = cfg && cfg.providers && cfg.providers[activeKey];
    if (!active) {
      _appendSkillDialogTurn("error",
        "No active LLM provider configured. Open Settings → AI Providers to set one up.");
      return;
    }
    var res = await chatCompletion({
      providerKey: activeKey,
      baseUrl:     active.baseUrl,
      model:       active.model,
      apiKey:      active.apiKey,
      messages: [
        // Hardened system prompt: the explicit "DO NOT echo" rules and
        // format directive stop the model from repeating the CARE XML
        // template back instead of executing it.
        { role: "system", content:
            "You are executing a saved skill. The user message below MAY start with an <engagement-data> " +
            "block listing concrete values from the user's active engagement. That block is the AUTHORITATIVE " +
            "context for the task — treat each `path: value` line as ground-truth data. The rest of the user " +
            "message is a CARE-structured prompt (<context>, <task>, <format>, <examples>) describing what " +
            "to do. Your job: EXECUTE the <task> using the data in the <engagement-data> block, producing " +
            "ONLY the final answer in the shape the <format> section specifies." +
            "\n\nSTRICT RULES:\n" +
            "  1. DO NOT echo the prompt template back. DO NOT include <engagement-data>, <context>, <task>, " +
            "<format>, or <examples> XML tags in your response.\n" +
            "  2. DO NOT explain your reasoning, restate the task, or include preamble like 'Here is the " +
            "answer:' — output the answer directly.\n" +
            "  3. DO NOT generate hypothetical or example values (e.g. fake company names). Only emit " +
            "values derived from the <engagement-data> block or the <context> data provided.\n" +
            "  4. If the <engagement-data> block is missing or empty AND the <context> doesn't carry the " +
            "needed information, output exactly: '[insufficient data: <what is missing>]' and nothing else. " +
            "If the <engagement-data> block has the value the task asks for, USE IT — do NOT claim data " +
            "is missing.\n" +
            "  5. Match the <format> exactly: if it says 'single line of plain text', output one line, no " +
            "markdown, no quotes. If it says JSON, output valid JSON only."
        },
        { role: "user",   content: userMessage }
      ]
    });
    var responseText = (res && res.text) || "";
    _renderSkillRunOutput(skill, panelHost, responseText);
  } catch (e) {
    _appendSkillDialogTurn("error", "Run failed: " + (e && e.message || e) +
      ". Try again, or check Settings → AI Providers.");
  }
}

// Builds the final user message sent to the LLM. Pure function (no I/O,
// no LLM call).
//
// Output shape:
//   <engagement-data>
//   <path-1>: <resolved value>
//   <path-2>: <resolved value>
//   </engagement-data>
//
//   <CARE prompt with data-paths + parameters substituted in>
//
// The <engagement-data> block is omitted entirely when skill.dataPoints
// is empty or missing. Paths that resolve to empty / "[?]" / null render
// as "[not set]" so the bare pathResolver marker doesn't leak through.
export function _buildSkillUserMessage(skill, paramValues, engagement) {
  var skillCtx = _buildSkillRunCtx(engagement);
  // Resolve schema-keyed data paths in the improvedPrompt body.
  var dataResolved = resolveTemplate(skill.improvedPrompt || "",
    skillCtx, { skillId: skill.skillId });
  // Substitute {{paramName}} placeholders for run-time parameters.
  var resolvedPrompt = _substituteSkillParams(dataResolved, paramValues);
  // Prepend the engagement-data block. Pass engagement so the block
  // builder can iterate per-record and emit relational markdown tables
  // when multiple fields from the same collection are selected.
  var dataBlock = _buildEngagementDataBlock(skill.dataPoints, skillCtx, skill.skillId, engagement);
  return dataBlock ? dataBlock + "\n\n" + resolvedPrompt : resolvedPrompt;
}

// Builds the <engagement-data> block from skill.dataPoints, using two
// serialization styles so cross-field relationships survive:
//
//   1. Singletons + 1-field collections + insights → flat
//      `path: value` lines.
//
//   2. 2+ fields picked from the same collection (driver / environment /
//      instance / gap) → wrapped in <entityKind>s>...</entityKind>s> and
//      rendered as a MARKDOWN TABLE where each row is one entity and the
//      columns are the selected fields.
//
// The table form matters because emitting several fields as parallel
// newline-joined lists loses row alignment, so the LLM can't answer
// questions like "what's the disposition of the desired instances in
// Primary DC". The table makes the relational shape explicit.
export function _buildEngagementDataBlock(dataPoints, skillCtx, skillId, engagement) {
  if (!Array.isArray(dataPoints) || dataPoints.length === 0) return "";

  // Group selected paths by entity. PICKER_METADATA tells us which entity
  // each path belongs to ("customer" / "engagementMeta" / "driver" /
  // "environment" / "instance" / "gap" / "insights").
  var byEntity = {
    customer: [], engagementMeta: [],
    driver: [], environment: [], instance: [], gap: [],
    insights: [], _unknown: []
  };
  dataPoints.forEach(function(dp) {
    if (!dp || !dp.path) return;
    var meta = PICKER_METADATA_LOCAL && PICKER_METADATA_LOCAL[dp.path];
    var entity = (meta && meta.entity) || _entityFromPath(dp.path);
    if (!byEntity[entity]) byEntity[entity] = [];
    byEntity[entity].push(dp.path);
  });

  var lines = ["<engagement-data>"];
  var hasContent = false;

  // ─── Singletons + scalars → flat key: value lines ──────────────────
  // customer, engagementMeta, insights, and any _unknown paths render
  // as the original key:value style. These are aggregates / singletons
  // with no row-binding to preserve.
  ["customer", "engagementMeta", "insights", "_unknown"].forEach(function(entity) {
    (byEntity[entity] || []).forEach(function(path) {
      var resolved = resolveTemplate("{{" + path + "}}", skillCtx,
        { skillId: skillId || "data-block" });
      var displayValue = (resolved === "[?]" || resolved === "" || resolved == null)
        ? "[not set]"
        : resolved;
      lines.push(path + ": " + displayValue);
      hasContent = true;
    });
  });

  // ─── Collections → flat (1 field) OR markdown table (2+ fields) ────
  ["driver", "environment", "instance", "gap"].forEach(function(entity) {
    var paths = byEntity[entity] || [];
    if (paths.length === 0) return;

    if (paths.length === 1) {
      // Single field selected → flat key:value (newline-joined across
      // records). No row-binding to preserve when there's one column.
      var path = paths[0];
      var resolved = resolveTemplate("{{" + path + "}}", skillCtx,
        { skillId: skillId || "data-block" });
      var displayValue = (resolved === "[?]" || resolved === "" || resolved == null)
        ? "[not set]"
        : resolved;
      lines.push(path + ": " + displayValue);
      hasContent = true;
      return;
    }

    // 2+ fields from the same collection → markdown table.
    var records = _getCollectionRecords(entity, engagement);
    if (records.length === 0) {
      // No records to put in the table — fall back to per-field [not set] lines.
      paths.forEach(function(path) {
        lines.push(path + ": [not set]");
      });
      hasContent = true;
      return;
    }

    var fieldNames = paths.map(function(p) { return p.split(".").pop(); });
    if (lines[lines.length - 1] !== "<engagement-data>") lines.push("");   // blank-line separator
    lines.push("<" + entity + "s>");
    // Header row + alignment row.
    lines.push("| " + fieldNames.join(" | ") + " |");
    lines.push("|" + fieldNames.map(function() { return "---"; }).join("|") + "|");
    // Data rows — one per record.
    records.forEach(function(record) {
      var row = paths.map(function(path) {
        var fieldName = path.split(".").pop();
        var value = _resolveRecordField(entity, fieldName, record, engagement);
        if (value == null || value === "") return "-";
        // Escape pipes + collapse newlines so the table row stays on one line.
        return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
      });
      lines.push("| " + row.join(" | ") + " |");
    });
    lines.push("</" + entity + "s>");
    hasContent = true;
  });

  if (!hasContent) return "";
  lines.push("</engagement-data>");
  return lines.join("\n");
}

// Helper · derive entity from path when PICKER_METADATA is unavailable.
function _entityFromPath(path) {
  if (!path || typeof path !== "string") return "_unknown";
  var head = path.split(".")[0];
  if (head === "customer" || head === "engagementMeta" || head === "insights") return head;
  if (head === "driver" || head === "environment" || head === "instance" || head === "gap") return head;
  return "_unknown";
}

// Helper · returns the engagement's records for one collection entity.
function _getCollectionRecords(entity, engagement) {
  if (!engagement) return [];
  var key = (entity === "driver") ? "drivers"
          : (entity === "environment") ? "environments"
          : (entity === "instance") ? "instances"
          : (entity === "gap") ? "gaps"
          : null;
  if (!key) return [];
  var coll = engagement[key];
  if (!coll || !Array.isArray(coll.allIds) || !coll.byId) return [];
  return coll.allIds.map(function(id) { return coll.byId[id]; }).filter(Boolean);
}

// Helper · resolve ONE record's field for the table. Mirrors the
// singular-accessor logic in _buildXxxAccessor but for a single
// record instead of joining across the collection.
function _resolveRecordField(entity, fieldName, record, engagement) {
  if (!record) return "";

  if (entity === "driver") {
    if (fieldName === "name") {
      var dm = (BUSINESS_DRIVERS_CAT || []).find(function(bd) { return bd.id === record.businessDriverId; });
      return dm ? dm.label : (record.businessDriverId || "");
    }
    if (fieldName === "hint") {
      var dm2 = (BUSINESS_DRIVERS_CAT || []).find(function(bd) { return bd.id === record.businessDriverId; });
      return dm2 ? (dm2.hint || dm2.shortHint || "") : "";
    }
    return record[fieldName] != null ? String(record[fieldName]) : "";
  }

  if (entity === "environment") {
    if (fieldName === "name") {
      if (record.alias && record.alias.length > 0) return record.alias;
      var ec = (ENV_CATALOG_CAT || []).find(function(c) { return c.id === record.envCatalogId; });
      return ec ? ec.label : (record.envCatalogId || "");
    }
    if (fieldName === "kindLabel") {
      var ec2 = (ENV_CATALOG_CAT || []).find(function(c) { return c.id === record.envCatalogId; });
      return ec2 ? ec2.label : (record.envCatalogId || "");
    }
    return record[fieldName] != null ? String(record[fieldName]) : "";
  }

  if (entity === "instance") {
    if (fieldName === "layerLabel") {
      var lm = (LAYERS_CAT || []).find(function(l) { return l.id === record.layerId; });
      return lm ? lm.label : (record.layerId || "");
    }
    if (fieldName === "environmentName") {
      var envRec = engagement && engagement.environments && engagement.environments.byId && engagement.environments.byId[record.environmentId];
      if (envRec && envRec.alias && envRec.alias.length > 0) return envRec.alias;
      var ec3 = envRec ? (ENV_CATALOG_CAT || []).find(function(c) { return c.id === envRec.envCatalogId; }) : null;
      return ec3 ? ec3.label : (record.environmentId || "");
    }
    if (fieldName === "dispositionLabel") {
      if (!record.disposition) return "";
      var dm3 = (DISPOSITION_ACTIONS_CAT || []).find(function(a) { return a.id === record.disposition; });
      return dm3 ? dm3.label : record.disposition;
    }
    return record[fieldName] != null ? String(record[fieldName]) : "";
  }

  if (entity === "gap") {
    if (fieldName === "gapTypeLabel") {
      var gt = (GAP_TYPES_CAT || []).find(function(t) { return t.id === record.gapType; });
      return gt ? gt.label : (record.gapType || "");
    }
    if (fieldName === "layerLabel") {
      var lm2 = (LAYERS_CAT || []).find(function(l) { return l.id === record.layerId; });
      return lm2 ? lm2.label : (record.layerId || "");
    }
    if (fieldName === "driverName") {
      if (!record.driverId) return "";
      var drv = engagement && engagement.drivers && engagement.drivers.byId && engagement.drivers.byId[record.driverId];
      if (!drv) return "";
      var dmGap = (BUSINESS_DRIVERS_CAT || []).find(function(bd) { return bd.id === drv.businessDriverId; });
      return dmGap ? dmGap.label : drv.businessDriverId;
    }
    if (fieldName === "affectedLayerLabels") {
      if (!Array.isArray(record.affectedLayers)) return "";
      return record.affectedLayers.map(function(lid) {
        var lm3 = (LAYERS_CAT || []).find(function(l) { return l.id === lid; });
        return lm3 ? lm3.label : lid;
      }).join(", ");
    }
    if (fieldName === "affectedEnvironmentNames") {
      if (!Array.isArray(record.affectedEnvironments)) return "";
      return record.affectedEnvironments.map(function(eid) {
        var ev = engagement && engagement.environments && engagement.environments.byId && engagement.environments.byId[eid];
        if (ev && ev.alias && ev.alias.length > 0) return ev.alias;
        var ec4 = ev ? (ENV_CATALOG_CAT || []).find(function(c) { return c.id === ev.envCatalogId; }) : null;
        return ec4 ? ec4.label : eid;
      }).join(", ");
    }
    if (fieldName === "servicesLabels") {
      if (!Array.isArray(record.services)) return "";
      return record.services.map(function(sid) {
        var sv = (SERVICE_TYPES_CAT || []).find(function(s) { return s.id === sid; });
        return sv ? sv.label : sid;
      }).join(", ");
    }
    return record[fieldName] != null ? String(record[fieldName]) : "";
  }

  return record[fieldName] != null ? String(record[fieldName]) : "";
}

// Builds the resolver context for a skill run. resolveTemplate walks
// `ctx.<path>`, so engagement collections are exposed at the top level
// (not under ctx.engagement.<path>):
//   · Customer + engagementMeta as singletons.
//   · Singular accessors (ctx.driver / .environment / .instance / .gap).
//     Each property iterates the collection and joins values with
//     newlines, so schema-keyed paths like "driver.priority" resolve.
//   · Label-resolved paths route through core/labelResolvers.js + the
//     catalog snapshots, so a skill bound to "driver.name" sees
//     "Cyber Resilience", not "cyber_resilience".
//   · insights namespace (ctx.insights.*) for derived selectors
//     (coverage / risk / totals / Dell density / projects / brief).
export function _buildSkillRunCtx(engagement) {
  if (!engagement) return {};

  var collFlat = function(coll) {
    if (!coll || !Array.isArray(coll.allIds) || !coll.byId) return [];
    return coll.allIds.map(function(id) { return coll.byId[id]; }).filter(Boolean);
  };

  // Base collections, exposed in plural form.
  var drivers      = collFlat(engagement.drivers);
  var environments = collFlat(engagement.environments);
  var instances    = collFlat(engagement.instances);
  var gaps         = collFlat(engagement.gaps);

  // Customer singleton with the label-resolved verticalLabel attached.
  var customer = Object.assign({}, engagement.customer || {});
  if (customer.vertical) {
    // CUSTOMER_VERTICALS catalog lookup (best-effort; falls back to id).
    try {
      var v = (CATALOGS_CUSTOMER_VERTICALS || []).find(function(c) { return c.id === customer.vertical; });
      customer.verticalLabel = v ? v.label : customer.vertical;
    } catch (_e) {
      customer.verticalLabel = customer.vertical;
    }
  }

  var ctx = {
    engagement:     engagement,
    customer:       customer,
    engagementMeta: engagement.meta || {},
    drivers:        drivers,
    environments:   environments,
    instances:      instances,
    gaps:           gaps,
    // Singular accessors with label-resolved properties.
    driver:         _buildDriverAccessor(drivers),
    environment:    _buildEnvironmentAccessor(environments),
    instance:       _buildInstanceAccessor(instances, engagement),
    gap:            _buildGapAccessor(gaps, engagement, drivers, environments),
    // Insights namespace (derived selectors).
    insights:       _buildInsightsAccessor(engagement)
  };

  return ctx;
}

// Singular accessor for the driver collection. Iterates all drivers and
// returns a synthetic object whose properties are newline-joined across
// the collection. Label-resolved paths (driver.name) go through the
// BUSINESS_DRIVERS catalog.
function _buildDriverAccessor(drivers) {
  if (!Array.isArray(drivers) || drivers.length === 0) return {};
  var join = function(values) {
    return values.filter(function(v) { return v != null && v !== ""; }).join("\n");
  };
  return {
    name: join(drivers.map(function(d) {
      var meta = (BUSINESS_DRIVERS_CAT || []).find(function(bd) { return bd.id === d.businessDriverId; });
      return meta ? meta.label : (d.businessDriverId || "");
    })),
    hint: join(drivers.map(function(d) {
      var meta = (BUSINESS_DRIVERS_CAT || []).find(function(bd) { return bd.id === d.businessDriverId; });
      return meta ? (meta.hint || meta.shortHint || "") : "";
    })),
    priority: join(drivers.map(function(d) { return d.priority || ""; })),
    outcomes: join(drivers.map(function(d) { return d.outcomes || ""; })),
    businessDriverId: join(drivers.map(function(d) { return d.businessDriverId || ""; }))
  };
}

// Singular accessor for the environment collection. Includes both the
// raw fields (alias / location / sizeKw / etc.) and the synthetic "name"
// path (alias || catalog label).
function _buildEnvironmentAccessor(environments) {
  if (!Array.isArray(environments) || environments.length === 0) return {};
  var join = function(values) {
    return values.filter(function(v) { return v != null && v !== ""; }).join("\n");
  };
  return {
    name: join(environments.map(function(e) {
      if (e.alias && e.alias.length > 0) return e.alias;
      var meta = (ENV_CATALOG_CAT || []).find(function(c) { return c.id === e.envCatalogId; });
      return meta ? meta.label : (e.envCatalogId || "");
    })),
    alias:    join(environments.map(function(e) { return e.alias || ""; })),
    location: join(environments.map(function(e) { return e.location || ""; })),
    tier:     join(environments.map(function(e) { return e.tier || ""; })),
    sizeKw:   join(environments.map(function(e) { return e.sizeKw != null ? String(e.sizeKw) : ""; })),
    sqm:      join(environments.map(function(e) { return e.sqm != null ? String(e.sqm) : ""; })),
    notes:    join(environments.map(function(e) { return e.notes || ""; })),
    envCatalogId: join(environments.map(function(e) { return e.envCatalogId || ""; })),
    kindLabel: join(environments.map(function(e) {
      var meta = (ENV_CATALOG_CAT || []).find(function(c) { return c.id === e.envCatalogId; });
      return meta ? meta.label : (e.envCatalogId || "");
    }))
  };
}

// Singular accessor for the instance collection. Joins via labelResolvers
// for layer + environment + disposition label paths.
function _buildInstanceAccessor(instances, engagement) {
  if (!Array.isArray(instances) || instances.length === 0) return {};
  var join = function(values) {
    return values.filter(function(v) { return v != null && v !== ""; }).join("\n");
  };
  return {
    label:        join(instances.map(function(i) { return i.label || ""; })),
    vendor:       join(instances.map(function(i) { return i.vendor || ""; })),
    vendorGroup:  join(instances.map(function(i) { return i.vendorGroup || ""; })),
    criticality:  join(instances.map(function(i) { return i.criticality || ""; })),
    notes:        join(instances.map(function(i) { return i.notes || ""; })),
    priority:     join(instances.map(function(i) { return i.priority || ""; })),
    state:        join(instances.map(function(i) { return i.state || ""; })),
    layerId:      join(instances.map(function(i) { return i.layerId || ""; })),
    layerLabel:   join(instances.map(function(i) {
      var meta = (LAYERS_CAT || []).find(function(l) { return l.id === i.layerId; });
      return meta ? meta.label : (i.layerId || "");
    })),
    environmentName: join(instances.map(function(i) {
      var env = engagement.environments && engagement.environments.byId && engagement.environments.byId[i.environmentId];
      if (env && env.alias && env.alias.length > 0) return env.alias;
      var cat = env ? (ENV_CATALOG_CAT || []).find(function(c) { return c.id === env.envCatalogId; }) : null;
      return cat ? cat.label : (i.environmentId || "");
    })),
    dispositionLabel: join(instances.map(function(i) {
      if (!i.disposition) return "";
      var meta = (DISPOSITION_ACTIONS_CAT || []).find(function(a) { return a.id === i.disposition; });
      return meta ? meta.label : i.disposition;
    })),
    disposition: join(instances.map(function(i) { return i.disposition || ""; }))
  };
}

// Singular accessor for the gap collection. Includes multi-hop labels
// (gap.driverName joins through drivers collection to BUSINESS_DRIVERS)
// and array-resolved label paths (affectedEnvironmentNames, etc.).
function _buildGapAccessor(gaps, engagement, drivers, environments) {
  if (!Array.isArray(gaps) || gaps.length === 0) return {};
  var join = function(values) {
    return values.filter(function(v) { return v != null && v !== ""; }).join("\n");
  };
  var driversById = {};
  if (engagement.drivers && engagement.drivers.byId) driversById = engagement.drivers.byId;
  var envsById = {};
  if (engagement.environments && engagement.environments.byId) envsById = engagement.environments.byId;
  return {
    description: join(gaps.map(function(g) { return g.description || ""; })),
    urgency:     join(gaps.map(function(g) { return g.urgency || ""; })),
    phase:       join(gaps.map(function(g) { return g.phase || ""; })),
    status:      join(gaps.map(function(g) { return g.status || ""; })),
    notes:       join(gaps.map(function(g) { return g.notes || ""; })),
    origin:      join(gaps.map(function(g) { return g.origin || ""; })),
    reviewed:    join(gaps.map(function(g) { return String(g.reviewed === true); })),
    urgencyOverride: join(gaps.map(function(g) { return String(g.urgencyOverride === true); })),
    gapType:     join(gaps.map(function(g) { return g.gapType || ""; })),
    layerId:     join(gaps.map(function(g) { return g.layerId || ""; })),
    driverId:    join(gaps.map(function(g) { return g.driverId || ""; })),
    gapTypeLabel: join(gaps.map(function(g) {
      var meta = (GAP_TYPES_CAT || []).find(function(t) { return t.id === g.gapType; });
      return meta ? meta.label : (g.gapType || "");
    })),
    layerLabel: join(gaps.map(function(g) {
      var meta = (LAYERS_CAT || []).find(function(l) { return l.id === g.layerId; });
      return meta ? meta.label : (g.layerId || "");
    })),
    driverName: join(gaps.map(function(g) {
      if (!g.driverId) return "";
      var driver = driversById[g.driverId];
      if (!driver) return "";
      var meta = (BUSINESS_DRIVERS_CAT || []).find(function(bd) { return bd.id === driver.businessDriverId; });
      return meta ? meta.label : driver.businessDriverId;
    })),
    affectedLayerLabels: join(gaps.map(function(g) {
      if (!Array.isArray(g.affectedLayers) || g.affectedLayers.length === 0) return "";
      return g.affectedLayers.map(function(lid) {
        var meta = (LAYERS_CAT || []).find(function(l) { return l.id === lid; });
        return meta ? meta.label : lid;
      }).join(", ");
    })),
    affectedEnvironmentNames: join(gaps.map(function(g) {
      if (!Array.isArray(g.affectedEnvironments) || g.affectedEnvironments.length === 0) return "";
      return g.affectedEnvironments.map(function(eid) {
        var env = envsById[eid];
        if (env && env.alias && env.alias.length > 0) return env.alias;
        var cat = env ? (ENV_CATALOG_CAT || []).find(function(c) { return c.id === env.envCatalogId; }) : null;
        return cat ? cat.label : eid;
      }).join(", ");
    })),
    servicesLabels: join(gaps.map(function(g) {
      if (!Array.isArray(g.services) || g.services.length === 0) return "";
      return g.services.map(function(sid) {
        var meta = (SERVICE_TYPES_CAT || []).find(function(s) { return s.id === sid; });
        return meta ? meta.label : sid;
      }).join(", ");
    }))
  };
}

// Insights accessor — wraps the reporting selectors. Each property is
// computed eagerly here.
function _buildInsightsAccessor(engagement) {
  // The selectors expect the legacy session shape; getEngagementAsSession()
  // projects it. Coverage / risk / summary / projects all accept a session;
  // brief assembles the roll-up rows.
  var session = null;
  try { session = getEngagementAsSession(); } catch (_e) { session = null; }
  if (!session) return {};
  // Defensive: services may throw on incomplete sessions.
  var coverage = {};
  var risk = {};
  var summary = {};
  var projects = [];
  var dellByLayer = {};
  var brief = [];
  try { coverage = computeDiscoveryCoverage(session) || {}; } catch (_e) {}
  try { risk     = computeRiskPosture(session) || {};     } catch (_e) {}
  try { summary  = getHealthSummary(session, LAYERS_CAT || [], ENV_CATALOG_CAT || []) || {}; } catch (_e) {}
  try { projects = (buildProjects(session, {}) || {}).projects || []; } catch (_e) {}
  try { brief    = generateSessionBrief(session) || []; } catch (_e) {}
  try {
    (LAYERS_CAT || []).forEach(function(layer) {
      var mix = computeMixByLayer({ stateFilter: "combined", layerIds: [layer.id] });
      var row = (mix && mix[0]) || null;
      if (row && row.total > 0) {
        dellByLayer[layer.id] = Math.round(100 * (row.dell || 0) / row.total);
      } else {
        dellByLayer[layer.id] = 0;
      }
    });
  } catch (_e) {}
  // Overall Dell density.
  var dellTotal = 0, total = 0;
  (engagement.instances && engagement.instances.allIds || []).forEach(function(id) {
    var inst = engagement.instances.byId[id];
    if (!inst) return;
    total++;
    if (inst.vendorGroup === "dell") dellTotal++;
  });
  var dellDensityPercent = total > 0 ? Math.round(100 * dellTotal / total) : 0;
  // Group projects by phase + by driver.
  var byPhase = { now: [], next: [], later: [] };
  projects.forEach(function(p) {
    if (byPhase[p.phase]) byPhase[p.phase].push(p.name || p.label);
  });
  var byDriver = {};
  try {
    var grouped = groupProjectsByProgram(projects, session) || {};
    Object.keys(grouped).forEach(function(key) {
      if (key === "unassigned") {
        byDriver["unassigned"] = (grouped[key] || []).map(function(p) { return p.name || p.label; });
        return;
      }
      // Resolve driver id → name via BUSINESS_DRIVERS catalog.
      var driverRec = engagement.drivers && engagement.drivers.byId && engagement.drivers.byId[key];
      var meta = driverRec ? (BUSINESS_DRIVERS_CAT || []).find(function(bd) { return bd.id === driverRec.businessDriverId; }) : null;
      var driverName = meta ? meta.label : key;
      byDriver[driverName] = (grouped[key] || []).map(function(p) { return p.name || p.label; });
    });
  } catch (_e) {}
  return {
    coverage: {
      percent: coverage.percent != null ? coverage.percent : 0,
      actions: (coverage.actions || []).join("\n")
    },
    risk: {
      level: risk.level || "",
      actions: (risk.actions || []).join("\n")
    },
    totals: {
      currentInstances: summary.totalCurrent != null ? summary.totalCurrent : 0,
      desiredInstances: summary.totalDesired != null ? summary.totalDesired : 0,
      gaps:             summary.totalGaps    != null ? summary.totalGaps    : 0,
      highUrgencyGaps:  summary.highRiskGaps != null ? summary.highRiskGaps : 0,
      unreviewedGaps:   (engagement.gaps && engagement.gaps.allIds || []).filter(function(id) {
        var g = engagement.gaps.byId[id];
        return g && g.reviewed === false && g.status === "open";
      }).length
    },
    dellDensity: {
      percent: dellDensityPercent,
      byLayer: dellByLayer
    },
    projects: {
      names: projects.map(function(p) { return p.name || p.label; }).join("\n"),
      byPhase: JSON.stringify(byPhase),
      byDriver: JSON.stringify(byDriver)
    },
    executiveSummary: {
      brief: brief.map(function(r) { return (r.label || "") + ": " + (r.text || ""); }).join("\n")
    }
  };
}

// Reads parameter values from the panel's input rows.
// File-type params resolve via FileReader.readAsText (returns "" when
// no file picked).
async function _collectSkillParamValues(skill, host) {
  var values = {};
  var params = (skill && Array.isArray(skill.parameters)) ? skill.parameters : [];
  for (var i = 0; i < params.length; i++) {
    var p = params[i];
    if (!p || !p.name) continue;
    var input = host && host.querySelector("[data-skill-param='" + p.name + "']");
    if (!input) { values[p.name] = ""; continue; }
    if (p.type === "file") {
      var f = input.files && input.files[0];
      values[p.name] = f ? await _readFileAsText(f) : "";
    } else if (p.type === "boolean") {
      values[p.name] = input.checked ? "true" : "false";
    } else if (p.type === "number") {
      var n = input.valueAsNumber;
      values[p.name] = (typeof n === "number" && !isNaN(n)) ? String(n) : "0";
    } else {
      values[p.name] = input.value || "";
    }
  }
  return values;
}

function _readFileAsText(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function() { resolve(reader.result || ""); };
    reader.onerror = function() { reject(reader.error || new Error("FileReader failed")); };
    reader.readAsText(file);
  });
}

// String replace on {{paramName}} placeholders. Unknown names pass
// through unchanged so the user can see what didn't substitute.
function _substituteSkillParams(template, values) {
  if (typeof template !== "string") return "";
  return template.replace(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g, function(match, name) {
    return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : match;
  });
}

// Append a turn into the active dynamic Skill tab's left chat dialog.
// Roles: "user" (the resolved prompt), "ai" (LLM response), "error".
function _appendSkillDialogTurn(role, content) {
  var dialog = document.querySelector("[data-canvas-chat-skill-dialog]");
  if (!dialog) return;
  var emptyHint = dialog.querySelector(".canvas-chat-skill-dialog-empty");
  if (emptyHint) emptyHint.remove();
  var turn = document.createElement("div");
  turn.className = "canvas-chat-skill-dialog-turn canvas-chat-skill-dialog-" + role;
  turn.textContent = content == null ? "" : String(content);
  dialog.appendChild(turn);
  dialog.scrollTop = dialog.scrollHeight;
}

// Per-outputFormat dispatch. text renders as a dialog turn; the other
// formats render into the panel output area, where applyMutations() and
// the ask/auto-tag policy gate take over.
function _renderSkillRunOutput(skill, panelHost, responseText) {
  var format = skill && skill.outputFormat;
  if (format === "text") {
    _appendSkillDialogTurn("ai", responseText);
    return;
  }
  var output = panelHost && panelHost.querySelector("[data-skill-panel-output]");
  if (format === "dimensional") {
    _appendSkillDialogTurn("ai",
      "Dimensional output produced (heatmap renderer deferred to a polish arc).");
    if (output) output.textContent = responseText;
    return;
  }
  if (format === "json-array" || format === "scalar") {
    _appendSkillDialogTurn("ai",
      "Proposed mutations (apply gate lands at rc.8.b R7 per skill.mutationPolicy='" +
      (skill.mutationPolicy || "(none)") + "'):");
    if (output) output.textContent = responseText;
    return;
  }
  // Unknown format — surface as plain AI turn so the user sees the response.
  _appendSkillDialogTurn("ai", responseText);
}

// Applies a list of AI-authored mutations to the active engagement,
// routing through commitAction so the update propagates to subscribers
// and persists.
//
// Both mutation policies stamp aiTag = runMeta on every mutated instance:
//   policy='ask'      → render an approval modal with a single batch
//                       confirm; on Apply commit all proposals, on Discard
//                       drop them all.
//   policy='auto-tag' → commit all proposals immediately (no modal).
//
// Scope: instances only. Proposals targeting drivers / environments /
// gaps / customer / engagementMeta are skipped (logged, not committed).
//
// Proposal shape: { op, path, value }
//   op: 'set' | 'addInstance'
//   path: 'instances.byId.<id>.<field>' for 'set'
//         'instances.<state>'           for 'addInstance'
//   value: the new field value (for 'set') or the full instance shape
//          (for 'addInstance')
//
// runMeta: { skillId, runId, mutatedAt } — required; stamped onto each
//   affected instance's aiTag.
export function applyMutations(proposals, policy, runMeta) {
  if (!Array.isArray(proposals) || proposals.length === 0) return;
  if (!runMeta || !runMeta.skillId || !runMeta.runId || !runMeta.mutatedAt) {
    console.warn("[applyMutations] runMeta { skillId, runId, mutatedAt } required; skipping");
    return;
  }
  if (policy === "ask") {
    _showMutationApprovalModal(proposals, runMeta);
    return;
  }
  // 'auto-tag' — apply immediately
  _commitAiMutations(proposals, runMeta);
}

function _showMutationApprovalModal(proposals, runMeta) {
  // Single-batch confirm modal (no per-row toggle).
  var existing = document.querySelector("[data-mutation-approve]");
  if (existing) existing.remove();

  var modal = document.createElement("div");
  modal.className = "mutation-approve-modal";
  modal.setAttribute("data-mutation-approve", "");

  var card = document.createElement("div");
  card.className = "mutation-approve-card";

  var title = document.createElement("div");
  title.className = "mutation-approve-title";
  title.textContent = "Apply " + proposals.length + " AI-proposed mutation(s)?";
  card.appendChild(title);

  var subtitle = document.createElement("div");
  subtitle.className = "mutation-approve-subtitle";
  subtitle.textContent = "Each mutated instance will carry a 'Done by AI' badge until you save the next edit on it.";
  card.appendChild(subtitle);

  var list = document.createElement("ul");
  list.className = "mutation-approve-list";
  proposals.slice(0, 50).forEach(function(p) {
    var li = document.createElement("li");
    li.textContent = (p.op || "set") + " · " + (p.path || "(no path)") +
      (p.value !== undefined ? " = " + _summarizeValue(p.value) : "");
    list.appendChild(li);
  });
  if (proposals.length > 50) {
    var more = document.createElement("li");
    more.className = "mutation-approve-more";
    more.textContent = "+ " + (proposals.length - 50) + " more...";
    list.appendChild(more);
  }
  card.appendChild(list);

  var actions = document.createElement("div");
  actions.className = "mutation-approve-actions";
  var discard = document.createElement("button");
  discard.type = "button";
  discard.className = "btn-secondary";
  discard.setAttribute("data-mutation-discard", "");
  discard.textContent = "Discard";
  discard.addEventListener("click", function() { modal.remove(); });
  var apply = document.createElement("button");
  apply.type = "button";
  apply.className = "btn-primary";
  apply.setAttribute("data-mutation-apply", "");
  apply.textContent = "Apply all";
  apply.addEventListener("click", function() {
    modal.remove();
    _commitAiMutations(proposals, runMeta);
  });
  actions.appendChild(discard);
  actions.appendChild(apply);
  card.appendChild(actions);

  modal.appendChild(card);
  document.body.appendChild(modal);
}

function _summarizeValue(v) {
  if (v === null || v === undefined) return "(empty)";
  if (typeof v === "string") return v.length > 40 ? v.slice(0, 37) + "..." : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v).slice(0, 60) + (JSON.stringify(v).length > 60 ? "..." : "");
}

function _commitAiMutations(proposals, runMeta) {
  var applied = 0;
  var skipped = 0;
  proposals.forEach(function(p) {
    if (!p || !p.path) { skipped++; return; }
    // Parse 'instances.byId.<id>.<field>' for 'set' on existing instance.
    var setMatch = /^instances\.byId\.([^.]+)\.([^.]+)$/.exec(p.path);
    if ((p.op === "set" || !p.op) && setMatch) {
      var instanceId = setMatch[1];
      var field = setMatch[2];
      var patch = {};
      patch[field] = p.value;
      var result = commitAiInstanceMutation(instanceId, patch, runMeta);
      if (result && result.ok) applied++; else skipped++;
      return;
    }
    // Out-of-scope: proposals targeting drivers / envs / gaps / customer /
    // engagementMeta. Log and skip (this path mutates instances only).
    console.warn("[applyMutations] proposal out of scope (instances-only):", p);
    skipped++;
  });
  // Surface a summary turn into the dialog so the user sees the outcome.
  _appendSkillDialogTurn("ai",
    "Applied " + applied + " mutation(s)" +
    (skipped > 0 ? "; skipped " + skipped + " (out-of-scope or invalid)" : "") +
    ". Mutated instances now carry a 'Done by AI' badge in the matrix tile.");
}

function buildFooter() {
  const foot = document.createElement("div");
  foot.className = "canvas-chat-footer";
  const lede = document.createElement("div");
  lede.className = "canvas-chat-foot-lede";
  // Footer breadcrumb shows the latest-turn provenance; the empty state
  // renders nothing, so the breadcrumb appears only once there's something
  // to show. The overlay header's X is the canonical close affordance, so
  // there's no Done button here.
  paintFooterCrumb(lede, null);
  foot.appendChild(lede);
  return foot;
}

// Paint the latest-turn provenance breadcrumb into the footer lede.
// Called with the chat result on onComplete. Missing fields are dropped
// silently (e.g. no latency → just provider label + model + tokens).
function paintFooterCrumb(lede, result) {
  if (!lede) return;
  // Empty state renders nothing: the breadcrumb is information-only and
  // appears only after an assistant turn completes.
  if (!result || !result.provenance) {
    lede.textContent = "";
    return;
  }
  const p = result.provenance;
  const segments = [];
  if (p.providerKey) segments.push(labelForProvider(p.providerKey));
  if (p.model)       segments.push(p.model);
  if (typeof p.tokensIn === "number" || typeof p.tokensOut === "number") {
    const total = (p.tokensIn || 0) + (p.tokensOut || 0);
    segments.push(total.toLocaleString() + " tokens");
  } else if (typeof p.tokens === "number") {
    segments.push(p.tokens.toLocaleString() + " tokens");
  }
  if (typeof p.latencyMs === "number") segments.push(Math.round(p.latencyMs) + "ms");
  lede.textContent = segments.join(" · ");
}

function injectHeaderExtras() {
  const slot = document.querySelector(".overlay[data-kind='canvas-chat'] .overlay-head-extras");
  if (!slot) return;
  slot.innerHTML = "";

  // Provider pill row. Active pill is filled; inactive-ready is outlined
  // with a green dot; inactive-needs-key is outlined with an amber dot.
  // Click semantics:
  //   inactive ready               -> switch active provider (saveAiConfig)
  //   inactive needs-key OR active -> open Settings modal
  paintProviderPills(slot);

  // Clear-chat button.
  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "canvas-chat-clear-btn";
  clearBtn.title = "Clear this engagement's chat transcript";
  clearBtn.innerHTML =
    '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
    'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M2 4h12"/><path d="M5 4V2.5h6V4"/><path d="M3 4l1 10h8l1-10"/></svg>' +
    ' <span>Clear</span>';
  // The confirm UI is inlined in the head-extras slot rather than using a
  // separate confirm overlay: Overlay.js is a singleton, so opening a
  // confirm overlay would close the chat. The Clear button morphs into a
  // "Clear chat? [Yes] [No]" pill cluster on click and restores itself
  // either way, with no overlay swap and no lost state.
  clearBtn.addEventListener("click", function() {
    confirmClearInline(slot, clearBtn);
  });
  slot.appendChild(clearBtn);

  // Ack indicator placeholder (filled by renderAckIndicator on first-turn
  // handshake completion). Empty until the LLM's first response is parsed.
  const ack = document.createElement("span");
  ack.className = "canvas-chat-ack";
  ack.setAttribute("data-canvas-chat-ack", "");
  ack.style.display = "none";
  slot.appendChild(ack);
}

// Single-pill-with-popover provider switcher. One compact pill in the
// header shows the active provider plus a chevron; clicking it reveals a
// popover anchored below that lists every provider with a status dot and
// click-to-switch / click-to-configure semantics. This scales to many
// providers without crowding the header.
function paintProviderPills(slot) {
  const aiCfg      = loadAiConfig();
  const activeKey  = (aiCfg && aiCfg.activeProvider) || "local";
  const activeReady = isProviderReady(aiCfg, activeKey);

  const wrap = document.createElement("div");
  wrap.className = "canvas-chat-provider-pills";
  wrap.setAttribute("data-canvas-chat-provider", "");

  // The visible pill = active provider + chevron. Click opens popover.
  const pill = document.createElement("button");
  pill.type = "button";
  pill.className = "canvas-chat-provider-pill is-active" +
    (activeReady ? " is-ready" : " is-warn");
  pill.setAttribute("data-provider-key", activeKey);
  pill.setAttribute("data-canvas-chat-provider-pill", "");
  pill.setAttribute("aria-haspopup", "menu");
  pill.setAttribute("aria-expanded", "false");
  pill.title = "AI provider: " + labelForProvider(activeKey) +
    (activeReady ? "" : " (needs key)") + ". Click to switch.";
  pill.setAttribute("aria-label", pill.title);

  const dot = document.createElement("span");
  dot.className = "canvas-chat-provider-pill-dot";
  dot.setAttribute("aria-hidden", "true");
  pill.appendChild(dot);

  const label = document.createElement("span");
  label.className = "canvas-chat-provider-pill-label";
  label.textContent = labelForProvider(activeKey);
  pill.appendChild(label);

  // Chevron (down-arrow) signals the dropdown affordance.
  const chev = document.createElement("span");
  chev.className = "canvas-chat-provider-pill-chev";
  chev.setAttribute("aria-hidden", "true");
  chev.innerHTML =
    '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
    'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M4 6l4 4 4-4"/></svg>';
  pill.appendChild(chev);

  wrap.appendChild(pill);

  // Popover anchored below the pill. Hidden by default; toggled on pill
  // click. Each row is one provider (one PROVIDERS entry).
  const popover = document.createElement("div");
  popover.className = "canvas-chat-provider-popover";
  popover.setAttribute("data-canvas-chat-provider-popover", "");
  popover.setAttribute("role", "menu");
  popover.style.display = "none";

  // Row state (class + meta text + routing decision) is rebuilt at
  // popover-OPEN time and re-read from a fresh config at click-DECIDE
  // time, rather than snapshotting once at build time. This keeps the
  // popover honest when the user adds a key in side-panel Settings and
  // returns to chat: the open-time refresh updates the "Ready" label and
  // the click-time refresh routes against the same fresh state.

  // Refresh one row's class + meta text against a fresh config.
  function refreshRow(row, freshCfg) {
    const providerKey = row.getAttribute("data-provider-key");
    const isActive    = providerKey === ((freshCfg && freshCfg.activeProvider) || "local");
    const ready       = isProviderReady(freshCfg, providerKey);
    row.className = "canvas-chat-provider-row" +
      (isActive ? " is-active" : "") +
      (ready ? " is-ready" : " is-warn");
    const meta = row.querySelector(".canvas-chat-provider-row-meta");
    if (meta) {
      // "Configured" (baseUrl + apiKey present) is honest about what the
      // dot signals; it does not imply live reachability. "Active" is the
      // only state that means currently in use.
      meta.textContent = isActive
        ? "Active"
        : (ready ? "Configured" : "Needs key");
    }
  }

  for (const providerKey of PROVIDERS) {
    const row = document.createElement("button");
    row.type = "button";
    row.setAttribute("data-provider-key", providerKey);
    row.setAttribute("role", "menuitem");

    const rowDot = document.createElement("span");
    rowDot.className = "canvas-chat-provider-row-dot";
    row.appendChild(rowDot);

    const rowLabel = document.createElement("span");
    rowLabel.className = "canvas-chat-provider-row-label";
    rowLabel.textContent = labelForProvider(providerKey);
    row.appendChild(rowLabel);

    const rowMeta = document.createElement("span");
    rowMeta.className = "canvas-chat-provider-row-meta";
    row.appendChild(rowMeta);

    // Initial paint with the snapshot config; refreshed on popover open.
    refreshRow(row, aiCfg);

    row.addEventListener("click", function() {
      //   inactive + ready -> switch active provider, repaint
      //   inactive + warn  -> open Settings (key entry)
      //   active           -> open Settings (key management)
      // Re-read fresh config now so the decision uses the latest saved
      // state, not whatever was true when the row was built.
      hidePopover();
      const freshCfg     = loadAiConfig();
      const freshActive  = (freshCfg && freshCfg.activeProvider) || "local";
      const freshIsActive = providerKey === freshActive;
      const freshReady    = isProviderReady(freshCfg, providerKey);
      if (!freshIsActive && freshReady) {
        freshCfg.activeProvider = providerKey;
        saveAiConfig(freshCfg);
        const headSlot = document.querySelector(".overlay[data-kind='canvas-chat'] .overlay-head-extras");
        if (headSlot) injectHeaderExtras();
        return;
      }
      // Keep the chat overlay mounted and open Settings as a side-panel
      // instead of replacing chat. Do NOT call closeOverlay(); the
      // Overlay.js stack handles the side-by-side layout via sidePanel:true.
      openSettingsModal({ section: "providers", focusProvider: providerKey, sidePanel: true });
    });

    popover.appendChild(row);
  }
  wrap.appendChild(popover);

  function showPopover() {
    // Refresh every row's ready/active state from fresh config so the
    // user sees the latest labels each time the popover opens.
    const freshCfg = loadAiConfig();
    popover.querySelectorAll(".canvas-chat-provider-row").forEach(function(r) {
      refreshRow(r, freshCfg);
    });
    popover.style.display = "";
    pill.setAttribute("aria-expanded", "true");
    document.addEventListener("click", outsideClickHandler, true);
  }
  function hidePopover() {
    popover.style.display = "none";
    pill.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", outsideClickHandler, true);
  }
  function outsideClickHandler(e) {
    if (!wrap.contains(e.target)) hidePopover();
  }

  pill.addEventListener("click", function(e) {
    e.stopPropagation();
    if (popover.style.display === "none") showPopover();
    else hidePopover();
  });

  slot.appendChild(wrap);
}

// Per-provider readiness check. Mirrors isActiveProviderReady's shape
// but evaluated against ANY provider key (not just the active one).
function isProviderReady(config, providerKey) {
  const c = config || loadAiConfig();
  const p = c && c.providers && c.providers[providerKey];
  if (!p) return false;
  if (!p.baseUrl) return false;
  // Local providers (A + B) don't require a key (a self-hosted vLLM
  // behind the nginx proxy is unauthenticated); public providers do.
  if (providerKey !== "local" && providerKey !== "localB" && !p.apiKey) return false;
  return true;
}

// Inline confirm for Clear-chat that keeps the chat overlay open. Replaces
// the head-extras Clear button with a "Clear? [Yes] [No]" pill cluster
// while awaiting the user's decision, then restores the Clear button.
function confirmClearInline(slot, clearBtn) {
  if (!slot || !clearBtn) return;
  // Hide the Clear button + paint a confirm strip in its place.
  const placeholder = document.createElement("span");
  placeholder.className = "canvas-chat-clear-confirm";
  placeholder.innerHTML =
    '<span class="canvas-chat-clear-confirm-q">Clear chat?</span>' +
    '<button type="button" class="canvas-chat-clear-confirm-yes">Clear</button>' +
    '<button type="button" class="canvas-chat-clear-confirm-no">Keep</button>';
  slot.replaceChild(placeholder, clearBtn);
  const yesBtn = placeholder.querySelector(".canvas-chat-clear-confirm-yes");
  const noBtn  = placeholder.querySelector(".canvas-chat-clear-confirm-no");

  function restore() {
    if (placeholder.parentNode === slot) slot.replaceChild(clearBtn, placeholder);
  }
  yesBtn.addEventListener("click", function() {
    if (state.engagementId) clearTranscript(state.engagementId);
    state.transcript = { messages: [], summary: null };
    const body = document.querySelector(".overlay[data-kind='canvas-chat'] .overlay-body");
    if (body) paintTranscript(body);
    // Reset the per-session try-asking seed so the empty-state re-rolls
    // a fresh set of prompts (the chat is now empty again).
    state._tryAskingSeed = (Date.now() & 0x7FFFFFFF) || 1;
    restore();
  });
  noBtn.addEventListener("click", restore);
}

// Render the contract-ack outcome.
//   contractAck.ok === true  → green ✓ "grounded" chip in header (auto-fade 3s)
//   contractAck.ok === false → red ⚠ chip + banner above the transcript
function renderAckIndicator(contractAck) {
  const chip = document.querySelector(".overlay[data-kind='canvas-chat'] [data-canvas-chat-ack]");
  if (!chip) return;
  chip.style.display = "";
  if (contractAck.ok) {
    chip.className = "canvas-chat-ack canvas-chat-ack-ok";
    chip.title = "Data contract sha=" + contractAck.expected + " acknowledged by LLM";
    chip.textContent = "✓ grounded";
    setTimeout(function() { chip.style.display = "none"; }, 3000);
  } else {
    chip.className = "canvas-chat-ack canvas-chat-ack-warn";
    chip.title = "Expected sha=" + contractAck.expected +
                 ", received " + (contractAck.received || "(none)");
    chip.textContent = "⚠ ungrounded";
    // Also paint a banner above the transcript on first-turn mismatch.
    const scroll = document.querySelector(".overlay[data-kind='canvas-chat'] .canvas-chat-transcript");
    if (scroll && !scroll.querySelector(".canvas-chat-ack-banner")) {
      const banner = document.createElement("div");
      banner.className = "canvas-chat-ack-banner";
      banner.textContent = "Heads up: the LLM did not echo back the data-contract checksum on its first turn. " +
        "Responses may not be grounded in the live engagement.";
      scroll.insertBefore(banner, scroll.firstChild);
    }
  }
}

function labelForProvider(providerKey) {
  switch (providerKey) {
    case "anthropic":     return "Claude";
    case "openai-compatible":
    case "local":         return "Local A";
    case "localB":        return "Local B";
    case "gemini":        return "Gemini";
    case "dellSalesChat": return "Dell Sales Chat";
    default:              return providerKey || "Provider";
  }
}

function paintTranscript(body) {
  const scroll = body.querySelector(".canvas-chat-transcript");
  if (!scroll) return;
  // Preserve the empty-state node + any transient thinking-state surfaces
  // (typing indicator + tool-status pill), which must survive a
  // paintTranscript that fires mid-turn or just after open.
  const empty       = scroll.querySelector(".canvas-chat-empty");
  const typing      = scroll.querySelector(".canvas-chat-typing-indicator");
  const toolStatus  = scroll.querySelector(".canvas-chat-tool-status");
  scroll.innerHTML = "";
  if (empty)      scroll.appendChild(empty);
  if (typing)     scroll.appendChild(typing);
  if (toolStatus) scroll.appendChild(toolStatus);

  const visibleMessages = state.transcript.messages.filter(function(m) {
    // System-role messages are internal (prior context summaries); only
    // user + assistant messages render.
    return m.role === "user" || m.role === "assistant";
  });

  if (visibleMessages.length === 0) {
    if (empty) {
      empty.style.display = "";
      const grid = empty.querySelector(".canvas-chat-empty-grid");
      if (grid) {
        grid.innerHTML = "";
        // Empty-state prompts come from the dynamic try-asking generator,
        // not the static EXAMPLE_PROMPTS. Pinned to a per-session seed so
        // they don't reshuffle while the user is reading them.
        if (!state._tryAskingSeed) state._tryAskingSeed = (Date.now() & 0x7FFFFFFF) || 1;
        const dynamicPrompts = generateTryAskingPrompts(state.engagement, { seed: state._tryAskingSeed });
        dynamicPrompts.forEach(function(prompt) {
          const tile = document.createElement("button");
          tile.type = "button";
          tile.className = "canvas-chat-example";
          tile.textContent = prompt;
          tile.addEventListener("click", function() {
            const input = body.querySelector(".canvas-chat-input");
            if (input) {
              input.value = prompt;
              input.dispatchEvent(new Event("input"));
              input.focus();
            }
          });
          grid.appendChild(tile);
        });
      }
    }
    return;
  }

  if (empty) empty.style.display = "none";

  for (const msg of visibleMessages) {
    scroll.appendChild(buildMessageBubble(msg));
  }

  // Auto-scroll to bottom.
  scroll.scrollTop = scroll.scrollHeight;
}

function buildMessageBubble(msg) {
  const bubble = document.createElement("div");
  bubble.className = "canvas-chat-msg canvas-chat-msg-" + msg.role;

  const role = document.createElement("div");
  role.className = "canvas-chat-msg-role";
  role.textContent = msg.role === "user" ? "you" : "canvas";
  bubble.appendChild(role);

  const content = document.createElement("div");
  content.className = "canvas-chat-msg-content";
  if (msg.role === "assistant") {
    renderAssistantMarkdown(content, msg.content || "");
  } else {
    content.textContent = msg.content || "";
  }
  bubble.appendChild(content);

  // Render the grounding-annotation footer block when the assistant turn
  // carries groundingViolations. The annotations surface as a footer below
  // the bubble (they never replace the response). Severity drives color:
  // high=red, medium=amber, low=muted.
  if (msg.role === "assistant" && Array.isArray(msg.groundingViolations) && msg.groundingViolations.length > 0) {
    bubble.appendChild(buildGroundingAnnotationsFooter(msg.groundingViolations));
  }

  if (msg.provenance) {
    const prov = document.createElement("div");
    prov.className = "canvas-chat-msg-prov";
    prov.textContent = "via " + (msg.provenance.model || "?") +
      " · " + new Date(msg.provenance.timestamp || Date.now()).toLocaleTimeString();
    bubble.appendChild(prov);
  }

  return bubble;
}

// Renders a footer block below the assistant bubble listing each
// grounding violation as a row tagged with severity
// (.severity-high|medium|low) and an icon hinting at the trust posture:
// 🚨 high, 🤔 medium, ℹ️ low. The container carries
// data-grounding-annotations so it can be located in the DOM.
//
// The annotations are visible-but-informational; they never replace or
// hide the LLM response. The engineer reads the response, reads the
// annotations, and decides whether to accept, regenerate, or correct.
function buildGroundingAnnotationsFooter(violations) {
  const SEVERITY_META = {
    high:   { icon: "🚨", label: "Likely fabricated" },
    medium: { icon: "🤔", label: "Verify" },
    low:    { icon: "ℹ️",  label: "Out-of-engagement reference" }
  };
  const footer = document.createElement("div");
  footer.className = "canvas-chat-grounding-annotations";
  footer.setAttribute("data-grounding-annotations", "");

  const head = document.createElement("div");
  head.className = "canvas-chat-grounding-annotations-head";
  head.textContent = "🤔 Review claims: " + violations.length + " claim" + (violations.length === 1 ? "" : "s") + " worth verifying";
  footer.appendChild(head);

  const list = document.createElement("ul");
  list.className = "canvas-chat-grounding-annotations-list";

  violations.forEach(function(v) {
    const severity = (v && v.severity && SEVERITY_META[v.severity]) ? v.severity : "medium";
    const meta = SEVERITY_META[severity];
    const row = document.createElement("li");
    row.className = "canvas-chat-grounding-annotations-row severity-" + severity;
    row.setAttribute("data-severity", severity);

    const badge = document.createElement("span");
    badge.className = "canvas-chat-grounding-annotations-badge";
    badge.textContent = meta.icon + " " + meta.label;
    row.appendChild(badge);

    const claim = document.createElement("span");
    claim.className = "canvas-chat-grounding-annotations-claim";
    claim.textContent = "\"" + String((v && v.claim) || "?").slice(0, 200) + "\"";
    row.appendChild(claim);

    if (v && v.reason) {
      const reason = document.createElement("span");
      reason.className = "canvas-chat-grounding-annotations-reason";
      reason.textContent = " — " + String(v.reason).slice(0, 200);
      row.appendChild(reason);
    }

    list.appendChild(row);
  });

  footer.appendChild(list);
  return footer;
}

// Assistant bubbles only — user bubbles never go through here. marked
// escapes raw HTML by default; we add a defensive sanitize for
// `javascript:` URLs that some renderers miss.
function renderAssistantMarkdown(node, text) {
  const raw = text || "";
  // Sanitize javascript: URLs after parsing.
  const parse = (t) => {
    let h;
    try { h = marked.parse(t || "", { gfm: true, breaks: true }); }
    catch (_e) { return null; }
    return String(h).replace(/\sjavascript:/gi, " ").replace(/^javascript:/gi, "");
  };
  // BEYOND-CANVAS marker. The model wraps outside-knowledge / competitive
  // / strategic analysis in ':::beyond-canvas ... :::' fences so the
  // engineer can tell general analysis from grounded canvas facts.
  // Beyond-canvas segments render wrapped in a labelled block. An unclosed
  // fence (mid-stream, or a model that forgets the closer) treats
  // everything after the opener as beyond-canvas to end-of-text (the `$`
  // arm of the alternation).
  const BEYOND_RE = /:::beyond-canvas[ \t]*\r?\n?([\s\S]*?)(?:\r?\n?:::|$)/g;
  let out = "", last = 0, m, sawMarker = false;
  while ((m = BEYOND_RE.exec(raw)) !== null) {
    sawMarker = true;
    const before = raw.slice(last, m.index);
    if (before.trim()) { const hb = parse(before); if (hb != null) out += hb; }
    const hi = parse(m[1] || "");
    out += '<div class="canvas-chat-beyond" role="note">' +
             '<div class="canvas-chat-beyond-label">↗ Beyond the canvas</div>' +
             '<div class="canvas-chat-beyond-body">' + (hi != null ? hi : "") + '</div>' +
           '</div>';
    last = BEYOND_RE.lastIndex;
    if (m[0].length === 0) { BEYOND_RE.lastIndex++; }   // zero-width guard
  }
  if (!sawMarker) {
    const h = parse(raw);
    if (h == null) { node.textContent = raw; return; }
    node.innerHTML = h;
    return;
  }
  const tail = raw.slice(last);
  if (tail.trim()) { const ht = parse(tail); if (ht != null) out += ht; }
  node.innerHTML = out;
}

async function handleSend(body) {
  if (state.isStreaming) return;
  const input = body.querySelector(".canvas-chat-input");
  if (!input) return;
  const userMessage = (input.value || "").trim();
  if (userMessage.length === 0) return;

  // Refresh the engagement reference (the user may have edited the
  // canvas since the overlay opened).
  state.engagement = getActiveEngagement();

  // Append user message + an empty assistant bubble for streaming.
  state.transcript.messages.push({
    role:    "user",
    content: userMessage,
    at:      new Date().toISOString()
  });
  const assistantMsg = {
    role:    "assistant",
    content: "",
    at:      new Date().toISOString()
  };
  state.transcript.messages.push(assistantMsg);
  paintTranscript(body);

  // Mark streaming + repaint to show typing indicator.
  state.isStreaming = true;
  const meter = body.querySelector(".canvas-chat-meter");
  if (meter) meter.textContent = "thinking…";
  input.disabled = true;
  input.value = "";
  input.style.height = "auto";
  // Paint the typing-dot indicator BEFORE streamChat fires; the first
  // onToken clears it once the assistant starts producing text.
  paintTypingIndicator();

  // Resolve the provider — always the user's active aiConfig provider.
  // If it isn't configured, surface a clear chat-bubble message instead
  // of attempting the call.
  const aiCfg = loadAiConfig();
  const providerKey = (aiCfg && aiCfg.activeProvider) || "local";
  const cfg = aiCfg && aiCfg.providers && aiCfg.providers[providerKey];
  if (!cfg || !isActiveProviderReady(aiCfg)) {
    assistantMsg.content = "**No AI provider configured.** Open Settings (gear icon) to add an API key for " +
      labelForProvider(providerKey) + ", or pick a different provider.";
    state.isStreaming = false;
    input.disabled = false;
    paintTranscript(body);
    if (meter) meter.textContent = "no provider";
    return;
  }
  const provider = createRealChatProvider({
    providerKey:    providerKey,
    baseUrl:        cfg.baseUrl,
    model:          cfg.model,
    fallbackModels: cfg.fallbackModels || [],
    apiKey:         cfg.apiKey || ""
  });

  // Summarize if the rolling-window threshold tripped.
  state.transcript = summarizeIfNeeded(state.transcript);

  // The transcript we send to the provider EXCLUDES the empty
  // assistant placeholder we just pushed for the UI streaming target.
  const transcriptForProvider = state.transcript.messages.slice(0, -1);

  try {
    await streamChat({
      engagement:     state.engagement,
      transcript:     transcriptForProvider,
      userMessage:    userMessage,
      providerConfig: { providerKey: providerKey },
      provider:       provider,
      onToken: function(token) {
        // On the first token, clear the typing-dot indicator; the AI is
        // now actively producing text.
        if (!assistantMsg.content) clearTypingIndicator();
        assistantMsg.content += token;
        // Streaming-time handshake strip. If the model emits the
        // contract-ack handshake mid-stream, strip it BEFORE the markdown
        // re-parse so the bubble never shows the artifact. stripHandshake
        // is idempotent and cheap, so it's safe to run on every token.
        assistantMsg.content = stripHandshake(assistantMsg.content);
        // Streaming-time scrub of UUIDs + workflow.<id> + concept.<id>
        // identifiers in prose, replaced with resolved labels (or
        // [unknown ...] sentinels for orphans). Idempotent; skips fenced
        // and inline code. Merge the engagement-derived UUID map with the
        // manifest-derived workflow/concept map so one pass covers both.
        const fullLabelMap = Object.assign({}, buildManifestLabelMap(), buildLabelMap(state.engagement));
        assistantMsg.content = scrubUuidsInProse(assistantMsg.content, fullLabelMap);
        // Re-parse via marked progressively on the last assistant bubble.
        const bubbles = body.querySelectorAll(".canvas-chat-msg-assistant .canvas-chat-msg-content");
        const last = bubbles[bubbles.length - 1];
        if (last) renderAssistantMarkdown(last, assistantMsg.content);
        const scroll = body.querySelector(".canvas-chat-transcript");
        if (scroll) scroll.scrollTop = scroll.scrollHeight;
      },
      onComplete: function(result) {
        assistantMsg.content    = result.response;
        assistantMsg.provenance = result.provenance;
        // Capture groundingViolations for the footer-block annotations in
        // buildMessageBubble; they don't replace the response.
        assistantMsg.groundingViolations = Array.isArray(result && result.groundingViolations)
          ? result.groundingViolations : [];
        // First-turn handshake outcome surfaces in the header ack chip and,
        // on mismatch, a banner above the transcript.
        if (result && result.contractAck) {
          renderAckIndicator(result.contractAck);
        }
        // Update the footer breadcrumb with the latest-turn provenance.
        const ledeEl = document.querySelector(".overlay[data-kind='canvas-chat'] .canvas-chat-foot-lede");
        if (ledeEl) paintFooterCrumb(ledeEl, result);
        // Footer breadcrumb slide-in: toggle .is-fresh for one cycle so
        // the CSS keyframe fires.
        if (ledeEl) {
          ledeEl.classList.remove("is-fresh");
          // force reflow so the animation re-triggers next frame
          // eslint-disable-next-line no-unused-expressions
          void ledeEl.offsetWidth;
          ledeEl.classList.add("is-fresh");
        }
      },
      // Thinking-state callbacks.
      onToolUse: function(evt) {
        paintToolStatus(evt && evt.name);
      },
      onRoundStart: function(evt) {
        paintRoundBadge(evt);
      }
    });
  } catch (e) {
    assistantMsg.content = "Error: " + (e && e.message || String(e));
  } finally {
    state.isStreaming = false;
    input.disabled = false;
    input.focus();
    if (meter) meter.textContent = "ready";
    if (state.engagementId) saveTranscript(state.engagementId, state.transcript);
    paintTranscript(body);
    // Clean up any thinking-state surfaces left on screen if the chain
    // ended mid-state.
    clearTypingIndicator();
    clearToolStatus();
  }
}
