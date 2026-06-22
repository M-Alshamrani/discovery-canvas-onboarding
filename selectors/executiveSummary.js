// Pure memoized selector: engagement -> ExecSummaryInputs.
//
// Not a UI view — this is the structured input the executive-summary
// skill consumes via selectLinkedComposition. The catalogVersions field
// is the provenance bridge: the skill stamps these versions into its
// output's provenance wrapper.

import { memoizeOne } from "../services/memoizeOne.js";
import { selectHealthSummary } from "./healthSummary.js";
import { selectGapsKanban }    from "./gapsKanban.js";
import { selectVendorMix }     from "./vendorMix.js";
import { computeLifecycleRisk } from "../services/healthMetrics.js";

const PRIORITY_RANK = { High: 2, Medium: 1, Low: 0 };
const LIFECYCLE_SEVERITY_RANK = { critical: 0, high: 1, elevated: 2 };

// lifecycleRisk · every current instance past or nearing end-of-support /
// end-of-service-life, sorted most-severe first. Mirrors the same
// computeLifecycleRisk used to (a) score the health heatmap and (b)
// auto-draft gaps, so the executive summary's count always agrees with
// what Tab 1's lifecycle fields and Tab 4's auto-drafted gaps show.
function computeLifecycleRiskSummary(engagement) {
  const items = [];
  let critical = 0, high = 0, elevated = 0;
  for (const id of engagement.instances.allIds) {
    const inst = engagement.instances.byId[id];
    if (inst.state !== "current") continue;
    const risk = computeLifecycleRisk(inst);
    if (risk.severity === "none") continue;
    if (risk.severity === "critical") critical++;
    else if (risk.severity === "high") high++;
    else if (risk.severity === "elevated") elevated++;
    items.push({
      instanceId:    inst.id,
      label:         inst.label,
      layerId:       inst.layerId,
      environmentId: inst.environmentId,
      severity:      risk.severity,
      reason:        risk.reason,
      days:          risk.days
    });
  }
  items.sort((a, b) => LIFECYCLE_SEVERITY_RANK[a.severity] - LIFECYCLE_SEVERITY_RANK[b.severity]);
  return { critical, high, elevated, total: items.length, items };
}

function compute(engagement) {
  const meta = engagement.meta;
  const customer = engagement.customer;

  // drivers.topPriority = the High-priority driver (or first in allIds order if tied).
  let topPriority = null;
  let topRank = -1;
  const driverList = [];
  for (const id of engagement.drivers.allIds) {
    const d = engagement.drivers.byId[id];
    driverList.push(d);
    const r = PRIORITY_RANK[d.priority] ?? 0;
    if (r > topRank) {
      topRank = r;
      topPriority = d;
    }
  }

  const health  = selectHealthSummary(engagement);
  const kanban  = selectGapsKanban(engagement);
  const vmix    = selectVendorMix(engagement);

  // Most-urgent gaps (excluding closed): High urgency, sorted by phase.
  const PHASE_RANK = { now: 0, next: 1, later: 2 };
  const mostUrgent = [];
  for (const gapId of engagement.gaps.allIds) {
    const g = engagement.gaps.byId[gapId];
    if (g.status === "closed") continue;
    if (g.urgency !== "High") continue;
    mostUrgent.push(g);
  }
  mostUrgent.sort((a, b) => (PHASE_RANK[a.phase] ?? 9) - (PHASE_RANK[b.phase] ?? 9));

  // catalogVersions for provenance stamping. Every entity stamps its
  // catalogVersion at write-time; all records in one engagement share the
  // same version, so we read BUSINESS_DRIVERS / ENV_CATALOG off the first
  // record. DELL_PRODUCT_TAXONOMY only appears on AI-authored fields and
  // is not surfaced here.
  const catalogVersions = {};
  if (driverList.length > 0) catalogVersions.BUSINESS_DRIVERS = driverList[0].catalogVersion;
  if (engagement.environments.allIds.length > 0) {
    catalogVersions.ENV_CATALOG =
      engagement.environments.byId[engagement.environments.allIds[0]].catalogVersion;
  }

  return {
    engagementMeta: {
      presalesOwner:  meta.presalesOwner,
      status:         meta.status,
      engagementDate: meta.engagementDate,
      customerName:   customer.name,
      vertical:       customer.vertical
    },
    drivers:               { topPriority, all: driverList },
    health,
    lifecycleRisk:         computeLifecycleRiskSummary(engagement),
    gapHighlights:         { mostUrgent, byPhase: {
                              now:   sumPhase(kanban, "now"),
                              next:  sumPhase(kanban, "next"),
                              later: sumPhase(kanban, "later")
                            } },
    vendorMixSummary:      { dellPercent: vmix.totals.dellPercent,
                              mostDiverseLayer: vmix.kpiTiles.mostDiverseLayer,
                              topNonDellConcentration: vmix.kpiTiles.topNonDellConcentration },
    catalogVersions
  };
}

function sumPhase(kanban, phase) {
  const ph = kanban.byPhase[phase];
  // Active count = open + in_progress + deferred (closed excluded)
  return ph.open.length + ph.in_progress.length + ph.deferred.length;
}

export const selectExecutiveSummaryInputs = memoizeOne(compute, ([a], [b]) => a === b);
