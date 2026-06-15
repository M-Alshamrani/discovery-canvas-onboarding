// services/realChatProvider.js
//
// Adapter from the chat-stream protocol
// (`async *stream({messages, tools}) yield {kind, ...}`) to the
// services/aiService.js chatCompletion + streamCompletion call shapes.
//
// Tool-use is wired for all three provider kinds: anthropic,
// openai-compatible, and gemini. chatService emits Anthropic-canonical
// content-block messages for the round-2 turn; each wire builder in
// aiService translates to the native shape. Tool-call extraction is
// dispatched by providerKind in extractToolCalls.
//
// SSE per-token streaming is Anthropic-only. For openai-compatible +
// gemini we use the non-streaming chatCompletion path and yield a single
// `{kind:"text"}` event with the whole payload.
//
// This module must not import session state or the state collections; it
// is a read-only adapter over aiService.

import { chatCompletion, streamCompletion, extractToolCalls } from "./aiService.js";

// providerKey → providerKind map (mirrors aiService.PROVIDER_FROM_KEY;
// kept local to avoid a public export). All "openai-compatible"-shaped
// providers (local LLM, Dell Sales Chat, future vendors) share the same
// wire/extract path.
const PROVIDER_KIND_FOR_KEY = {
  local:         "openai-compatible",
  anthropic:     "anthropic",
  gemini:        "gemini",
  dellSalesChat: "openai-compatible"
};

// createRealChatProvider({ providerKey, baseUrl, model, fallbackModels?,
//                          apiKey?, stream?, fetchImpl? })
//   → { stream({messages, tools, cacheControl}) → AsyncIterable<event>,
//        callsRecorded, capabilities }
//
// `messages` is the system + transcript + user message array assembled
// by chatService. `tools` is the CHAT_TOOLS array (with `invoke`); we
// strip the function before forwarding to the wire builder since
// closures are not serializable. `cacheControl` is the array of message
// indices that carry the Anthropic ephemeral cache_control marker.
//
// `stream:true` (default for Anthropic) routes through streamCompletion
// (SSE per-token). `stream:false` keeps the non-streaming path.
// `fetchImpl` is an optional override for fetch-replacement use cases
// such as an alternative transport.
export function createRealChatProvider(opts) {
  const providerConfig = opts || {};
  const callsRecorded = [];
  const providerKind  = PROVIDER_KIND_FOR_KEY[providerConfig.providerKey] || "openai-compatible";

  // Tool-use is supported across all three provider kinds. Each builder
  // in aiService translates the canonical content blocks to its native
  // wire shape; extractToolCalls dispatches by kind.
  const supportsToolUse  = true;
  // SSE per-token streaming is Anthropic-only. Opt out via stream:false.
  const supportsStream   = providerConfig.providerKey === "anthropic";
  const wantsStream      = providerConfig.stream !== false && supportsStream;
  // cache_control is Anthropic-specific.
  const supportsCaching  = providerConfig.providerKey === "anthropic";

  const capabilities = {
    streaming: wantsStream,
    toolUse:   supportsToolUse,
    caching:   supportsCaching
  };

  return {
    callsRecorded,
    capabilities,

    async *stream(call) {
      const messages = (call && call.messages) || [];
      const wireTools = supportsToolUse
        ? toWireTools(call && call.tools)
        : [];

      // cacheControl indices flow from systemPromptAssembler through
      // chatService into the wire builder, so the Anthropic stable prefix
      // gets `cache_control: ephemeral` on every turn (5-min TTL). The
      // savings apply only to Anthropic; other providers ignore it.
      const cacheControl = (call && Array.isArray(call.cacheControl)) ? call.cacheControl : [];

      callsRecorded.push({
        messages,
        tools:        wireTools,
        cacheControl: cacheControl,
        streaming:    wantsStream,
        at:           new Date().toISOString()
      });

      const wireOpts = {
        providerKey:    providerConfig.providerKey,
        baseUrl:        providerConfig.baseUrl,
        model:          providerConfig.model,
        fallbackModels: providerConfig.fallbackModels || [],
        apiKey:         providerConfig.apiKey || "",
        messages,
        tools:          wireTools.length > 0 ? wireTools : undefined,
        cacheControl:   cacheControl.length > 0 ? cacheControl : undefined,
        fetchImpl:      providerConfig.fetchImpl
      };

      // SSE streaming path (Anthropic only). Yields events 1:1 from
      // streamCompletion's generator — text tokens stream as they arrive;
      // tool_use surfaces on content_block_stop with the accumulated
      // input JSON.
      if (wantsStream) {
        try {
          for await (const evt of streamCompletion(wireOpts)) {
            yield evt;
          }
        } catch (e) {
          const msg = "Provider error: " + (e && e.message || String(e));
          yield { kind: "text", token: msg };
          yield { kind: "done", text:  msg };
        }
        return;
      }

      // Non-streaming path (default for non-Anthropic; opt-in for
      // Anthropic via stream:false).
      let response;
      try {
        response = await chatCompletion(wireOpts);
      } catch (e) {
        const msg = "Provider error: " + (e && e.message || String(e));
        yield { kind: "text", token: msg };
        yield { kind: "done", text:  msg };
        return;
      }

      // Provider-dispatched tool-call extraction. Same
      // {kind:"tool_use",...} event shape regardless of provider.
      const toolCalls = extractToolCalls(providerKind, response && response.raw);
      for (const tu of toolCalls) {
        yield { kind: "tool_use", name: tu.name, input: tu.input || {}, id: tu.id };
      }

      const text = (response && typeof response.text === "string") ? response.text : "";
      if (text.length > 0) {
        yield { kind: "text", token: text };
      }
      yield { kind: "done", text };
    }
  };
}

// Strip non-serializable fields (notably `invoke`) from CHAT_TOOLS to
// produce the canonical wire-shape `{name, description, input_schema}`.
// Each provider's wire builder in aiService translates input_schema to
// its native field name (anthropic keeps it; openai-compatible renames
// to `parameters`; gemini wraps in functionDeclarations + parameters).
function toWireTools(tools) {
  if (!Array.isArray(tools)) return [];
  return tools.map(function(t) {
    return {
      name:         t.name,
      description:  t.description,
      input_schema: t.input_schema || { type: "object", properties: {} }
    };
  });
}
