// schema/helpers/catalog.js
//
// Catalog wrapper schema. Per-catalog files extend `CatalogEntrySchema`
// with their catalog-specific fields and re-export.

import { z } from "zod";

export const CatalogEntrySchema = z.object({
  id:    z.string().min(1),
  label: z.string().min(1)
});

// Catalog-version regex: YYYY.MM
export const CatalogVersionSchema = z.string().regex(/^\d{4}\.\d{2}$/);

export function catalogSchemaOf(entrySchema) {
  return z.object({
    catalogId:      z.string().min(1),
    catalogVersion: CatalogVersionSchema,
    entries:        z.array(entrySchema)
  });
}
