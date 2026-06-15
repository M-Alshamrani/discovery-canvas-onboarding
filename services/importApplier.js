// services/importApplier.js
//
// The shared applier. All ingress paths (Skills Builder file-ingest,
// the Dell-internal-LLM instructions workflow, and the Workshop Notes
// overlay) call into this module after parseImportResponse and
// checkImportDrift have cleared the wire payload.
//
// Kind-aware dispatch: the applier reads each items[].kind and routes:
//   "instance.add" → addInstance (1 or 2 records, per scope)
//   "driver.add"   → addDriver (apply-scope ignored; drivers have no state)
//   "gap.close"    → updateGap with status "closed" and closeReason
//                    appended to notes
//
// The apply-scope picker is authoritative only for instance.add:
//   scope="current" creates one current instance per item
//   scope="desired" creates one desired instance per item
//   scope="both"    creates two independent records (one current, one
//                   desired) with no originId linkage between them
//
// Every created or mutated entity is stamped with a provenance envelope
// (aiTag), whose kind reflects the ingress path (skill, external-llm,
// discovery-note, or ai-proposal).

import { addInstance }   from "../state/collections/instanceActions.js";
import { addDriver }     from "../state/collections/driverActions.js";
import { updateGap }     from "../state/collections/gapActions.js";

// Build an aiTag envelope from the caller's provenance hint. Returns
// null if no provenance was supplied (an untagged import is permitted
// but rare). The kind defaults to "external-llm" when not specified.
function buildAiTag(provenance) {
  if (!provenance || typeof provenance !== "object") return null;
  const tag = {
    kind:      provenance.kind || "external-llm",
    runId:     provenance.runId,
    mutatedAt: provenance.mutatedAt
  };
  if (provenance.source)  tag.source  = provenance.source;
  if (provenance.skillId) tag.skillId = provenance.skillId;
  return tag;
}

// Disposition default per state. Wire format does not carry disposition;
// applier injects the canonical one for the target state.
function defaultDispositionFor(state) {
  return state === "current" ? "keep" : "introduce";
}

// Build the addInstance input from an item.data + a target state.
// Adds aiTag from the buildAiTag(provenance) envelope.
function buildInstanceInput(itemData, state, provenance) {
  return {
    state:                  state,
    layerId:                itemData.layerId,
    environmentId:          itemData.environmentId,
    label:                  itemData.label,
    vendor:                 itemData.vendor,
    vendorGroup:            itemData.vendorGroup,
    criticality:            itemData.criticality,
    notes:                  itemData.notes || "",
    disposition:            defaultDispositionFor(state),
    // No linkage between the current and desired records created from
    // the same item, regardless of scope.
    originId:               null,
    // Priority is set by the engineer after import, not by the LLM.
    priority:               null,
    // Workload-asset mappings are out of scope here.
    mappedAssetIds:         [],
    aiSuggestedDellMapping: null,
    aiTag:                  buildAiTag(provenance)
  };
}

// Build the addDriver input from a driver.add item. Mirrors the
// buildInstanceInput shape but for drivers.
function buildDriverInput(itemData, provenance) {
  return {
    businessDriverId: itemData.businessDriverId,
    catalogVersion:   "2026.05",                  // A20 default · refresh per release
    priority:         itemData.priority || "Medium",
    outcomes:         itemData.outcomes || "",
    aiTag:            buildAiTag(provenance)
  };
}

