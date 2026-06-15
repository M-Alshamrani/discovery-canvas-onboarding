// core/labelResolvers.js
//
// Single source of truth for UUID/typeId → human-readable label
// resolution. Every view + service that displays a label imports from here.
// The rule: NEVER fall back to displaying a raw UUID in a user-visible
// surface — return a structured placeholder instead.
//
// Centralizing this in one module (rather than per-call-site `?: rawId`
// fallbacks) gives one contract and one test surface; future resolvers
// (skill labels, service labels, etc.) extend the same pattern.
//
// Resolver contract: each takes either a UUID (resolved against the active
// engagement) OR a static catalog typeId, and returns either a real label
// or a structured placeholder string (PLACEHOLDER_*). Defensive: never
// throws on bad input; null/undefined/empty returns the placeholder. These
// run on the render path, so any throw would crash the whole view.
//
// Module dependencies:
//   - core/config.js (LAYERS, ENV_CATALOG, ENVIRONMENTS, BUSINESS_DRIVERS) -- pure data
//   - state/engagementStore.js (getActiveEngagement) -- read-only access for UUID resolution
//   No circular deps: engagementStore does NOT import from labelResolvers.

import { LAYERS, ENV_CATALOG, ENVIRONMENTS, BUSINESS_DRIVERS } from "./config.js";
import { getActiveEngagement } from "../state/engagementStore.js";

// ─── Structured placeholder strings ─────────────────────────────────────
// These are user-visible. Parenthesized so they read as missing-data
// signals, not as real labels.
export const PLACEHOLDER_ENV      = "(unknown environment)";
export const PLACEHOLDER_LAYER    = "(unknown layer)";
export const PLACEHOLDER_DRIVER   = "(unknown driver)";
export const PLACEHOLDER_INSTANCE = "(unknown instance)";

/**
 * envLabel(idOrUuid) -> human-readable env label
 *
 * Resolution order:
 *   1. "crossCutting" sentinel -> "Cross-cutting"
 *   2. UUID against the active engagement: environments.byId[uuid] →
 *      env.alias (if non-empty) → ENV_CATALOG.find(envCatalogId).label
 *   3. typeId against the catalogs:
 *      ENV_CATALOG.find(typeId).label → ENVIRONMENTS.find(typeId).label
 *   4. PLACEHOLDER_ENV
 */
export function envLabel(idOrUuid) {
  if (!idOrUuid || typeof idOrUuid !== "string") return PLACEHOLDER_ENV;
  if (idOrUuid === "crossCutting") return "Cross-cutting";

  // Walk the active engagement by UUID.
  try {
    const eng = getActiveEngagement();
    if (eng && eng.environments && eng.environments.byId && eng.environments.byId[idOrUuid]) {
      const e = eng.environments.byId[idOrUuid];
      if (e.alias && typeof e.alias === "string" && e.alias.length > 0) return e.alias;
      const cat = ENV_CATALOG.find(function(c) { return c.id === e.envCatalogId; });
      if (cat) return cat.label;
      // An env without a known envCatalogId is a data-integrity issue
      // (the scrubber should catch it). Fall through.
    }
  } catch (_e) { /* defensive · resolver MUST NOT throw on render path */ }

  // Catalog path: try ENV_CATALOG (full 8 entries) then ENVIRONMENTS
  // (default-4 subset). The catalog is authoritative.
  const cat = ENV_CATALOG.find(function(c) { return c.id === idOrUuid; });
  if (cat) return cat.label;
  if (typeof ENVIRONMENTS !== "undefined" && Array.isArray(ENVIRONMENTS)) {
    const env = ENVIRONMENTS.find(function(e) { return e.id === idOrUuid; });
    if (env) return env.label;
  }

  return PLACEHOLDER_ENV;
}

/**
 * layerLabel(typeId) -> human-readable layer label
 *
 * LAYERS catalog has 6 fixed entries (workload / compute / storage /
 * dataProtection / virtualization / infrastructure). typeId is always
 * a string id, never a UUID. Returns PLACEHOLDER_LAYER for any unknown
 * input rather than echoing the typeId itself.
 */
export function layerLabel(typeId) {
  if (!typeId || typeof typeId !== "string") return PLACEHOLDER_LAYER;
  const l = LAYERS.find(function(x) { return x.id === typeId; });
  return l ? l.label : PLACEHOLDER_LAYER;
}

/**
 * driverLabel(idOrUuid) -> human-readable driver label
 *
 * Resolution order:
 *   1. typeId against the BUSINESS_DRIVERS catalog (direct match)
 *   2. UUID against the active engagement:
 *      drivers.byId[uuid].businessDriverId → BUSINESS_DRIVERS.find(...).label
 *   3. PLACEHOLDER_DRIVER
 */
export function driverLabel(idOrUuid) {
  if (!idOrUuid) return PLACEHOLDER_DRIVER;

  // Direct catalog typeId.
  const d = BUSINESS_DRIVERS.find(function(b) { return b.id === idOrUuid; });
  if (d) return d.label;

  // UUID → engagement.drivers.byId resolution.
  try {
    const eng = getActiveEngagement();
    const v3d = eng && eng.drivers && eng.drivers.byId && eng.drivers.byId[idOrUuid];
    if (v3d && v3d.businessDriverId) {
      const d2 = BUSINESS_DRIVERS.find(function(b) { return b.id === v3d.businessDriverId; });
      if (d2) return d2.label;
      // A driver with an unknown businessDriverId is a data-integrity
      // issue. Fall through.
    }
  } catch (_e) { /* defensive · resolver MUST NOT throw on render path */ }

  return PLACEHOLDER_DRIVER;
}

/**
 * instanceLabel(uuid) -> instance.label or PLACEHOLDER_INSTANCE
 *
 * Pure UUID resolution against the active engagement. Instances are
 * always UUID-keyed, so there is no catalog fallback.
 */
export function instanceLabel(uuid) {
  if (!uuid || typeof uuid !== "string") return PLACEHOLDER_INSTANCE;
  try {
    const eng = getActiveEngagement();
    const inst = eng && eng.instances && eng.instances.byId && eng.instances.byId[uuid];
    if (inst && typeof inst.label === "string" && inst.label.length > 0) return inst.label;
  } catch (_e) { /* defensive */ }
  return PLACEHOLDER_INSTANCE;
}
