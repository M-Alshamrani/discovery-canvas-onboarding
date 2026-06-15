// schema/helpers/pathManifest.js
//
// Shape of the path-manifest contribution exported by every entity schema
// file. Consumed by services/manifestGenerator.js to build the chip
// palette for the AI skill builder, and drift-gated against
// services/manifest.snapshot.json.

import { z } from "zod";

export const PathManifestEntrySchema = z.object({
  path:        z.string().min(1),                            // e.g. "context.driver.priority"
  type:        z.enum(["string","number","boolean","date","datetime","enum","array","object"]),
  label:       z.string().min(1),                            // user-visible label in the chip palette
  source:      z.enum(["session","entity","linked","catalog"]),
  composition: z.string().optional()                         // human-readable composition rule for linked paths
});

export const PathManifestSchema = z.array(PathManifestEntrySchema);

// Convenience constructors so per-entity declarations stay readable.
export function ownPath(path, type, label) {
  return { path, type, label, source: "entity" };
}
export function sessionPath(path, type, label) {
  return { path, type, label, source: "session" };
}
export function catalogPath(path, type, label) {
  return { path, type, label, source: "catalog" };
}
export function linkedPath(path, type, label, composition) {
  return { path, type, label, source: "linked", composition };
}