// applyImportItems(engagement, items, opts)
//   opts.scope       - "current" | "desired" | "both". Authoritative
//                      only for instance.add items; driver.add and
//                      gap.close ignore the scope picker (drivers have
//                      no state, and close-gap mutates an existing gap).
//   opts.provenance  - { kind, source?, skillId?, runId, mutatedAt }.
//                      kind defaults to "external-llm".
// Returns: { engagement, addedInstanceIds, addedDriverIds, closedGapIds, errors? }
//   - engagement       - the new engagement with all imported entities
//                        committed (or the original engagement if every
//                        item errored at the per-action layer)
//   - addedInstanceIds - flat array of newly-created instance IDs in
//                        commit order. For scope="both" each instance.add
//                        item yields two IDs.
//   - addedDriverIds   - flat array of newly-created driver IDs
//   - closedGapIds     - flat array of gap IDs whose status was set to
//                        "closed" via gap.close items
//   - errors           - non-null only if any item failed; each entry
//                        carries { itemIndex, kind, state?, errors[] }
export function applyImportItems(engagement, items, opts) {
  const scope      = (opts && opts.scope)      || "desired";
  const provenance = (opts && opts.provenance) || null;

  let eng = engagement;
  const addedInstanceIds = [];
  const addedDriverIds   = [];                          // A20
  const closedGapIds     = [];                          // A20
  const errors           = [];

  // Inner: add one instance for a specific state, accumulate result.
  function addInstanceOne(item, state, itemIndex) {
    const input = buildInstanceInput(item.data, state, provenance);
    const res   = addInstance(eng, input);
    if (res.ok) {
      eng = res.engagement;
      const ids = eng.instances.allIds;
      addedInstanceIds.push(ids[ids.length - 1]);
    } else {
      errors.push({ itemIndex: itemIndex, kind: "instance.add", state: state, errors: res.errors || [] });
    }
  }

  // Add one driver from a driver.add item.
  function addDriverOne(item, itemIndex) {
    const input = buildDriverInput(item.data, provenance);
    const res   = addDriver(eng, input);
    if (res.ok) {
      eng = res.engagement;
      const ids = eng.drivers.allIds;
      addedDriverIds.push(ids[ids.length - 1]);
    } else {
      errors.push({ itemIndex: itemIndex, kind: "driver.add", errors: res.errors || [] });
    }
  }

  // Close one gap from a gap.close item. Sets the existing gap's status
  // to "closed", appends closeReason to its notes, and stamps aiTag on
  // the mutated gap.
  function closeGapOne(item, itemIndex) {
    const gapId = item.data && item.data.gapId;
    const existing = eng.gaps && eng.gaps.byId && eng.gaps.byId[gapId];
    if (!existing) {
      errors.push({ itemIndex: itemIndex, kind: "gap.close", errors: [{ path: "gapId", message: "Gap not found at apply time (drift between drift-check and apply?)", code: "not_found" }] });
      return;
    }
    const closeReason = (item.data && item.data.closeReason) || "";
    // Append closeReason to notes (engineer-readable trail). Preserve
    // existing notes; add a newline + "Closed: <reason>" suffix.
    const trailedNotes = (existing.notes && existing.notes.length > 0)
      ? existing.notes + "\nClosed: " + closeReason
      : (closeReason.length > 0 ? "Closed: " + closeReason : "");
    const patch = {
      status: "closed",
      notes:  trailedNotes,
      aiTag:  buildAiTag(provenance)
    };
    const res = updateGap(eng, gapId, patch);
    if (res.ok) {
      eng = res.engagement;
      closedGapIds.push(gapId);
    } else {
      errors.push({ itemIndex: itemIndex, kind: "gap.close", errors: res.errors || [] });
    }
  }

  const list = Array.isArray(items) ? items : [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!item || !item.data) continue;

    // Kind-aware dispatch. A direct applier caller that bypasses
    // parseImportResponse may pass items without a `kind`; default those
    // to "instance.add" (the drift-check uses the same default).
    const kind = item.kind || "instance.add";
    switch (kind) {
      case "instance.add":
        if (scope === "both") {
          addInstanceOne(item, "current", i);
          addInstanceOne(item, "desired", i);
        } else {
          addInstanceOne(item, scope, i);
        }
        break;
      case "driver.add":
        addDriverOne(item, i);
        break;
      case "gap.close":
        closeGapOne(item, i);
        break;
      default:
        errors.push({ itemIndex: i, kind: kind || "(missing)", errors: [{ path: "kind", message: "Unknown item kind · expected instance.add | driver.add | gap.close", code: "unknown_kind" }] });
    }
  }

  return {
    engagement:       eng,
    addedInstanceIds: addedInstanceIds,
    addedDriverIds:   addedDriverIds,
    closedGapIds:     closedGapIds,
    errors:           errors.length > 0 ? errors : null
  };
}
