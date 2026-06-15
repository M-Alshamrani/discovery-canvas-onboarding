// state/adapter.js
//
// The view tabs (Context, Architecture, Heatmap, Workload Mapping, Gaps,
// Reporting) read engagement data through this thin adapter. Read
// selectors are pure and memoized on engagement reference. Where a core
// selector already returns the right shape (the matrix views), we
// delegate to it so its memoization is inherited; where a view needs a
// different shape, we memoize here on the same engagement reference.
//
// Write helpers all route through commitAction(actionFn, ...) so writes
// land via the action functions on the engagementStore; no engagement
// object is ever mutated directly.

import { memoizeOne } from "../services/memoizeOne.js";
import { selectMatrixView }    from "../selectors/matrix.js";
import { selectHealthSummary } from "../selectors/healthSummary.js";
import { commitAction, getActiveEngagement } from "./engagementStore.js";
import { updateCustomer }      from "./collections/customerActions.js";
import { updateEngagementMeta } from "./collections/engagementMetaActions.js";
// Instance and gap write surface, consumed by MatrixView, GapsEditView,
// and desiredStateSync.
import {
  addInstance,
  updateInstance,
  removeInstance,
  linkOrigin,
  mapWorkloadAssets,
  applyAiInstanceMutation
} from "./collections/instanceActions.js";
import {
  addGap,
  updateGap,
  removeGap,
  attachInstances
} from "./collections/gapActions.js";
// Driver write helpers, consumed by ContextView.
import {
  addDriver,
  updateDriver,
  removeDriver
} from "./collections/driverActions.js";
// Environment write helpers, consumed by ContextView.
import {
  addEnvironment,
  updateEnvironment,
  hideEnvironment,
  unhideEnvironment,
  removeEnvironment
} from "./collections/environmentActions.js";
// Pure read-only phase-conflict check used by _gapLinkInstance: linking
// a desired instance to a gap must be refused with
// PHASE_CONFLICT_NEEDS_ACK when gap.phase != desired.priority and the
// caller has not acknowledged, so AI write-paths can't bypass the
// confirmation.
import { confirmPhaseOnLink } from "./dispositionLogic.js";

// ─── view-shape selectors (read side) ────────────────────────────────────────

function _computeContext(eng) {
  return {
    customer: eng.customer,
    drivers: eng.drivers.allIds.map(id => eng.drivers.byId[id])
  };
}
const _adaptContextViewMemo = memoizeOne(
  _computeContext,
  ([engA], [engB]) => engA === engB
);
export function adaptContextView(eng) {
  if (!eng) return null;
  return _adaptContextViewMemo(eng);
}

// Architecture and Heatmap delegate to selectMatrixView (already memoized
// on engagement reference). Both share the matrix shape; the heatmap
// derives further from this same data.
export function adaptArchitectureView(eng) {
  if (!eng) return null;
  return selectMatrixView(eng, { state: "current" });
}
export function adaptHeatmapView(eng) {
  if (!eng) return null;
  return selectMatrixView(eng, { state: "current" });
}

function _computeWorkload(eng) {
  const workloads = eng.instances.allIds
    .map(id => eng.instances.byId[id])
    .filter(inst => inst.layerId === "workload" && inst.state === "current")
    .map(wl => ({
      ...wl,
      mappedAssets: (wl.mappedAssetIds || [])
        .map(aid => eng.instances.byId[aid])
        .filter(Boolean)
    }));
  return { workloads };
}
const _adaptWorkloadViewMemo = memoizeOne(
  _computeWorkload,
  ([a], [b]) => a === b
);
export function adaptWorkloadView(eng) {
  if (!eng) return null;
  return _adaptWorkloadViewMemo(eng);
}

function _computeGaps(eng) {
  return {
    gaps: eng.gaps.allIds.map(id => eng.gaps.byId[id])
  };
}
const _adaptGapsViewMemo = memoizeOne(
  _computeGaps,
  ([a], [b]) => a === b
);
export function adaptGapsView(eng) {
  if (!eng) return null;
  return _adaptGapsViewMemo(eng);
}

function _computeReporting(eng) {
  const health = selectHealthSummary(eng);
  const openGaps = eng.gaps.allIds
    .map(id => eng.gaps.byId[id])
    .filter(g => g.status === "open").length;
  return {
    totals: {
      gapsOpen: openGaps
    },
    health
  };
}
const _adaptReportingViewMemo = memoizeOne(
  _computeReporting,
  ([a], [b]) => a === b
);
export function adaptReportingView(eng) {
  if (!eng) return null;
  return _adaptReportingViewMemo(eng);
}

// ─── write-through helpers (write side) ──────────────────────────────────────

