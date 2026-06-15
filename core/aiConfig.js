// core/aiConfig.js
//
// AI provider configuration: per-provider endpoint + model + API key,
// plus the active-provider selector. Lives in localStorage under
// `ai_config_v1`. Keys are visible in browser DevTools (acceptable for
// personal/dev use).

const STORAGE_KEY = "ai_config_v1";

// Each provider shares the same connection shape: url + model + apiKey +
// fallback chain. Local A and Local B let the user run two self-hosted
// LLMs side-by-side (e.g. one model for code, another for prose); both
// are unauth'd by default (typical self-hosted vLLM behind an nginx
// proxy). The user supplies the URL + model id at runtime via Settings.
export const PROVIDERS = ["local", "localB", "anthropic", "gemini", "dellSalesChat"];

// Defaults — every field is overridable via the Settings modal at runtime.
// Local URL is relative (uses the container's nginx proxy by default; the
// user can paste an absolute URL like "http://<host-ip>:8000/v1" to bypass
// the proxy and call vLLM directly when CORS allows it).
// Each provider may declare `fallbackModels: string[]`. aiService walks the
// list if the primary model exhausts retries on a transient upstream error
// (429/5xx). Empty array = single-model mode.
export const DEFAULT_AI_CONFIG = {
  activeProvider: "local",
  providers: {
    local: {
      label:          "Local A",
      baseUrl:        "/api/llm/local/v1",
      model:          "code-llm",
      apiKey:         "",                     // typical self-hosted vLLM is unauth'd behind the proxy
      fallbackModels: []
    },
    // Second local LLM slot. Defaults to a sibling proxy path
    // (/api/llm/local-b/v1); the user pastes the actual URL + model id in
    // Settings. Same auth shape as Local A: no key needed by default (the
    // nginx proxy gates access; downstream vLLM is unauth'd). The distinct
    // proxy path lets a single host run two independent vLLM endpoints
    // without colliding.
    localB: {
      label:          "Local B",
      baseUrl:        "/api/llm/local-b/v1",
      model:          "",
      apiKey:         "",
      fallbackModels: []
    },
    anthropic: {
      label:          "Anthropic Claude",
      baseUrl:        "/api/llm/anthropic",   // proxy path; not user-editable
      model:          "claude-haiku-4-5",
      apiKey:         "",
      fallbackModels: ["claude-sonnet-4-5"]
    },
    gemini: {
      label:          "Google Gemini",
      baseUrl:        "/api/llm/gemini",      // proxy path; not user-editable
      model:          "gemini-2.5-flash",     // gemini-2.0-flash deprecated to new users (2026-Q1)
      apiKey:         "",
      // gemini-2.5-flash is the most-used (= most-overloaded) model. The
      // fallback chain prefers still-fast models before dropping to the
      // stable 1.5 family.
      fallbackModels: ["gemini-2.0-flash", "gemini-1.5-flash"]
    },
    dellSalesChat: {
      label:          "Dell Sales Chat",
      baseUrl:        "",                     // user pastes their endpoint
      model:          "",                     // user supplies model id
      apiKey:         "",
      fallbackModels: []
    }
  }
};

export function loadAiConfig() {
  try {
    var raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return JSON.parse(JSON.stringify(DEFAULT_AI_CONFIG));
    var parsed = JSON.parse(raw);
    return mergeWithDefaults(parsed);
  } catch (e) {
    return JSON.parse(JSON.stringify(DEFAULT_AI_CONFIG));
  }
}

export function saveAiConfig(config) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    return true;
  } catch (e) {
    return false;
  }
}

// Carry forward any values the user has set, filling in missing ones from
// defaults. Lets new providers be added later without breaking saved configs.
//
// Also performs one-shot migrations for model IDs deprecated upstream. The
// user's key + endpoint are preserved; only the model string shifts to the
// supported replacement.
var DEPRECATED_MODELS = {
  gemini: { "gemini-2.0-flash": "gemini-2.5-flash" }   // deprecated to new users 2026-Q1
};

function mergeWithDefaults(stored) {
  var merged = JSON.parse(JSON.stringify(DEFAULT_AI_CONFIG));
  if (stored && typeof stored.activeProvider === "string"
      && PROVIDERS.indexOf(stored.activeProvider) >= 0) {
    merged.activeProvider = stored.activeProvider;
  }
  if (stored && stored.providers && typeof stored.providers === "object") {
    PROVIDERS.forEach(function(p) {
      var s = stored.providers[p];
      if (!s) return;
      var d = merged.providers[p];
      if (typeof s.baseUrl === "string" && s.baseUrl.length > 0) d.baseUrl = s.baseUrl;
      if (typeof s.model   === "string" && s.model.length > 0) {
        var deprMap = DEPRECATED_MODELS[p] || {};
        d.model = deprMap[s.model] || s.model;
      }
      if (typeof s.apiKey  === "string")                          d.apiKey  = s.apiKey;
      // Honour a user-supplied fallback chain if present; keep the default
      // otherwise. Stored entries are filtered to strings so a garbled save
      // can't crash chatCompletion.
      if (Array.isArray(s.fallbackModels)) {
        d.fallbackModels = s.fallbackModels.filter(function(m) {
          return typeof m === "string" && m.trim().length > 0;
        });
      }
    });
  }
  return merged;
}

// True when the active provider has enough config to make a real call.
export function isActiveProviderReady(config) {
  var c = config || loadAiConfig();
  var p = c.providers[c.activeProvider];
  if (!p) return false;
  if (!p.baseUrl) return false;
  // Local providers (A + B) don't require a key (typical self-hosted
  // vLLM behind nginx proxy is unauth'd); public providers do.
  if (c.activeProvider !== "local" && c.activeProvider !== "localB" && !p.apiKey) return false;
  return true;
}
