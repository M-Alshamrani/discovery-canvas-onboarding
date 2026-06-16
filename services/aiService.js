// services/aiService.js — provider-aware chat completion.
//
// Three provider shapes are supported:
//   - openai-compatible  (vLLM, OpenAI proper, etc.)
//   - anthropic          (Claude API)
//   - gemini             (Google Generative AI)
//
// All three are reached via the container's nginx reverse-proxy when the
// configured baseUrl is relative (starts with "/"). When the baseUrl is
// absolute (http:// or https://), the call goes direct from the browser
// — only viable for upstreams whose CORS allows it (typically
// self-hosted vLLM started with --allowed-origins '["*"]').
//
// Reliability features:
//   - Anthropic browser-direct opt-in header (see buildRequest).
//   - Retry with exponential backoff + jitter on 429 / 5xx, which
//     handles most transient "high demand" upstream errors. 4xx (auth,
//     bad request) are not retried — those are config to fix.
//   - Optional per-provider fallback model chain: if the primary model
//     exhausts retries with a transient error, chatCompletion re-issues
//     on the next model in the chain.

const PROVIDER_FROM_KEY = {
  local:         "openai-compatible",
  anthropic:     "anthropic",
  gemini:        "gemini",
  dellSalesChat: "openai-compatible"
};

// Retry tuning — exported for tests so suites can drive the loop
// deterministically with a custom waitImpl.
export var RETRY_MAX_ATTEMPTS  = 3;      // total tries per model (incl. first)
export var RETRY_BASE_DELAY_MS = 500;    // first backoff; doubles each attempt
export var RETRY_CAP_DELAY_MS  = 4000;   // hard ceiling per wait
export var RETRIABLE_STATUSES  = [429, 500, 502, 503, 504];

// Curated model lists for the Settings model dropdown. Only the proxy-backed
// providers whose model set is known are listed here; the model string is
// still passed to the provider as-is, so this is a convenience, not a gate.
// Providers with user-defined endpoints (local, Local B, Dell Sales Chat) are
// absent, so listModels() returns [] and their Model field stays free-text.
var BLESSED_MODELS = {
  anthropic: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5", "claude-fable-5"],
  gemini:    ["gemini-2.5-flash", "gemini-2.5-pro"]
};

// listModels(providerId) -> string[] (a fresh copy each call; [] for free-text
// providers). The Settings model dropdown is built from this.
export function listModels(providerId) {
  var list = BLESSED_MODELS[providerId];
  return Array.isArray(list) ? list.slice() : [];
}

