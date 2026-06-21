// state/dispositionLogic.js — disposition + gap-sync helpers.
//
// All reads operate on the engagement object directly; all writes route
// through state/adapter.js commit* helpers (which wrap commitAction
// against state/engagementStore.js). Engagement objects are never
// mutated directly.
//
// Two flavours of helper:
//   - Pure read functions (getDesiredCounterpart, getCurrentSource,
//     buildGapFromDisposition, proposeCriticalityUpgrades) — take
//     engagement (or fragments) + return new objects. No side effects.
//   - Composed write actions (syncGapFromDesiredAction,
//     syncGapsFromCurrentCriticalityAction) — take engagement + return
//     { ok, engagement } per the action contract. Caller passes them
//     to commitAction so multi-gap updates are atomic + single-emit.
//     Convenience wrappers (commitSyncGapFromDesired, etc.) call
//     commitAction internally for terse view call-sites.

import { LAYERS } from "../core/config.js";
import {
  DISPOSITION_ACTIONS as TAXONOMY_ACTIONS,
  ACTION_TO_GAP_TYPE  as TAXONOMY_ACTION_MAP
} from "../core/taxonomy.js";
import { commitAction } from "./engagementStore.js";
import { addGap, updateGap } from "./collections/gapActions.js";
import { updateInstance } from "./collections/instanceActions.js";
import { computeLifecycleRisk } from "../services/healthMetrics.js";

// Re-export for view consumers — single source of truth lives in
// core/taxonomy.js.
export const DISPOSITION_ACTIONS = TAXONOMY_ACTIONS;
export const ACTION_TO_GAP_TYPE  = TAXONOMY_ACTION_MAP;

// ─── pure read helpers ───────────────────────────────────────────────

// getDesiredCounterpart · find the desired-state instance whose
// originId === currentInstanceId. Returns null if no counterpart.
export function getDesiredCounterpart(engagement, currentInstanceId) {
  if (!engagement || !engagement.instances || !Array.isArray(engagement.instances.allIds)) return null;
  for (const id of engagement.instances.allIds) {
    const i = engagement.instances.byId[id];
    if (i && i.state === "desired" && i.originId === currentInstanceId) return i;
  }
  return null;
}

// getCurrentSource · resolve a desired instance's originId to the
// matching current-state instance. Returns null if no origin set or
// dangling reference.
export function getCurrentSource(engagement, desiredInstance) {
  if (!desiredInstance || !desiredInstance.originId) return null;
  if (!engagement || !engagement.instances) return null;
  const src = engagement.instances.byId[desiredInstance.originId];
  return src || null;
}

function priorityToPhase(priority) {
  if (priority === "Now")   return "now";
  if (priority === "Next")  return "next";
  if (priority === "Later") return "later";
  return null;
}

