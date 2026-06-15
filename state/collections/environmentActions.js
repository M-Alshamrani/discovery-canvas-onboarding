// state/collections/environmentActions.js
//
// Action functions for the environments collection. Follows the driver-
// action pattern: pure, returns a new engagement, validates against
// EnvironmentSchema.

import { EnvironmentSchema, createEmptyEnvironment } from "../../schema/environment.js";

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

export function addEnvironment(engagement, input) {
  const now = new Date().toISOString();
  const draft = createEmptyEnvironment({
    ...input,
    id:           newId(),
    engagementId: engagement.meta.engagementId,
    createdAt:    now,
    updatedAt:    now
  });
  const result = EnvironmentSchema.safeParse(draft);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map(i => ({
        path: i.path.join("."), message: i.message, code: i.code
      }))
    };
  }
  const env = result.data;
  return {
    ok: true,
    engagement: {
      ...engagement,
      environments: {
        byId:   { ...engagement.environments.byId, [env.id]: env },
        allIds: [...engagement.environments.allIds, env.id]
      },
      meta: { ...engagement.meta, updatedAt: now }
    }
  };
}

export function updateEnvironment(engagement, envId, patch) {
  const existing = engagement.environments.byId[envId];
  if (!existing) {
    return { ok: false, errors: [{ path: "envId", message: "Environment not found", code: "not_found" }] };
  }
  const now = new Date().toISOString();
  const merged = { ...existing, ...patch,
                   id: existing.id, engagementId: existing.engagementId,
                   createdAt: existing.createdAt, updatedAt: now };
  const result = EnvironmentSchema.safeParse(merged);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map(i => ({
        path: i.path.join("."), message: i.message, code: i.code
      }))
    };
  }
  return {
    ok: true,
    engagement: {
      ...engagement,
      environments: {
        ...engagement.environments,
        byId: { ...engagement.environments.byId, [envId]: result.data }
      },
      meta: { ...engagement.meta, updatedAt: now }
    }
  };
}

export function removeEnvironment(engagement, envId) {
  if (!engagement.environments.byId[envId]) return { ok: true, engagement };
  const { [envId]: _removed, ...remaining } = engagement.environments.byId;
  const now = new Date().toISOString();
  return {
    ok: true,
    engagement: {
      ...engagement,
      environments: {
        byId:   remaining,
        allIds: engagement.environments.allIds.filter(id => id !== envId)
      },
      meta: { ...engagement.meta, updatedAt: now }
    }
  };
}

// Soft-delete via the hidden flag.
export function hideEnvironment(engagement, envId) {
  return updateEnvironment(engagement, envId, { hidden: true });
}

export function unhideEnvironment(engagement, envId) {
  return updateEnvironment(engagement, envId, { hidden: false });
}