// Public API — single entry point.
//   chatCompletion({
//     providerKey:    "local" | "anthropic" | "gemini",
//     baseUrl:        resolved URL (relative or absolute),
//     model:          string (primary model id),
//     fallbackModels: optional string[] (tried in order after primary),
//     apiKey:         string (may be empty for local),
//     messages:       [{ role: "system" | "user" | "assistant", content: "..." }],
//     fetchImpl:      optional override (for tests; defaults to window.fetch)
//     waitImpl:       optional override (for tests; defaults to setTimeout)
//   }) → Promise<{ text: string, raw: any, modelUsed: string, attempts: number }>
//
// Throws on terminal failure (all models + retries exhausted, or a
// non-retriable error). Error message has the usual prefix so the UI
// can keep rendering the "fix your key / try again" hint.
export async function chatCompletion(opts) {
  var providerKey  = opts.providerKey || "local";
  var providerKind = PROVIDER_FROM_KEY[providerKey] || "openai-compatible";
  var fetchImpl    = opts.fetchImpl || (typeof window !== "undefined" ? window.fetch.bind(window) : null);
  if (!fetchImpl) throw new Error("aiService.chatCompletion: no fetch implementation available");
  var waitImpl     = opts.waitImpl || defaultWait;

  // Model candidates: primary first, then fallbacks. Duplicate entries
  // filtered so a user pasting the same model twice doesn't waste
  // attempts.
  var candidates = [opts.model || ""].concat(Array.isArray(opts.fallbackModels) ? opts.fallbackModels : [])
    .filter(function(m, i, arr) { return typeof m === "string" && m.length > 0 && arr.indexOf(m) === i; });
  if (candidates.length === 0) candidates = [""];

  var totalAttempts = 0;
  var lastError = null;

  for (var ci = 0; ci < candidates.length; ci++) {
    var model = candidates[ci];
    for (var attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
      totalAttempts++;
      var built = buildRequest(providerKind, Object.assign({}, opts, { model: model }));
      var resp;
      try {
        resp = await fetchImpl(built.url, {
          method:  "POST",
          headers: built.headers,
          body:    JSON.stringify(built.body)
        });
      } catch (networkErr) {
        // Network-level failure (DNS, TLS, connection drop). Same
        // retriability story as a 5xx: try again, then fall back.
        lastError = new Error("aiService " + providerKey + " network error: " +
          (networkErr && networkErr.message || String(networkErr)));
        if (attempt < RETRY_MAX_ATTEMPTS) {
          await waitImpl(backoffMs(attempt));
          continue;
        }
        break;   // exhausted retries on this model; try next candidate
      }

      if (resp.ok) {
        var json = await resp.json();
        return {
          text: extractText(providerKind, json),
          raw: json,
          modelUsed: model,
          attempts: totalAttempts
        };
      }

      var bodyText = "";
      try { bodyText = await resp.text(); } catch (e) { /* swallow */ }
      var err = buildHttpError(providerKey, resp.status, bodyText);

      if (RETRIABLE_STATUSES.indexOf(resp.status) >= 0) {
        lastError = err;
        if (attempt < RETRY_MAX_ATTEMPTS) {
          await waitImpl(backoffMs(attempt));
          continue;
        }
        // Exhausted retries on this model — fall through to next
        // candidate (if any). Preserve lastError for final throw.
        break;
      }

      // Non-retriable (auth, schema, bad key). Throw immediately —
      // no point asking upstream the same bad thing three more times.
      throw err;
    }
  }

  // Every candidate + every retry exhausted. Throw the last transient
  // error with the original prefix so UI hints stay consistent.
  if (lastError) throw lastError;
  throw new Error("aiService " + providerKey + " exhausted all retries");
}

// Builds a user-facing Error for a non-OK HTTP response, mapping the
// status to a hint the UI can show. Exported so the error-shape contract
// is testable without a real fetch.
export function buildHttpError(providerKey, status, bodyText) {
  var prefix;
  if (status === 401 || status === 403) {
    prefix = "auth failed — check your API key in gear icon → " + providerKey;
  } else if (status === 429) {
    prefix = "rate-limited — wait a moment or switch provider";
  } else if (status >= 500 && status < 600) {
    prefix = "upstream temporary error — try again or switch provider";
  } else if (status === 400 && bodyText && /tool[- ]?choice|enable[- ]?auto[- ]?tool[- ]?choice|tool[- ]?call[- ]?parser/i.test(bodyText)) {
    // vLLM returns a 400 when tool-use is requested but the server was
    // not started with --enable-auto-tool-choice + --tool-call-parser.
    // Surface a clearer server-config hint instead of the raw vLLM error.
    prefix = "vLLM server config — start the LLM with --enable-auto-tool-choice + --tool-call-parser hermes (Code LLM) or disable tools for this provider in Settings";
  } else {
    prefix = "HTTP " + status;
  }
  return new Error("aiService " + providerKey + " " + prefix +
    " (" + status + ")" + (bodyText ? ": " + bodyText.slice(0, 200) : ""));
}

