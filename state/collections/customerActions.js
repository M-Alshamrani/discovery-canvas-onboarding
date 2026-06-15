// state/collections/customerActions.js
//
// Customer is a single record per engagement (not a collection), so only
// updateCustomer is exposed. Same pattern as the collection-action
// modules: pure, returns a new engagement, validates against the schema.

import { CustomerSchema } from "../../schema/customer.js";

export function updateCustomer(engagement, patch) {
  const existing = engagement.customer;
  const merged = {
    ...existing,
    ...patch,
    // engagementId is authoritative on engagement.meta; cannot be patched.
    engagementId: existing.engagementId
  };
  const result = CustomerSchema.safeParse(merged);
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
  const now = new Date().toISOString();
  return {
    ok: true,
    engagement: {
      ...engagement,
      customer: result.data,
      meta: { ...engagement.meta, updatedAt: now }
    }
  };
}
