// services/uuidScrubber.js
//
// Runtime scrub for three classes of internal-id leakage in the LLM's
// prose. The system prompt already instructs the model to cite
// user-facing labels rather than ids; this is the safety net for when
// it slips up.
//   1. UUIDs — bare 36-char UUIDs that should be replaced with the
//      entity's user-facing label.
//   2. workflow / concept IDs — `workflow.<id>` and `concept.<id>`
//      tokens from the manifest dictionaries, replaced with the
//      manifest's user-facing label.
//   3. selector / analytical-view function names + the '*[calls X]*'
//      cue — e.g. `selectVendorMix` printed in prose ("per
//      selectVendorMix, there are 6…"). Stripped so a reader never
//      sees an internal function name.
//
// Behavior:
//   - UUIDs: match the 36-char shape (8-4-4-4-12 hex), case-insensitive,
//     and look up in the engagement-derived labelMap (buildLabelMap).
//     Found → replace with the entity label. Orphan → `[unknown
//     reference]`.
//   - workflow.<id> / concept.<id>: match the dotted-token shape and
//     look up in the manifest-derived labelMap (buildManifestLabelMap).
//     Found → replace with the workflow's `name` or concept's `label`,
//     wrapped in markdown bold. Orphan → `[unknown workflow]` or
//     `[unknown concept]`.
//   - Skips fenced code blocks (```...```) and inline code (`...`): the
//     LLM may legitimately quote JSON or code containing these
//     identifiers, and scrubbing inside code would corrupt the example.
//
// Idempotent (substituted labels carry no UUID / dotted-id shape on a
// re-pass) and cheap (O(n) over text length), so it is safe to apply at
// every token.

import { WORKFLOWS } from "../core/appManifest.js";
import { CONCEPTS }  from "../core/conceptManifest.js";
// v3 driver records have the shape { id: <uuid>, businessDriverId,
// priority, outcomes } with no `label` field; the human label lives in
// the BUSINESS_DRIVERS catalog keyed by businessDriverId. Resolving
// through the catalog lets the scrubber swap a driver UUID for its real
// label rather than mapping the UUID to itself.
import { BUSINESS_DRIVERS } from "../core/config.js";

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

// workflow.<id> / concept.<id> dotted-token shape. Matches "workflow."
// or "concept." followed by [a-z0-9_.] (dots are allowed because concept
// IDs are themselves dotted, e.g. "concept.gap_type.replace").
// Word-boundary anchored so "iworkflow.x" doesn't match. Trailing
// sentence punctuation is excluded by requiring the last captured char
// to be alphanumeric or underscore.
const WORKFLOW_CONCEPT_RE = /\b(workflow|concept)\.[a-z0-9_]+(?:\.[a-z0-9_]+)*\b/gi;