// Exponential backoff with jitter. attempt is 1-based. Returns
// milliseconds to wait before the NEXT try (after this attempt failed).
// Exported so tests can assert the schedule.
export function backoffMs(attempt) {
  var base = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
  var capped = Math.min(base, RETRY_CAP_DELAY_MS);
  // Full-jitter: pick a random point in [0, capped]. Prevents the
  // thundering-herd retry synchronisation that collapses overloaded
  // upstreams further.
  return Math.floor(Math.random() * capped);
}

function defaultWait(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

// Pure builder — exported for unit tests so we can assert request shape
// per provider without a real network call.
export function buildRequest(providerKind, opts) {
  var baseUrl = opts.baseUrl || "";
  var model   = opts.model   || "";
  var apiKey  = opts.apiKey  || "";
  var messages = opts.messages || [];

  if (providerKind === "openai-compatible") {
    // Translate Anthropic-canonical content-block messages into the flat
    // OpenAI shape. Each message with array content is walked:
    //   - text block         → message.content (string)
    //   - tool_use block     → message.tool_calls[]
    //   - tool_result block  → SEPARATE role:"tool" message correlated by
    //                          tool_use_id (maps to OpenAI tool_call_id)
    //
    // Four compatibility adjustments guard against OpenAI-compatible
    // parsers (e.g. Qwen3-Coder + hermes) that mishandle conversation
    // history on multi-round exchanges:
    //   1. Adjacent role:"system" messages are consolidated into one;
    //      some parsers only honor the first system message.
    //   2. Empty assistant content emits as "" not null; some parsers
    //      reject `content: null` in history.
    //   3. role:"tool" content is always a string (never object/null).
    //   4. max_tokens defaults to 4096 for multi-round prose headroom.
    var oaiMessagesRaw = [];
    messages.forEach(function(m) {
      if (Array.isArray(m.content)) {
        if (m.role === "assistant") {
          var textPieces = [];
          var toolCalls  = [];
          m.content.forEach(function(b) {
            if (b.type === "text" && typeof b.text === "string") {
              textPieces.push(b.text);
            } else if (b.type === "tool_use") {
              toolCalls.push({
                id:   b.id || ("call_" + Math.random().toString(36).slice(2, 12)),
                type: "function",
                function: {
                  name:      b.name,
                  arguments: JSON.stringify(b.input || {})
                }
              });
            }
          });
          // Emit empty content as "" not null; some OpenAI-compatible
          // parsers reject null in conversation history.
          var asst = { role: "assistant", content: textPieces.length > 0 ? textPieces.join("\n") : "" };
          if (toolCalls.length > 0) asst.tool_calls = toolCalls;
          oaiMessagesRaw.push(asst);
        } else if (m.role === "user") {
          // user message with array content carries tool_result blocks.
          // Each tool_result becomes a SEPARATE role:"tool" message.
          m.content.forEach(function(b) {
            if (b.type === "tool_result") {
              // tool content must be a string: stringify objects, and
              // fall back to "" for null/undefined. Some parsers misbehave
              // with non-string content fields.
              var resultContent;
              if (typeof b.content === "string") resultContent = b.content;
              else if (b.content == null)        resultContent = "";
              else                                resultContent = JSON.stringify(b.content);
              oaiMessagesRaw.push({
                role:         "tool",
                tool_call_id: b.tool_use_id || "",
                content:      resultContent
              });
            } else if (b.type === "text" && typeof b.text === "string") {
              oaiMessagesRaw.push({ role: "user", content: b.text });
            }
          });
        } else {
          // System or other role with array content — flatten text blocks
          var texts = [];
          m.content.forEach(function(b) {
            if (b.type === "text" && typeof b.text === "string") texts.push(b.text);
          });
          oaiMessagesRaw.push({ role: m.role, content: texts.join("\n") });
        }
      } else {
        oaiMessagesRaw.push({ role: m.role, content: m.content });
      }
    });
    // Consolidate adjacent role:"system" messages into one. The
    // system-prompt assembler emits several separate system messages
    // (role, contract, concept dictionary, workflow manifest,
    // engagement). The Anthropic and Gemini translators join or preserve
    // them, but some OpenAI-compatible parsers only honor the first
    // system message, dropping the data contract and manifests on later
    // rounds. Merging into one system message keeps the full grounding
    // context present every round.
    var oaiMessages = [];
    var i = 0;
    while (i < oaiMessagesRaw.length) {
      if (oaiMessagesRaw[i].role === "system") {
        var combined = [];
        while (i < oaiMessagesRaw.length && oaiMessagesRaw[i].role === "system") {
          combined.push(oaiMessagesRaw[i].content || "");
          i++;
        }
        oaiMessages.push({ role: "system", content: combined.join("\n\n---\n\n") });
      } else {
        oaiMessages.push(oaiMessagesRaw[i]);
        i++;
      }
    }
    var oaiBody = {
      model: model,
      messages: oaiMessages,
      // Default output ceiling of 4096 tokens; callers may raise it via
      // opts.maxTokens for long structured (JSON) responses that would
      // otherwise be cut off mid-string.
      max_tokens: (typeof opts.maxTokens === "number" && opts.maxTokens > 0) ? opts.maxTokens : 4096,
      temperature: 0.3
    };
    // OpenAI tools wire shape:
    // tools: [{type:"function", function:{name, description, parameters}}]
    if (Array.isArray(opts.tools) && opts.tools.length > 0) {
      oaiBody.tools = opts.tools.map(function(t) {
        return {
          type: "function",
          function: {
            name:        t.name,
            description: t.description,
            parameters:  t.input_schema || t.parameters || { type: "object", properties: {} }
          }
        };
      });
      oaiBody.tool_choice = "auto";
    }
    return {
      url: joinUrl(baseUrl, "/chat/completions"),
      headers: openAiHeaders(apiKey),
      body: oaiBody
    };
  }
  if (providerKind === "anthropic") {
    // Walk messages preserving original indices so cacheControl[] (which
    // names indices into the full message list) maps cleanly onto the
    // resulting system blocks.
    var systemBlocks = [];          // [{ type:"text", text, cache_control? }]
    var nonSystem = [];
    var cacheIdxSet = (Array.isArray(opts.cacheControl) ? opts.cacheControl : [])
      .reduce(function(acc, i) { acc[i] = true; return acc; }, {});
    messages.forEach(function(m, idx) {
      if (m.role === "system") {
        var block = { type: "text", text: m.content };
        if (cacheIdxSet[idx]) block.cache_control = { type: "ephemeral" };
        systemBlocks.push(block);
      } else {
        nonSystem.push({ role: m.role, content: m.content });
      }
    });
    var body = {
      model: model,
      // Default output ceiling of 1024 tokens; callers emitting long
      // structured output pass a larger opts.maxTokens to avoid the JSON
      // envelope being cut off mid-string.
      max_tokens: (typeof opts.maxTokens === "number" && opts.maxTokens > 0) ? opts.maxTokens : 1024,
      messages: nonSystem
    };
    if (systemBlocks.length > 0) {
      // Emit a content-block array when any block carries a cache_control
      // marker, so Anthropic honors per-block caching. With no markers,
      // collapse to the single-string system field for a smaller payload.
      var anyCacheMarker = systemBlocks.some(function(b) { return !!b.cache_control; });
      if (anyCacheMarker) {
        body.system = systemBlocks;
      } else {
        body.system = systemBlocks.map(function(b) { return b.text; }).join("\n\n");
      }
    }
    // Anthropic tool-use round-trip. The caller passes the wire-shape
    // tools array (name + description + input_schema only; chatService
    // strips `invoke` before this point).
    if (Array.isArray(opts.tools) && opts.tools.length > 0) {
      body.tools = opts.tools;
    }
    return {
      url: joinUrl(baseUrl, "/v1/messages"),
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
        // Anthropic requires this explicit opt-in whenever the request
        // carries an Origin (browser-direct or transparent reverse-proxy).
        // Without it the API responds 401 with a message naming this
        // header literally.
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: body
    };
  }
  if (providerKind === "gemini") {
    // Gemini contents[] with parts; system messages collapse into
    // systemInstruction. Translation of Anthropic-canonical array content:
    //   - text block        → parts[].text
    //   - tool_use block    → parts[].functionCall { name, args }
    //   - tool_result block → role:"user" message with parts[].functionResponse
    //                          { name, response: { result: <stringified content> } }
    // Tool-result correlation is by NAME (Gemini lacks tool_call_id);
    // chatService keeps the name stable across rounds via the same dispatch.
    var systemContent = "";
    var contents = [];
    // We need the most recent tool_use NAME so a follow-up tool_result
    // can correlate by name. Track per content-block index.
    var lastToolUseName = null;
    messages.forEach(function(m) {
      if (m.role === "system") {
        var sysText = "";
        if (Array.isArray(m.content)) {
          m.content.forEach(function(b) {
            if (b.type === "text" && typeof b.text === "string") sysText += b.text;
          });
        } else {
          sysText = m.content;
        }
        systemContent = (systemContent ? systemContent + "\n\n" : "") + sysText;
        return;
      }
      if (Array.isArray(m.content)) {
        if (m.role === "assistant") {
          var parts = [];
          m.content.forEach(function(b) {
            if (b.type === "text" && typeof b.text === "string") {
              parts.push({ text: b.text });
            } else if (b.type === "tool_use") {
              parts.push({ functionCall: { name: b.name, args: b.input || {} } });
              lastToolUseName = b.name;
            }
          });
          contents.push({ role: "model", parts: parts });
        } else if (m.role === "user") {
          var parts2 = [];
          m.content.forEach(function(b) {
            if (b.type === "tool_result") {
              var resultPayload;
              try {
                resultPayload = typeof b.content === "string" ? JSON.parse(b.content) : b.content;
              } catch (_e) {
                resultPayload = { result: typeof b.content === "string" ? b.content : "" };
              }
              parts2.push({
                functionResponse: {
                  name:     lastToolUseName || "",
                  response: (resultPayload && typeof resultPayload === "object" && !Array.isArray(resultPayload))
                              ? resultPayload
                              : { result: resultPayload }
                }
              });
            } else if (b.type === "text" && typeof b.text === "string") {
              parts2.push({ text: b.text });
            }
          });
          contents.push({ role: "user", parts: parts2 });
        } else {
          // Fallback for any other role
          var ptexts = [];
          m.content.forEach(function(b) {
            if (b.type === "text" && typeof b.text === "string") ptexts.push(b.text);
          });
          contents.push({ role: m.role === "assistant" ? "model" : "user",
                          parts: [{ text: ptexts.join("\n") }] });
        }
      } else {
        contents.push({
          role:  m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }]
        });
      }
    });
    var body2 = { contents: contents };
    if (systemContent) body2.systemInstruction = { parts: [{ text: systemContent }] };
    // Callers may pass opts.maxTokens to widen the output ceiling; Gemini
    // expresses this as generationConfig.maxOutputTokens.
    if (typeof opts.maxTokens === "number" && opts.maxTokens > 0) {
      body2.generationConfig = Object.assign({}, body2.generationConfig, { maxOutputTokens: opts.maxTokens });
    }
    // Gemini tools wire shape:
    // tools: [{functionDeclarations: [{name, description, parameters}]}]
    if (Array.isArray(opts.tools) && opts.tools.length > 0) {
      body2.tools = [{
        functionDeclarations: opts.tools.map(function(t) {
          return {
            name:        t.name,
            description: t.description,
            parameters:  t.input_schema || t.parameters || { type: "object", properties: {} }
          };
        })
      }];
    }
    return {
      url: joinUrl(baseUrl, "/v1beta/models/" + encodeURIComponent(model) +
                            ":generateContent?key=" + encodeURIComponent(apiKey)),
      headers: { "Content-Type": "application/json" },
      body: body2
    };
  }
  throw new Error("aiService.buildRequest: unknown provider kind '" + providerKind + "'");
}

