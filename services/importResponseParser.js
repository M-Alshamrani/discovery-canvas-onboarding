// services/importResponseParser.js
//
// Zod-validated parser for the canonical `import-subset` JSON shape that
// both ingress paths (Skills-Builder file-ingest skill + Dell-internal-LLM
// instructions workflow) produce. Same wire format, same parser, same
// downstream pipeline (drift-check -> preview modal -> applier).
//
// SHAPE:
//   {
//     "schemaVersion": "1.0",
//     "kind": "instance.add",
//     "generatedAt": "<ISO instant>",
//     "engagementContextSnapshot"?: {           // Path B only
//       "customerName": "<string>",
//       "environmentSlots": [
//         { "uuid": "<string>", "label": "<string>", "envCatalogId": "<string>" },
//         ...
//       ]
//     },
//     "items": [
//       {
//         "confidence": "high" | "medium" | "low",
//         "rationale": "<string>",
//         "data": {
//           "state": "current" | "desired" | null,           // hint only
//           "layerId": "<string>",                            // FK to LAYERS
//           "environmentId": "<string>",                      // wire-format only;
//                                                              // drift-check validates
//                                                              // membership against
//                                                              // live engagement
//           "label": "<string>",
//           "vendor": "<string>",
//           "vendorGroup": "dell" | "nonDell" | "custom",
//           "criticality": "High" | "Medium" | "Low",
//           "notes": "<string>"
//         }
//       },
//       ...
//     ]
//   }
//
// Design notes:
//   - environmentId is z.string().min(1) NOT .uuid() · the live-engagement
//     UUID membership check is the drift-check's job (importDriftCheck.js).
//     Validating UUID format here would let mismatched-but-format-valid
//     UUIDs short-circuit the drift check, leaking subtle bugs.
//   - engagementContextSnapshot is .optional() at the parser layer · the
//     Path A skill omits it (skill runs against live engagement); Path B
//     includes it (records env-slot state at instructions-generation time
//     so drift detection has a baseline). The upper layer enforces the
//     Path B requirement.
//   - Not .strict() · external LLMs may emit harmless extra fields
//     (e.g. "summary" or "notes-for-engineer"); Zod silently strips them
//     rather than rejecting outright. The strict-match contract applies to
//     environmentId membership, not to schema-shape.

import { z } from "zod";

// Instance-only item shape (legacy file-upload Path B).
const InstanceImportItemDataSchema = z.object({
  state:         z.enum(["current", "desired"]).nullable(),
  layerId:       z.string().min(1),
  environmentId: z.string().min(1),
  label:         z.string().min(1),
  vendor:        z.string(),
  vendorGroup:   z.enum(["dell", "nonDell", "custom"]),
  criticality:   z.enum(["High", "Medium", "Low"]),
  notes:         z.string().default("")
});

// Widened shapes — one payload schema per engagement-mutating kind.
//
// driver.add payload (the engagement-mutating shape for add-driver).
const DriverImportItemDataSchema = z.object({
  businessDriverId: z.string().min(1),                     // FK to BUSINESS_DRIVERS catalog
  priority:         z.enum(["High", "Medium", "Low"]).default("Medium"),
  outcomes:         z.string().default("")
});

// gap.close payload (the engagement-mutating shape for close-gap).
const GapCloseImportItemDataSchema = z.object({
  gapId:       z.string().min(1),                          // FK to live engagement gap
  status:      z.literal("closed"),                        // close-gap is the only gap mutation in v1
  closeReason: z.string().default("")
});

// Per-kind item schemas, combined below into a discriminated union on `kind`.
const InstanceAddItemSchema = z.object({
  kind:       z.literal("instance.add"),
  confidence: z.enum(["high", "medium", "low"]),
  rationale:  z.string().default(""),
  data:       InstanceImportItemDataSchema
});

const DriverAddItemSchema = z.object({
  kind:       z.literal("driver.add"),
  confidence: z.enum(["high", "medium", "low"]),
  rationale:  z.string().default(""),
  data:       DriverImportItemDataSchema
});

const GapCloseItemSchema = z.object({
  kind:       z.literal("gap.close"),
  confidence: z.enum(["high", "medium", "low"]),
  rationale:  z.string().default(""),
  data:       GapCloseImportItemDataSchema
});

// Discriminated union over the 3 wire kinds.
export const WideImportItemSchema = z.discriminatedUnion("kind", [
  InstanceAddItemSchema,
  DriverAddItemSchema,
  GapCloseItemSchema
]);

const EnvironmentSlotSchema = z.object({
  uuid:         z.string().min(1),
  label:        z.string().min(1),
  envCatalogId: z.string().min(1)
});

const EngagementContextSnapshotSchema = z.object({
  customerName:     z.string().min(1),
  environmentSlots: z.array(EnvironmentSlotSchema)
});

