// state/runtimeMigrate.js
//
// Runtime v2-session → v3-engagement adapter.
//
// Thin wrapper around the migrations/v2-0_to_v3-0 pipeline +
// migrations/helpers/pipelineContext.js makePipelineContext. Lets app.js's
// file-open path translate the v2-shape session returned by
// services/sessionFile.js applyEnvelope() into an engagement that
// state/engagementStore.js can accept directly via setActiveEngagement.
//
// Why this exists:
//   It pipes the WHOLE v2 session through the same migrator that runs at
//   .canvas file load, so the resulting engagement carries the loaded
//   file's instances/gaps/envs/drivers in full — not just the customer
//   name — and is set into engagementStore directly.
//
// Why not just call migrateToVersion directly from app.js:
//   The migrator needs a `pipelineContext` with a catalog snapshot. This
//   wrapper bakes that snapshot from the live core/config.js +
//   catalogs/snapshots/* sources so callers don't assemble it each time.
//   The single source of truth for the current catalog version stays in
//   catalogs/snapshots/.

import { migrateToVersion } from "../migrations/index.js";
import { makePipelineContext } from "../migrations/helpers/pipelineContext.js";
import BUSINESS_DRIVERS_SNAPSHOT from "../catalogs/snapshots/business_drivers.js";
import ENV_CATALOG_SNAPSHOT      from "../catalogs/snapshots/env_catalog.js";
// migrateLegacySession (defined below) is the canonical-form finalizer
// that runs BEFORE the v3 pipeline. This module is the home for pure
// v2→v3 migration logic.
import { LEGACY_DRIVER_LABEL_TO_ID } from "../core/config.js";
import { normalizeServices } from "../core/services.js";

// setPrimaryLayer + deriveProjectId are tiny pure functions inlined here
// so this module is self-contained; it is their only caller.
function setPrimaryLayer(gap, layerId) {
  if (!gap || typeof layerId !== "string" || layerId.length === 0) return;
  gap.layerId = layerId;
  var existing = Array.isArray(gap.affectedLayers) ? gap.affectedLayers : [];
  var rest = existing.filter(function(l) { return l !== layerId; });
  gap.affectedLayers = [layerId].concat(rest);
}

function deriveProjectId(gap) {
  if (!gap) return "unknown::unknown::unknown";
  var env = (Array.isArray(gap.affectedEnvironments) && gap.affectedEnvironments[0])
    || "crossCutting";
  var layer = gap.layerId || "unknown";
  var type = gap.gapType || "null";
  return env + "::" + layer + "::" + type;
}