function openAiHeaders(apiKey) {
  var h = { "Content-Type": "application/json" };
  if (apiKey) h["Authorization"] = "Bearer " + apiKey;
  return h;
}

function joinUrl(base, path) {
  if (!base) return path;
  if (base.charAt(base.length - 1) === "/") base = base.slice(0, -1);
  if (path.charAt(0) !== "/") path = "/" + path;
  // For Gemini we sometimes already include the full path; check for a
  // collision with `/v1beta`.
  return base + path;
}

// Extract the assistant text from a provider's response shape.
export function extractText(providerKind, json) {
  if (!json) return "";
  if (providerKind === "openai-compatible") {
    var c0 = json.choices && json.choices[0];
    if (!c0) return "";
    var msg = c0.message;
    // OpenAI message.content can be string OR null (when only tool_calls).
    if (msg && typeof msg.content === "string") return msg.content;
    return "";
  }
  if (providerKind === "anthropic") {
    var blocks = json.content || [];
    var text = "";
    blocks.forEach(function(b) {
      if (b && b.type === "text" && typeof b.text === "string") text += b.text;
    });
    return text;
  }
  if (providerKind === "gemini") {
    var cand = (json.candidates || [])[0];
    if (!cand || !cand.content) return "";
    var parts = cand.content.parts || [];
    var t = "";
    parts.forEach(function(p) { if (typeof p.text === "string") t += p.text; });
    return t;
  }
  return "";
}

