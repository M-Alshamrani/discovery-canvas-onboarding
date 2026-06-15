// services/chatService.js
//
// Canvas Chat — chat-shape entry point. Orchestrates:
//   1. Assembles the layered system prompt (systemPromptAssembler).
//   2. Streams a provider call, accumulating tokens via onToken.
//   3. If the provider emits tool_use, resolves the tool locally via
//      CHAT_TOOLS against the active engagement, feeds the tool_result
//      back as a user-role message, and streams a second provider call
//      whose tokens form the final user-visible response.
//   4. Returns { response, provenance } and emits onComplete.
//
// Provider injection: opts.provider is required. The chat overlay UI
// injects a thin wrapper around aiService that does streaming, tool_use,
// and cache_control. There is no mock provider; streamChat behavior is
// validated by real-LLM smoke at tag time.
//
// Chat is read-only: it never imports the session/collection action
// modules and never mutates the engagement.

import { buildSystemPrompt }  from "./systemPromptAssembler.js";
import { CHAT_TOOLS }         from "./chatTools.js";
import { getContractChecksum } from "../core/dataContract.js";
// Canonical Zod schema for validating proposeAction tool args at
// runtime. The chat invokes proposeAction with structured args;
// chatService captures and validates each call's input into the
// envelope's proposedActions[] field. Bad input is dropped with a
// console.warn.
import { ActionProposalSchema } from "../schema/actionProposal.js";
// Grounding contract. streamChat invokes the deterministic retrieval
// router before assembling the system prompt; selector results are
// inlined into the prompt by buildSystemPrompt. After the LLM responds,
// streamChat runs verifyGrounding on the visible response; flagged
// entity references are attached as result.groundingViolations on the
// onComplete envelope. The response itself is preserved unchanged; the
// overlay renders the violations as a severity-tiered footer block.
import { route as groundingRoute } from "./groundingRouter.js";
import { verifyGrounding }         from "./groundingVerifier.js";
// Handshake regex and strip helper live in chatHandshake.js so
// chatService, chatMemory, and the overlay's streaming-time onToken
// path all share one source-of-truth pattern and idempotent strip.
import { HANDSHAKE_RE, HANDSHAKE_STRIP_RE } from "./chatHandshake.js";
// Defensive UUID scrub. The role section and selector enrichment reduce
// but don't eliminate UUID leakage in prose. This runtime scrub
// replaces bare UUIDs with resolved labels (or `[unknown reference]`)
// and is applied to the visible response as a final pass.
import { buildLabelMap, buildManifestLabelMap, scrubUuidsInProse } from "./uuidScrubber.js";

// Multi-round tool-chaining safety cap. Prevents runaway tool loops if
// the model never emits a text-only response. Five rounds covers every
// legitimate question against the selectors (most need 1-2; the densest
// cross-cuts 3-4). On cap, streamChat surfaces a clear notice in the
// response.
export const MAX_TOOL_ROUNDS = 5;