// buildGapFromDisposition · derive the gap props that should auto-draft
// when a desired instance gets a non-keep disposition. Returns null
// when ACTION_TO_GAP_TYPE doesn't map the disposition (e.g. "keep").
//
// The returned object is the input to commitGapAdd — it has UUIDs
// throughout (relatedCurrentInstanceIds, relatedDesiredInstanceIds,
// affectedEnvironments are all instance/env UUIDs). The caller must
// already hold valid references.
export function buildGapFromDisposition(engagement, desiredInstance) {
  const action  = desiredInstance && desiredInstance.disposition;
  const gapType = ACTION_TO_GAP_TYPE[action];
  if (gapType === null || gapType === undefined) return null;

  const sourceInst = getCurrentSource(engagement, desiredInstance);

  let layerLabel = desiredInstance.layerId;
  if (Array.isArray(LAYERS)) {
    const found = LAYERS.find(l => l.id === desiredInstance.layerId);
    if (found) layerLabel = found.label;
  }

  const actionEntry = DISPOSITION_ACTIONS.find(a => a.id === action);
  const actionLabel = actionEntry ? actionEntry.label : action;

  let description;
  if (sourceInst && desiredInstance.label && desiredInstance.label !== sourceInst.label) {
    description = actionLabel + " " + sourceInst.label + " -> " + desiredInstance.label + " [" + layerLabel + "]";
  } else if (sourceInst) {
    description = actionLabel + ": " + sourceInst.label + " [" + layerLabel + "]";
  } else {
    description = actionLabel + " " + desiredInstance.label + " [" + layerLabel + "]";
  }

  const phase   = priorityToPhase(desiredInstance.priority) || "next";
  const urgency = (sourceInst && sourceInst.criticality) ? sourceInst.criticality : "Medium";

  const currentIds = sourceInst ? [sourceInst.id] : [];
  const desiredIds = [desiredInstance.id];

  let notes;
  if (action === "ops") {
    notes = "Operational / services work: " + description;
  } else if (action === "introduce") {
    notes = "Net-new: " + desiredInstance.label + ". No current technology to replace.";
  } else if (sourceInst) {
    notes = "From workshop: " + actionLabel + " " + sourceInst.label;
    if (desiredInstance.label && desiredInstance.label !== sourceInst.label) {
      notes += " -> " + desiredInstance.label;
    }
    notes += ".";
  } else {
    notes = "From workshop: " + actionLabel + " " + desiredInstance.label + ".";
  }

  return {
    description,
    layerId:                   desiredInstance.layerId,
    affectedLayers:            [desiredInstance.layerId],   // v3 invariant G6: affectedLayers[0] === layerId
    affectedEnvironments:      desiredInstance.environmentId ? [desiredInstance.environmentId] : [],
    gapType,
    urgency,
    phase,
    notes,
    relatedCurrentInstanceIds: currentIds,
    relatedDesiredInstanceIds: desiredIds,
    status:                    "open",
    reviewed:                  false,
    // Gaps created via this auto-draft path are origin="autoDraft" so
    // the GapsEditView banner can count them accurately, distinct from
    // gaps the user added manually and later linked.
    origin:                    "autoDraft"
  };
}

// proposeCriticalityUpgrades · pure walk of a workload's mappedAssetIds.
// Returns an array of upgrade proposals (assetId, label, layerId,
// currentCrit, newCrit). Upward-only. Caller (UI) confirms each.
const _CRIT_RANK = { Low: 1, Medium: 2, High: 3 };

export function proposeCriticalityUpgrades(engagement, workloadInstanceId) {
  if (!engagement || !engagement.instances) return [];
  const workload = engagement.instances.byId[workloadInstanceId];
  if (!workload) {
    throw new Error("proposeCriticalityUpgrades: instance '" + workloadInstanceId + "' not found");
  }
  if (workload.layerId !== "workload") {
    throw new Error("proposeCriticalityUpgrades: '" + workload.label + "' is not a workload-layer instance");
  }
  const workloadRank = _CRIT_RANK[workload.criticality] || 0;
  if (!workloadRank) return [];
  const proposals = [];
  for (const assetId of (workload.mappedAssetIds || [])) {
    const asset = engagement.instances.byId[assetId];
    if (!asset) continue;
    const assetRank = _CRIT_RANK[asset.criticality] || 0;
    if (assetRank < workloadRank) {
      proposals.push({
        assetId:     asset.id,
        label:       asset.label,
        layerId:     asset.layerId,
        currentCrit: asset.criticality || null,
        newCrit:     workload.criticality
      });
    }
  }
  return proposals;
}

// ─── composed write actions (single-emit gap sync) ───────────────────