// Generic tool-call extraction. Returns [{ id, name, input }] normalized
// across providers, or an empty array when the response carries no tool
// calls.
export function extractToolCalls(providerKind, json) {
  if (!json) return [];
  if (providerKind === "anthropic") {
    var blocks = json.content || [];
    var out = [];
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (b && b.type === "tool_use" && typeof b.name === "string") {
        out.push({ id: b.id || null, name: b.name, input: b.input || {} });
      }
    }
    return out;
  }
  if (providerKind === "openai-compatible") {
    var c0 = json.choices && json.choices[0];
    if (!c0 || !c0.message || !Array.isArray(c0.message.tool_calls)) return [];
    return c0.message.tool_calls.map(function(tc) {
      var input = {};
      try { input = tc.function && typeof tc.function.arguments === "string"
                      ? JSON.parse(tc.function.arguments)
                      : {}; }
      catch (_e) { input = {}; }
      return {
        id:    tc.id || null,
        name:  (tc.function && tc.function.name) || "",
        input: input
      };
    }).filter(function(x) { return x.name.length > 0; });
  }
  if (providerKind === "gemini") {
    var cand = (json.candidates || [])[0];
    if (!cand || !cand.content || !Array.isArray(cand.content.parts)) return [];
    var out2 = [];
    cand.content.parts.forEach(function(p) {
      if (p && p.functionCall && typeof p.functionCall.name === "string") {
        out2.push({
          id:    null,                   // Gemini lacks per-call ids; correlation by name
          name:  p.functionCall.name,
          input: p.functionCall.args || {}
        });
      }
    });
    return out2;
  }
  return [];
}

