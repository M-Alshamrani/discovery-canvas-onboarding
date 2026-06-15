// schema/helpers/aiTag.js
//
// Shared AiTagSchema — the single source of truth for the AI-mutation
// provenance envelope. Living in a helper lets the instance, driver, and
// gap entities share one shape without duplicated Zod declarations.
//
// kind enum:
//   "skill"          · Skills Builder skill-mutation run
//   "external-llm"   · file-upload import
//   "discovery-note" · Workshop Notes overlay; stamped by importApplier
//                       when source = "workshop-notes-overlay"
//   "ai-proposal"    · chat-inline emission (reserved · forward compat)
//
// Consumers: schema/instance.js (re-exports this schema), schema/driver.js
// and schema/gap.js (add an optional aiTag field via the helper),
// services/importApplier.js (stamps kind = "discovery-note"), and
// ui/views/MatrixView.js (renders a per-kind tile chip).

import { z } from "zod";

// The four aiTag kinds.
export const AI_TAG_KINDS = [
  "skill",
  "external-llm",
  "discovery-note",
  "ai-proposal"
];

export const AiTagSchema = z.object({
  kind:      z.enum(AI_TAG_KINDS).default("skill"),
  skillId:   z.string().optional(),   // present when kind="skill"
  source:    z.string().optional(),   // present when kind="external-llm" | "discovery-note" | "ai-proposal"
  runId:     z.string().min(1),
  mutatedAt: z.string().min(1)        // ISO instant
});

// Nullable + default(null) form for use in entity schemas. Entities
// without an aiTag parse to aiTag: null.
export const AiTagFieldSchema = AiTagSchema.nullable().default(null);
