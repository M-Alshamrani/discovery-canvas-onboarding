// state/collections/instanceActions.js
//
// Action functions for the instances collection. Follows the driver-
// action pattern (pure, returns a new engagement, validates against
// InstanceSchema) and additionally maintains the byState secondary
// index, which is rebuilt by a pure function on every mutation.

import { InstanceSchema, createEmptyInstance } from "../../schema/instance.js";

function newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

// Rebuild the byState secondary index from byId.state. Pure helper.
function rebuildByState(byId, allIds) {
  const current = [];
  const desired = [];
  for (const id of allIds) {
    const inst = byId[id];
    if (inst.state === "current") current.push(id);
    else if (inst.state === "desired") desired.push(id);
  }
  return { current, desired };
}

export function addInstance(engagement, input) {
  const now = new Date().toISOString();
  const draft = createEmptyInstance({
    ...input,
    id:           newId(),
    engagementId: engagement.meta.engagementId,
    createdAt:    now,
    updatedAt:    now
  });
  const result = InstanceSchema.safeParse(draft);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map(i => ({
        path: i.path.join("."), message: i.message, code: i.code
      }))
    };
  }
  const inst = result.data;
  const newById   = { ...engagement.instances.byId, [inst.id]: inst };
  const newAllIds = [...engagement.instances.allIds, inst.id];
  return {
    ok: true,
    engagement: {
      ...engagement,
      instances: {
        byId:    newById,
        allIds:  newAllIds,
        byState: rebuildByState(newById, newAllIds)
      },
      meta: { ...engagement.meta, updatedAt: now }
    }
  };
}

export function updateInstance(engagement, instanceId, patch) {
  const existing = engagement.instances.byId[instanceId];
  if (!existing) {
    return { ok: false, errors: [{ path: "instanceId", message: "Instance not found", code: "not_found" }] };
  }
  const now = new Date().toISOString();
  // An engineer save on an AI-tagged instance strips aiTag: ownership
  // transfers from the AI to the engineer the moment they commit a
  // change. applyAiInstanceMutation below is the only path that
  // (re-)stamps aiTag.
  const merged = { ...existing, ...patch,
                   id: existing.id, engagementId: existing.engagementId,
                   createdAt: existing.createdAt, updatedAt: now,
                   aiTag: null };
  const result = InstanceSchema.safeParse(merged);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map(i => ({
        path: i.path.join("."), message: i.message, code: i.code
      }))
    };
  }
  const newById = { ...engagement.instances.byId, [instanceId]: result.data };
  return {
    ok: true,
    engagement: {
      ...engagement,
      instances: {
        byId:    newById,
        allIds:  engagement.instances.allIds,
        byState: rebuildByState(newById, engagement.instances.allIds)
      },
      meta: { ...engagement.meta, updatedAt: now }
    }
  };
}

export function removeInstance(engagement, instanceId) {
  if (!engagement.instances.byId[instanceId]) return { ok: true, engagement };
  const { [instanceId]: _removed, ...remaining } = engagement.instances.byId;
  const newAllIds = engagement.instances.allIds.filter(id => id !== instanceId);
  const now = new Date().toISOString();
  return {
    ok: true,
    engagement: {
      ...engagement,
      instances: {
        byId:    remaining,
        allIds:  newAllIds,
        byState: rebuildByState(remaining, newAllIds)
      },
      meta: { ...engagement.meta, updatedAt: now }
    }
  };
}

// Convenience wrappers for the cross-cutting relationships.
// linkOrigin sets desired.originId → current id (cross-env supported).
export function linkOrigin(engagement, desiredInstanceId, currentInstanceId) {
  return updateInstance(engagement, desiredInstanceId, { originId: currentInstanceId });
}