export function commitContextEdit(patch) {
  // Accepts { customer?, meta? } — either or both. When both are present,
  // both commits land (each routes through commitAction independently so
  // the emit cascade fires once per sub-write). Returns the last commit's
  // result, or null if patch was empty.
  let last = null;
  if (patch && patch.customer) {
    last = commitAction(updateCustomer, patch.customer);
  }
  if (patch && patch.meta) {
    last = commitAction(updateEngagementMeta, patch.meta);
  }
  return last;
}

// Driver write helpers. Writes route through commitAction →
// engagementStore.

export function commitDriverAdd(input) {
  return commitAction(addDriver, input);
}

export function commitDriverUpdate(driverId, patch) {
  return commitAction(updateDriver, driverId, patch);
}

export function commitDriverRemove(driverId) {
  return commitAction(removeDriver, driverId);
}

// ContextView holds drivers keyed by businessDriverId (the catalog
// reference, e.g. "cyber_resilience"), but driver records key by UUID.
// These "*ByBusinessDriverId" helpers do the catalog-ref → UUID lookup
// internally so the call site can keep its `d.id` references.

function _findDriverByBusinessDriverId(businessDriverId) {
  const eng = getActiveEngagement();
  if (!eng || !eng.drivers || !Array.isArray(eng.drivers.allIds)) return null;
  for (const id of eng.drivers.allIds) {
    const d = eng.drivers.byId[id];
    if (d && d.businessDriverId === businessDriverId) return d;
  }
  return null;
}

export function commitDriverUpdateByBusinessDriverId(businessDriverId, patch) {
  const d = _findDriverByBusinessDriverId(businessDriverId);
  if (!d) {
    return { ok: false, error: "no v3 driver with businessDriverId='" + businessDriverId + "'" };
  }
  return commitAction(updateDriver, d.id, patch);
}

export function commitDriverRemoveByBusinessDriverId(businessDriverId) {
  const d = _findDriverByBusinessDriverId(businessDriverId);
  if (!d) {
    return { ok: false, error: "no v3 driver with businessDriverId='" + businessDriverId + "'" };
  }
  return commitAction(removeDriver, d.id);
}

export function commitInstanceEdit(_layerId, _envId, instancePatch) {
  if (!instancePatch || !instancePatch.id) {
    throw new Error("commitInstanceEdit: instancePatch.id required");
  }
  const { id, ...patch } = instancePatch;
  return commitAction(updateInstance, id, patch);
}

export function commitWorkloadMapping(workloadId, mappedAssetIds) {
  return commitAction(mapWorkloadAssets, workloadId, mappedAssetIds);
}

// AI-mutation commit helper. Routes through commitAction so the Canvas
// Chat layer (which may not import state/collections/* directly) can
// dispatch AI mutations via this adapter. Stamps aiTag on the mutated
// instance; downstream subscribers re-render, including the MatrixView
// "Done by AI" badge.
export function commitAiInstanceMutation(instanceId, patch, runMeta) {
  return commitAction(applyAiInstanceMutation, instanceId, patch, runMeta);
}

export function commitGapEdit(gapId, patch) {
  return commitAction(updateGap, gapId, patch);
}

// Environment write helpers. Writes route through commitAction →
// engagementStore.

export function commitEnvAdd(input) {
  return commitAction(addEnvironment, input);
}

export function commitEnvUpdate(envId, patch) {
  return commitAction(updateEnvironment, envId, patch);
}

export function commitEnvHide(envId) {
  return commitAction(hideEnvironment, envId);
}

export function commitEnvUnhide(envId) {
  return commitAction(unhideEnvironment, envId);
}

export function commitEnvRemove(envId) {
  return commitAction(removeEnvironment, envId);
}

// ContextView holds environments keyed by envCatalogId (the catalog
// reference, e.g. "coreDc"), but environment records key by UUID. These
// "*ByCatalogId" helpers do the catalog-ref → UUID lookup internally so
// the call site can keep its `e.id` references.

function _findEnvByCatalogId(envCatalogId) {
  const eng = getActiveEngagement();
  if (!eng || !eng.environments || !Array.isArray(eng.environments.allIds)) return null;
  for (const id of eng.environments.allIds) {
    const e = eng.environments.byId[id];
    if (e && e.envCatalogId === envCatalogId) return e;
  }
  return null;
}

export function commitEnvUpdateByCatalogId(envCatalogId, patch) {
  const e = _findEnvByCatalogId(envCatalogId);
  if (!e) {
    return { ok: false, error: "no v3 environment with envCatalogId='" + envCatalogId + "'" };
  }
  return commitAction(updateEnvironment, e.id, patch);
}

