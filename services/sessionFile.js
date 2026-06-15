// services/sessionFile.js — user-owned save/open file
//
// The user's durable workbook: every piece of work they've authored,
// packaged in one .canvas file they control. Round-trips cleanly across
// localStorage, across machines, across version upgrades.
//
// File format (v1 — embedded `fileFormatVersion` lets future slices evolve
// the envelope without breaking older files):
//
//   {
//     fileFormatVersion: 1,
//     appVersion:        "2.4.10",         // what saved the file
//     schemaVersion:     "2.0",            // session-schema at save time
//     savedAt:           "2026-04-24T14:32:00Z",
//     session: { ...full session object... },
//     skills:  [ ...AI skills library...  ],
//     providerConfig: {
//       activeProvider: "gemini",
//       providers: {
//         local:     { label, baseUrl, model, fallbackModels /* no apiKey */ },
//         anthropic: { label, baseUrl, model, fallbackModels /* no apiKey */ },
//         gemini:    { label, baseUrl, model, fallbackModels /* no apiKey */ }
//       }
//     }
//     // providerKeys: OPT-IN. Present only if user ticked "include API keys".
//   }
//
// Security default: API keys are STRIPPED by `buildSaveEnvelope` unless
// the caller passes `{ includeApiKeys: true }`. A colleague who opens
// your file uses their own keys; your secrets stay on your machine.
//
// Forward-compat: `parseFileEnvelope` is tolerant of unknown top-level
// keys (preserved but ignored) and runs the session through the existing
// migrateLegacySession so every rationalize-coercion + primary-layer
// backfill we've shipped applies to imported files automatically.

import { APP_VERSION } from "../core/version.js";
// The .canvas file format stays v2 (the single source of truth for
// inter-version compatibility); translation to a v3 engagement happens
// here on load, so app.js receives an engagement ready for
// setActiveEngagement.
import { translateV2SessionToV3Engagement } from "../state/runtimeMigrate.js";

export var FILE_FORMAT_VERSION = 1;
export var FILE_EXTENSION      = ".canvas";
export var FILE_MIME           = "application/vnd.delltech.canvas+json";

// Strip apiKey from a providers-map clone. Returns a NEW object so the
// live aiConfig stays untouched.
function stripApiKeys(providersMap) {
  var out = {};
  Object.keys(providersMap || {}).forEach(function(pk) {
    var p = providersMap[pk] || {};
    out[pk] = {
      label:          p.label,
      baseUrl:        p.baseUrl,
      model:          p.model,
      fallbackModels: Array.isArray(p.fallbackModels) ? p.fallbackModels.slice() : []
      // apiKey intentionally omitted
    };
  });
  return out;
}

// Build the envelope object that gets JSON-serialized. Caller chooses
// whether to include API keys via opts.includeApiKeys (default false).
export function buildSaveEnvelope(args) {
  var session        = args.session;
  var skills         = Array.isArray(args.skills) ? args.skills : [];
  var providerConfig = args.providerConfig || { activeProvider: "local", providers: {} };
  var includeApiKeys = args.includeApiKeys === true;

  var envelope = {
    fileFormatVersion: FILE_FORMAT_VERSION,
    appVersion:        APP_VERSION,
    schemaVersion:     (session && session.sessionMeta && session.sessionMeta.version) || "2.0",
    savedAt:           new Date().toISOString(),
    session:           cloneJson(session),
    skills:            cloneJson(skills),
    providerConfig: {
      activeProvider: providerConfig.activeProvider,
      providers:      stripApiKeys(providerConfig.providers)
    }
  };

  if (includeApiKeys) {
    // Separate bag so the default-load path can ignore it in one check.
    // Shape mirrors providers but carries ONLY the apiKey field.
    envelope.providerKeys = {};
    Object.keys(providerConfig.providers || {}).forEach(function(pk) {
      var p = providerConfig.providers[pk] || {};
      if (typeof p.apiKey === "string" && p.apiKey.length > 0) {
        envelope.providerKeys[pk] = { apiKey: p.apiKey };
      }
    });
  }

  return envelope;
}

