// services/importKickoffPrompt.js
//
// Builds the short, context-aware "first prompt" snippet the engineer
// copies as the very first message to their Dell internal LLM session,
// before pasting the full LLM Instructions Prompt (built by
// importInstructionsBuilder.js).
//
// The full instructions file is long, and when the engineer pastes it
// cold the LLM can rush straight to "extract and emit JSON", skipping
// the Phase A / B / C walkthrough. The kickoff snippet is a dense
// priming message that (a) names the customer and environment count so
// the LLM has immediate context, (b) tells the LLM that an instructions
// file and a source file will follow, (c) commands the LLM to follow
// Phase A / B / C explicitly, and (d) forbids emitting final JSON before
// the engineer confirms the mapping table.
//
// Contract:
//   - buildKickoffPrompt(engagement) -> { content: <non-empty string> }
//   - content embeds the customer name and environment count
//   - content names Phase A, Phase B, and Phase C
//   - content forbids emitting JSON before approval
//   - content tells the engineer to upload the source file into the LLM
//     chat, not into the canvas
//   - target length is about 200 words (soft target)

// buildKickoffPrompt(engagement) -> { content }
//   engagement: live engagement object (passed from the import modal)
//
// The snippet is plain text (no markdown fences) so the engineer can
// paste it into any chat surface (web LLM, mobile, terminal) without
// formatting damage.
export function buildKickoffPrompt(engagement) {
  const customer    = (engagement && engagement.customer) || {};
  const customerName = (typeof customer.name === "string" && customer.name.trim()) || "this customer";
  const envIds      = (engagement && engagement.environments && Array.isArray(engagement.environments.allIds))
                        ? engagement.environments.allIds
                        : [];
  const envCount    = envIds.length;
  const envWord     = envCount === 1 ? "environment" : "environments";

  // The kickoff prompt body. Plain text, no markdown fences. Each
  // paragraph is one focused idea so the LLM cannot conflate them.
  const lines = [
    "You are about to help me extract technology install-base data for the customer **" + customerName + "** into Dell Discovery Canvas. The customer has " + envCount + " " + envWord + " in scope.",
    "",
    "TWO INPUTS will follow this message:",
    "  1. An LLM Instructions Prompt (.txt) describing exactly how to map extracted rows to the canvas schema, including the customer's environment UUIDs.",
    "  2. A source file (CSV / XLSX / PDF / TXT) I will UPLOAD INTO THIS CHAT — this is the customer's install-base / product list / BOM. Upload the source file INTO YOUR LLM CHAT, not into the Canvas app; the Canvas app only consumes your final JSON in a later step.",
    "",
    "FOLLOW THE THREE PHASES STRICTLY:",
    "  • Phase A · Extract — read the source file silently. Identify discrete technology instances. Do not show me anything yet.",
    "  • Phase B · Confirm with engineer — present a mapping table (markdown, or CSV if you cannot render rich tables, or fixed-width plaintext as a last resort) showing every extracted row with proposed canvas mapping. STOP and ask me to approve. I may also ask you to normalize labels or correct individual rows. Iterate until I say 'looks good' or 'approved' or 'ship it'.",
    "  • Phase C · Emit final JSON — ONLY after I approve, output the JSON object matching the schema in the instructions file. No prose, no fences, no commentary around the JSON.",
    "",
    "DO NOT emit final JSON before I have approved the mapping table in Phase B. Wait for my explicit go-ahead.",
    "",
    "Reply with 'Ready — paste the instructions file and upload the source file.' when you understand these rules."
  ];

  return { content: lines.join("\n") };
}