export function commitEnvHideByCatalogId(envCatalogId) {
  const e = _findEnvByCatalogId(envCatalogId);
  if (!e) {
    return { ok: false, error: "no v3 environment with envCatalogId='" + envCatalogId + "'" };
  }
  return commitAction(hideEnvironment, e.id);
}

export function commitEnvUnhideByCatalogId(envCatalogId) {
  const e = _findEnvByCatalogId(envCatalogId);
  if (!e) {
    return { ok: false, error: "no v3 environment with envCatalogId='" + envCatalogId + "'" };
  }
  return commitAction(unhideEnvironment, e.id);
}

export function commitEnvRemoveByCatalogId(envCatalogId) {
  const e = _findEnvByCatalogId(envCatalogId);
  if (!e) {
    return { ok: false, error: "no v3 environment with envCatalogId='" + envCatalogId + "'" };
  }
  return commitAction(removeEnvironment, e.id);
}

// ─── instance + gap write surface ────────────────────────────────────────────
// Consumed by MatrixView, GapsEditView, desiredStateSync, and the AI
// machinery. All writes key by UUID; callers (views) own UUID resolution
// at click time.

// Instance writes ---------------------------------------------------------
export function commitInstanceAdd(input) {
  return commitAction(addInstance, input);
}

export function commitInstanceUpdate(instanceId, patch) {
  return commitAction(updateInstance, instanceId, patch);
}

export function commitInstanceRemove(instanceId) {
  return commitAction(removeInstance, instanceId);
}

// Convenience wrappers for the matrix UI's frequent single-field edits.
// All route through updateInstance; named helpers exist so the view
// call-sites read intentionally.
export function commitInstanceSetCriticality(instanceId, criticality) {
  return commitAction(updateInstance, instanceId, { criticality });
}

export function commitInstanceSetDisposition(instanceId, disposition) {
  return commitAction(updateInstance, instanceId, { disposition });
}

export function commitInstanceSetPriority(instanceId, priority) {
  // priority is desired-only per InstanceSchema superRefine; null clears.
  return commitAction(updateInstance, instanceId, { priority });
}

export function commitInstanceSetNotes(instanceId, notes) {
  return commitAction(updateInstance, instanceId, { notes });
}

export function commitInstanceSetVendor(instanceId, vendor, vendorGroup) {
  return commitAction(updateInstance, instanceId, { vendor, vendorGroup });
}

// Cross-cutting linkage. originId on a desired instance points at a
// current instance; linkOrigin handles the cross-env case.
export function commitInstanceSetOrigin(desiredInstanceId, currentInstanceId) {
  return commitAction(linkOrigin, desiredInstanceId, currentInstanceId);
}

// Workload mappedAssetIds. Only valid on layerId === "workload"; the
// action enforces that invariant at commit time.
export function commitWorkloadMap(workloadInstanceId, assetInstanceIds) {
  return commitAction(mapWorkloadAssets, workloadInstanceId, assetInstanceIds);
}

// Gap writes --------------------------------------------------------------
export function commitGapAdd(input) {
  return commitAction(addGap, input);
}

export function commitGapUpdate(gapId, patch) {
  return commitAction(updateGap, gapId, patch);
}

export function commitGapRemove(gapId) {
  return commitAction(removeGap, gapId);
}

// Cross-cutting gap linkage. The gap stores arrays of instance UUIDs;
// the link/unlink helpers fetch the current arrays, apply the change,
// and commit the result. Idempotent (already-linked / already-unlinked
// is a no-op).
//
// The phase-conflict-acknowledgment gate is enforced here for the
// "desired" side: when acknowledged is not set and linking would put
// the tile's priority out of sync with the gap's phase, the helper
// refuses with PHASE_CONFLICT_NEEDS_ACK plus the conflict details, so
// the caller can surface a confirmation modal. The no-op idempotency
// check runs before the gate so re-linking doesn't trip it.
function _gapLinkInstance(gapId, instanceId, side, opts) {
  // side: "current" or "desired"; opts: { acknowledged?: bool } (desired only)
  const eng = getActiveEngagement();
  if (!eng || !eng.gaps || !eng.gaps.byId) {
    return { ok: false, error: "no active engagement" };
  }
  const gap = eng.gaps.byId[gapId];
  if (!gap) {
    return { ok: false, error: "gap '" + gapId + "' not found" };
  }
  const field = side === "desired" ? "relatedDesiredInstanceIds" : "relatedCurrentInstanceIds";
  const cur = Array.isArray(gap[field]) ? gap[field] : [];
  if (cur.indexOf(instanceId) >= 0) return { ok: true, engagement: eng };  // already linked (idempotent)

  // Phase-conflict gate (desired side only).
  if (side === "desired") {
    const acknowledged = !!(opts && opts.acknowledged === true);
    const check = confirmPhaseOnLink(eng, gapId, instanceId);
    if (check && check.status === "conflict" && !acknowledged) {
      return {
        ok: false,
        errors: [{
          path: "acknowledged",
          message: "Linking '" + check.desiredLabel + "' to a gap in phase '" +
                   check.gapPhase + "' would reassign the tile's priority from '" +
                   check.currentPriority + "' to '" + check.targetPriority +
                   "'. Pass { acknowledged: true } to confirm.",
          code: "PHASE_CONFLICT_NEEDS_ACK",
          details: {
            currentPriority: check.currentPriority,
            targetPriority:  check.targetPriority,
            gapPhase:        check.gapPhase,
            desiredLabel:    check.desiredLabel
          }
        }]
      };
    }
  }

  const next = cur.concat([instanceId]);
  const patch = side === "desired"
    ? { relatedDesiredInstanceIds: next }
    : { relatedCurrentInstanceIds: next };
  return commitAction(updateGap, gapId, patch);
}

