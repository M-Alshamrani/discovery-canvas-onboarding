// services/workshopNotesImportAdapter.js
//
// Transforms Workshop Notes overlay output (mappings: ActionProposal[]
// emitted by services/workshopNotesService.js, validated via
// schema/actionProposal.js) into the Path B widened wire shape, with a
// per-item kind discriminator `instance.add` | `driver.add` | `gap.close`.
//
// Behavior:
//   - Imports ActionProposalSchema from schema/actionProposal.js as the
//     single source of truth (no parallel definitions).
//   - Maps the 4 ActionProposal kinds to 3 wire kinds:
//        add-instance-current → kind: "instance.add" + data.state="current"
//        add-instance-desired → kind: "instance.add" + data.state="desired"
//        add-driver           → kind: "driver.add"
//        close-gap            → kind: "gap.close"
//   - Validates each mapping via ActionProposalSchema.safeParse and drops
//     invalid entries with console.warn.
//   - Emits schemaVersion "1.1" (the widened wire format).
//
// USAGE:
//   import { transformOverlayToImportPayload } from "/services/workshopNotesImportAdapter.js";
//   const payload = transformOverlayToImportPayload({
//     mappings: <ActionProposal[]>,
//     runId:    <string>,
//     mutatedAt:<ISO string>
//   });
//   // payload shape: { schemaVersion: "1.1", generatedAt, runId, mutatedAt,
//   //                  source: "workshop-notes-overlay", items: [...] }
//
// The payload flows into importResponseParser.js → importDriftCheck.js →
// ImportPreviewModal → importApplier.js.

import { ActionProposalSchema } from "../schema/actionProposal.js";

// Map a single validated ActionProposal to the widened wire item shape.
// Returns null if the kind is unknown (defensive — schema validation
// upstream should catch this, but treat as belt-and-braces).
function mapProposalToWireItem(proposal) {
  if (!proposal || typeof proposal !== "object") return null;

  const sharedFields = {
    confidence: (proposal.confidence || "MEDIUM").toLowerCase(),  // schema enum is HIGH/MEDIUM/LOW; wire format uses high/medium/low per §S47.3
    rationale:  proposal.rationale || ""
  };

  switch (proposal.kind) {
    case "add-instance-current":
      return Object.assign({ kind: "instance.add" }, sharedFields, {
        data: {
          state:         "current",
          layerId:       proposal.payload.layerId,
          environmentId: proposal.payload.environmentId,
          label:         proposal.payload.label,
          vendor:        proposal.payload.vendor || "",
          vendorGroup:   proposal.payload.vendorGroup || "nonDell",
          criticality:   proposal.payload.criticality || "Medium",
          notes:         ""
        }
      });
    case "add-instance-desired":
      return Object.assign({ kind: "instance.add" }, sharedFields, {
        data: {
          state:         "desired",
          layerId:       proposal.payload.layerId,
          environmentId: proposal.payload.environmentId,
          label:         proposal.payload.label,
          vendor:        proposal.payload.vendor || "",
          vendorGroup:   proposal.payload.vendorGroup || "nonDell",
          criticality:   "Medium",         // desired-state criticality typically engineer-set post-import
          notes:         ""
        }
      });
    case "add-driver":
      return Object.assign({ kind: "driver.add" }, sharedFields, {
        data: {
          businessDriverId: proposal.payload.businessDriverId,
          priority:         proposal.payload.priority || "Medium",
          outcomes:         Array.isArray(proposal.payload.outcomes)
            ? proposal.payload.outcomes.join("; ")
            : (proposal.payload.outcomes || "")
        }
      });
    case "close-gap":
      return Object.assign({ kind: "gap.close" }, sharedFields, {
        data: {
          gapId:       proposal.payload.gapId,
          status:      "closed",
          closeReason: proposal.payload.closeReason || ""
        }
      });
    default:
      return null;
  }
}

// transformOverlayToImportPayload · main exported entry point.
//
//   opts.mappings   · ActionProposal[] (already validated upstream)
//   opts.runId      · string · provenance id (stamped onto aiTag)
//   opts.mutatedAt  · ISO string · provenance timestamp
//
// Returns the widened Path B wire payload.
//
// Per-mapping validation: each mapping is re-validated against
// ActionProposalSchema in case the caller bypassed the service-layer
// validation. Invalid mappings are dropped with console.warn rather than
// throwing, so one bad entry doesn't fail the whole import.
export function transformOverlayToImportPayload(opts) {
  opts = opts || {};
  const mappings = Array.isArray(opts.mappings) ? opts.mappings : [];
  const runId = opts.runId || ("wn-" + Date.now().toString(36));
  const mutatedAt = opts.mutatedAt || new Date().toISOString();

  const items = [];
  let droppedCount = 0;

  for (let i = 0; i < mappings.length; i++) {
    const raw = mappings[i];
    // Re-validate in case a caller reaches this without going through
    // workshopNotesService.pushNotesToAi (which validates first).
    const validated = ActionProposalSchema.safeParse(raw);
    if (!validated.success) {
      droppedCount++;
      console.warn("[workshopNotesImportAdapter] dropping invalid ActionProposal at index " + i + ": " +
        (validated.error && validated.error.message ? validated.error.message : "(no error)"));
      continue;
    }
    const wireItem = mapProposalToWireItem(validated.data);
    if (wireItem === null) {
      droppedCount++;
      console.warn("[workshopNotesImportAdapter] dropping mapping at index " + i +
        " · unknown kind: " + validated.data.kind);
      continue;
    }
    items.push(wireItem);
  }

  return {
    schemaVersion: "1.1",                       // A20 widened format per SPEC §S47.3 R47.3.5
    generatedAt:   new Date().toISOString(),
    runId:         runId,                       // provenance · importApplier stamps aiTag.runId
    mutatedAt:     mutatedAt,                   // provenance · importApplier stamps aiTag.mutatedAt
    source:        "workshop-notes-overlay",    // importApplier reads this to stamp aiTag.kind="discovery-note"
    items:         items,
    droppedCount:  droppedCount                 // engineer-visible · surfaced in overlay toast on import-click
  };
}
