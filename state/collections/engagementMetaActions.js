// state/collections/engagementMetaActions.js
//
// EngagementMeta is the workshop's identity envelope — a single record
// at engagement.meta. Same pattern as customerActions.js: pure function,
// returns a new engagement, validates against EngagementMetaSchema.

import { EngagementMetaSchema } from "../../schema/engagement.js";

export function updateEngagementMeta(engagement, patch) {
  const existing = engagement.meta;
  const merged = {
    ...existing,
    ...patch,
    // engagementId + schemaVersion are authoritative — cannot be patched
    // via this surface. createdAt is set at engagement creation and
    // never changes; updatedAt refreshes on every successful patch.
    engagementId:  existing.engagementId,
    schemaVersion: existing.schemaVersion,
    createdAt:     existing.createdAt,
    updatedAt:     new Date().toISOString()
  };
  const result = EngagementMetaSchema.safeParse(merged);
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
      meta: result.data
    }
  };
}
