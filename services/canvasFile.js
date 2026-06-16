// services/canvasFile.js -- saving and loading Canvas .canvas files.
//
// A .canvas file is the on-disk format for an engagement. This module
// turns a live engagement into a file (save) and turns a file back into
// a live engagement (load). Files are validated against the engagement
// schema on the way out and on the way in, so a malformed file is caught
// at the boundary instead of corrupting app state.
//
// Two boundaries:
//   1. Save: validate the engagement, strip transient fields and
//      secondary indexes, and wrap it with a small header.
//   2. Load: read the header, accept only the current schema version,
//      validate the engagement, run the integrity sweep, and rebuild
//      the secondary indexes.
//
// Only the current schema version loads. A file from an older version
// surfaces a friendly "this file is from a previous version" error and
// the user starts fresh.

import { APP_VERSION } from "../core/version.js";
import { EngagementSchema, CURRENT_SCHEMA_VERSION } from "../schema/engagement.js";
import { loadAllCatalogs } from "./catalogLoader.js";
import { runIntegritySweep } from "../state/integritySweep.js";

export const FILE_FORMAT_VERSION = "v3-1";   // on-disk file format tag
export const FILE_MIME = "application/x-dell-discovery-canvas";

// ---------------------------------------------------------------------
// buildSaveEnvelope — build the on-disk save shape
// ---------------------------------------------------------------------
//
// Produces the wrapper that gets written to the file: file/app/schema
// versions, a savedAt timestamp, and the engagement to persist.
//
// Before persisting it strips:
//   - Transient fields (activeEntity, integrityLog) from the engagement
//   - Secondary indexes (instances.byState); these are rebuilt on load
//
// The engagement must validate against the schema first. If it does not,
// nothing is saved and the structured issues are returned so the caller
// can show them to the user.
//
// opts: { skills, providerConfig, includeApiKeys }. A save bundles the
// engagement plus the AI skills library and provider settings. API keys
// are stripped by default; passing includeApiKeys === true moves them
// into a separate opt-in `providerKeys` bag, so a colleague who opens the
// file uses their own keys unless the keys were deliberately shared.
export function buildSaveEnvelope(engagement, opts = {}) {
  // Boundary validation: the engagement we save must be valid.
  const validation = EngagementSchema.safeParse(engagement);
  if (!validation.success) {
    return {
      ok:     false,
      errors: validation.error.issues.map(i => ({
        path:    i.path.join("."),
        message: i.message,
        code:    i.code
      }))
    };
  }

  // Strip transient + secondary indexes for the persisted shape.
  const persisted = stripForPersist(validation.data);

  const skills         = Array.isArray(opts.skills) ? cloneJson(opts.skills) : [];
  const providerConfig = opts.providerConfig || { activeProvider: "local", providers: {} };
  const includeApiKeys = opts.includeApiKeys === true;

  const envelope = {
    fileFormatVersion: FILE_FORMAT_VERSION,
    appVersion:        APP_VERSION,
    schemaVersion:     CURRENT_SCHEMA_VERSION,
    savedAt:           new Date().toISOString(),
    engagement:        persisted,
    skills:            skills,
    providerConfig: {
      activeProvider: providerConfig.activeProvider,
      providers:      stripApiKeys(providerConfig.providers)
    }
  };

  if (includeApiKeys) {
    // Separate bag so the default-load path can ignore it in one check.
    envelope.providerKeys = {};
    Object.keys(providerConfig.providers || {}).forEach(pk => {
      const p = providerConfig.providers[pk] || {};
      if (typeof p.apiKey === "string" && p.apiKey.length > 0) {
        envelope.providerKeys[pk] = { apiKey: p.apiKey };
      }
    });
  }

  return { ok: true, envelope };
}

