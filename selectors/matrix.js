// Pure memoized selector: (engagement, { state }) -> MatrixView.
//
// Output shape:
//   {
//     state:    "current" | "desired",
//     envIds:   string[],                            // env order (allIds; hidden envs omitted)
//     layerIds: string[],                            // catalog order from LAYERS
//     cells:    Record<envId, Record<layerId, {
//       instanceIds: string[],                       // belonging to (envId, layerId, state)
//       count:       number,
//       vendorMix:   { dell, nonDell, custom }
//     }>>
//   }
//
// Hidden-env exclusion is the default unless args.includeHidden = true.

import { memoizeOne } from "../services/memoizeOne.js";

// Layer order matches the LAYERS catalog (workload, compute, storage,
// dataProtection, virtualization, infrastructure). The ids are hardcoded
// here rather than read from the catalog because the six layers are
// fixed — the catalog is the source of truth for labels, this is the order.
const LAYER_ORDER = ["workload", "compute", "storage", "dataProtection", "virtualization", "infrastructure"];

function emptyVendorMix() {
  return { dell: 0, nonDell: 0, custom: 0 };
}

function compute(engagement, args) {
  const state = (args && args.state) || "current";
  const includeHidden = !!(args && args.includeHidden);

  // Active env list, preserving allIds insertion order, optional hidden filter.
  const envIds = engagement.environments.allIds.filter(id =>
    includeHidden || !engagement.environments.byId[id].hidden);

  // Init empty cells for every (envId, layerId).
  const cells = {};
  for (const envId of envIds) {
    cells[envId] = {};
    for (const layerId of LAYER_ORDER) {
      cells[envId][layerId] = { instanceIds: [], count: 0, vendorMix: emptyVendorMix() };
    }
  }

  // Populate from instances filtered by state + visible env.
  const visibleEnvSet = new Set(envIds);
  for (const id of engagement.instances.allIds) {
    const inst = engagement.instances.byId[id];
    if (inst.state !== state) continue;
    if (!visibleEnvSet.has(inst.environmentId)) continue;
    const cell = cells[inst.environmentId]?.[inst.layerId];
    if (!cell) continue;   // unknown layer (defensive)
    cell.instanceIds.push(inst.id);
    cell.count += 1;
    if (inst.vendorGroup === "dell")     cell.vendorMix.dell += 1;
    else if (inst.vendorGroup === "nonDell") cell.vendorMix.nonDell += 1;
    else if (inst.vendorGroup === "custom")  cell.vendorMix.custom += 1;
  }

  return { state, envIds, layerIds: LAYER_ORDER.slice(), cells };
}

// Custom equality: short-circuit on (engagement reference, state, includeHidden).
export const selectMatrixView = memoizeOne(compute, ([engA, argsA], [engB, argsB]) => {
  if (engA !== engB) return false;
  const aState = (argsA && argsA.state) || "current";
  const bState = (argsB && argsB.state) || "current";
  if (aState !== bState) return false;
  const aHidden = !!(argsA && argsA.includeHidden);
  const bHidden = !!(argsB && argsB.includeHidden);
  return aHidden === bHidden;
});
