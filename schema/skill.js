// schema/skill.js
//
// Skills Builder schema. The eight author-form fields plus cross-cutting
// metadata:
//   description     — required string; surfaced in launcher confirm
//   seedPrompt      — required string; author's raw idea
//   dataPoints[]    — array of {path, scope}; selected schema-keyed paths
//   improvedPrompt  — string (default ""); LLM Improve-button output
//   outputFormat    — enum (text/dimensional/json-array/scalar)
//   mutationPolicy  — nullable enum (ask/auto-tag); required-non-null iff
//                     outputFormat ∈ {json-array, scalar}

import { z } from "zod";
import { crossCuttingFieldsSchema, defaultCrossCuttingFields } from "./helpers/crossCuttingFields.js";

// DataPoint binding shape — a subset of the dataContract DataPoint
// descriptor. Only path + scope are persisted with the skill; the full
// descriptor is re-derived on demand.
const DataPointSchema = z.object({
  path:  z.string().min(1),
  scope: z.enum(["standard", "advanced"])
});

// Output format enum (locked).
const OutputFormatEnum = z.enum(["text", "dimensional", "json-array", "scalar"]);

// Mutation policy enum (locked). Nullable: required-non-null only when
// outputFormat ∈ {json-array, scalar}; for non-mutating formats
// (text/dimensional) it persists as null.
const MutationPolicyEnum = z.enum(["ask", "auto-tag"]).nullable();

// Parameter schema. The `file` type accepts client-side run-time uploads,
// declared with an `accepts` extension list (e.g. ".xlsx,.csv,.txt,.pdf");
// file parameters are never persisted with the skill — they are consumed
// at run-time only.
const ParameterSchema = z.object({
  name:        z.string().min(1),
  type:        z.enum(["string", "number", "boolean", "entityId", "file"]),
  description: z.string().default(""),
  required:    z.boolean().default(false),
  // Optional metadata for file-type parameters; ignored for other types.
  accepts:     z.string().optional()
});

const SCHEMA_VERSION_RE = /^\d+\.\d+$/;

// The 8 author form fields plus cross-cutting metadata.
export const SkillSchema = z.object({
  ...crossCuttingFieldsSchema,
  // Identity + cross-cutting
  skillId:              z.string().min(1),
  label:                z.string().min(1),
  description:          z.string().min(1),                 // §S46.3 field 2
  version:              z.string().default("1.0.0"),
  // Authoring fields (§S46.3 fields 3..5)
  seedPrompt:           z.string().min(1),                 // field 3 (required)
  dataPoints:           z.array(DataPointSchema).default([]),  // field 4
  improvedPrompt:       z.string().default(""),            // field 5 (filled by Improve)
  // Run-time inputs (§S46.3 field 6)
  parameters:           z.array(ParameterSchema).default([]),
  // Output + mutation contract (§S46.3 fields 7..8 / §S46.6 / §S46.10)
  outputFormat:         OutputFormatEnum,                  // field 7 (locked enum)
  mutationPolicy:       MutationPolicyEnum.default(null),  // field 8 (conditional)
  // Schema versioning
  validatedAgainst:     z.string().regex(SCHEMA_VERSION_RE).default("3.2"),
  outdatedSinceVersion: z.string().regex(SCHEMA_VERSION_RE).nullable().default(null)
}).strict();

// createEmptySkill — emits a blank draft with sensible defaults that the
// user immediately fills in.
export function createEmptySkill(overrides = {}) {
  const base = defaultCrossCuttingFields(overrides);
  const candidate = {
    ...base,
    skillId:              overrides.skillId              ?? "skl-new-001",
    label:                overrides.label                ?? "New skill",
    description:          overrides.description          ?? "(describe what this skill does)",
    version:              overrides.version              ?? "1.0.0",
    seedPrompt:           overrides.seedPrompt           ?? "(describe what you want the AI to do)",
    dataPoints:           overrides.dataPoints           ?? [],
    improvedPrompt:       overrides.improvedPrompt       ?? "",
    parameters:           overrides.parameters           ?? [],
    outputFormat:         overrides.outputFormat         ?? "text",
    mutationPolicy:       overrides.mutationPolicy       ?? null,
    validatedAgainst:     overrides.validatedAgainst     ?? "3.2",
    outdatedSinceVersion: overrides.outdatedSinceVersion ?? null
  };
  return SkillSchema.parse(candidate);
}