// syncGapFromDesiredAction · re-derive every gap linked to the desired
// instance's phase/gapType/urgency from the post-edit instance state.
// "keep" disposition closes linked open gaps (instead of deleting them
// — recoverable from a "Closed gaps" filter on Tab 4).
//
// Pure: takes engagement, returns { ok, engagement }. Designed to be
// passed to commitAction so multi-gap updates ship as a single atomic
// commit + single emit.
export function syncGapFromDesiredAction(engagement, desiredInstanceId) {
  const desiredInst = engagement.instances.byId[desiredInstanceId];
  if (!desiredInst || desiredInst.state !== "desired") return { ok: true, engagement };

  const linkedGapIds = engagement.gaps.allIds.filter(gapId => {
    const g = engagement.gaps.byId[gapId];
    return Array.isArray(g.relatedDesiredInstanceIds) &&
           g.relatedDesiredInstanceIds.indexOf(desiredInstanceId) >= 0;
  });
  if (linkedGapIds.length === 0) return { ok: true, engagement };

  let next = engagement;
  for (const gapId of linkedGapIds) {
    const gap = next.gaps.byId[gapId];
    const patch = {};

    if (desiredInst.disposition === "keep") {
      // Close the linked gap rather than delete it (recoverable).
      // status:"closed" alone is the signal; there is no separate
      // closeReason / closedAt field.
      if (gap.status !== "closed") patch.status = "closed";
    } else {
      const newPhase = priorityToPhase(desiredInst.priority);
      if (newPhase) patch.phase = newPhase;
      if (desiredInst.disposition) {
        const newGapType = ACTION_TO_GAP_TYPE[desiredInst.disposition];
        if (newGapType) patch.gapType = newGapType;
      }
      // urgency only when the user hasn't overridden it.
      if (gap.urgencyOverride !== true) {
        if (desiredInst.originId) {
          const origin = next.instances.byId[desiredInst.originId];
          if (origin && origin.criticality) patch.urgency = origin.criticality;
        } else {
          patch.urgency = "Medium";
        }
      }
    }

    if (Object.keys(patch).length === 0) continue;
    const r = updateGap(next, gapId, patch);
    if (!r.ok) return r;   // surface validation error to caller
    next = r.engagement;
  }
  return { ok: true, engagement: next };
}

// commitSyncGapFromDesired · convenience wrapper for view call-sites.
// Routes through commitAction so the action commits atomically.
export function commitSyncGapFromDesired(desiredInstanceId) {
  return commitAction(syncGapFromDesiredAction, desiredInstanceId);
}

// syncGapsFromCurrentCriticalityAction · re-derive urgency on every
// gap whose relatedCurrentInstanceIds contains the given current
// instance. Triggered after a current instance's criticality changes.
// urgencyOverride is respected.
export function syncGapsFromCurrentCriticalityAction(engagement, currentInstanceId) {
  const curInst = engagement.instances.byId[currentInstanceId];
  if (!curInst || curInst.state !== "current" || !curInst.criticality) {
    return { ok: true, engagement };
  }

  const targetGapIds = engagement.gaps.allIds.filter(gapId => {
    const g = engagement.gaps.byId[gapId];
    return Array.isArray(g.relatedCurrentInstanceIds) &&
           g.relatedCurrentInstanceIds.indexOf(currentInstanceId) >= 0 &&
           g.urgencyOverride !== true &&
           g.urgency !== curInst.criticality;
  });
  if (targetGapIds.length === 0) return { ok: true, engagement };

  let next = engagement;
  for (const gapId of targetGapIds) {
    const r = updateGap(next, gapId, { urgency: curInst.criticality });
    if (!r.ok) return r;
    next = r.engagement;
  }
  return { ok: true, engagement: next };
}

export function commitSyncGapsFromCurrentCriticality(currentInstanceId) {
  return commitAction(syncGapsFromCurrentCriticalityAction, currentInstanceId);
}

// syncDesiredFromGapAction · reverse sync: when a gap's phase changes
// (e.g. via Tab 4 drag-drop), propagate the new phase back to every
// linked desired instance's priority. Single source of truth: gap
// phase ↔ desired instance priority.
export function syncDesiredFromGapAction(engagement, gapId) {
  const gap = engagement.gaps.byId[gapId];
  if (!gap) return { ok: true, engagement };
  const phaseToPriority = { now: "Now", next: "Next", later: "Later" };
  const targetPriority  = phaseToPriority[gap.phase];
  if (!targetPriority) return { ok: true, engagement };

  const targetIds = (gap.relatedDesiredInstanceIds || []).filter(id => {
    const i = engagement.instances.byId[id];
    return i && i.state === "desired" && i.priority !== targetPriority;
  });
  if (targetIds.length === 0) return { ok: true, engagement };

  let next = engagement;
  for (const id of targetIds) {
    const r = updateInstance(next, id, { priority: targetPriority });
    if (!r.ok) return r;
    next = r.engagement;
  }
  return { ok: true, engagement: next };
}

export function commitSyncDesiredFromGap(gapId) {
  return commitAction(syncDesiredFromGapAction, gapId);
}