// streamCompletion(opts) — async generator over Anthropic SSE events.
//
// Yields:
//   { kind: "text",     token:  string }
//   { kind: "tool_use", id, name, input }
//   { kind: "done",     text:   string }
//
// Uses the same buildRequest('anthropic') wire shape as chatCompletion
// plus body.stream=true. Reads response.body as a ReadableStream and
// parses SSE per Anthropic's event grammar (`event: <name>\ndata:
// <json>\n\n` blocks). Tool-use input arrives as a sequence of
// input_json_delta partials that are accumulated and JSON.parsed on
// content_block_stop. There is no retry/fallback here: the stream is
// committed once headers come back, so recovery from a mid-stream drop
// is the caller's responsibility. Anthropic-only.
export async function* streamCompletion(opts) {
  if ((opts.providerKey || "") !== "anthropic") {
    throw new Error("streamCompletion: only providerKey='anthropic' supported in rc.2; got " + (opts.providerKey || "(none)"));
  }
  var fetchImpl = opts.fetchImpl || (typeof window !== "undefined" ? window.fetch.bind(window) : null);
  if (!fetchImpl) throw new Error("streamCompletion: no fetch implementation available");

  var built = buildRequest("anthropic", opts);
  built.body.stream = true;

  var resp = await fetchImpl(built.url, {
    method:  "POST",
    headers: built.headers,
    body:    JSON.stringify(built.body)
  });
  if (!resp.ok) {
    var bodyText = "";
    try { bodyText = await resp.text(); } catch (_e) {}
    throw buildHttpError("anthropic", resp.status, bodyText);
  }
  if (!resp.body || typeof resp.body.getReader !== "function") {
    throw new Error("streamCompletion: Anthropic response.body is not a ReadableStream (browser-only path)");
  }

  var reader  = resp.body.getReader();
  var decoder = new TextDecoder();
  var buffer  = "";
  // Track in-flight tool_use blocks by content-block index so input_json_delta
  // partials accumulate until content_block_stop.
  var toolBlocks = {}; // index → { id, name, partialJson }
  var fullText = "";

  while (true) {
    var chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });

    // SSE events are separated by a blank line (\n\n). Drain complete
    // events; leave a trailing partial event in the buffer.
    var idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      var block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      var dataLine = "";
      var lines = block.split("\n");
      for (var li = 0; li < lines.length; li++) {
        if (lines[li].slice(0, 6) === "data: ") {
          dataLine += lines[li].slice(6);
        }
      }
      if (!dataLine) continue;
      var parsed;
      try { parsed = JSON.parse(dataLine); } catch (_e) { continue; }
      if (!parsed) continue;

      if (parsed.type === "content_block_start" && parsed.content_block) {
        var cb = parsed.content_block;
        if (cb.type === "tool_use") {
          toolBlocks[parsed.index] = {
            id: cb.id || null,
            name: cb.name || "",
            partialJson: ""
          };
        }
      } else if (parsed.type === "content_block_delta" && parsed.delta) {
        if (parsed.delta.type === "text_delta" && typeof parsed.delta.text === "string") {
          fullText += parsed.delta.text;
          yield { kind: "text", token: parsed.delta.text };
        } else if (parsed.delta.type === "input_json_delta") {
          var tb1 = toolBlocks[parsed.index];
          if (tb1) tb1.partialJson += (parsed.delta.partial_json || "");
        }
      } else if (parsed.type === "content_block_stop") {
        var tb2 = toolBlocks[parsed.index];
        if (tb2) {
          var input = {};
          try { input = JSON.parse(tb2.partialJson || "{}"); } catch (_e) { input = {}; }
          yield { kind: "tool_use", id: tb2.id, name: tb2.name, input: input };
        }
      }
      // message_start / message_delta / message_stop / ping → informational
    }
  }
  yield { kind: "done", text: fullText };
}

// Convenience: run a tiny "Reply OK" probe to verify wiring. Returns
// { ok: true, sample: "..." } or { ok: false, error: "..." }.
export async function testConnection(opts) {
  try {
    var res = await chatCompletion({
      providerKey:    opts.providerKey,
      baseUrl:        opts.baseUrl,
      model:          opts.model,
      fallbackModels: opts.fallbackModels,
      apiKey:         opts.apiKey,
      messages:       [
        { role: "system", content: "Reply with exactly 'OK' — no other words." },
        { role: "user",   content: "Probe." }
      ]
    });
    return { ok: true, sample: (res.text || "").slice(0, 80), modelUsed: res.modelUsed };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}
