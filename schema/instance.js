// schema/instance.js
//
// Instance entity. A single collection discriminated by `state` (current
// vs desired). One collection avoids joins for the matrix view, originId
// resolution, and workload mappedAssetIds resolution.
//
// Three superRefine invariants:
//   - originId only on state==='desired'
//   - priority only on state==='desired'
//   - mappedAssetIds non-empty only on layerId==='workload'
//
// The AI-authored field aiSuggestedDellMapping is provenance-wrapped.

import { z } from "zod";
import { crossCuttingFieldsSchema, defaultCrossCuttingFields } from "./helpers/crossCuttingFields.js";
import { provenanceWrapper } from "./helpers/provenanceWrapper.js";
import { ownPath, linkedPath } from "./helpers/pathManifest.js";
// AiTagSchema lives in schema/helpers/aiTag.js so one shape serves the
// instance, driver, and gap entities without duplicated Zod declarations.
// Re-exported here so consumers importing AiTagSchema from this file keep
// working.
import { AiTagSchema } from "./helpers/aiTag.js";
export { AiTagSchema };

// Typed payload for aiSuggestedDellMapping; refines as the dell-mapping
// skill matures.
const DellMappingSchema = z.object({
  rawLegacy: z.string().optional(),                    // populated by migrator from v2.x plain strings
  products:  z.array(z.string()).default([])           // FKs to DELL_PRODUCT_TAXONOMY entries
});

// aiTag — provenance for an AI-authored mutation. Stamped by
// applyMutations under either mutation policy ('ask'-approved or
// 'auto-tag'), auto-cleared on the next engineer save
// (instanceActions.updateInstance strips it), and rendered as a "Done by
// AI" badge on the MatrixView tile. Among the entities, only instance,
// driver, and gap carry an aiTag; environment, customer, and
// engagementMeta do not.
//
// The aiTag.kind discriminator:
//   - kind="skill"          · Skills-Builder skill run (uses skillId)
//   - kind="external-llm"   · file-upload import (uses source)
//   - kind="discovery-note" · Workshop Notes overlay
//   - kind="ai-proposal"    · chat-inline emission (reserved · forward compat)
// Legacy aiTag records without `kind` parse as kind="skill" via the Zod
// default, so no data migration is needed.

export const InstanceSchema = z.object({
  ...crossCuttingFieldsSchema,
  state:         z.enum(["current", "desired"]),
  layerId:       z.string().min(1),                       // FK to LAYERS
  environmentId: z.string().uuid(),                       // FK to environments
  label:         z.string().min(1),
  vendor:        z.string(),
  vendorGroup:   z.enum(["dell", "nonDell", "custom"]),
  criticality:   z.enum(["High", "Medium", "Low"]),
  notes:         z.string().default(""),
  disposition:   z.string().min(1),                       // FK to DISPOSITION_ACTIONS
  endOfSaleDate:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  endOfSupportDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  endOfServiceLifeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  nodeCount:            z.number().int().nonnegative().nullable().default(null),

  // State-conditional (validated by .superRefine):
  originId:      z.string().uuid().nullable().default(null),
  priority:      z.enum(["Now", "Next", "Later"]).nullable().default(null),

  // Layer-conditional:
  mappedAssetIds: z.array(z.string().uuid()).default([]),

  // AI-authored, provenance-wrapped:
  aiSuggestedDellMapping: provenanceWrapper(DellMappingSchema).nullable().default(null),

  // AI-mutation provenance. Stamped by applyMutations; cleared on engineer
  // save in instanceActions.
  aiTag:                 AiTagSchema.nullable().default(null)
}).strict().superRefine((inst, ctx) => {
  // originId only on desired
  if (inst.state === "current" && inst.originId !== null) {
    ctx.addIssue({ code: "custom", path: ["originId"],
      message: "originId is permitted only on state==='desired' instances" });
  }
  // priority only on desired
  if (inst.state === "current" && inst.priority !== null) {
    ctx.addIssue({ code: "custom", path: ["priority"],
      message: "priority is permitted only on state==='desired' instances" });
  }
  // mappedAssetIds only on workload
  if (inst.layerId !== "workload" && inst.mappedAssetIds.length > 0) {
    ctx.addIssue({ code: "custom", path: ["mappedAssetIds"],
      message: "mappedAssetIds permitted only on layerId==='workload' instances" });
  }
  // No self-reference
  if (inst.originId !== null && inst.originId === inst.id) {
    ctx.addIssue({ code: "custom", path: ["originId"],
      message: "originId must not point at the instance itself" });
  }
});

export function createEmptyInstance(overrides = {}) {
  const state = overrides.state ?? "current";
  const layerId = overrides.layerId ?? "compute";
  return InstanceSchema.parse({
    ...defaultCrossCuttingFields(overrides),
    state,
    layerId,
    environmentId: overrides.environmentId ?? "00000000-0000-4000-8000-000000000001",
    label:         overrides.label         ?? "New instance",
    vendor:        overrides.vendor        ?? "Dell",
    vendorGroup:   overrides.vendorGroup   ?? "dell",
    criticality:   overrides.criticality   ?? "Medium",
    notes:         overrides.notes         ?? "",
    disposition:   overrides.disposition   ?? "keep",
    endOfSaleDate:        overrides.endOfSaleDate        ?? null,
    endOfSupportDate:     overrides.endOfSupportDate     ?? null,
    endOfServiceLifeDate: overrides.endOfServiceLifeDate ?? null,
    nodeCount:            overrides.nodeCount            ?? null,
    originId:      overrides.originId      ?? null,
    priority:      overrides.priority      ?? null,
    mappedAssetIds: overrides.mappedAssetIds ?? [],
    aiSuggestedDellMapping: overrides.aiSuggestedDellMapping ?? null,
    aiTag:                  overrides.aiTag                  ?? null
  });
}

export const instanceFkDeclarations = [
  { field: "layerId",        target: "catalog:LAYERS",              required: true, isArray: false },
  { field: "environmentId",  target: "environments",                required: true, isArray: false },
  { field: "disposition",    target: "catalog:DISPOSITION_ACTIONS", required: true, isArray: false },
  { field: "originId",       target: "instances",                   required: false, isArray: false,
    targetFilter: { state: "current" } },
  { field: "mappedAssetIds", target: "instances",                   required: false, isArray: true }
];

export const instancePathManifest = [
  ownPath("context.instance.label",       "string", "Instance label"),
  ownPath("context.instance.vendor",      "string", "Vendor"),
  ownPath("context.instance.vendorGroup", "enum",   "Vendor group"),
  ownPath("context.instance.criticality", "enum",   "Criticality"),
  ownPath("context.instance.notes",       "string", "Instance notes"),
  ownPath("context.instance.disposition", "enum",   "Disposition"),
  ownPath("context.instance.priority",    "enum",   "Priority (desired only)"),
  linkedPath("context.instance.linkedGaps[*].description", "string",
    "Linked gap description",
    "engagement.gaps where gap.relatedCurrentInstanceIds OR relatedDesiredInstanceIds includes instance.id")
];