// confirmPhaseOnLink · read-only check the GapsEditView uses before
// linking a desired instance to a gap with a different phase.
export function confirmPhaseOnLink(engagement, gapId, desiredInstanceId) {
  const gap = engagement.gaps.byId[gapId];
  const des = engagement.instances.byId[desiredInstanceId];
  if (!gap || !des || des.state !== "desired") return { status: "ok" };

  const phaseToPriority = { now: "Now", next: "Next", later: "Later" };
  const targetPriority  = phaseToPriority[gap.phase];

  if (!des.priority || des.priority === targetPriority) return { status: "ok" };

  return {
    status:          "conflict",
    currentPriority: des.priority,
    targetPriority,
    desiredLabel:    des.label,
    gapPhase:        gap.phase
  };
}

// ─── lifecycle-risk gap sync ──────────────────────────────────────────

// Marker prefix on auto-drafted lifecycle gaps. Distinguishes them from
// disposition-drafted gaps (which always carry a relatedDesiredInstanceIds
// link) so syncLifecycleGapAction can find "its" gap for a given current
// instance without a dedicated schema field.
const LIFECYCLE_GAP_PREFIX = "Lifecycle risk: ";

function findLifecycleGap(engagement, currentInstanceId) {
  for (const gapId of engagement.gaps.allIds) {
    const g = engagement.gaps.byId[gapId];
    if (g.origin === "autoDraft" &&
        Array.isArray(g.relatedCurrentInstanceIds) && g.relatedCurrentInstanceIds.indexOf(currentInstanceId) >= 0 &&
        (!g.relatedDesiredInstanceIds || g.relatedDesiredInstanceIds.length === 0) &&
        typeof g.description === "string" && g.description.indexOf(LIFECYCLE_GAP_PREFIX) === 0) {
      return g;
    }
  }
  return null;
}

function lifecycleGapDescription(inst, risk) {
  const dateSuffix = risk.days !== null
    ? " (" + Math.abs(risk.days) + "d " + (risk.days < 0 ? "ago" : "out") + ")"
    : "";
  return LIFECYCLE_GAP_PREFIX + inst.label + " is " + risk.reason + dateSuffix;
}

// syncLifecycleGapAction · after a current instance's lifecycle dates
// are saved, auto-draft (or update) a gap when the asset is past or
// nearing end-of-support / end-of-service-life, and auto-close that gap
// (recoverable, not deleted — mirrors syncGapFromDesiredAction's "keep"
// behaviour) once the risk clears (date removed or pushed out).
// urgencyOverride is respected, same as the criticality sync above.
export function syncLifecycleGapAction(engagement, currentInstanceId) {
  const inst = engagement.instances.byId[currentInstanceId];
  if (!inst || inst.state !== "current") return { ok: true, engagement };

  const risk     = computeLifecycleRisk(inst);
  const existing = findLifecycleGap(engagement, currentInstanceId);

  if (risk.severity === "none") {
    if (existing && existing.status !== "closed") {
      return updateGap(engagement, existing.id, { status: "closed" });
    }
    return { ok: true, engagement };
  }

  const urgency = risk.severity === "elevated" ? "Medium" : "High";
  const phase   = risk.severity === "elevated" ? "next"   : "now";
  const description = lifecycleGapDescription(inst, risk);

  if (existing) {
    const patch = { description, phase };
    if (existing.status === "closed") patch.status = "open";
    if (existing.urgencyOverride !== true) patch.urgency = urgency;
    return updateGap(engagement, existing.id, patch);
  }

  const result = addGap(engagement, {
    description,
    layerId:                   inst.layerId,
    affectedLayers:            [inst.layerId],
    affectedEnvironments:      inst.environmentId ? [inst.environmentId] : [],
    gapType:                   "replace",
    urgency,
    phase,
    notes:                     "Auto-detected from lifecycle dates entered on " + inst.label + " (Tab 1).",
    relatedCurrentInstanceIds: [inst.id],
    relatedDesiredInstanceIds: [],
    status:                    "open",
    reviewed:                  false,
    origin:                    "autoDraft"
  });
  if (!result.ok) return result;
  return { ...result, lifecycleGapCreated: true };
}

export function commitSyncLifecycleGap(currentInstanceId) {
  return commitAction(syncLifecycleGapAction, currentInstanceId);
}

