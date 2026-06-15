// schema/driver.js
//
// Driver entity. Its own top-level collection. The skill builder treats
// drivers as a click-to-run entity kind, and cross-engagement reporting
// relies on this top-level shape.

import { z } from "zod";
import { crossCuttingFieldsSchema, defaultCrossCuttingFields } from "./helpers/crossCuttingFields.js";
import { ownPath, catalogPath } from "./helpers/pathManifest.js";
// AI-mutation provenance tag, mirroring instance.aiTag via the shared
// helper. services/importApplier.js stamps aiTag.kind = "discovery-note"
// when the source is the Workshop Notes overlay.
import { AiTagFieldSchema } from "./helpers/aiTag.js";

export const DriverSchema = z.object({
  ...crossCuttingFieldsSchema,
  businessDriverId: z.string().min(1),                         // FK to BUSINESS_DRIVERS catalog
  catalogVersion:   z.string().min(1),                         // pinned catalog version (SPEC sec S6.1.3)
  priority:         z.enum(["High", "Medium", "Low"]),
  outcomes:         z.string().default(""),
  // AI-mutation provenance (mirrors instance.aiTag). Stamped by
  // services/importApplier.js when a driver is imported from the Workshop
  // Notes overlay. Optional, nullable, defaults null.
  aiTag:            AiTagFieldSchema
}).strict();

export function createEmptyDriver(overrides = {}) {
  return DriverSchema.parse({
    ...defaultCrossCuttingFields(overrides),
    businessDriverId: overrides.businessDriverId ?? "ai_data",
    catalogVersion:   overrides.catalogVersion   ?? "2026.04",
    priority:         overrides.priority         ?? "Medium",
    outcomes:         overrides.outcomes         ?? "",
    aiTag:            overrides.aiTag            ?? null
  });
}

export const driverFkDeclarations = [
  { field: "businessDriverId", target: "catalog:BUSINESS_DRIVERS", required: true, isArray: false }
];

export const driverPathManifest = [
  ownPath("context.driver.priority", "enum",   "Driver priority"),
  ownPath("context.driver.outcomes", "string", "Driver outcomes"),
  catalogPath("context.driver.catalog.label",                "string", "Driver name"),
  catalogPath("context.driver.catalog.hint",                 "string", "Driver hint"),
  catalogPath("context.driver.catalog.conversationStarter", "string", "Conversation starter")
];