// buildLabelMap(engagement) — returns { [uuid]: label } map covering
// every UUID-keyed entity reachable from the engagement. Labels are
// chosen by entity-type priority:
//   gap:         description (truncated to 60 chars at first sentence/comma)
//   driver:      label OR id (driver objects often carry both)
//   environment: alias OR envCatalogId (alias is the user-facing name)
//   instance:    label OR roleHint OR vendor + " instance"
// Returns an empty map if engagement is null/missing collections.
export function buildLabelMap(engagement) {
  const map = {};
  if (!engagement || typeof engagement !== "object") return map;

  // Gaps — description is the user-facing name; truncate so substituted
  // text stays readable.
  if (engagement.gaps && engagement.gaps.byId) {
    for (const [id, gap] of Object.entries(engagement.gaps.byId)) {
      const desc = gap && (gap.description || gap.label);
      if (typeof desc === "string" && desc.length > 0) {
        map[id] = truncateLabel(desc);
      }
    }
  }
  // Drivers — v3 stores driver records as { id: <uuid>, businessDriverId,
  // priority, outcomes }; the human label lives in the BUSINESS_DRIVERS
  // catalog keyed by businessDriverId. Resolve through the catalog so
  // the scrubber can swap a driver UUID for e.g. "Cyber Resilience" in
  // the LLM's prose.
  if (engagement.drivers && engagement.drivers.byId) {
    for (const [id, drv] of Object.entries(engagement.drivers.byId)) {
      if (!drv) continue;
      let lbl = drv.label;   // legacy + future-proof for label-bearing v3 records
      if (!lbl && drv.businessDriverId) {
        const meta = BUSINESS_DRIVERS.find(function(b) { return b.id === drv.businessDriverId; });
        if (meta && typeof meta.label === "string" && meta.label.length > 0) lbl = meta.label;
      }
      if (!lbl) lbl = drv.businessDriverId;   // last-resort typeId (still readable, not a UUID)
      if (typeof lbl === "string" && lbl.length > 0) {
        map[id] = lbl;
      }
    }
  }
  // Environments — alias is the user-facing name; envCatalogId is the
  // catalog key (e.g. "coreDc"). Prefer alias.
  if (engagement.environments && engagement.environments.byId) {
    for (const [id, env] of Object.entries(engagement.environments.byId)) {
      const lbl = env && (env.alias || env.envCatalogId);
      if (typeof lbl === "string" && lbl.length > 0) {
        map[id] = lbl;
      }
    }
  }
  // Instances — label OR roleHint OR vendor.
  if (engagement.instances && engagement.instances.byId) {
    for (const [id, inst] of Object.entries(engagement.instances.byId)) {
      const lbl = inst && (inst.label || inst.roleHint ||
        (inst.vendor ? inst.vendor + " instance" : null));
      if (typeof lbl === "string" && lbl.length > 0) {
        map[id] = lbl;
      }
    }
  }
  return map;
}

