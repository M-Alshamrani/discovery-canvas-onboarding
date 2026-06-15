// state/collections/gapActions.js
//
// Action functions for the gaps collection. Follows the driver-action
// pattern: pure, returns a new engagement, validates against GapSchema.
//
// updateGap additionally enforces validateActionLinks atomically when
// the patch flips reviewed to true, or when a structural field changes
// on an already-reviewed gap. Pure metadata patches (urgency, notes,
// phase, status, driverId, etc.) on an already-reviewed-but-invalid gap
// still succeed — the user can save a side note on a gap with a
// violation, and the UI flags it with a soft chip. The link check only
// fires at the "I'm done" moment (an explicit reviewed:true flip) or
// when the structural shape changes. Enforcing it here keeps the gate
// atomic for every caller, including AI write paths and integrations.

import { GapSchema, createEmptyGap } from "../../schema/gap.js";
import { validateActionLinks } from "../../core/taxonomy.js";

// Fields whose change can plausibly violate the Action's link-count
// rules or move the gap into a different Action category. Pure metadata
// fields (urgency, notes, phase, status, driverId, services,
// description, etc.) are deliberately NOT listed — they can update
// freely even on a reviewed gap that already has a link violation.
const _STRUCTURAL_FIELDS = [
  "gapType", "layerId", "affectedLayers", "affectedEnvironments",
  "relatedCurrentInstanceIds", "relatedDesiredInstanceIds"
];

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

export function addGap(engagement, input) {
  const now = new Date().toISOString();
  const draft = createEmptyGap({
    ...input,
    id:           newId(),
    engagementId: engagement.meta.engagementId,
    createdAt:    now,
    updatedAt:    now
  });
  const result = GapSchema.safeParse(draft);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map(i => ({
        path: i.path.join("."), message: i.message, code: i.code
      }))
    };
  }
  const gap = result.data;
  return {
    ok: true,
    engagement: {
      ...engagement,
      gaps: {
        byId:   { ...engagement.gaps.byId, [gap.id]: gap },
        allIds: [...engagement.gaps.allIds, gap.id]
      },
      meta: { ...engagement.meta, updatedAt: now }
    }
  };
}

export function updateGap(engagement, gapId, patch) {
  const existing = engagement.gaps.byId[gapId];
  if (!existing) {
    return { ok: false, errors: [{ path: "gapId", message: "Gap not found", code: "not_found" }] };
  }
  const now = new Date().toISOString();

  // Primary-layer auto-rebalance. When the caller patches layerId
  // WITHOUT also patching affectedLayers, auto-derive affectedLayers so
  // that the new layerId is at index 0 (the schema requires
  // affectedLayers[0] === layerId), the old primary is demoted to a
  // later index, and there are no duplicates. If the caller passes both
  // layerId and affectedLayers, we respect that and do not auto-derive;
  // the schema still enforces the primary-at-index-0 rule.
  let effectivePatch = patch;
  if (typeof patch.layerId === "string" && patch.layerId.length > 0
      && !Array.isArray(patch.affectedLayers)) {
    const newPrimary = patch.layerId;
    const existingLayers = Array.isArray(existing.affectedLayers) ? existing.affectedLayers : [];
    const rest = existingLayers.filter(l => l !== newPrimary);
    effectivePatch = { ...patch, affectedLayers: [newPrimary, ...rest] };
  }

  const merged = { ...existing, ...effectivePatch,
                   id: existing.id, engagementId: existing.engagementId,
                   createdAt: existing.createdAt, updatedAt: now };
  const result = GapSchema.safeParse(merged);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map(i => ({
        path: i.path.join("."), message: i.message, code: i.code
      }))
    };
  }
  // Enforce action-link rules atomically when:
  //   (a) the caller explicitly flips reviewed:true ("I'm done"), or
  //   (b) the caller patches a structural field and the merged gap is
  //       reviewed.
  // Skipped for pure metadata patches on a reviewed-but-violating gap
  // (side notes, urgency, phase changes, etc. save freely; the UI
  // surfaces the violation as a soft chip). Also skipped when the merged
  // gap is not reviewed — validateActionLinks bypasses unreviewed gaps
  // anyway, but checking here avoids the call.
  const explicitReviewedFlip = patch.reviewed === true;
  const hasStructuralPatch = _STRUCTURAL_FIELDS.some(f => patch[f] !== undefined);
  const shouldValidateLinks =
    (explicitReviewedFlip) ||
    (hasStructuralPatch && result.data.reviewed === true);
  if (shouldValidateLinks) {
    try {
      validateActionLinks(result.data);
    } catch (e) {
      return {
        ok: false,
        errors: [{ path: "actionLinks", message: (e && e.message) || String(e), code: "AL10_VIOLATION" }]
      };
    }
  }
  return {
    ok: true,
    engagement: {
      ...engagement,
      gaps: {
        ...engagement.gaps,
        byId: { ...engagement.gaps.byId, [gapId]: result.data }
      },
      meta: { ...engagement.meta, updatedAt: now }
    }
  };
}

export function removeGap(engagement, gapId) {
  if (!engagement.gaps.byId[gapId]) return { ok: true, engagement };
  const { [gapId]: _removed, ...remaining } = engagement.gaps.byId;
  const now = new Date().toISOString();
  return {
    ok: true,
    engagement: {
      ...engagement,
      gaps: {
        byId:   remaining,
        allIds: engagement.gaps.allIds.filter(id => id !== gapId)
      },
      meta: { ...engagement.meta, updatedAt: now }
    }
  };
}

// Cross-cutting helpers.
export function attachServices(engagement, gapId, serviceIds) {
  return updateGap(engagement, gapId, { services: serviceIds });
}

export function attachInstances(engagement, gapId, { current = [], desired = [] }) {
  return updateGap(engagement, gapId, {
    relatedCurrentInstanceIds: current,
    relatedDesiredInstanceIds: desired
  });
}
