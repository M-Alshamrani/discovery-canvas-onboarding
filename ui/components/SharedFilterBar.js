// ui/components/SharedFilterBar.js
//
// Single helper that mounts the FilterBar with the canonical dimension
// list + toggles + "+ Add gap" trailing slot used across:
//   * Tab 4 GapsEditView
//   * Tab 5 sub-tabs (Overview / Heatmap / Gaps board / Vendor mix /
//     Roadmap)
//
// Using the same vocabulary everywhere keeps the user's mental model
// consistent.

import {
  LAYERS, getEnvLabel, getVisibleEnvironments
} from "../../core/config.js";
import { SERVICE_TYPES } from "../../core/services.js";
import { renderFilterBar } from "./FilterBar.js";

// Mount the shared FilterBar inside `host`. opts:
//   session   the current session
//   scope     optional Element where filterable cards live (defaults to host)
//   trailing  optional Element appended to the right of the toggle pill
export function mountSharedFilterBar(host, opts) {
  if (!host) return null;
  opts = opts || {};
  var session = opts.session || {};
  var scope   = opts.scope   || host;

  var visibleEnvs = (typeof getVisibleEnvironments === "function")
    ? getVisibleEnvironments(session)
    : [];

  var closedCount = (session.gaps || []).filter(function(g) {
    return g && g.status === "closed";
  }).length;

  return renderFilterBar(host, {
    dimensions: [
      { id: "services", label: "Service",
        options: SERVICE_TYPES.map(function(s) {
          return { id: s.id, label: s.label.split(" / ")[0] };
        }) },
      { id: "layer", label: "Layer",
        options: LAYERS.map(function(l) { return { id: l.id, label: l.label }; }) },
      { id: "environment", label: "Environment",
        options: visibleEnvs.map(function(e) {
          return { id: e.id, label: getEnvLabel(e.id, session) };
        }) },
      { id: "gapType", label: "Gap type",
        options: [
          { id: "replace",     label: "Replace" },
          { id: "enhance",     label: "Enhance" },
          { id: "ops",         label: "Operational / services" },
          { id: "newCap",      label: "New capability" },
          { id: "consolidate", label: "Consolidate" }
        ] },
      { id: "urgency", label: "Urgency",
        options: [
          { id: "High",   label: "High"   },
          { id: "Medium", label: "Medium" },
          { id: "Low",    label: "Low"    }
        ] }
    ],
    toggles: [
      { key: "needsReviewOnly", label: "Needs review only",
        hint: "Show only gaps that still need approval or review." },
      { key: "showClosedGaps",
        label: "Show closed gaps" + (closedCount > 0 ? " (" + closedCount + ")" : ""),
        hint: "Closed gaps are hidden by default. Tick to see + recover them." }
    ],
    session: session,
    scope:   scope,
    trailing: opts.trailing || null
  });
}
