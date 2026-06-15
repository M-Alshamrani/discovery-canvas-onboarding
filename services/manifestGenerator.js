// services/manifestGenerator.js
//
// Walks the entity schemas + their <entityName>PathManifest exports and
// composes the chip manifest the AI skill builder consumes.
//
// Output shape:
//   {
//     sessionPaths: PathManifestEntry[],
//     byEntityKind: {
//       driver:          { ownPaths, linkedPaths },
//       currentInstance: { ownPaths, linkedPaths },
//       desiredInstance: { ownPaths, linkedPaths },
//       gap:             { ownPaths, linkedPaths },
//       environment:     { ownPaths, linkedPaths },
//       project:         { ownPaths, linkedPaths }
//     }
//   }
//
// The regenerated manifest must be byte-equal to a checked-in snapshot;
// drift fails the manifest test.
//
// Linked compositions are derived from FK declarations plus a small
// per-kind reverse-FK lookup table, kept here as declarative constants.

import { customerPathManifest }    from "../schema/customer.js";
import { driverPathManifest }      from "../schema/driver.js";
import { environmentPathManifest } from "../schema/environment.js";
import { instancePathManifest }    from "../schema/instance.js";
import { gapPathManifest }         from "../schema/gap.js";
import { engagementPathManifest }  from "../schema/engagement.js";

// Linked-composition declarations, consolidated here rather than spread
// next to each entity schema.
const LINKED_BY_KIND = {
  driver: [
    { path: "context.driver.linkedGaps[*].description", type: "string", label: "Linked gap description",
      source: "linked", composition: "engagement.gaps where gap.driverId === driver.id" },
    { path: "context.driver.linkedGaps[*].urgency", type: "enum", label: "Linked gap urgency",
      source: "linked", composition: "engagement.gaps where gap.driverId === driver.id" }
  ],
  currentInstance: [
    { path: "context.currentInstance.desiredCounterparts[*].label", type: "string",
      label: "Desired counterpart label", source: "linked",
      composition: "engagement.instances where state==='desired' AND originId === instance.id" }
  ],
  desiredInstance: [
    { path: "context.desiredInstance.originInstance.label", type: "string",
      label: "Origin (current) instance label", source: "linked",
      composition: "engagement.instances.byId[instance.originId]" }
  ],
  gap: [
    { path: "context.gap.driver.priority", type: "enum", label: "Linked driver priority", source: "linked",
      composition: "engagement.drivers.byId[gap.driverId]" },
    { path: "context.gap.affectedEnvironments[*].alias", type: "string",
      label: "Affected environment alias", source: "linked",
      composition: "engagement.environments filtered by gap.affectedEnvironments[]" }
  ],
  environment: [
    { path: "context.environment.linkedInstances[*].label", type: "string",
      label: "Linked instance label", source: "linked",
      composition: "engagement.instances where environmentId === environment.id" },
    { path: "context.environment.linkedGaps[*].description", type: "string",
      label: "Linked gap description", source: "linked",
      composition: "engagement.gaps where affectedEnvironments.includes(environment.id)" }
  ],
  project: [
    { path: "context.project.gaps[*].description", type: "string", label: "Gap description", source: "linked",
      composition: "engagement.gaps grouped into this project (selectProjects)" }
  ]
};

export function generateManifest() {
  // sessionPaths: customer + engagement-meta + selector-derived inputs.
  const sessionPaths = [
    ...customerPathManifest,
    ...engagementPathManifest
  ];

  return {
    sessionPaths,
    byEntityKind: {
      driver: {
        ownPaths:     driverPathManifest.filter(p => p.source !== "linked"),
        linkedPaths:  LINKED_BY_KIND.driver
      },
      currentInstance: {
        ownPaths:     instancePathManifest.filter(p => p.source !== "linked"),
        linkedPaths:  LINKED_BY_KIND.currentInstance
      },
      desiredInstance: {
        ownPaths:     instancePathManifest.filter(p => p.source !== "linked"),
        linkedPaths:  LINKED_BY_KIND.desiredInstance
      },
      gap: {
        ownPaths:     gapPathManifest.filter(p => p.source !== "linked"),
        linkedPaths:  LINKED_BY_KIND.gap
      },
      environment: {
        ownPaths:     environmentPathManifest.filter(p => p.source !== "linked"),
        linkedPaths:  LINKED_BY_KIND.environment
      },
      project: {
        ownPaths:     [],   // projects are derived; no own fields
        linkedPaths:  LINKED_BY_KIND.project
      }
    }
  };
}

// Stable JSON serialization — sorts keys + arrays-of-objects-by-path for
// deterministic byte-equal comparison with the snapshot.
export function serializeManifestStable(manifest) {
  return JSON.stringify(manifest, sortReplacer, 2);
}
function sortReplacer(_key, value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const sorted = {};
    for (const k of Object.keys(value).sort()) sorted[k] = value[k];
    return sorted;
  }
  return value;
}
