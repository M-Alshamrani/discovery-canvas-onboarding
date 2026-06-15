// services/vendorMixService.js — pure vendor composition analytics
//
// Reads instances via getActiveEngagement().instances.
//
// Environment-key translation: instance.environmentId is a UUID (an
// engagement.environments.byId entry), but the caller's `environments`
// param carries entries keyed by envCatalogId. computeMixByEnv
// translates UUIDs back to envCatalogIds when bucketing so the result
// keys match the caller's env list. The lookup uses a small in-memory
// map built once per call — O(envCount) setup, O(1) per instance.
//
// Closed-gap behavior: not applicable — these helpers operate on
// instances (vendor counts), not gaps.
// Hidden-env behavior: the caller passes the visible env list via the
// `environments` param, and computeMixByEnv initializes per-env buckets
// only from that list. The `if (!result[...])` auto-create path still
// counts envs that have instances but aren't in the supplied list.

import { getActiveEngagement } from "../state/engagementStore.js";

// Pull all instances out of the engagement as a flat array.
function _allInstances() {
  const eng = getActiveEngagement();
  if (!eng || !eng.instances || !Array.isArray(eng.instances.allIds)) return [];
  return eng.instances.allIds.map(id => eng.instances.byId[id]).filter(Boolean);
}

// Build envUuid -> envCatalogId lookup so per-env aggregation can
// expose buckets keyed by catalogId (matching the caller's
// environments param shape).
function _envUuidToCatalogIdMap() {
  const eng = getActiveEngagement();
  const m = {};
  if (!eng || !eng.environments || !Array.isArray(eng.environments.allIds)) return m;
  eng.environments.allIds.forEach(uuid => {
    const e = eng.environments.byId[uuid];
    if (e && e.envCatalogId) m[uuid] = e.envCatalogId;
  });
  return m;
}

function getFiltered({ stateFilter = "combined", layerIds = [] } = {}) {
  return _allInstances().filter(i => {
    if (stateFilter === "current" && i.state !== "current") return false;
    if (stateFilter === "desired" && i.state !== "desired") return false;
    if (layerIds.length && !layerIds.includes(i.layerId))   return false;
    return true;
  });
}

export function computeMixByLayer({ stateFilter = "combined", layerIds = [] } = {}) {
  const result = {};
  layerIds.forEach(id => { result[id] = { dell: 0, nonDell: 0, custom: 0, total: 0 }; });
  getFiltered({ stateFilter, layerIds }).forEach(i => {
    if (!result[i.layerId]) result[i.layerId] = { dell: 0, nonDell: 0, custom: 0, total: 0 };
    const b = result[i.layerId];
    if      (i.vendorGroup === "dell")    b.dell++;
    else if (i.vendorGroup === "nonDell") b.nonDell++;
    else                                  b.custom++;
    b.total++;
  });
  return result;
}

export function computeMixByEnv({ stateFilter = "combined", layerIds = [], environments = [] } = {}) {
  const result = {};
  environments.forEach(e => { result[e.id] = { dell: 0, nonDell: 0, custom: 0, total: 0 }; });
  // instance.environmentId is a UUID; translate back to envCatalogId so
  // buckets match the caller's env list keys.
  const envUuidToCatalog = _envUuidToCatalogIdMap();
  getFiltered({ stateFilter, layerIds }).forEach(i => {
    const envKey = envUuidToCatalog[i.environmentId] || i.environmentId;
    if (!result[envKey]) result[envKey] = { dell: 0, nonDell: 0, custom: 0, total: 0 };
    const b = result[envKey];
    if      (i.vendorGroup === "dell")    b.dell++;
    else if (i.vendorGroup === "nonDell") b.nonDell++;
    else                                  b.custom++;
    b.total++;
  });
  return result;
}

export function computeVendorTableData({ layerIds = [] } = {}) {
  const map = new Map();
  _allInstances().forEach(i => {
    if (layerIds.length && !layerIds.includes(i.layerId)) return;
    const key = i.vendor || i.label;
    if (!map.has(key)) map.set(key, { vendor: key, vendorGroup: i.vendorGroup || "custom", current: 0, desired: 0, total: 0 });
    const r = map.get(key);
    if (i.state === "current") r.current++;
    if (i.state === "desired") r.desired++;
    r.total = r.current + r.desired;
  });
  return [...map.values()].sort((a, b) => b.total - a.total);
}