// Chat-says-vs-chat-does guard. Detects the hallucination pattern where
// the chat writes prose claiming an action was taken ("I've proposed X"
// / "Proposal submitted ✓" / "now proposed for your review") while
// proposedActions is empty. This is structural LLM inconsistency, not
// something prompt text can fully prevent, so detection happens at
// chatService output time where it is deterministic and provider-
// agnostic.
//
// Coverage:
//   - "I've proposed" / "I have proposed" / "I've added" / "I've submitted"
//   - "I've captured" / "I've marked" / "I've created"
//   - "Proposal submitted" / "Proposal is in your panel"
//   - "Proposal is ready" / "Proposal recorded"
//   - "now proposed for your review"
//
// Deliberately excludes phrasings that are legitimate when the chat
// actually fires the tool (e.g. a bare "Captured." preamble),
// tutorial-mode responses, and generic agreement phrases — to avoid
// false positives.
export const HALLUCINATION_RE =
  /(?:I'?ve|I\s+have)\s+(?:propose[ds]?|added|submitted|captured|marked|created)|Proposal\s+(?:submitted|is\s+in\s+your\s+panel|is\s+ready|recorded)|now\s+propose[ds]?\s+for\s+your\s+review/i;

// providerCapabilities(providerKey)
// → { streaming: bool, toolUse: bool, caching: bool }
//
// Static capability table keyed on the provider identifiers used in the
// AI config. Drives both the chat surface (streaming vs blocking
// dispatch) and the system-prompt assembler (which emits cache_control
// markers only for caching-capable providers).
export function providerCapabilities(providerKey) {
  switch (providerKey) {
    case "anthropic":
      return { streaming: true, toolUse: true, caching: true };
    case "openai-compatible":
    case "local":
      return { streaming: true, toolUse: true, caching: false };
    case "gemini":
      return { streaming: true, toolUse: true, caching: false };
    case "dellSalesChat":
      // Conservative defaults until this provider's streaming and
      // tool-use shape is documented.
      return { streaming: false, toolUse: false, caching: false };
    default:
      return { streaming: false, toolUse: false, caching: false };
  }
}

// streamChat({engagement, transcript, userMessage, providerConfig,
//             provider, onToken?, onComplete?, options?})
//   → Promise<{ response: string, provenance: object }>
//
// `transcript` is an array of prior messages [{role, content, ...}].
// `provider` MUST expose `async *stream({messages, tools})` yielding
//   - { kind: "text",     token: string }
//   - { kind: "done",     text:  string }
//   - { kind: "tool_use", name:  string, input: object }
// (Production path: services/realChatProvider.js. No mock providers
// exist.)
//
// One tool-use round trip is supported: the provider may emit at most
// one tool_use in the first call; the dispatcher resolves it and runs a
// second call whose tokens become the visible response.
export async function streamChat(opts) {
  const engagement     = opts && opts.engagement;
  const transcript     = (opts && opts.transcript) || [];
  const userMessage    = (opts && opts.userMessage) || "";
  const providerConfig = (opts && opts.providerConfig) || {};
  const provider       = opts && opts.provider;
  const onToken        = (opts && opts.onToken)    || function() {};
  const onComplete     = (opts && opts.onComplete) || function() {};
  // Thinking-state callbacks. onToolUse fires once per tool dispatch
  // before the tool runs; the overlay paints a per-tool status pill.
  // onRoundStart fires at each multi-round iteration; the overlay paints
  // the round badge for round >= 2.
  const onToolUse      = (opts && opts.onToolUse)    || function() {};
  const onRoundStart   = (opts && opts.onRoundStart) || function() {};

  if (!provider || typeof provider.stream !== "function") {
    throw new Error("streamChat: opts.provider with .stream() is required");
  }

  // Resolve providerKind for the assembler's cache_control branch.
  const providerKind = mapProviderKindForAssembler(providerConfig.providerKey);

  // Invoke the deterministic grounding router before assembling the
  // system prompt. The router classifies the user message into a list
  // of selector calls; results are inlined into the prompt by
  // buildSystemPrompt, so the LLM sees the engagement data before
  // answering (retrieval by construction, not chat-with-tools-as-hope).
  const routerOutput = groundingRoute({
    userMessage: userMessage,
    transcript:  transcript,
    engagement:  engagement
  });

  // System prompt: cached prefix plus the router-driven engagement layer.
  const systemPrompt = buildSystemPrompt({ engagement, providerKind, routerOutput });

  // Build the initial conversation: system messages + prior transcript +
  // current user turn. We do not summarize transcript here; that is the
  // caller's responsibility (chatMemory.summarizeIfNeeded before this).
  const baseMessages = [].concat(
    systemPrompt.messages,
    transcript.map(t => ({ role: t.role, content: t.content })),
    [{ role: "user", content: userMessage }]
  );

  // Multi-round tool-chaining loop. Stream; if tool_use, dispatch and
  // append assistant content blocks plus the user tool_result block,
  // then loop. Terminates when the model emits a text-only response (no
  // tool_use) or MAX_TOOL_ROUNDS is hit (the safety cap surfaces a
  // notice if reached).
  let messages       = baseMessages;
  let lastTextResponse = "";   // tracks the most recent text-only LLM response (the "answer")
  let allRoundsText  = "";     // accumulated text across all rounds (used if cap is hit with no text-only round)
  let chainCap       = false;  // true if MAX_TOOL_ROUNDS reached without text-only response
  // Accumulator for proposeAction tool calls across rounds. Each valid
  // proposal is appended and surfaced in the result envelope as
  // proposedActions[] for engineer-facing review.
  const proposedActions = [];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // Signal round start to the overlay so it can paint the multi-round
    // badge for round >= 2 (1-indexed in the user view).
    try { onRoundStart({ round: round + 1, totalRounds: MAX_TOOL_ROUNDS }); }
    catch (e) { console.warn("[chatService] onRoundStart threw:", e && e.message); }

    const result = await streamOneRound(provider, messages, onToken, systemPrompt.cacheControl);
    if (result.text) allRoundsText += (allRoundsText ? "\n\n" : "") + result.text;

    if (!result.toolUse) {
      // Text-only response — chain terminates with this as the answer.
      lastTextResponse = result.text;
      break;
    }

    const tool = CHAT_TOOLS.find(t => t.name === result.toolUse.name);
    if (!tool) {
      throw new Error("streamChat: provider requested unknown tool '" + result.toolUse.name + "'");
    }
    // Signal tool dispatch before invoking so the overlay can paint the
    // per-tool status pill while the tool runs.
    try { onToolUse({ name: result.toolUse.name, args: result.toolUse.input || {} }); }
    catch (e) { console.warn("[chatService] onToolUse threw:", e && e.message); }
    // proposeAction is a structurally-special tool: it records intent
    // rather than fetching data. Capture the validated args into
    // proposedActions[] for the envelope; invalid input is dropped with
    // a console.warn.
    if (result.toolUse.name === "proposeAction") {
      const parsed = ActionProposalSchema.safeParse(result.toolUse.input || {});
      if (parsed.success) {
        proposedActions.push(parsed.data);
      } else {
        console.warn("[chatService] proposeAction received malformed input (dropped from envelope.proposedActions):",
          JSON.stringify(parsed.error?.issues || parsed.error).slice(0, 500));
      }
    }
    const toolResult = tool.invoke(engagement, result.toolUse.input || {});

    // Anthropic-shape content blocks. Anthropic requires the assistant
    // message to replay all content blocks (preamble text plus tool_use
    // with id), and the user message to carry the tool_result block
    // correlated by tool_use_id. Other providers tolerate the array
    // shape (aiService translates it).
    const toolUseId = result.toolUse.id || ("toolu_" + Math.random().toString(36).slice(2, 12));
    const assistantBlocks = [];
    if (result.text) assistantBlocks.push({ type: "text", text: result.text });
    assistantBlocks.push({
      type:  "tool_use",
      id:    toolUseId,
      name:  result.toolUse.name,
      input: result.toolUse.input || {}
    });
    const userBlocks = [{
      type:         "tool_result",
      tool_use_id:  toolUseId,
      content:      safeStringify(toolResult)
    }];
    messages = messages.concat([
      { role: "assistant", content: assistantBlocks },
      { role: "user",      content: userBlocks }
    ]);

    // If we just consumed the LAST allowed round and the model is still
    // calling tools, mark the cap and break. The notice is appended below.
    if (round === MAX_TOOL_ROUNDS - 1) {
      chainCap = true;
    }
  }

  // Compose final response. Three cases:
  //   - text-only termination → lastTextResponse is the answer
  //   - cap hit with no text-only → use the accumulated text + cap notice
  //   - cap hit but the very last round HAD a text preamble → include it + notice
  let finalResponse = lastTextResponse;
  if (chainCap) {
    const accumulated = allRoundsText || "";
    finalResponse = (accumulated ? accumulated + "\n\n" : "") +
      "_(tool-call cap reached after " + MAX_TOOL_ROUNDS +
      " rounds — ask me to continue if you need more detail)_";
  }

  // Provenance — every assistant turn carries the model, runId,
  // timestamp, and (when known) catalogVersions.
  const provenance = {
    model:           providerConfig.providerKey || "unknown",
    runId:           genRunId(),
    timestamp:       new Date().toISOString(),
    catalogVersions: (engagement && engagement.meta && engagement.meta.catalogVersions) || {}
  };

  // Handshake parsing. On the first turn the LLM is instructed to emit
  // [contract-ack v3.0 sha=<8>] as its first line; we parse it, validate
  // the sha, strip it from the visible response, and report ack status
  // via contractAck. On subsequent turns the role section forbids the
  // prefix, but some models repeat it intermittently, so the handshake
  // is stripped regardless of turn to keep it out of the rendered
  // bubble. contractAck is populated only on the first turn (where its
  // truth signal matters); on later turns it stays null.
  let contractAck = null;
  // Strict pass captures the sha for first-turn ack validation; the
  // permissive pass scrubs any remnant (bracketless, multiple, or
  // mid-response).
  const handshakeMatch = HANDSHAKE_RE.exec(finalResponse);
  let visibleResponse = finalResponse.replace(HANDSHAKE_STRIP_RE, "").replace(/^\s+/, "");
  // Final UUID scrub. Replace bare UUIDs in the visible response with
  // resolved labels (gap description / driver label / environment alias
  // / instance label), or `[unknown reference]` for orphans. Skips
  // fenced and inline code so legitimate JSON examples stay intact. The
  // merged label map covers both engagement UUIDs and manifest
  // workflow/concept ids in a single pass.
  visibleResponse = scrubUuidsInProse(visibleResponse, Object.assign({}, buildManifestLabelMap(), buildLabelMap(engagement)));
  if (transcript.length === 0) {
    const expected = getContractChecksum();
    if (handshakeMatch) {
      const received = handshakeMatch[1].toLowerCase();
      contractAck = {
        ok:       received === expected,
        expected: expected,
        received: received
      };
    } else {
      contractAck = {
        ok:       false,
        expected: expected,
        received: null
      };
    }
  }

  // Runtime grounding verification. After all post-stream scrubbing
  // (handshake strip + UUID scrub) but before return, cross-reference
  // the visible response against the engagement.
  //
  // Soft-warn behavior: the response is preserved unchanged on ok:false.
  // The groundingViolations array (each with a severity field) flows
  // through to the onComplete envelope as result.groundingViolations,
  // and the overlay renders them as a severity-tiered footer block below
  // the assistant bubble. The verifier annotates rather than blocks, so
  // the LLM's response reaches the engineer and can be refined rather
  // than overridden by the app.
  let groundingViolations = [];
  try {
    const verifyResult = verifyGrounding(visibleResponse, engagement);
    if (verifyResult && verifyResult.ok === false) {
      groundingViolations = verifyResult.violations || [];
      // visibleResponse is not reassigned: the response flows through
      // unchanged. The violations are attached to the onComplete
      // envelope below and rendered by the overlay as annotations.
      console.warn("[chatService] groundingViolations annotated (response preserved per R37.6 SOFT-WARN):",
        JSON.stringify(groundingViolations).slice(0, 400));
    }
  } catch (e) {
    // Verifier failure must NOT swallow the assistant turn; log + continue.
    console.warn("[chatService] verifyGrounding threw:", e && e.message);
  }

  // proposedActions[] is always present on the envelope; it is an empty
  // array when the chat did not call proposeAction. Downstream consumers
  // check proposedActions.length > 0 to determine emission.
  //
  // proposalEmissionWarning carries the chat-says-vs-chat-does guard
  // result: it is null when no hallucination pattern was detected, or an
  // object with { detected, matchedPhrase, reason } when the chat
  // described an action in prose without firing the tool. The preview
  // modal surfaces it as a warning.
  let proposalEmissionWarning = null;
  if (proposedActions.length === 0 && HALLUCINATION_RE.test(visibleResponse)) {
    const match = visibleResponse.match(HALLUCINATION_RE);
    proposalEmissionWarning = {
      detected: true,
      matchedPhrase: match ? match[0] : "(pattern matched but no exact substring captured)",
      reason: "Chat described an action in prose without invoking the proposeAction tool. Engineer review recommended."
    };
    console.warn("[chatService] proposalEmissionWarning detected (hallucination pattern matched · proposedActions: [] · matchedPhrase=" +
      JSON.stringify(proposalEmissionWarning.matchedPhrase) + ")");
  }
  const result = { response: visibleResponse, provenance, contractAck, groundingViolations, proposedActions, proposalEmissionWarning };
  try { onComplete(result); } catch (e) { console.warn("[chatService] onComplete threw:", e && e.message); }
  return result;
}

