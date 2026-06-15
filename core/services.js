// core/services.js
//
// Catalog of professional-services "engagement shape" categories that can
// be attached to any gap as a multi-select facet. The chips appear on the
// gap detail panel, rolled up per project on the Roadmap, and rolled up
// across the session on the Reporting "Services scope" sub-tab.
//
// Services are NOT a separate gap type; they are a facet of any gap.
// SUGGESTED_SERVICES_BY_GAP_TYPE drives an opt-in "SUGGESTED" row above the
// chip selector: chips appear greyed but are not auto-selected. The user
// clicks to add, which is less surprising than auto-applying.

// The `domain` field colors a chip independently of its urgency level.
// Values: "cyber" (red), "ops" (green), "data" (amber), or null (neutral).
// Kept separate from the urgency color so the two visual roles don't collide.
export const SERVICE_TYPES = [
  { id: "assessment",         label: "Assessment / Health check",   hint: "Pre-engagement audit before the work starts",                       domain: null   },
  { id: "migration",          label: "Migration",                   hint: "Move data / workloads from current to desired platform",            domain: "data" },
  { id: "deployment",         label: "Deployment / Install",        hint: "Build out the desired-state system",                                domain: null   },
  { id: "integration",        label: "Integration",                 hint: "Connect to existing systems, APIs, identity, monitoring",           domain: "ops"  },
  { id: "training",           label: "Training",                    hint: "Skill the customer's ops team on the new platform",                 domain: null   },
  { id: "knowledge_transfer", label: "Knowledge transfer",          hint: "Hand-off documentation + walkthroughs",                             domain: null   },
  { id: "runbook",            label: "Runbook authoring",           hint: "Operational playbooks (DR, incident response, change-mgmt)",        domain: "ops"  },
  { id: "managed",            label: "Managed services",            hint: "Ongoing operational support contract",                              domain: "ops"  },
  { id: "decommissioning",    label: "Decommissioning",             hint: "Safe removal + data archive of retired systems",                    domain: "data" },
  { id: "custom_dev",         label: "Custom development",          hint: "Bespoke connectors, scripts, tooling",                              domain: null   }
];

// Look up a service's domain by id. Returns null if the id is unknown or
// the service has no domain mapping.
export function serviceDomain(id) {
  var hit = SERVICE_TYPES.find(function(s) { return s.id === id; });
  return hit ? (hit.domain || null) : null;
}

// Map of gapType to its suggested services. Suggestions are opt-in: the
// chips are offered under a "SUGGESTED" row but are never pre-selected.
// Keys correspond to the gap types in core/taxonomy.js. "keep" gaps have a
// null gapType and so get no suggestions.
export const SUGGESTED_SERVICES_BY_GAP_TYPE = {
  replace:     ["migration", "deployment"],
  consolidate: ["migration", "integration", "knowledge_transfer"],
  introduce:   ["deployment", "training"],
  enhance:     ["assessment"],
  ops:         ["runbook"]
};

// All valid service ids, used to reject or drop unknown ids.
export const SERVICE_IDS = SERVICE_TYPES.map(function(s) { return s.id; });

// Look up a service's display label by id. Returns null on miss.
export function serviceLabel(id) {
  var hit = SERVICE_TYPES.find(function(s) { return s.id === id; });
  return hit ? hit.label : null;
}

// Normalize a services array: drop duplicates, drop unknowns, preserve
// caller's first-occurrence ordering. Pure function.
export function normalizeServices(arr) {
  if (!Array.isArray(arr)) return [];
  var seen = {};
  var out = [];
  for (var i = 0; i < arr.length; i++) {
    var id = arr[i];
    if (typeof id !== "string") continue;
    if (SERVICE_IDS.indexOf(id) < 0) continue;   // drop unknowns silently
    if (seen[id]) continue;                       // dedupe
    seen[id] = true;
    out.push(id);
  }
  return out;
}

// Return the suggested chips for a gapType, minus chips the user has
// already selected. Used by the gap detail panel's "SUGGESTED" eyebrow.
export function suggestedFor(gapType, selected) {
  var sug = SUGGESTED_SERVICES_BY_GAP_TYPE[gapType] || [];
  var sel = Array.isArray(selected) ? selected : [];
  return sug.filter(function(id) { return sel.indexOf(id) < 0; });
}