// Strip apiKey from a providers-map clone. Returns a new object so the
// live aiConfig stays untouched.
function stripApiKeys(providersMap) {
  const out = {};
  Object.keys(providersMap || {}).forEach(pk => {
    const p = providersMap[pk] || {};
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

// Parse a raw string into an envelope object. Throws readable errors on
// malformed input. Tolerant of unknown top-level keys; the schema-version
// check (including the previous-version rejection) happens in loadCanvas.
export function parseFileEnvelope(rawText) {
  if (typeof rawText !== "string" || rawText.trim().length === 0) {
    throw new Error("File is empty.");
  }
  let parsed;
  try { parsed = JSON.parse(rawText); }
  catch (e) { throw new Error("File is not valid JSON: " + ((e && e.message) || String(e))); }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("File root must be a JSON object.");
  }
  return parsed;
}

// Derive a safe, friendly filename from the engagement's customer name,
// with today's date appended. "Acme Financial Services" becomes
// "acme-financial-services-YYYY-MM-DD.canvas".
export function suggestFilename(engagement) {
  const name = engagement && engagement.customer && engagement.customer.name;
  const base = (name || "engagement").toString().trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "engagement";
  const date = new Date().toISOString().slice(0, 10);
  return base + "-" + date + ".canvas";
}

function cloneJson(o) {
  try { return JSON.parse(JSON.stringify(o)); }
  catch (e) { return o; }
}

function stripForPersist(eng) {
  // Drop transient fields entirely.
  // eslint-disable-next-line no-unused-vars
  const { activeEntity, integrityLog, ...persisted } = eng;
  // Drop secondary indexes: instances.byState rebuilds on load from byId+state.
  const persistedInstances = {
    byId:   persisted.instances.byId,
    allIds: persisted.instances.allIds
    // byState intentionally omitted
  };
  return { ...persisted, instances: persistedInstances };
}

// ---------------------------------------------------------------------
// loadCanvas -- turn an envelope back into a live engagement
// ---------------------------------------------------------------------
//
// Accepts only the current schema version, validates the engagement
// against the schema, runs the integrity sweep, rebuilds the secondary
// indexes (instances.byState from byId.state), and re-attaches the
// transient fields (activeEntity, integrityLog).
//
// An envelope from an older schema version surfaces
// FILE_FROM_PREVIOUS_VERSION; the user starts fresh.
//
// Returns { ok: true, engagement } or { ok: false, error, recoveryHint }.

export async function loadCanvas(envelope, opts = {}) {
  if (!envelope || typeof envelope !== "object") {
    return {
      ok:    false,
      error: { code: "INVALID_ENVELOPE", message: "Envelope is missing or not an object" },
      recoveryHint: "The .canvas file appears corrupted. Try downloading a fresh copy."
    };
  }

  // Schema version check. Only CURRENT_SCHEMA_VERSION loads. An older
  // file surfaces a friendly error; a newer file asks for a newer build.
  const schemaVersion = envelope.schemaVersion ?? envelope.engagement?.meta?.schemaVersion ?? "2.0";
  if (schemaVersion !== CURRENT_SCHEMA_VERSION) {
    if (schemaVersion < CURRENT_SCHEMA_VERSION) {
      return {
        ok:    false,
        error: {
          code:           "FILE_FROM_PREVIOUS_VERSION",
          message:        `This .canvas file is from a previous version of Canvas (schema ${schemaVersion}). This build only loads schema ${CURRENT_SCHEMA_VERSION}.`,
          schemaVersion,
          buildSchema:    CURRENT_SCHEMA_VERSION
        },
        recoveryHint: "Start a fresh session. Older file formats are no longer supported."
      };
    }
    return {
      ok:    false,
      error: {
        code:    "FILE_NEWER_THAN_BUILD",
        message: `Envelope schema version ${schemaVersion} is newer than build's ${CURRENT_SCHEMA_VERSION}.`,
        schemaVersion
      },
      recoveryHint: "Open this file in a newer Canvas build."
    };
  }
  const v3Engagement = envelope.engagement;

  // Hydrate secondary indexes (the persisted shape doesn't carry them).
  const hydrated = hydrate(v3Engagement);

  // Validate the hydrated engagement before doing anything with it.
  const validation = EngagementSchema.safeParse(hydrated);
  if (!validation.success) {
    return {
      ok:    false,
      error: {
        code:    "VALIDATION_FAILED",
        message: "Loaded engagement failed schema validation.",
        issues:  validation.error.issues
      },
      recoveryHint: "The .canvas file is malformed. Try opening a known-good backup."
    };
  }

  // Integrity sweep. Schema validation checks shape but not references,
  // so the sweep handles foreign-key orphans (an id pointing at a missing
  // record) and detects drift against the AI catalog versions.
  let sweptEngagement = validation.data;
  let sweepLog = [];
  let sweepQuarantine = [];
  try {
    const catalogs = await loadAllCatalogs();
    const sweep = runIntegritySweep(validation.data, catalogs);
    sweptEngagement = sweep.repaired;
    sweepLog = sweep.log;
    sweepQuarantine = sweep.quarantine;
  } catch (e) {
    // Sweep failure is non-fatal: surface but proceed with un-swept engagement.
    sweepLog = [{ ruleId: "INT-SWEEP-ERROR", message: e.message }];
  }

  // Extract the non-engagement payload (AI skills + provider config). API
  // keys ride in the opt-in `providerKeys` bag and are folded into
  // providerConfig only when the caller passes { applyApiKeys: true }.
  const skills = Array.isArray(envelope.skills) ? cloneJson(envelope.skills) : [];
  const warnings = [];
  let providerConfig = null;
  if (envelope.providerConfig && typeof envelope.providerConfig === "object") {
    providerConfig = cloneJson(envelope.providerConfig);
    providerConfig.providers = providerConfig.providers || {};
    if (envelope.providerKeys && opts.applyApiKeys === true) {
      Object.keys(envelope.providerKeys).forEach(pk => {
        const k = envelope.providerKeys[pk];
        if (providerConfig.providers[pk] && k && typeof k.apiKey === "string") {
          providerConfig.providers[pk].apiKey = k.apiKey;
        }
      });
    } else if (envelope.providerKeys) {
      warnings.push("File included API keys; they were NOT applied. Your own keys are kept.");
    }
  }
  if (envelope.appVersion && envelope.appVersion > APP_VERSION) {
    warnings.push("File was saved in Canvas v" + envelope.appVersion + "; you're on v" + APP_VERSION + ".");
  }

  return {
    ok:              true,
    engagement:      sweptEngagement,
    skills:          skills,
    providerConfig:  providerConfig,
    savedAppVersion: envelope.appVersion || "unknown",
    savedAt:         envelope.savedAt    || null,
    warnings:        warnings,
    integrityLog:    sweepLog,
    quarantine:      sweepQuarantine
  };
}

function hydrate(persisted) {
  // Rebuild instances.byState from byId.state.
  const byId    = persisted.instances?.byId   ?? {};
  const allIds  = persisted.instances?.allIds ?? [];
  const current = [];
  const desired = [];
  for (const id of allIds) {
    const inst = byId[id];
    if (inst?.state === "current") current.push(id);
    else if (inst?.state === "desired") desired.push(id);
  }
  return {
    ...persisted,
    instances: {
      byId,
      allIds,
      byState: { current, desired }
    },
    // Re-attach transient fields with empty defaults.
    activeEntity: null,
    integrityLog: []
  };
}