// streamOneRound: drains one provider.stream() call. Returns the
// accumulated text plus at most one tool_use envelope. At most one
// tool_use per round is honored; if the provider emits more, only the
// first is kept.
async function streamOneRound(provider, messages, onToken, cacheControl) {
  let text = "";
  let toolUse = null;
  const iter = provider.stream({ messages, tools: CHAT_TOOLS, cacheControl: cacheControl || [] });
  for await (const evt of iter) {
    if (!evt) continue;
    if (evt.kind === "text" && typeof evt.token === "string") {
      text += evt.token;
      try { onToken(evt.token); } catch (e) { console.warn("[chatService] onToken threw:", e && e.message); }
    } else if (evt.kind === "tool_use" && !toolUse) {
      toolUse = { name: evt.name, input: evt.input || {}, id: evt.id || null };
    }
    // evt.kind === "done" is informational; we accumulate text directly.
  }
  return { text, toolUse };
}

function mapProviderKindForAssembler(providerKey) {
  switch (providerKey) {
    case "anthropic":         return "anthropic";
    case "gemini":            return "gemini";
    case "openai-compatible":
    case "local":
    default:                  return "openai-compatible";
  }
}

function genRunId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "run-" + Date.now() + "-" + Math.floor(Math.random() * 1e9).toString(16);
}

function safeStringify(value) {
  try { return JSON.stringify(value); }
  catch (_e) { return "<unserializable>"; }
}
