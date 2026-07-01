// services/techRefreshReport.js
//
// Pure selector for the Tech Refresh report: where the customer stands on
// hardware lifecycle — are devices aging, is support still active, what
// must be refreshed and when. Reads the projected session shape (the same
// argument ExportReportView already passes around) and reuses
// computeLifecycleRisk() from healthMetrics so the report's risk buckets
// match the heatmap and lifecycle-risk panels exactly.
//
// No mutation, no I/O, no DOM — just a data rollup the report renderer (and
// any future consumer) can read through normal code paths.

import { computeLifecycleRisk } from "./healthMetrics.js";
import { LAYERS } from "../core/config.js";

// Recommended action per lifecycle severity. Kept here (not in the
// renderer) so any consumer gets a consistent recommendation.
const ACTION_BY_SEVERITY = {
  critical: "Refresh now — past end of service life",
  high:     "Refresh now — out of vendor support",
  elevated: "Plan refresh — support expiring within 12 months",
  none:     "Monitor — within support"
};

const SEVERITY_RANK = { critical: 0, high: 1, elevated: 2, none: 3 };

function daysUntil(dateStr, now) {
  if (!dateStr) return null;
  return Math.round((new Date(dateStr + "T00:00:00").getTime() - now.getTime()) / 86400000);
}

// computeTechRefresh · returns per-asset lifecycle rows plus rollups.
//   session       — projected session (state/projection.js getEngagementAsSession)
//   visibleEnvs   — [{ id, label }] visible environments (catalog-id shape)
//   referenceDate — optional Date; defaults to now (same default as
//                   computeLifecycleRisk)
export function computeTechRefresh(session, visibleEnvs, referenceDate) {
  const now      = referenceDate || new Date();
  const envList  = visibleEnvs || [];
  const envLabel = function(id) {
    const e = envList.find(function(x) { return x.id === id; });
    return e ? e.label : id;
  };
  const layerLabel = function(id) {
    const l = LAYERS.find(function(x) { return x.id === id; });
    return l ? l.label : id;
  };

  const current = (session.instances || []).filter(function(i) { return i.state === "current"; });

  const rows = current.map(function(i) {
    const risk   = computeLifecycleRisk(i, now);
    // Days until the earliest meaningful lifecycle boundary, for the
    // "timing" column — prefer end-of-support, fall back to end-of-service-life.
    const eosDays  = daysUntil(i.endOfSupportDate, now);
    const eoslDays = daysUntil(i.endOfServiceLifeDate, now);
    return {
      id:           i.id,
      label:        i.label || "(unnamed)",
      vendor:       i.vendor || "—",
      vendorGroup:  i.vendorGroup,
      criticality:  i.criticality,
      layerId:      i.layerId,
      layerLabel:   layerLabel(i.layerId),
      environmentId: i.environmentId,
      envLabel:     envLabel(i.environmentId),
      nodeCount:    i.nodeCount,
      endOfSaleDate:        i.endOfSaleDate || null,
      endOfSupportDate:     i.endOfSupportDate || null,
      endOfServiceLifeDate: i.endOfServiceLifeDate || null,
      eosDays:      eosDays,
      eoslDays:     eoslDays,
      severity:     risk.severity,
      reason:       risk.reason,
      action:       ACTION_BY_SEVERITY[risk.severity] || ACTION_BY_SEVERITY.none,
      hasLifecycleData: !!(i.endOfSupportDate || i.endOfServiceLifeDate)
    };
  });

  // ── Severity counts ──────────────────────────────────────────────────
  const bySeverity = { critical: 0, high: 0, elevated: 0, none: 0 };
  rows.forEach(function(r) { bySeverity[r.severity]++; });

  // ── Coverage: how many current assets carry lifecycle data at all ─────
  const tracked   = rows.filter(function(r) { return r.hasLifecycleData; }).length;
  const total     = rows.length;
  // Assets still under active vendor support (not critical, not high) as a
  // share of those we have data for.
  const supported = rows.filter(function(r) {
    return r.hasLifecycleData && r.severity !== "critical" && r.severity !== "high";
  }).length;
  const supportCoveragePct = tracked > 0 ? Math.round((supported / tracked) * 100) : 0;
  const trackedCoveragePct = total   > 0 ? Math.round((tracked   / total)   * 100) : 0;

  // ── Refresh lists ─────────────────────────────────────────────────────
  const refreshNow  = rows.filter(function(r) { return r.severity === "critical" || r.severity === "high"; })
                          .sort(severitySort);
  const refreshSoon = rows.filter(function(r) { return r.severity === "elevated"; })
                          .sort(function(a, b) { return (a.eosDays ?? 1e9) - (b.eosDays ?? 1e9); });

  // ── Aging breakdown by layer and by environment ───────────────────────
  const byLayer = LAYERS.map(function(l) {
    const lr = rows.filter(function(r) { return r.layerId === l.id; });
    return { id: l.id, label: l.label, total: lr.length, atRisk: countAtRisk(lr) };
  }).filter(function(b) { return b.total > 0; });

  const byEnvironment = envList.map(function(e) {
    const er = rows.filter(function(r) { return r.environmentId === e.id; });
    return { id: e.id, label: e.label, total: er.length, atRisk: countAtRisk(er) };
  }).filter(function(b) { return b.total > 0; });

  const atRiskTotal = bySeverity.critical + bySeverity.high + bySeverity.elevated;

  return {
    referenceDate: now,
    rows: rows.sort(severitySort),
    total: total,
    tracked: tracked,
    trackedCoveragePct: trackedCoveragePct,
    supportCoveragePct: supportCoveragePct,
    bySeverity: bySeverity,
    atRiskTotal: atRiskTotal,
    refreshNow: refreshNow,
    refreshSoon: refreshSoon,
    byLayer: byLayer,
    byEnvironment: byEnvironment
  };
}

function countAtRisk(rows) {
  return rows.filter(function(r) { return r.severity !== "none"; }).length;
}

function severitySort(a, b) {
  const d = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (d !== 0) return d;
  return (a.eosDays ?? 1e9) - (b.eosDays ?? 1e9);
}

export { ACTION_BY_SEVERITY };