// scrubUuidsInProse(text, labelMap) — returns text with bare UUIDs
// replaced by their resolved labels (or `[unknown reference]` for
// orphan UUIDs). Skips fenced code blocks (```...```) and inline code
// (`...`) so legitimate JSON examples in the AI's response stay intact.
export function scrubUuidsInProse(text, labelMap) {
  if (typeof text !== "string" || text.length === 0) return text;
  const map = labelMap || {};

  // Split into segments: code-block / inline-code / plain. Code regions
  // pass through unchanged; plain regions are scrubbed.
  // Order matters: match fenced code blocks first (greedy), then inline
  // code, then plain text.
  const SEGMENT_RE = /(```[\s\S]*?```|`[^`\n]+`)/g;

  let out = "";
  let lastIdx = 0;
  let m;
  while ((m = SEGMENT_RE.exec(text)) !== null) {
    // Plain segment before this code segment — scrub it.
    out += scrubPlainSegment(text.slice(lastIdx, m.index), map);
    // Code segment — pass through.
    out += m[0];
    lastIdx = m.index + m[0].length;
  }
  // Tail plain segment.
  out += scrubPlainSegment(text.slice(lastIdx), map);
  return out;
}

function scrubPlainSegment(seg, labelMap) {
  if (seg.length === 0) return seg;
  // First pass: UUIDs.
  let out = seg.replace(UUID_RE, function(match) {
    const lower = match.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(labelMap, lower)) {
      return labelMap[lower];
    }
    // Also try the as-emitted casing (some models upper-case hex).
    if (Object.prototype.hasOwnProperty.call(labelMap, match)) {
      return labelMap[match];
    }
    return "[unknown reference]";
  });
  // Second pass: workflow.<id> / concept.<id>.
  out = out.replace(WORKFLOW_CONCEPT_RE, function(match, kind) {
    const lower = match.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(labelMap, lower)) {
      // Wrap the user-facing label in markdown bold.
      return "**" + labelMap[lower] + "**";
    }
    // Orphan sentinel per kind.
    return kind === "workflow" ? "[unknown workflow]" : "[unknown concept]";
  });
  // Third pass: leaked internal selector / analytical-view function names
  // and the '*[calls X]*' thinking-cue notation. The system prompt tells
  // the model to call these silently; this catches the cases where it
  // slips and prints the function name in prose (e.g. "Per selectVendorMix,
  // there are 6 Dell instances"). The selector-name shape is `select`
  // immediately followed by an uppercase letter, which effectively never
  // occurs in natural prose, so the match is precise. Code regions are
  // already excluded by the caller.
  out = scrubLeakedToolNames(out);
  return out;
}

// scrubLeakedToolNames(seg) — strip internal selector/tool names + the
// '*[calls X]*' cue from a plain (non-code) prose segment. Idempotent:
// after substitution no `select<Upper>` token or `*[calls …]*` remains.
function scrubLeakedToolNames(seg) {
  if (typeof seg !== "string" || seg.length === 0) return seg;
  let out = seg;
  // 1. Strip the '*[calls selectX(...)]*' / '*[calls X for Y: …]*' cue
  //    (the few-shot thinking notation a model may echo verbatim).
  out = out.replace(/\*\[\s*calls?\b[^\]]*\]\*\s*/gi, "");
  // 2. Strip a 'per/via/using/from/according to selectXxx' citation lead-in
  //    (with optional trailing colon/comma/dash) so the sentence reads as a
  //    direct statement: "Per selectVendorMix, there are 6" → "there are 6".
  out = out.replace(/\b(?:per|via|using|from|according to)\s+select[A-Z][A-Za-z0-9]*\b\s*[:,–—-]?\s*/g, "");
  // 3. Any remaining bare selectXxx function-name token → neutral phrase
  //    so an executive reader never sees the internal symbol.
  out = out.replace(/\bselect[A-Z][A-Za-z0-9]*\b/g, "the canvas data");
  return out;
}

// buildManifestLabelMap() returns a { "workflow.<id>": <name>,
// "concept.<id>": <label> } map covering every workflow + concept
// declared in the manifests. Callers merge this with the
// engagement-derived buildLabelMap output and pass the result as
// `labelMap` to scrubUuidsInProse.
//
// Workflow keys are already prefixed ("workflow.identify_gaps") in
// core/appManifest.js. Concept keys come without a "concept." prefix in
// core/conceptManifest.js (e.g. "gap_type.replace"), so the prefix is
// synthesized here to match what the scrub expects.
export function buildManifestLabelMap() {
  const map = {};
  // Workflows: id is "workflow.<name>"; expose .name as the label.
  if (Array.isArray(WORKFLOWS)) {
    for (const wf of WORKFLOWS) {
      if (wf && typeof wf.id === "string" && typeof wf.name === "string") {
        map[wf.id.toLowerCase()] = wf.name;
      }
    }
  }
  // Concepts: id is "<category>.<name>" (no "concept." prefix). Expose
  // both "concept.<full_id>" → label AND the bare "<full_id>" → label
  // so the scrubber catches either emission form. The scrub regex
  // requires the "workflow." or "concept." prefix, so only the
  // prefixed form actually fires; the bare-form key is harmless.
  if (Array.isArray(CONCEPTS)) {
    for (const c of CONCEPTS) {
      if (c && typeof c.id === "string" && typeof c.label === "string") {
        map["concept." + c.id.toLowerCase()] = c.label;
      }
    }
  }
  return map;
}

function truncateLabel(text) {
  const trimmed = text.trim();
  if (trimmed.length <= 60) return trimmed;
  // Prefer break at sentence/punctuation if one is in [40, 60].
  const cut = trimmed.slice(0, 60);
  const lastBreak = Math.max(
    cut.lastIndexOf(". "),
    cut.lastIndexOf(", "),
    cut.lastIndexOf(" — "),
    cut.lastIndexOf(" - ")
  );
  if (lastBreak >= 40) return trimmed.slice(0, lastBreak);
  return cut + "…";
}
