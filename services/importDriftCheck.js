// services/importDriftCheck.js
//
// Strict drift detection for file-driven imports. The instructions file
// embeds the live engagement's environment UUIDs at generation time and
// tells the LLM to reference those UUIDs exactly. If the engineer adds
// or removes environments between generating the instructions and
// importing, the imported JSON will reference UUIDs that are no longer
// in the engagement.
//
// Strict reject, no partial apply:
//   - every items[].data.environmentId must be present in
//     engagement.environments.allIds
//   - if any referenced UUID is missing, the entire import is rejected
//   - no partial apply, no fuzzy remap, no UUID coercion
//
// The user-facing error message is the caller's responsibility (the
// preview modal renders a one-line banner). This module returns only
// the structural result so the caller can compose its UX.
//
// kind-aware drift checking:
//   - "instance.add" → environment UUID membership
//   - "driver.add"   → businessDriverId catalog membership (static
//                      catalog; no live-engagement check)
//   - "gap.close"    → gapId membership against live engagement gaps
//
// Duplicate-detection rows are also computed here but are not treated as
// drift failures; they are surfaced to the modal as per-row indicators
// for the engineer to apply or deselect.
//
// checkImportDrift(parsedResponse, engagement) -> { ok, missingEnvIds, ... }
//   - ok=true  · missingEnvIds is [] · safe to proceed to the applier
//   - ok=false · missingEnvIds is the deduplicated list of UUIDs the
//                response references that are not in the live engagement
//
// Both arguments are validated defensively: a missing `items` array or
// missing `environments.allIds` is treated as "no items / no live
// environments" rather than throwing. The caller is expected to have
// already passed the response through parseImportResponse.
import { BUSINESS_DRIVERS } from "../core/config.js";
export function checkImportDrift(parsedResponse, engagement) {
  const liveEnvIds = new Set(
    (engagement && engagement.environments && Array.isArray(engagement.environments.allIds))
      ? engagement.environments.allIds
      : []
  );
  const liveGapIds = new Set(
    (engagement && engagement.gaps && Array.isArray(engagement.gaps.allIds))
      ? engagement.gaps.allIds
      : []
  );
  // BUSINESS_DRIVERS catalog membership · use the id field of each entry.
  const validDriverCatalogIds = new Set(
    (Array.isArray(BUSINESS_DRIVERS) ? BUSINESS_DRIVERS : []).map(d => d && d.id).filter(Boolean)
  );
  // Existing engagement entities for duplicate detection.
  const existingDriverCatalogIds = new Set();
  if (engagement && engagement.drivers && Array.isArray(engagement.drivers.allIds)) {
    engagement.drivers.allIds.forEach(id => {
      const d = engagement.drivers.byId[id];
      if (d && d.businessDriverId) existingDriverCatalogIds.add(d.businessDriverId);
    });
  }
  // Per-instance dedup key: (layerId, environmentId, label).
  const existingInstanceKeys = new Set();
  if (engagement && engagement.instances && Array.isArray(engagement.instances.allIds)) {
    engagement.instances.allIds.forEach(id => {
      const inst = engagement.instances.byId[id];
      if (inst) existingInstanceKeys.add(inst.layerId + "|" + inst.environmentId + "|" + inst.label);
    });
  }

  const items = (parsedResponse && Array.isArray(parsedResponse.items))
    ? parsedResponse.items
    : [];

  const missingEnvIds         = [];
  const missingGapIds         = [];
  const invalidBusinessDriverIds = [];
  const duplicates            = [];                // per-row duplicate flags · A20 Q4 lock
  const seenEnv = new Set();
  const seenGap = new Set();
  const seenDriverInvalid = new Set();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || typeof item !== "object") continue;
    // Some file-upload payloads have no per-item `kind` field. Default a
    // missing kind to "instance.add"; payloads from the Workshop Notes
    // overlay emit an explicit kind.
    const kind = item.kind || "instance.add";
    // Kind-aware switch. The parser upstream is the real gatekeeper, but
    // the default case is defensive so this code fails visibly on an
    // unknown kind.
    switch (kind) {
      case "instance.add": {
        const envId = item.data && item.data.environmentId;
        if (typeof envId === "string" && envId.length > 0 && !liveEnvIds.has(envId) && !seenEnv.has(envId)) {
          seenEnv.add(envId);
          missingEnvIds.push(envId);
        }
        const dupKey = (item.data ? item.data.layerId : "") + "|" + (item.data ? item.data.environmentId : "") + "|" + (item.data ? item.data.label : "");
        if (existingInstanceKeys.has(dupKey)) {
          duplicates.push({ itemIndex: i, kind: "instance.add", reason: "already in engagement (same layer + environment + label)" });
        }
        break;
      }
      case "driver.add": {
        const bdId = item.data && item.data.businessDriverId;
        if (typeof bdId === "string" && bdId.length > 0 && validDriverCatalogIds.size > 0 && !validDriverCatalogIds.has(bdId) && !seenDriverInvalid.has(bdId)) {
          seenDriverInvalid.add(bdId);
          invalidBusinessDriverIds.push(bdId);
        }
        if (typeof bdId === "string" && existingDriverCatalogIds.has(bdId)) {
          duplicates.push({ itemIndex: i, kind: "driver.add", reason: "driver already in engagement (businessDriverId match)" });
        }
        break;
      }
      case "gap.close": {
        const gapId = item.data && item.data.gapId;
        if (typeof gapId === "string" && gapId.length > 0 && !liveGapIds.has(gapId) && !seenGap.has(gapId)) {
          seenGap.add(gapId);
          missingGapIds.push(gapId);
        }
        // close-gap targeting an EXISTING gap is the EXPECTED state ·
        // not a duplicate · drift only flags missing gapIds.
        break;
      }
      default:
        // Unknown kind · should never reach here if parser validated
        // upstream · but be defensive · flag in console.
        console.warn("[importDriftCheck] unknown item kind at index " + i + ": " + (item.kind || "(missing)"));
    }
  }

  return {
    ok:                       missingEnvIds.length === 0 && missingGapIds.length === 0 && invalidBusinessDriverIds.length === 0,
    missingEnvIds:            missingEnvIds,
    missingGapIds:            missingGapIds,
    invalidBusinessDriverIds: invalidBusinessDriverIds,
    duplicates:               duplicates              // not blocking · engineer-override per A20 Q4
  };
}