// Derive a safe, user-friendly filename. "Acme Financial Services" →
// "acme-financial-services-2026-04-24.canvas".
export function suggestFilename(session) {
  var c = session && session.customer || {};
  var base = (c.name || "session").toString().trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "session";
  var date = new Date().toISOString().slice(0, 10);
  return base + "-" + date + FILE_EXTENSION;
}

// Parse a raw string (from a user-selected file or a dropped blob) into
// a normalised envelope. Throws with a clear error when the file is
// malformed. Does NOT apply the envelope — caller decides.
export function parseFileEnvelope(rawText) {
  if (typeof rawText !== "string" || rawText.trim().length === 0) {
    throw new Error("File is empty.");
  }
  var parsed;
  try { parsed = JSON.parse(rawText); }
  catch (e) {
    throw new Error("File is not valid JSON: " + (e && e.message || String(e)));
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("File root must be a JSON object.");
  }
  // fileFormatVersion check — tolerate missing (treat as 1) for hand-
  // edited files, reject anything newer than we know how to read.
  var fv = typeof parsed.fileFormatVersion === "number" ? parsed.fileFormatVersion : 1;
  if (fv > FILE_FORMAT_VERSION) {
    throw new Error("File was saved by a newer Canvas version (fileFormatVersion=" + fv +
      ") — upgrade the app first, or ask the sender to export from " +
      "Canvas v" + APP_VERSION + " or earlier.");
  }
  if (!parsed.session || typeof parsed.session !== "object") {
    throw new Error("File is missing the .session block.");
  }
  return parsed;
}

// Apply an envelope. Translates the v2-shape `env.session` into a v3
// engagement via the runtime migrator (state/runtimeMigrate.js). The
// returned `engagement` is ready for
// state/engagementStore.setActiveEngagement directly, with all
// instances/gaps/envs/drivers from the loaded file intact.
//
// Returns { engagement, skills, providerConfig, savedAppVersion,
// savedAt, warnings }; the caller writes the engagement directly via
// setActiveEngagement.
export function applyEnvelope(env, opts) {
  opts = opts || {};
  var warnings = [];

  // Translate the v2 envelope's session block into a v3 engagement.
  // Throws MigrationStepError on malformed input; the caller catches
  // and surfaces via notifyError.
  var engagement = translateV2SessionToV3Engagement(cloneJson(env.session));

  // Envelope was saved in a newer appVersion — flag for UI to warn.
  if (env.appVersion && env.appVersion > APP_VERSION) {
    warnings.push("File was saved in Canvas v" + env.appVersion +
      "; you're on v" + APP_VERSION + ". Some newer fields may be ignored.");
  }

  var skills = Array.isArray(env.skills) ? cloneJson(env.skills) : [];

  // providerConfig: merge incoming non-key settings (baseUrl, model,
  // fallbackModels) with the user's EXISTING apiKeys unless the file
  // carried opted-in keys AND the caller opted in to apply them.
  var providerConfig = null;
  if (env.providerConfig && typeof env.providerConfig === "object") {
    providerConfig = cloneJson(env.providerConfig);
    providerConfig.providers = providerConfig.providers || {};
    if (env.providerKeys && opts.applyApiKeys === true) {
      Object.keys(env.providerKeys).forEach(function(pk) {
        var k = env.providerKeys[pk];
        if (providerConfig.providers[pk] && k && typeof k.apiKey === "string") {
          providerConfig.providers[pk].apiKey = k.apiKey;
        }
      });
    } else if (env.providerKeys) {
      warnings.push("File included API keys; they were NOT applied. Your own keys are kept. " +
        "Re-import with 'Apply included API keys' checked to use them.");
    }
  }

  return {
    engagement:      engagement,
    skills:          skills,
    providerConfig:  providerConfig,
    savedAppVersion: env.appVersion || "unknown",
    savedAt:         env.savedAt    || null,
    warnings:        warnings
  };
}

function cloneJson(o) {
  try { return JSON.parse(JSON.stringify(o)); }
  catch (e) { return o; }
}
