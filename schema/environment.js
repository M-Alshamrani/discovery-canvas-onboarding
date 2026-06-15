// schema/environment.js
//
// Environment entity. Top-level collection with soft-delete via the
// `hidden` flag. Optional alias / location / sizeKw / sqm / tier / notes
// carry through user input.

import { z } from "zod";
import { crossCuttingFieldsSchema, defaultCrossCuttingFields } from "./helpers/crossCuttingFields.js";
import { ownPath } from "./helpers/pathManifest.js";

export const EnvironmentSchema = z.object({
  ...crossCuttingFieldsSchema,
  envCatalogId:   z.string().min(1),                              // FK to ENV_CATALOG
  catalogVersion: z.string().min(1),
  hidden:         z.boolean().default(false),
  alias:          z.string().nullable().default(null),
  location:       z.string().nullable().default(null),
  sizeKw:         z.number().nullable().default(null),
  sqm:            z.number().nullable().default(null),
  tier:           z.string().nullable().default(null),
  notes:          z.string().default("")
}).strict();

export function createEmptyEnvironment(overrides = {}) {
  return EnvironmentSchema.parse({
    ...defaultCrossCuttingFields(overrides),
    envCatalogId:   overrides.envCatalogId   ?? "coreDc",
    catalogVersion: overrides.catalogVersion ?? "2026.04",
    hidden:         overrides.hidden         ?? false,
    alias:          overrides.alias          ?? null,
    location:       overrides.location       ?? null,
    sizeKw:         overrides.sizeKw         ?? null,
    sqm:            overrides.sqm            ?? null,
    tier:           overrides.tier           ?? null,
    notes:          overrides.notes          ?? ""
  });
}

export const environmentFkDeclarations = [
  { field: "envCatalogId", target: "catalog:ENV_CATALOG", required: true, isArray: false }
];

export const environmentPathManifest = [
  ownPath("context.environment.alias",    "string", "Environment alias"),
  ownPath("context.environment.location", "string", "Environment location"),
  ownPath("context.environment.sizeKw",   "number", "Environment size (kW)"),
  ownPath("context.environment.sqm",      "number", "Environment size (m²)"),
  ownPath("context.environment.tier",     "string", "Environment tier"),
  ownPath("context.environment.notes",    "string", "Environment notes")
];