// mapWorkloadAssets sets workload.mappedAssetIds, enforcing the
// workload-to-asset relationship invariants atomically — the first
// violation aborts the whole commit, so no partial mapping is written.
// Enforcing here (rather than in the UI) means every caller, including
// AI write paths and integrations, is held to the same rules.
//
// Invariants enforced:
//   I1 · workload.layerId === "workload" (only workload-layer instances
//        carry mappedAssetIds; other layers reject the call entirely)
//   I2 · dedupe assetIds (duplicates silently collapse to a unique set,
//        preserving the order of first occurrence)
//   I3 · the asset must exist in engagement.instances.byId (no dangling
//        references)
//   I4 · the workload id must NOT appear in the asset list (a workload
//        cannot be its own infrastructure)
//   I5 · asset.layerId !== "workload" (workloads map only to
//        infrastructure layers, never to another workload)
//   I6 · asset.state === workload.state (a current workload maps current
//        infra and a desired workload maps desired infra; cross-state
//        mapping would leak lifecycle boundaries)
//   I7 · asset.environmentId === workload.environmentId (a workload
//        lives in one environment and its mapped infrastructure must run
//        there too; model a hybrid workload as one tile per environment,
//        each mapping to its local stack)
//   I8 · asset.disposition !== "retire" (mapping to an asset being
//        retired would leave a dangling reference once it is removed;
//        map to the replacement desired-state asset instead)
export function mapWorkloadAssets(engagement, workloadInstanceId, assetIds) {
  const workload = engagement.instances.byId[workloadInstanceId];
  if (!workload) {
    return { ok: false, errors: [{ path: "workloadInstanceId",
      message: "Workload instance '" + workloadInstanceId + "' not found",
      code: "WORKLOAD_NOT_FOUND" }] };
  }
  // I1
  if (workload.layerId !== "workload") {
    return { ok: false, errors: [{ path: "workloadInstanceId",
      message: "mapWorkloadAssets: source '" + (workload.label || workload.id) + "' is not a workload-layer instance (layerId='" + workload.layerId + "')",
      code: "MAP_NOT_WORKLOAD_SOURCE" }] };
  }
  if (!Array.isArray(assetIds)) {
    return { ok: false, errors: [{ path: "assetIds",
      message: "assetIds must be an array",
      code: "MAP_INVALID_ARG" }] };
  }
  // I2 · dedupe (order-preserving, first occurrence wins)
  const seen = new Set();
  const dedupedAssetIds = [];
  for (const id of assetIds) {
    if (typeof id !== "string" || id.length === 0) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    dedupedAssetIds.push(id);
  }
  // I3..I8 · per-asset gate
  for (const assetId of dedupedAssetIds) {
    // I4 · self-map
    if (assetId === workloadInstanceId) {
      return { ok: false, errors: [{ path: "assetIds",
        message: "mapWorkloadAssets: a workload cannot map to itself",
        code: "MAP_SELF" }] };
    }
    const asset = engagement.instances.byId[assetId];
    // I3 · existence
    if (!asset) {
      return { ok: false, errors: [{ path: "assetIds",
        message: "mapWorkloadAssets: asset instance '" + assetId + "' not found",
        code: "MAP_ASSET_NOT_FOUND" }] };
    }
    // I5 · workload→workload forbidden
    if (asset.layerId === "workload") {
      return { ok: false, errors: [{ path: "assetIds",
        message: "mapWorkloadAssets: target '" + (asset.label || asset.id) + "' is itself a workload — workloads only map to infrastructure layers",
        code: "MAP_WORKLOAD_TO_WORKLOAD" }] };
    }
    // I6 · state mismatch
    if (asset.state !== workload.state) {
      return { ok: false, errors: [{ path: "assetIds",
        message: "mapWorkloadAssets: state mismatch — " + workload.state + " workload cannot map to a " + asset.state + " asset",
        code: "MAP_STATE_MISMATCH" }] };
    }
    // I7 · cross-env mismatch
    if (asset.environmentId !== workload.environmentId) {
      return { ok: false, errors: [{ path: "assetIds",
        message: "mapWorkloadAssets: environment mismatch — workload is in " +
          workload.environmentId + ", asset is in " + asset.environmentId +
          ". Create a separate workload tile in '" + asset.environmentId +
          "' to model hybrid deployments.",
        code: "MAP_ENV_MISMATCH" }] };
    }
    // I8 · retired-asset gate
    if (asset.disposition === "retire") {
      return { ok: false, errors: [{ path: "assetIds",
        message: "mapWorkloadAssets: target '" + (asset.label || asset.id) + "' has disposition 'retire' — cannot map a workload to an asset being retired (BUG-040). Map to the replacement desired-state asset instead.",
        code: "MAP_TO_RETIRED_ASSET" }] };
    }
  }
  // All invariants pass · delegate to updateInstance for the actual commit.
  return updateInstance(engagement, workloadInstanceId, { mappedAssetIds: dedupedAssetIds });
}

// ─── applyAiInstanceMutation ─────────────────────────────────────────────────
//
// AI-authored mutation path. Stamps aiTag (from runMeta) on the mutated
// instance — the opposite of updateInstance, which strips aiTag. Used by
// the Canvas Chat overlay for both the ask (post-approval) and auto-tag
// (immediate) policies.
//
// Scope is instances only: drivers, environments, gaps, customer, and
// engagementMeta have no equivalent action, and AI mutations against
// them are not supported.
//
// Shape: applyAiInstanceMutation(engagement, instanceId, patch, runMeta),
// where runMeta = { skillId, runId, mutatedAt }.
export function applyAiInstanceMutation(engagement, instanceId, patch, runMeta) {
  const existing = engagement.instances.byId[instanceId];
  if (!existing) {
    return { ok: false, errors: [{ path: "instanceId",
      message: "Instance not found", code: "not_found" }] };
  }
  if (!runMeta || typeof runMeta !== "object" ||
      !runMeta.skillId || !runMeta.runId || !runMeta.mutatedAt) {
    return { ok: false, errors: [{ path: "runMeta",
      message: "runMeta { skillId, runId, mutatedAt } required for AI mutation",
      code: "missing_runmeta" }] };
  }
  const now = new Date().toISOString();
  const merged = { ...existing, ...(patch || {}),
                   id: existing.id, engagementId: existing.engagementId,
                   createdAt: existing.createdAt, updatedAt: now,
                   aiTag: { skillId: runMeta.skillId, runId: runMeta.runId, mutatedAt: runMeta.mutatedAt } };
  const result = InstanceSchema.safeParse(merged);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map(i => ({
        path: i.path.join("."), message: i.message, code: i.code
      }))
    };
  }
  const newById = { ...engagement.instances.byId, [instanceId]: result.data };
  return {
    ok: true,
    engagement: {
      ...engagement,
      instances: {
        byId:    newById,
        allIds:  engagement.instances.allIds,
        byState: rebuildByState(newById, engagement.instances.allIds)
      },
      meta: { ...engagement.meta, updatedAt: now }
    }
  };
}