// Widened payload. schemaVersion "1.1" carries the per-item `kind`
// discriminator; the legacy top-level `kind: "instance.add"` field is
// gone (back-compat handled below at parse time).
export const WideImportSubsetSchema = z.object({
  schemaVersion:             z.literal("1.1"),
  generatedAt:               z.string().min(1),
  runId:                     z.string().optional(),         // workshop-notes-overlay provenance
  mutatedAt:                 z.string().optional(),         // workshop-notes-overlay provenance
  source:                    z.string().optional(),         // "workshop-notes-overlay" | undefined (file upload)
  engagementContextSnapshot: EngagementContextSnapshotSchema.optional(),
  items:                     z.array(WideImportItemSchema).min(1)
});

// Instance-only payload, preserved for back-compat. Legacy file-upload
// payloads (schemaVersion="1.0", top-level kind:"instance.add") are
// migrated to the widened shape at parse time: each items[] entry gets
// `kind: "instance.add"` injected.
export const ImportSubsetSchema = z.object({
  schemaVersion:             z.literal("1.0"),
  kind:                      z.literal("instance.add"),
  generatedAt:               z.string().min(1),
  engagementContextSnapshot: EngagementContextSnapshotSchema.optional(),
  items:                     z.array(z.object({
    confidence: z.enum(["high", "medium", "low"]),
    rationale:  z.string().default(""),
    data:       InstanceImportItemDataSchema
  })).min(1)
});

// parseImportResponse(jsonOrObject) -> { ok, parsed, errors }
//   - ok=true  · parsed is the Zod-validated object in the WIDENED shape
//                (normalized regardless of input format), errors is null
//   - ok=false · parsed is null, errors is a non-empty array of issues
//
// Accepts EITHER a JSON string (legacy + workshop-notes path) OR a
// pre-parsed JavaScript object (Workshop Notes overlay adapter emits
// an object directly · no need to round-trip through JSON). Branches
// on schemaVersion: "1.0" → legacy back-compat injection of per-item
// kind="instance.add". "1.1" → already-widened shape.
export function parseImportResponse(jsonOrObject) {
  let raw;
  if (typeof jsonOrObject === "string") {
    try {
      raw = JSON.parse(jsonOrObject);
    } catch (e) {
      return {
        ok:     false,
        parsed: null,
        errors: [{ path: "(json)", message: "Invalid JSON: " + (e && e.message || String(e)), code: "json_parse" }]
      };
    }
  } else if (jsonOrObject && typeof jsonOrObject === "object") {
    raw = jsonOrObject;
  } else {
    return {
      ok:     false,
      parsed: null,
      errors: [{ path: "(input)", message: "parseImportResponse: expected a string or object", code: "input_type" }]
    };
  }

  // Branch on schemaVersion. Widened payloads carry "1.1"; legacy file
  // uploads carry "1.0" with top-level kind:"instance.add".
  if (raw && raw.schemaVersion === "1.1") {
    const result = WideImportSubsetSchema.safeParse(raw);
    if (!result.success) {
      return {
        ok:     false,
        parsed: null,
        errors: result.error.issues.map(i => ({
          path:    i.path.join("."),
          message: i.message,
          code:    i.code
        }))
      };
    }
    return { ok: true, parsed: result.data, errors: null };
  }

  // Legacy 1.0 path · validate against the original schema then
  // normalize to the widened shape by injecting kind:"instance.add"
  // per-item. Downstream code (drift-check, modal, applier) only sees
  // the widened shape regardless of input version.
  const legacyResult = ImportSubsetSchema.safeParse(raw);
  if (!legacyResult.success) {
    return {
      ok:     false,
      parsed: null,
      errors: legacyResult.error.issues.map(i => ({
        path:    i.path.join("."),
        message: i.message,
        code:    i.code
      }))
    };
  }
  // Normalize legacy to widened: bump schemaVersion + inject per-item kind.
  const normalized = {
    schemaVersion:             "1.1",
    generatedAt:               legacyResult.data.generatedAt,
    engagementContextSnapshot: legacyResult.data.engagementContextSnapshot,
    items:                     legacyResult.data.items.map(it => ({
      kind:       "instance.add",
      confidence: it.confidence,
      rationale:  it.rationale,
      data:       it.data
    }))
  };
  // Re-validate the normalized shape (defensive · should always pass
  // since legacyResult.data already passed the narrower schema).
  const wideCheck = WideImportSubsetSchema.safeParse(normalized);
  if (!wideCheck.success) {
    return {
      ok:     false,
      parsed: null,
      errors: wideCheck.error.issues.map(i => ({
        path:    "(post-normalize) " + i.path.join("."),
        message: i.message,
        code:    i.code
      }))
    };
  }
  return { ok: true, parsed: wideCheck.data, errors: null };
}