function _gapUnlinkInstance(gapId, instanceId, side) {
  const eng = getActiveEngagement();
  if (!eng || !eng.gaps || !eng.gaps.byId) {
    return { ok: false, error: "no active engagement" };
  }
  const gap = eng.gaps.byId[gapId];
  if (!gap) {
    return { ok: false, error: "gap '" + gapId + "' not found" };
  }
  const field = side === "desired" ? "relatedDesiredInstanceIds" : "relatedCurrentInstanceIds";
  const cur = Array.isArray(gap[field]) ? gap[field] : [];
  const next = cur.filter(id => id !== instanceId);
  if (next.length === cur.length) return { ok: true, engagement: eng };  // no-op
  const patch = side === "desired"
    ? { relatedDesiredInstanceIds: next }
    : { relatedCurrentInstanceIds: next };
  return commitAction(updateGap, gapId, patch);
}

export function commitGapLinkCurrentInstance(gapId, instanceId) {
  return _gapLinkInstance(gapId, instanceId, "current");
}
// opts.acknowledged is the phase-conflict opt-in. When the caller has
// already confirmed with the user (or is sure no conflict exists) it
// passes { acknowledged: true }; otherwise the helper refuses a
// conflicting link with PHASE_CONFLICT_NEEDS_ACK.
export function commitGapLinkDesiredInstance(gapId, instanceId, opts) {
  return _gapLinkInstance(gapId, instanceId, "desired", opts);
}
export function commitGapUnlinkCurrentInstance(gapId, instanceId) {
  return _gapUnlinkInstance(gapId, instanceId, "current");
}
export function commitGapUnlinkDesiredInstance(gapId, instanceId) {
  return _gapUnlinkInstance(gapId, instanceId, "desired");
}

export function commitGapSetDriver(gapId, driverId) {
  // driverId is the v3 driver UUID (or null to clear). View call-sites
  // that hold the v2-style businessDriverId resolve via
  // commitGapSetDriverByBusinessDriverId below.
  return commitAction(updateGap, gapId, { driverId });
}

export function commitGapAttachInstances(gapId, { current = [], desired = [] }) {
  return commitAction(attachInstances, gapId, { current, desired });
}

// Convenience for views that hold the businessDriverId (e.g.
// "cyber_resilience") rather than the driver UUID.
export function commitGapSetDriverByBusinessDriverId(gapId, businessDriverId) {
  if (businessDriverId === null || businessDriverId === undefined) {
    return commitAction(updateGap, gapId, { driverId: null });
  }
  const eng = getActiveEngagement();
  if (!eng || !eng.drivers || !Array.isArray(eng.drivers.allIds)) {
    return { ok: false, error: "no active engagement" };
  }
  for (const id of eng.drivers.allIds) {
    const d = eng.drivers.byId[id];
    if (d && d.businessDriverId === businessDriverId) {
      return commitAction(updateGap, gapId, { driverId: d.id });
    }
  }
  return { ok: false, error: "no v3 driver with businessDriverId='" + businessDriverId + "'" };
}

// AI proposal application -----------------------------------------------
// Applies proposals as a single transactional engagement update — one
// commitAction call, one setActiveEngagement, one emit, one undo entry.
// The signature is intentionally narrow: it accepts a function that
// takes the engagement and returns the next engagement (or
// {ok, engagement, errors}); callers compose path-specific actions into
// that function. Path → action resolution lives in
// core/bindingResolvers.js WRITE_RESOLVERS.
export function commitProposeAndApply(actionFn, ...args) {
  return commitAction(actionFn, ...args);
}
