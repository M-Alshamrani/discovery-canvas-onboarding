// state/collections/driverActions.js
//
// Action functions for the drivers collection. Establishes the pattern
// that environmentActions, instanceActions, gapActions, and
// customerActions follow.
//
// Contract:
//   - Pure: same input → same output.
//   - Returns a NEW engagement object via structural sharing. In-place
//     mutation is forbidden because selector memoization depends on
//     referential change detection.
//   - Stamps engagementId from the engagement context (the caller never
//     supplies it), and stamps createdAt/updatedAt at action time.
//   - Validates the resulting record against DriverSchema before
//     committing it; rejects on failure with a structured error envelope.

import { DriverSchema, createEmptyDriver } from "../../schema/driver.js";

// Generate a UUID via crypto.randomUUID() when available, with a manual
// UUID v4 fallback.
function newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback: random hex carved into the UUID v4 shape.
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;  // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80;  // variant
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

// addDriver — appends a new driver to the engagement's drivers collection.
// `input` carries user-supplied fields (businessDriverId, priority, outcomes).
// engagementId, id, timestamps are stamped from context.
export function addDriver(engagement, input) {
  const now = new Date().toISOString();
  const draft = createEmptyDriver({
    ...input,
    id:           newId(),
    engagementId: engagement.meta.engagementId,
    createdAt:    now,
    updatedAt:    now
  });

  // Validate the resulting record. createEmptyDriver throws on invalid
  // input; this safeParse is the commit-boundary check.
  const result = DriverSchema.safeParse(draft);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map(i => ({
        path: i.path.join("."),
        message: i.message,
        code: i.code
      }))
    };
  }

  const driver = result.data;
  return {
    ok: true,
    engagement: {
      ...engagement,
      drivers: {
        byId:   { ...engagement.drivers.byId, [driver.id]: driver },
        allIds: [...engagement.drivers.allIds, driver.id]
      },
      meta: { ...engagement.meta, updatedAt: now }
    }
  };
}

// updateDriver — partial patch on an existing driver. Stamps updatedAt.
export function updateDriver(engagement, driverId, patch) {
  const existing = engagement.drivers.byId[driverId];
  if (!existing) {
    return { ok: false, errors: [{ path: "driverId", message: "Driver not found", code: "not_found" }] };
  }
  const now = new Date().toISOString();
  const merged = { ...existing, ...patch, id: existing.id, engagementId: existing.engagementId,
                   createdAt: existing.createdAt, updatedAt: now };
  const result = DriverSchema.safeParse(merged);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map(i => ({
        path: i.path.join("."),
        message: i.message,
        code: i.code
      }))
    };
  }
  return {
    ok: true,
    engagement: {
      ...engagement,
      drivers: {
        ...engagement.drivers,
        byId: { ...engagement.drivers.byId, [driverId]: result.data }
      },
      meta: { ...engagement.meta, updatedAt: now }
    }
  };
}

// removeDriver — deletes a driver from the collection. No-op if absent.
export function removeDriver(engagement, driverId) {
  if (!engagement.drivers.byId[driverId]) {
    return { ok: true, engagement };  // idempotent
  }
  const { [driverId]: _removed, ...remaining } = engagement.drivers.byId;
  const now = new Date().toISOString();
  return {
    ok: true,
    engagement: {
      ...engagement,
      drivers: {
        byId:   remaining,
        allIds: engagement.drivers.allIds.filter(id => id !== driverId)
      },
      meta: { ...engagement.meta, updatedAt: now }
    }
  };
}
