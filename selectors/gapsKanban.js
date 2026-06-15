// Pure memoized selector: engagement -> KanbanView.
//
// Output shape:
//   {
//     byPhase: {
//       now:   { open: GapId[], in_progress: GapId[], closed: GapId[], deferred: GapId[] },
//       next:  { ... },
//       later: { ... }
//     },
//     totalsByStatus: { open: n, in_progress: n, closed: n, deferred: n },
//     gapsSummary: Record<GapId, {
//       description, urgencyLabel, phaseLabel, statusLabel,
//       layerLabel, driverLabel
//     }>
//   }
//
// gapsSummary is the LLM-citation-friendly companion to byPhase. The LLM
// uses byPhase to read structure (gap counts per phase × status) and
// gapsSummary[gapId] to humanize each gap into a sentence without
// emitting UUIDs or internal field names.
//
// Closed-gap rollup exclusion: totalsByStatus.closed is reported, but
// downstream "active gaps" callers must read the other three keys
// (open + in_progress + deferred). selectVendorMix and selectHealthSummary
// read this shape (not the raw gap collection) so the closed-exclusion
// contract is enforced in one place.

import { memoizeOne } from "../services/memoizeOne.js";
import LAYERS_CATALOG           from "../catalogs/snapshots/layers.js";
import BUSINESS_DRIVERS_CATALOG from "../catalogs/snapshots/business_drivers.js";

const PHASES   = ["now", "next", "later"];
const STATUSES = ["open", "in_progress", "closed", "deferred"];

const PHASE_LABEL  = { now: "Now", next: "Next", later: "Later" };
const STATUS_LABEL = { open: "Open", in_progress: "In progress", closed: "Closed", deferred: "Deferred" };

function emptyPhase() {
  return { open: [], in_progress: [], closed: [], deferred: [] };
}

function buildCatalogLabelMap(catalog) {
  const m = Object.create(null);
  for (const e of catalog.entries) m[e.id] = e.label;
  return m;
}
const LAYER_LABEL  = buildCatalogLabelMap(LAYERS_CATALOG);
const DRIVER_LABEL = buildCatalogLabelMap(BUSINESS_DRIVERS_CATALOG);

function compute(engagement) {
  const byPhase = {
    now:   emptyPhase(),
    next:  emptyPhase(),
    later: emptyPhase()
  };
  const totalsByStatus = { open: 0, in_progress: 0, closed: 0, deferred: 0 };
  const gapsSummary = Object.create(null);

  // Iterate gaps in allIds order (preserves user-visible ordering).
  for (const gapId of engagement.gaps.allIds) {
    const gap = engagement.gaps.byId[gapId];
    if (!PHASES.includes(gap.phase)) continue;        // defensive
    if (!STATUSES.includes(gap.status)) continue;     // defensive
    byPhase[gap.phase][gap.status].push(gap.id);
    totalsByStatus[gap.status] += 1;

    // Human-readable companion. Resolves the driver label inline when the
    // gap is driver-tied. Layer label comes from the LAYERS catalog
    // (e.g. "dataProtection" → "Data Protection & Recovery").
    let driverLabel = null;
    if (gap.driverId && engagement.drivers.byId[gap.driverId]) {
      const bdid = engagement.drivers.byId[gap.driverId].businessDriverId;
      driverLabel = DRIVER_LABEL[bdid] || bdid;
    }
    gapsSummary[gap.id] = {
      description:  gap.description,
      urgencyLabel: gap.urgency,
      phaseLabel:   PHASE_LABEL[gap.phase] || gap.phase,
      statusLabel:  STATUS_LABEL[gap.status] || gap.status,
      layerLabel:   LAYER_LABEL[gap.layerId] || gap.layerId,
      driverLabel:  driverLabel    // null when gap has no driver
    };
  }

  return { byPhase, totalsByStatus, gapsSummary };
}

export const selectGapsKanban = memoizeOne(compute, ([a], [b]) => a === b);
