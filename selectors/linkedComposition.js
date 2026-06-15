// Pure memoized selector: (engagement, { kind, id }) -> LinkedRecord.
//
// The merged record set a click-to-run skill receives as context. Per
// kind, includes the entity itself plus its FK-linked records across
// collections. Cross-cutting relationships are honored: linked
// compositions for gaps with affectedEnvironments.length >= 2 include
// all referenced environments and all related instances regardless of
// their environment.
//
// Composition rules are derived from FK declarations plus reverse-FK
// lookups, kept in one site here.

import { memoizeOne } from "../services/memoizeOne.js";

function compute(engagement, args) {
  const kind = args && args.kind;
  const id   = args && args.id;
  if (!kind || !id) {
    return { kind: kind || null, entity: null, error: "missing kind or id" };
  }

  switch (kind) {
    case "driver":          return composeDriver(engagement, id);
    case "currentInstance": return composeInstance(engagement, id, "current");
    case "desiredInstance": return composeInstance(engagement, id, "desired");
    case "gap":             return composeGap(engagement, id);
    case "environment":     return composeEnvironment(engagement, id);
    case "project":         return composeProject(engagement, id);
    default:
      return { kind, entity: null, error: "unknown kind: " + kind };
  }
}

function composeDriver(engagement, driverId) {
  const driver = engagement.drivers.byId[driverId];
  if (!driver) return { kind: "driver", entity: null, error: "driver not found" };
  const linkedGaps = [];
  const affectedEnvSet = new Set();
  const relatedCurrentSet = new Set();
  const relatedDesiredSet = new Set();
  for (const gapId of engagement.gaps.allIds) {
    const g = engagement.gaps.byId[gapId];
    if (g.driverId !== driverId) continue;
    linkedGaps.push(g);
    for (const e of g.affectedEnvironments)      affectedEnvSet.add(e);
    for (const i of g.relatedCurrentInstanceIds) relatedCurrentSet.add(i);
    for (const i of g.relatedDesiredInstanceIds) relatedDesiredSet.add(i);
  }
  return {
    kind: "driver",
    entity: driver,
    linked: {
      gaps:                 linkedGaps,
      affectedEnvironments: [...affectedEnvSet].map(e => engagement.environments.byId[e]).filter(Boolean),
      relatedInstances: {
        current: [...relatedCurrentSet].map(i => engagement.instances.byId[i]).filter(Boolean),
        desired: [...relatedDesiredSet].map(i => engagement.instances.byId[i]).filter(Boolean)
      }
    }
  };
}

function composeInstance(engagement, instanceId, expectedState) {
  const inst = engagement.instances.byId[instanceId];
  if (!inst) return { kind: expectedState + "Instance", entity: null, error: "instance not found" };
  if (inst.state !== expectedState) {
    return { kind: expectedState + "Instance", entity: null,
             error: "instance state mismatch: " + inst.state };
  }
  // Linked gaps via relatedCurrentInstanceIds / relatedDesiredInstanceIds.
  const linkedGaps = [];
  for (const gapId of engagement.gaps.allIds) {
    const g = engagement.gaps.byId[gapId];
    const arr = expectedState === "current" ? g.relatedCurrentInstanceIds : g.relatedDesiredInstanceIds;
    if (arr.includes(inst.id)) linkedGaps.push(g);
  }
  // For desired instances: include the originId-linked current instance.
  // For current instances: include the desired counterpart(s) that point to this id.
  const linked = { gaps: linkedGaps };
  if (expectedState === "desired") {
    linked.originInstance = inst.originId ? engagement.instances.byId[inst.originId] : null;
  } else {
    linked.desiredCounterparts = [];
    for (const id of engagement.instances.allIds) {
      const i = engagement.instances.byId[id];
      if (i.state === "desired" && i.originId === inst.id) linked.desiredCounterparts.push(i);
    }
  }
  return { kind: expectedState + "Instance", entity: inst, linked };
}

function composeGap(engagement, gapId) {
  const g = engagement.gaps.byId[gapId];
  if (!g) return { kind: "gap", entity: null, error: "gap not found" };
  const driver = g.driverId ? engagement.drivers.byId[g.driverId] : null;
  // Cross-cutting: pull all referenced envs and instances regardless of
  // their own env.
  const affectedEnvironments = g.affectedEnvironments
    .map(e => engagement.environments.byId[e])
    .filter(Boolean);
  const relatedCurrent = g.relatedCurrentInstanceIds
    .map(i => engagement.instances.byId[i])
    .filter(Boolean);
  const relatedDesired = g.relatedDesiredInstanceIds
    .map(i => engagement.instances.byId[i])
    .filter(Boolean);
  return {
    kind: "gap",
    entity: g,
    linked: {
      driver,
      affectedEnvironments,
      relatedInstances: { current: relatedCurrent, desired: relatedDesired }
    }
  };
}

function composeEnvironment(engagement, envId) {
  const env = engagement.environments.byId[envId];
  if (!env) return { kind: "environment", entity: null, error: "environment not found" };
  const instances = [];
  for (const id of engagement.instances.allIds) {
    const i = engagement.instances.byId[id];
    if (i.environmentId === envId) instances.push(i);
  }
  const gaps = [];
  for (const gapId of engagement.gaps.allIds) {
    const g = engagement.gaps.byId[gapId];
    if (g.affectedEnvironments.includes(envId)) gaps.push(g);
  }
  return {
    kind: "environment",
    entity: env,
    linked: { instances, gaps }
  };
}

function composeProject(engagement, projectId) {
  // projectId is derived — there's no engagement.projects collection.
  // Re-derive it: a project id is "proj-<driverId|no-driver>-<layerId>"
  // (see selectProjects). Parse and match.
  const m = /^proj-(.+?)-([a-zA-Z]+)$/.exec(projectId);
  if (!m) return { kind: "project", entity: null, error: "malformed projectId" };
  const driverId = m[1] === "no-driver" ? null : m[1];
  const layerId = m[2];
  const matchingGaps = [];
  const driverIds = new Set();
  for (const gapId of engagement.gaps.allIds) {
    const g = engagement.gaps.byId[gapId];
    if ((g.driverId || null) === driverId && g.layerId === layerId) {
      matchingGaps.push(g);
      if (g.driverId) driverIds.add(g.driverId);
    }
  }
  if (matchingGaps.length === 0) {
    return { kind: "project", entity: null, error: "no gaps match this project key" };
  }
  return {
    kind: "project",
    entity: { projectId, driverId, layerId, gapCount: matchingGaps.length },
    linked: {
      gaps: matchingGaps,
      drivers: [...driverIds].map(id => engagement.drivers.byId[id]).filter(Boolean)
    }
  };
}

// Custom equality: short-circuit on (engagement ref, kind, id).
export const selectLinkedComposition = memoizeOne(compute, ([eA, aA], [eB, aB]) => {
  if (eA !== eB) return false;
  return (aA?.kind === aB?.kind) && (aA?.id === aB?.id);
});
