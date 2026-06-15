// schema/actionProposal.js
//
// Canonical Zod schema for the structured action proposals the chat emits
// via the `proposeAction` tool (services/chatTools.js). The chat calls
// `proposeAction(actionProposal)` as a tool call; the args are validated
// against ActionProposalSchema at capture time and valid proposals are
// appended to the envelope's `proposedActions[]` field for engineer review.
//
// Scope: four action kinds — add-driver, add-instance-current,
// add-instance-desired, and close-gap. Destructive kinds (delete / hide /
// archive) and flip-disposition are intentionally out of scope.
//
// Per-kind payload schemas are .strict() so unknown fields fail validation.
// A discriminated union on `kind` enforces the per-kind payload shape, so
// the chat cannot pair an add-driver kind with an add-instance payload.
//
// Shared fields across all kinds:
//   confidence  (HIGH | MEDIUM | LOW)
//   rationale   (non-empty string · the chat's explanation for the proposal)
//   source      (discovery-note | ai-proposal · provenance)
//   targetState (optional · current | desired · only for add-instance-*)

import { z } from "zod";

// Canonical list of action kinds. Exported so chatTools.js can use it as
// the JSON-Schema enum, keeping a single source of truth for the kind list
// shared between Zod and the hand-written JSON Schema.
export const ACTION_KINDS = [
  "add-driver",
  "add-instance-current",
  "add-instance-desired",
  "close-gap"
];

// Confidence levels. Uppercase to match actionRubric.js scoring text.
export const ACTION_CONFIDENCE_LEVELS = ["HIGH", "MEDIUM", "LOW"];

// Source enum. Kebab-case to match the aiTag.kind values ("skill" /
// "external-llm").
export const ACTION_SOURCES = ["discovery-note", "ai-proposal"];

// Per-kind payload schemas. Each .strict() so unknown fields reject.

// add-driver payload
const AddDriverPayloadSchema = z.object({
  businessDriverId: z.string().min(1),
  priority:         z.enum(["High", "Medium", "Low"]).optional(),
  outcomes:         z.array(z.string()).optional()
}).strict();

// add-instance-current payload
const AddInstanceCurrentPayloadSchema = z.object({
  layerId:         z.string().min(1),
  environmentId:   z.string().min(1),
  label:           z.string().min(1),
  vendor:          z.string().optional(),
  vendorGroup:     z.enum(["dell", "nonDell", "custom"]).optional(),
  criticality:     z.enum(["High", "Medium", "Low"]).optional()
}).strict();

// add-instance-desired payload (extends current with disposition + originId)
const AddInstanceDesiredPayloadSchema = z.object({
  layerId:         z.string().min(1),
  environmentId:   z.string().min(1),
  label:           z.string().min(1),
  disposition:     z.enum(["keep", "enhance", "replace", "consolidate", "retire", "introduce"]).optional(),
  originId:        z.string().optional(),
  vendor:          z.string().optional(),
  vendorGroup:     z.enum(["dell", "nonDell", "custom"]).optional()
}).strict();

// close-gap payload
const CloseGapPayloadSchema = z.object({
  gapId:           z.string().min(1),
  status:          z.literal("closed"),
  closeReason:     z.string().optional()
}).strict();

// Discriminated union on `kind` · enforces per-kind payload shape.
// Each branch carries the shared fields (confidence + rationale + source +
// optional targetState).
export const ActionProposalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind:        z.literal("add-driver"),
    payload:     AddDriverPayloadSchema,
    confidence:  z.enum(["HIGH", "MEDIUM", "LOW"]),
    rationale:   z.string().min(1),
    source:      z.enum(["discovery-note", "ai-proposal"]),
    targetState: z.enum(["current", "desired"]).optional()
  }).strict(),
  z.object({
    kind:        z.literal("add-instance-current"),
    payload:     AddInstanceCurrentPayloadSchema,
    confidence:  z.enum(["HIGH", "MEDIUM", "LOW"]),
    rationale:   z.string().min(1),
    source:      z.enum(["discovery-note", "ai-proposal"]),
    targetState: z.enum(["current", "desired"]).optional()
  }).strict(),
  z.object({
    kind:        z.literal("add-instance-desired"),
    payload:     AddInstanceDesiredPayloadSchema,
    confidence:  z.enum(["HIGH", "MEDIUM", "LOW"]),
    rationale:   z.string().min(1),
    source:      z.enum(["discovery-note", "ai-proposal"]),
    targetState: z.enum(["current", "desired"]).optional()
  }).strict(),
  z.object({
    kind:        z.literal("close-gap"),
    payload:     CloseGapPayloadSchema,
    confidence:  z.enum(["HIGH", "MEDIUM", "LOW"]),
    rationale:   z.string().min(1),
    source:      z.enum(["discovery-note", "ai-proposal"]),
    targetState: z.enum(["current", "desired"]).optional()
  }).strict()
]);

// Array schema for the envelope's `proposedActions[]` field. chatService.js
// validates each proposal with ActionProposalSchema as it builds the array;
// this export lets consumers validate the whole list at once.
export const ActionProposalListSchema = z.array(ActionProposalSchema);

// Schema version stamp. Bumps when any field or enum changes.
export const ACTION_PROPOSAL_SCHEMA_VERSION = "1.0.0";

// Returns the canonical kind list for chatTools.js to drop into the tool's
// JSON-Schema enum, keeping that schema hand-written but the kind list
// canonical here.
export function getActionKindsEnum() {
  return ACTION_KINDS.slice(); // defensive copy
}
