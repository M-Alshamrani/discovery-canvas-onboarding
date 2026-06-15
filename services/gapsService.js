// services/gapsService.js — pure read-side gap queries
//
// Reads gaps via getActiveEngagement().gaps and returns a flat array of
// gap objects (id, gapType, layerId, affectedLayers,
// affectedEnvironments, urgency, phase, etc.).
//
// Closed-gap behavior: none of these helpers filter by gap.status. The
// caller is responsible for closed-gap exclusion (the gaps and summary
// views apply the user's show-closed-gaps toggle). This is by design,
// so these functions are reusable across "show all" and "active only"
// contexts. Hidden environments are likewise not filtered here
// (envId="all" returns everything).

import { getActiveEngagement } from "../state/engagementStore.js";

export function getAllGaps() {
  const eng = getActiveEngagement();
  if (!eng || !eng.gaps || !Array.isArray(eng.gaps.allIds)) return [];
  return eng.gaps.allIds.map(id => eng.gaps.byId[id]).filter(Boolean);
}

export function getFilteredGaps({ layerIds = [], envId = "all" } = {}) {
  return getAllGaps().filter(g => {
    const layers = g.affectedLayers?.length ? g.affectedLayers : [g.layerId];
    const envs   = g.affectedEnvironments || [];
    const lOk = !layerIds.length || layers.some(l => layerIds.includes(l));
    const eOk = envId === "all" || envs.length === 0 || envs.includes(envId);
    return lOk && eOk;
  });
}

export function getGapsByPhase({ layerIds = [], envId = "all" } = {}) {
  const result = { now: [], next: [], later: [] };
  getFilteredGaps({ layerIds, envId }).forEach(g => {
    const ph = g.phase || "now";
    if (!result[ph]) result[ph] = [];
    result[ph].push(g);
  });
  return result;
}
