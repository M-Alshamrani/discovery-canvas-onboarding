// schema/customer.js
//
// Customer entity. Single record per engagement, embedded in the
// engagement document.

import { z } from "zod";
import { sessionPath } from "./helpers/pathManifest.js";

// `name` and `vertical` are plain z.string() (any string, including "")
// rather than .min(1): an empty string is the canonical "unset" sentinel.
// A .min(1) constraint would force createEmptyCustomer() to invent real-
// looking placeholder values for the empty initial state, which the chat
// would then read as actual customer data.
export const CustomerSchema = z.object({
  engagementId: z.string().uuid(),
  name:         z.string(),                                    // BUG-063: relaxed from .min(1); "" is the unset sentinel
  vertical:     z.string(),                                    // BUG-063: relaxed from .min(1); "" is the unset sentinel · FK to CUSTOMER_VERTICALS catalog when non-empty
  region:       z.string(),
  notes:        z.string().default("")
}).strict();

// Default-valid factory. Every entity schema exports a
// createEmpty<EntityName>() that returns an instance the schema accepts.
// Defaults to empty strings so the empty state is honest (see the
// schema-level note above).
export function createEmptyCustomer(overrides = {}) {
  return CustomerSchema.parse({
    engagementId: overrides.engagementId ?? "00000000-0000-4000-8000-000000000000",
    name:         overrides.name         ?? "",
    vertical:     overrides.vertical     ?? "",
    region:       overrides.region       ?? "",
    notes:        overrides.notes        ?? ""
  });
}

// FK declarations consumed by integrity sweep + manifest generator + DDL.
// Customer has one FK: vertical → CUSTOMER_VERTICALS catalog.
export const customerFkDeclarations = [
  { field: "vertical", target: "catalog:CUSTOMER_VERTICALS", required: true, isArray: false }
];

// Path manifest contribution. Customer fields are addressable as
// session-level paths (no entityKind scope) per SPEC S7.2 since the
// customer record is a top-level engagement field.
export const customerPathManifest = [
  sessionPath("customer.name",     "string", "Customer name"),
  sessionPath("customer.vertical", "string", "Customer vertical"),
  sessionPath("customer.region",   "string", "Customer region"),
  sessionPath("customer.notes",    "string", "Customer notes")
];
