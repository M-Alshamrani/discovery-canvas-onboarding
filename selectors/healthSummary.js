// Pure memoized selector: engagement -> HealthSummary.
//
// Output shape:
//   {
//     byLayer: Record<layerId, {
//       bucketScore: "green" | "amber" | "red",
//       riskLabel:   string,
//       counts: { totalCurrent, totalDesired, openGaps, highRiskGaps, ... }
//     }>,
//     overall: { score: 0-100, label: "Excellent" | ..., highestRiskLayer }
//   }
//
// Closed-gap exclusion: highRiskGaps excludes gap.status === "closed".

import { memoizeOne } from "../services/memoizeOne.js";

const LAYER_ORDER = ["workload", "compute", "storage", "dataProtection", "virtualization", "infrastructure"];

function compute(engagement) {
  // Hidden envs are excluded from counts (consistent with selectMatrixView default).
  const hiddenEnvIds = new Set();
  for (const id of engagement.environments.allIds) {
    if (engagement.environments.byId[id].hidden) hiddenEnvIds.add(id);
  }

  const byLayer = {};
  for (const layerId of LAYER_ORDER) {
    byLayer[layerId] = {
      bucketScore: "green",
      riskLabel: "Healthy",
      counts: { totalCurrent: 0, totalDesired: 0, openGaps: 0, highRiskGaps: 0 }
    };
  }

  // Count instances by (layer, state), excluding hidden envs.
  for (const id of engagement.instances.allIds) {
    const inst = engagement.instances.byId[id];
    if (hiddenEnvIds.has(inst.environmentId)) continue;
    const bucket = byLayer[inst.layerId];
    if (!bucket) continue;
    if (inst.state === "current") bucket.counts.totalCurrent += 1;
    else if (inst.state === "desired") bucket.counts.totalDesired += 1;
  }

  // Count gaps by primary layer. Active = not closed. High-risk =
  // urgency High and status != closed.
  for (const gapId of engagement.gaps.allIds) {
    const gap = engagement.gaps.byId[gapId];
    const bucket = byLayer[gap.layerId];
    if (!bucket) continue;
    if (gap.status === "closed") continue;        // closed never counted as open OR high-risk
    bucket.counts.openGaps += 1;
    if (gap.urgency === "High") bucket.counts.highRiskGaps += 1;
  }

  // Bucket scoring: green if no openGaps; amber if some open but no
  // high-risk; red if any high-risk gaps.
  let highestRiskLayer = null;
  let highestRiskCount = -1;
  for (const layerId of LAYER_ORDER) {
    const c = byLayer[layerId].counts;
    if (c.highRiskGaps > 0) {
      byLayer[layerId].bucketScore = "red";
      byLayer[layerId].riskLabel = "Critical";
    } else if (c.openGaps > 0) {
      byLayer[layerId].bucketScore = "amber";
      byLayer[layerId].riskLabel = "Concerning";
    } else if (c.totalCurrent === 0 && c.totalDesired === 0) {
      byLayer[layerId].bucketScore = "green";
      byLayer[layerId].riskLabel = "Empty";
    }
    if (c.highRiskGaps > highestRiskCount) {
      highestRiskCount = c.highRiskGaps;
      highestRiskLayer = layerId;
    }
  }

  // Overall score: 100 minus 10 per high-risk gap minus 3 per open gap,
  // floored at 0. Label thresholds are a heuristic; the contract is that
  // the score is deterministic from byLayer counts.
  let score = 100;
  for (const layerId of LAYER_ORDER) {
    score -= byLayer[layerId].counts.highRiskGaps * 10;
    score -= byLayer[layerId].counts.openGaps     * 3;
  }
  if (score < 0) score = 0;

  let label;
  if      (score >= 85) label = "Excellent";
  else if (score >= 65) label = "Good";
  else if (score >= 35) label = "Concerning";
  else                  label = "Critical";

  return {
    byLayer,
    overall: { score, label, highestRiskLayer }
  };
}

export const selectHealthSummary = memoizeOne(compute, ([a], [b]) => a === b);
