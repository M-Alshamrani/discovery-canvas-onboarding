// schema/gap.js
//
// Gap entity. Enforces the G6 invariant (affectedLayers[0] === layerId)
// in superRefine and carries the cross-cutting array fields
// affectedEnvironments, relatedCurrentInstanceIds, and
// relatedDesiredInstanceIds.
//
// projectId is derived, not stored — selectProjects computes project
// grouping at projection time.

import { z } from "zod";
import { crossCuttingFieldsSchema, defaultCrossCuttingFields } from "./helpers/crossCuttingFields.js";
import { provenanceWrapper } from "./helpers/provenanceWrapper.js";
import { ownPath, linkedPath } from "./helpers/pathManifest.js";
// AI-mutation provenance tag, mirroring instance.aiTag via the shared
// helper. services/importApplier.js stamps aiTag.kind = "discovery-note"
// when a gap.close item from the Workshop Notes overlay sets the gap's
// status to "closed".
import { AiTagFieldSchema } from "./helpers/aiTag.js";

// Typed payload for aiMappedDellSolutions.
const DellSolutionListSchema = z.object({
  rawLegacy: z.string().optional(),                    // populated by migrator from v2.x plain strings
  products:  z.array(z.string()).default([])           // FKs to DELL_PRODUCT_TAXONOMY
});

export const GapSchema = z.object({
  ...crossCuttingFieldsSchema,
  description:               z.string().min(1),
  gapType:                   z.string().min(1),                       // FK to GAP_TYPES
  urgency:                   z.enum(["High", "Medium", "Low"]),
  urgencyOverride:           z.boolean().default(false),
  phase:                     z.enum(["now", "next", "later"]),
  status:                    z.enum(["open", "in_progress", "closed", "deferred"]),
  reviewed:                  z.boolean().default(false),
  // Provenance flag for how the gap was created. "autoDraft" = generated
  // from a Desired-State disposition; "manual" = user-created via the
  // "+ Add gap" dialog (or an AI write path that explicitly authors a
  // gap). This must be explicit rather than inferred from link state:
  // using `relatedDesiredInstanceIds.length > 0` as a proxy mis-classifies
  // a manual gap as auto-drafted the moment the user links it to a desired
  // tile, inflating the "auto-drafted from Desired State" banner count.
  // Defaults to "autoDraft" so persisted gaps lacking this field rehydrate
  // to the historically dominant case.
  origin:                    z.enum(["manual", "autoDraft"]).default("autoDraft"),
  notes:                     z.string().default(""),
  driverId:                  z.string().uuid().nullable().default(null),
  layerId:                   z.string().min(1),                       // primary layer; FK to LAYERS
  affectedLayers:            z.array(z.string().min(1)).min(1),       // invariant G6
  affectedEnvironments:      z.array(z.string().uuid()).min(1),
  relatedCurrentInstanceIds: z.array(z.string().uuid()).default([]),
  relatedDesiredInstanceIds: z.array(z.string().uuid()).default([]),
  services:                  z.array(z.string()).default([]),         // FKs to SERVICE_TYPES

  // AI-authored, provenance-wrapped:
  aiMappedDellSolutions:     provenanceWrapper(DellSolutionListSchema).nullable().default(null),

  // AI-mutation provenance (mirrors instance.aiTag). Stamped by
  // services/importApplier.js when a gap is closed from the Workshop
  // Notes overlay (kind: "gap.close"). Optional, nullable, defaults null.
  aiTag:                     AiTagFieldSchema
}).strict().superRefine((gap, ctx) => {
  // Invariant G6 — affectedLayers[0] must equal layerId.
  if (gap.affectedLayers[0] !== gap.layerId) {
    ctx.addIssue({ code: "custom", path: ["affectedLayers", 0],
      message: "affectedLayers[0] must equal layerId (invariant G6)" });
  }
});

export function createEmptyGap(overrides = {}) {
  const layerId = overrides.layerId ?? "compute";
  return GapSchema.parse({
    ...defaultCrossCuttingFields(overrides),
    description:               overrides.description               ?? "New gap",
    gapType:                   overrides.gapType                   ?? "replace",
    urgency:                   overrides.urgency                   ?? "Medium",
    urgencyOverride:           overrides.urgencyOverride           ?? false,
    phase:                     overrides.phase                     ?? "now",
    status:                    overrides.status                    ?? "open",
    reviewed:                  overrides.reviewed                  ?? false,
    origin:                    overrides.origin                    ?? "autoDraft",
    notes:                     overrides.notes                     ?? "",
    driverId:                  overrides.driverId                  ?? null,
    layerId,
    affectedLayers:            overrides.affectedLayers            ?? [layerId],
    affectedEnvironments:      overrides.affectedEnvironments      ?? ["00000000-0000-4000-8000-000000000001"],
    relatedCurrentInstanceIds: overrides.relatedCurrentInstanceIds ?? [],
    relatedDesiredInstanceIds: overrides.relatedDesiredInstanceIds ?? [],
    services:                  overrides.services                  ?? [],
    aiMappedDellSolutions:     overrides.aiMappedDellSolutions     ?? null,
    aiTag:                     overrides.aiTag                     ?? null
  });
}

export const gapFkDeclarations = [
  { field: "gapType",                   target: "catalog:GAP_TYPES",     required: true,  isArray: false },
  { field: "driverId",                  target: "drivers",               required: false, isArray: false },
  { field: "layerId",                   target: "catalog:LAYERS",        required: true,  isArray: false },
  { field: "affectedLayers",            target: "catalog:LAYERS",        required: true,  isArray: true },
  { field: "affectedEnvironments",      target: "environments",          required: true,  isArray: true },
  { field: "relatedCurrentInstanceIds", target: "instances",             required: false, isArray: true,
    targetFilter: { state: "current" } },
  { field: "relatedDesiredInstanceIds", target: "instances",             required: false, isArray: true,
    targetFilter: { state: "desired" } },
  { field: "services",                  target: "catalog:SERVICE_TYPES", required: false, isArray: true }
];

export const gapPathManifest = [
  ownPath("context.gap.description",     "string", "Gap description"),
  ownPath("context.gap.urgency",         "enum",   "Gap urgency"),
  ownPath("context.gap.phase",           "enum",   "Gap phase"),
  ownPath("context.gap.status",          "enum",   "Gap status"),
  ownPath("context.gap.notes",           "string", "Gap notes"),
  // layerId and gapType are user-meaningful scalars referenced by the
  // dell-mapping seed prompt and by user skills that author per-layer or
  // per-action prompts. They must appear here or the skill-save validator
  // rejects e.g. `{{context.gap.layerId}}` even though the run-time path
  // resolver handles it.
  ownPath("context.gap.layerId",         "enum",   "Gap layer (primary)"),
  ownPath("context.gap.gapType",         "enum",   "Gap type (replace / augment / new / decommission / consolidate)"),
  linkedPath("context.gap.driver.priority", "enum", "Linked driver priority",
    "engagement.drivers.byId[gap.driverId]"),
  linkedPath("context.gap.relatedCurrentInstances[*].label", "string",
    "Linked current instance labels",
    "engagement.instances filtered by gap.relatedCurrentInstanceIds")
];