// migrateLegacySession(raw) -> v2-canonical session
//
// raw is mutated in place AND returned. Applies every pre-v3
// normalization: drivers extraction from primaryDriver, the dynamic
// environment model + alias drain, "rationalize" disposition/gapType
// coercion, the primary-layer invariant + projectId backfill, the
// urgencyOverride default, and services normalization.
//
// The v3 pipeline (migrations/v2-0_to_v3-0/index.js) assumes a clean
// canonical v2 shape; running this function first is the contract.
export function migrateLegacySession(raw) {
  var s = raw || {};
  if (!s.customer || typeof s.customer !== "object") s.customer = {};
  var c = s.customer;

  if (typeof c.name     === "undefined") c.name     = "";
  if (typeof c.vertical === "undefined") c.vertical = c.segment || c.industry || "";
  if (typeof c.segment  === "undefined") c.segment  = "";
  if (typeof c.industry === "undefined") c.industry = "";
  if (typeof c.region   === "undefined") c.region   = "";

  if (!Array.isArray(c.drivers)) {
    var legacyLabel    = c.primaryDriver;
    var legacyOutcomes = s.businessOutcomes;
    if (legacyLabel && LEGACY_DRIVER_LABEL_TO_ID[legacyLabel]) {
      c.drivers = [{
        id:       LEGACY_DRIVER_LABEL_TO_ID[legacyLabel],
        priority: "High",
        outcomes: legacyOutcomes || ""
      }];
    } else {
      c.drivers = [];
    }
  }
  delete c.primaryDriver;
  delete s.businessOutcomes;

  if (!Array.isArray(s.instances)) s.instances = [];
  if (!Array.isArray(s.gaps))      s.gaps      = [];

  // Dynamic environment model + alias drain.
  var legacyAliases = (s.environmentAliases && typeof s.environmentAliases === "object")
    ? s.environmentAliases : null;

  if (!Array.isArray(s.environments)) {
    var referenced = {};
    s.instances.forEach(function(i) {
      if (i && typeof i.environmentId === "string" && i.environmentId.length > 0) {
        referenced[i.environmentId] = true;
      }
    });
    s.gaps.forEach(function(g) {
      if (g && Array.isArray(g.affectedEnvironments)) {
        g.affectedEnvironments.forEach(function(envId) {
          if (typeof envId === "string" && envId.length > 0) referenced[envId] = true;
        });
      }
    });
    s.environments = Object.keys(referenced).map(function(id) {
      return { id: id, hidden: false };
    });
  }

  var seenIds = {};
  s.environments = s.environments.filter(function(e) {
    if (!e || typeof e.id !== "string" || e.id.length === 0) return false;
    if (seenIds[e.id]) return false;
    seenIds[e.id] = true;
    return true;
  }).map(function(e) {
    var out = Object.assign({}, e);
    if (typeof out.hidden !== "boolean") out.hidden = false;
    if (legacyAliases && typeof legacyAliases[out.id] === "string" &&
        legacyAliases[out.id].trim().length > 0 &&
        (typeof out.alias !== "string" || out.alias.length === 0)) {
      out.alias = legacyAliases[out.id].trim();
    }
    return out;
  });
  if ("environmentAliases" in s) delete s.environmentAliases;

  s.gaps.forEach(function(g) {
    if (typeof g.reviewed !== "boolean") {
      g.reviewed = !((g.relatedDesiredInstanceIds || []).length > 0);
    }
  });

  // Coerce the retired "rationalize" disposition/gapType.
  s.gaps.forEach(function(g) {
    if (g && g.gapType === "rationalize") {
      console.warn("[migrate · Phase 17] coercing gap.gapType 'rationalize' → 'ops' on gap " + g.id);
      g.gapType = "ops";
    }
  });
  s.instances.forEach(function(i) {
    if (i && i.disposition === "rationalize") {
      console.warn("[migrate · Phase 17] coercing instance.disposition 'rationalize' → 'retire' on " + i.id);
      i.disposition = "retire";
    }
  });

  // Primary-layer, projectId, urgencyOverride, and services backfills.
  s.gaps.forEach(function(g) {
    if (!g || !g.layerId) return;
    var alreadyOk = Array.isArray(g.affectedLayers) &&
                    g.affectedLayers.length > 0 &&
                    g.affectedLayers[0] === g.layerId;
    if (!alreadyOk) setPrimaryLayer(g, g.layerId);
    if (!g.projectId) g.projectId = deriveProjectId(g);
    if (typeof g.urgencyOverride !== "boolean") g.urgencyOverride = false;
    if (!Array.isArray(g.services)) {
      g.services = [];
    } else {
      g.services = normalizeServices(g.services);
    }
  });

  if (!s.sessionMeta || typeof s.sessionMeta !== "object") {
    s.sessionMeta = {
      date:          new Date().toISOString().slice(0, 10),
      presalesOwner: "",
      status:        "Draft",
      version:       "2.0"
    };
  }

  if (!s.sessionId) {
    s.sessionId = "sess-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
  }

  return s;
}

// translateV2SessionToV3Engagement(v2Session) -> v3Engagement
//
// Pure: same input → same output (modulo the migrationTimestamp, which
// reflects wall-clock at call time). Throws MigrationStepError on
// malformed input -- the caller (app.js handleOpenedFile) catches and
// surfaces the error to the user via notifyError.
//
// The randomSeed is derived from the v2 session's sessionId when
// present, else falls back to a stable per-runtime seed. This gives
// best-effort determinism: re-opening the same .canvas file in the same
// browser session yields the same generated UUIDs rather than new ones.
export function translateV2SessionToV3Engagement(v2Session) {
  if (!v2Session || typeof v2Session !== "object") {
    throw new Error("translateV2SessionToV3Engagement: requires a v2 session object");
  }

  const seed = (v2Session.sessionMeta && v2Session.sessionMeta.sessionId)
    ? "v2-to-v3:" + v2Session.sessionMeta.sessionId
    : "v2-to-v3:runtime";

  const ctx = makePipelineContext({
    migrationTimestamp: new Date().toISOString(),
    randomSeed:         seed,
    catalogSnapshot: {
      BUSINESS_DRIVERS: { catalogVersion: BUSINESS_DRIVERS_SNAPSHOT.catalogVersion },
      ENV_CATALOG:      { catalogVersion: ENV_CATALOG_SNAPSHOT.catalogVersion }
    }
  });

  // Canonicalize the v2 shape first (rationalize coercion, primary-layer
  // backfill, etc.) THEN run through the v3 pipeline, which assumes a
  // clean v2.0 shape. Without this, an older envelope carrying
  // gapType:"rationalize" would land on a gap with gapType:"rationalize",
  // which is invalid in the v3 GAP_TYPES enum.
  var canonical = migrateLegacySession(v2Session);
  return migrateToVersion(canonical, "3.0", ctx);
}
