// core/engagementIntegrity.js
//
// Pure function that scrubs cross-reference orphans from an engagement.
// Runs at engagement-load time (engagementStore._rehydrateFromStorage)
// and at any serialization boundary (Save-to-file roundtrip).
//
// Every cross-cutting reference is a UUID. When data flows through
// migration / save-load roundtrips / partial edits, references can become
// orphaned (target entity removed, but the referrer still points at the
// dead UUID). Orphan handling is two-layered:
//   1. SCRUB at engagement-load: drop / null / repair dead refs (THIS FILE)
//   2. RESOLVE at render time: label resolvers return placeholders, never
//      raw UUIDs (ui/views/*Helpers, services/*Service)
//
// This file is layer 1. The scrubber is structural — it doesn't know about
// the UI; it only knows which reference points at which collection.
//
// Contract:
//
//   Gap-level orphan scrub:
//     - gap.affectedEnvironments[]: drop entries not in
//       engagement.environments.byId. If after the drop the array is empty
//       AND the engagement has ≥1 visible env, fall back to [first visible
//       env UUID] (preserves G6 + the GapSchema affectedEnvironments.min(1)
//       rule). If the engagement has 0 visible envs, leave whatever was
//       there (the empty-env UI state handles this case).
//     - gap.driverId: null out if not in engagement.drivers.byId.
//     - gap.relatedCurrentInstanceIds[]: drop entries not in
//       engagement.instances.byId (or whose state !== "current").
//     - gap.relatedDesiredInstanceIds[]: drop entries not in
//       engagement.instances.byId (or whose state !== "desired").
//
//   Instance-level orphan scrub:
//     - instance.originId: null out if not in engagement.instances.byId
//       (originId is desired-only; the schema enforces that, not this file).
//     - instance.mappedAssetIds[]: drop entries not in
//       engagement.instances.byId. Workload-only; non-workload instances
//       should already have an empty array (schema-enforced).
//     - instance.environmentId: NOT scrubbed. It's required + non-nullable
//       per InstanceSchema; remapping it would silently move tiles between
//       matrix columns. The UI's envName resolver returns
//       "(unknown environment)" for orphans (layer 2).
//
// Idempotent: running the scrubber twice returns deeply-equal output
// (a clean engagement is a fixed point).
//
// Pure: never mutates input; returns a new engagement object with scrubbed
// nested collections. Reference-equal pass-through when no scrub was needed
// (memoization-friendly).

/**
 * scrubEngagementOrphans(engagement) -> engagement
 *
 * Returns a new engagement object with all cross-reference orphans
 * resolved per the contract above. If no scrubbing was needed, returns
 * the input by reference (no allocation).
 *
 * Defensive: tolerates partial / undefined collections (returns input
 * as-is if engagement is null/undefined or missing required collections).
 * Never throws on bad input — degrades to a no-op so a corrupt cache
 * doesn't brick the rehydrate path.
 */
export function scrubEngagementOrphans(engagement) {
  if (!engagement || typeof engagement !== "object") return engagement;
  if (!engagement.gaps || !engagement.instances || !engagement.environments) {
    return engagement;
  }

  const envIds      = _safeIdSet(engagement.environments);
  const visibleEnvs = _firstVisibleEnvId(engagement.environments);
  const driverIds   = _safeIdSet(engagement.drivers);
  const instances   = engagement.instances.byId || {};
  const instanceIds = _safeIdSet(engagement.instances);

  let didScrub = false;

  // ─── Gaps ─────────────────────────────────────────────────────────────
  const newGapsById = {};
  for (const gapId of engagement.gaps.allIds || []) {
    const gap = engagement.gaps.byId[gapId];
    if (!gap) continue;
    let nextGap = gap;

    // affectedEnvironments[]: drop orphans; fallback to first visible env
    // if empty post-drop AND engagement has visible envs.
    if (Array.isArray(gap.affectedEnvironments)) {
      const cleanEnvs = gap.affectedEnvironments.filter(id => envIds.has(id));
      const needsFallback = cleanEnvs.length === 0 && visibleEnvs !== null;
      if (cleanEnvs.length !== gap.affectedEnvironments.length) {
        const finalEnvs = cleanEnvs.length > 0
          ? cleanEnvs
          : (needsFallback ? [visibleEnvs] : gap.affectedEnvironments);
        nextGap = { ...nextGap, affectedEnvironments: finalEnvs };
      }
    }

    // driverId: null if orphan
    if (gap.driverId && !driverIds.has(gap.driverId)) {
      nextGap = { ...nextGap, driverId: null };
    }

    // relatedCurrentInstanceIds[]: drop orphans + non-current state
    if (Array.isArray(gap.relatedCurrentInstanceIds)) {
      const clean = gap.relatedCurrentInstanceIds.filter(id => {
        const inst = instances[id];
        return inst && inst.state === "current";
      });
      if (clean.length !== gap.relatedCurrentInstanceIds.length) {
        nextGap = { ...nextGap, relatedCurrentInstanceIds: clean };
      }
    }

    // relatedDesiredInstanceIds[]: drop orphans + non-desired state
    if (Array.isArray(gap.relatedDesiredInstanceIds)) {
      const clean = gap.relatedDesiredInstanceIds.filter(id => {
        const inst = instances[id];
        return inst && inst.state === "desired";
      });
      if (clean.length !== gap.relatedDesiredInstanceIds.length) {
        nextGap = { ...nextGap, relatedDesiredInstanceIds: clean };
      }
    }

    if (nextGap !== gap) didScrub = true;
    newGapsById[gapId] = nextGap;
  }

  // ─── Instances ────────────────────────────────────────────────────────
  const newInstancesById = {};
  for (const instId of engagement.instances.allIds || []) {
    const inst = engagement.instances.byId[instId];
    if (!inst) continue;
    let nextInst = inst;

    // originId: null if orphan
    if (inst.originId && !instanceIds.has(inst.originId)) {
      nextInst = { ...nextInst, originId: null };
    }

    // mappedAssetIds[]: drop orphans
    if (Array.isArray(inst.mappedAssetIds)) {
      const clean = inst.mappedAssetIds.filter(id => instanceIds.has(id));
      if (clean.length !== inst.mappedAssetIds.length) {
        nextInst = { ...nextInst, mappedAssetIds: clean };
      }
    }

    if (nextInst !== inst) didScrub = true;
    newInstancesById[instId] = nextInst;
  }

  // No-op fast path: pass through by reference when nothing changed.
  if (!didScrub) return engagement;

  return {
    ...engagement,
    gaps: { ...engagement.gaps, byId: newGapsById },
    instances: { ...engagement.instances, byId: newInstancesById }
  };
}

/**
 * Internal · build a Set of ids from a {byId, allIds} collection.
 * Defensive: returns empty Set on bad input.
 */
function _safeIdSet(collection) {
  if (!collection || !collection.byId) return new Set();
  return new Set(Object.keys(collection.byId));
}

/**
 * Internal · find the first visible env id (env.hidden !== true).
 * Returns null if none. Used as the fallback target when a gap's
 * affectedEnvironments[] would be empty post-scrub.
 */
function _firstVisibleEnvId(environments) {
  if (!environments || !Array.isArray(environments.allIds)) return null;
  for (const id of environments.allIds) {
    const env = environments.byId[id];
    if (env && env.hidden !== true) return id;
  }
  return null;
}
