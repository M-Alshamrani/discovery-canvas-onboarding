// core/models.js -- shape validation for instances and gaps.
// Relationship rules are warned about in the UI, not blocked here.

import { LAYERS, ENVIRONMENTS } from "./config.js";
import { GAP_TYPES } from "./taxonomy.js";
import { SERVICE_IDS } from "./services.js";

export const LayerIds       = LAYERS.map(function(l) { return l.id; });
export const EnvironmentIds = ENVIRONMENTS.map(function(e) { return e.id; });

var VALID_STATES    = ["current", "desired"];
var VALID_PHASES    = ["now", "next", "later"];
var VALID_URGENCY   = ["High", "Medium", "Low"];
// Valid gap types are derived from core/taxonomy.js.
var VALID_GAP_TYPES = GAP_TYPES;
var VALID_VG        = ["dell", "nonDell", "custom"];
var VALID_STATUS    = ["open", "in_progress", "closed", "deferred"];

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "Validation failed");
}

export function validateInstance(inst) {
  assert(inst && typeof inst === "object",                                  "Instance must be an object");
  assert(typeof inst.id === "string" && inst.id.trim().length > 0,         "Instance.id must be a non-empty string");
  assert(VALID_STATES.includes(inst.state),                                "Instance.state must be 'current' or 'desired'");
  assert(LayerIds.includes(inst.layerId),                                  "Instance.layerId '" + inst.layerId + "' is not a valid layer");
  assert(EnvironmentIds.includes(inst.environmentId),                      "Instance.environmentId '" + inst.environmentId + "' is not a valid environment");
  assert(typeof inst.label === "string" && inst.label.trim().length > 0,   "Instance.label must be a non-empty string");
  if (inst.vendorGroup !== undefined) {
    assert(VALID_VG.includes(inst.vendorGroup),                            "Instance.vendorGroup must be dell, nonDell, or custom");
  }
  // `mappedAssetIds` is a workload-only array of instance ids that the
  // workload runs on. Restricted to the workload layer so a non-workload
  // tile can never carry it.
  if (inst.mappedAssetIds !== undefined) {
    assert(Array.isArray(inst.mappedAssetIds),                             "Instance.mappedAssetIds must be an array of instance ids");
    assert(inst.layerId === "workload",                                    "Instance.mappedAssetIds is only valid on workload-layer instances");
    inst.mappedAssetIds.forEach(function(id) {
      assert(typeof id === "string" && id.trim().length > 0,               "Instance.mappedAssetIds entries must be non-empty strings");
    });
  }
  // originId and disposition are optional free-form fields -- no validation needed.
}

export function validateGap(gap) {
  assert(gap && typeof gap === "object",                                            "Gap must be an object");
  assert(typeof gap.id === "string" && gap.id.trim().length > 0,                   "Gap.id must be a non-empty string");
  assert(typeof gap.description === "string" && gap.description.trim().length > 0, "Gap description must not be empty");
  assert(LayerIds.includes(gap.layerId),                                           "Gap.layerId '" + gap.layerId + "' is not a valid layer");

  if (Array.isArray(gap.affectedLayers)) {
    gap.affectedLayers.forEach(function(l) {
      assert(LayerIds.includes(l), "Gap.affectedLayers contains invalid layer: '" + l + "'");
    });
    // Primary-layer invariant: if affectedLayers is non-empty, index 0
    // MUST equal gap.layerId. The primary layer is conceptually distinct
    // from the "also affected" layers, and the position-0 convention makes
    // that explicit without adding a new field. Empty arrays are tolerated.
    if (gap.affectedLayers.length > 0) {
      assert(gap.affectedLayers[0] === gap.layerId,
        "Gap.affectedLayers[0] must equal Gap.layerId (primary-layer invariant, v2.4.9+) — " +
        "got layerId='" + gap.layerId + "' but affectedLayers[0]='" + gap.affectedLayers[0] + "'");
    }
  }
  if (Array.isArray(gap.affectedEnvironments)) {
    gap.affectedEnvironments.forEach(function(e) {
      assert(EnvironmentIds.includes(e), "Gap.affectedEnvironments contains invalid environment: '" + e + "'");
    });
  }

  var urgency = gap.urgency || "Medium";
  var phase   = gap.phase   || "now";
  assert(VALID_URGENCY.includes(urgency), "Gap.urgency must be High, Medium, or Low");
  assert(VALID_PHASES.includes(phase),    "Gap.phase must be now, next, or later");

  if (gap.gapType) {
    assert(VALID_GAP_TYPES.includes(gap.gapType),
      "Gap.gapType must be one of: " + VALID_GAP_TYPES.join(", "));
  }
  if (gap.status) {
    assert(VALID_STATUS.includes(gap.status),
      "Gap.status must be one of: " + VALID_STATUS.join(", "));
  }

  // urgencyOverride is a user-set flag that pins gap.urgency against the
  // propagation rules. Optional; must be a boolean if present.
  if (gap.urgencyOverride !== undefined) {
    assert(typeof gap.urgencyOverride === "boolean",
      "Gap.urgencyOverride must be a boolean if set (got " + typeof gap.urgencyOverride + ")");
  }

  // gap.services is an optional multi-select of professional-services
  // engagement-shape categories. If present, must be an array of strings,
  // each a valid id from core/services.js SERVICE_IDS. Empty array is
  // valid; undefined/missing is valid (services are opt-in per gap).
  if (gap.services !== undefined) {
    assert(Array.isArray(gap.services),
      "Gap.services must be an array if set (got " + typeof gap.services + ")");
    gap.services.forEach(function(id) {
      assert(typeof id === "string" && id.length > 0,
        "Gap.services entries must be non-empty strings (got " + typeof id + ")");
      assert(SERVICE_IDS.indexOf(id) >= 0,
        "Gap.services contains unknown id '" + id + "' — must be one of: " + SERVICE_IDS.join(", "));
    });
  }

  // Relationship rules (relatedCurrentInstanceIds, relatedDesiredInstanceIds)
  // are intentionally NOT validated here. They are soft constraints shown as
  // UI warnings, not hard blocks, so the user is never blocked from saving.
}
