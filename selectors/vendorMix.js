// Pure memoized selector: engagement -> VendorMixView.
//
// Output shape:
//   {
//     totals:        { dell, nonDell, custom, total, dellPercent },
//     byLayer:       Record<layerId, { dell, nonDell, custom, total, dellPercent }>,
//     byEnvironment: Record<envId,   { dell, nonDell, custom, total, dellPercent }>,
//     kpiTiles: {
//       dellDensity:             { value, label },
//       mostDiverseLayer:        { layerId, vendorCount },
//       topNonDellConcentration: { vendorName, count, percentOfNonDell }
//     }
//   }
//
// Hidden-environment exclusion: totals exclude instances in hidden envs.
// Cross-cutting workload mappedAssetIds do not inflate counts — each
// instance contributes once, counted in its native env and never in the
// envs it maps assets across.

import { memoizeOne } from "../services/memoizeOne.js";

function emptyBucket() {
  return { dell: 0, nonDell: 0, custom: 0, total: 0, dellPercent: 0 };
}

function pct(num, denom) {
  if (denom === 0) return 0;
  return Math.round((num / denom) * 1000) / 10;   // one decimal
}

function bumpBucket(bucket, vendorGroup) {
  bucket.total += 1;
  if (vendorGroup === "dell")          bucket.dell += 1;
  else if (vendorGroup === "nonDell")  bucket.nonDell += 1;
  else if (vendorGroup === "custom")   bucket.custom += 1;
}

function finalizeBucket(bucket) {
  bucket.dellPercent = pct(bucket.dell, bucket.total);
  return bucket;
}

function compute(engagement) {
  const totals  = emptyBucket();
  const byLayer       = {};
  const byEnvironment = {};

  // Build the hidden-env exclusion set once.
  const hiddenEnvIds = new Set();
  for (const envId of engagement.environments.allIds) {
    if (engagement.environments.byId[envId].hidden) hiddenEnvIds.add(envId);
  }

  // Vendor counts (per non-Dell vendor name) for the topNonDell KPI.
  const nonDellByVendor = Object.create(null);

  for (const id of engagement.instances.allIds) {
    const inst = engagement.instances.byId[id];
    if (hiddenEnvIds.has(inst.environmentId)) continue;
    bumpBucket(totals, inst.vendorGroup);

    if (!byLayer[inst.layerId])             byLayer[inst.layerId]             = emptyBucket();
    if (!byEnvironment[inst.environmentId]) byEnvironment[inst.environmentId] = emptyBucket();
    bumpBucket(byLayer[inst.layerId],             inst.vendorGroup);
    bumpBucket(byEnvironment[inst.environmentId], inst.vendorGroup);

    if (inst.vendorGroup === "nonDell" && inst.vendor) {
      nonDellByVendor[inst.vendor] = (nonDellByVendor[inst.vendor] || 0) + 1;
    }
  }

  finalizeBucket(totals);
  for (const k of Object.keys(byLayer))       finalizeBucket(byLayer[k]);
  for (const k of Object.keys(byEnvironment)) {
    finalizeBucket(byEnvironment[k]);
    // Add envLabel inside each entry so the LLM can cite "Riyadh Core DC"
    // instead of the UUID. Falls back to envCatalogId, then "(unknown)".
    const envRec = engagement.environments.byId[k];
    byEnvironment[k].envLabel = envRec
      ? (envRec.alias || envRec.envCatalogId || "(unknown)")
      : "(unknown)";
  }

  // KPI: most diverse layer = layer with most distinct vendor groups
  // present (1, 2, or 3). Tie -> first by allIds order.
  let mostDiverseLayer = { layerId: null, vendorCount: 0 };
  for (const layerId of Object.keys(byLayer)) {
    const b = byLayer[layerId];
    const count = (b.dell > 0 ? 1 : 0) + (b.nonDell > 0 ? 1 : 0) + (b.custom > 0 ? 1 : 0);
    if (count > mostDiverseLayer.vendorCount) {
      mostDiverseLayer = { layerId, vendorCount: count };
    }
  }

  // KPI: top non-Dell concentration (single vendor with the most
  // non-Dell instances).
  let topVendor = null;
  let topCount  = 0;
  for (const vendor of Object.keys(nonDellByVendor)) {
    if (nonDellByVendor[vendor] > topCount) {
      topVendor = vendor;
      topCount  = nonDellByVendor[vendor];
    }
  }
  const topNonDellConcentration = topVendor
    ? {
        vendorName: topVendor,
        count: topCount,
        percentOfNonDell: pct(topCount, totals.nonDell)
      }
    : { vendorName: null, count: 0, percentOfNonDell: 0 };

  return {
    totals,
    byLayer,
    byEnvironment,
    kpiTiles: {
      dellDensity:             { value: totals.dellPercent, label: "Dell density" },
      mostDiverseLayer,
      topNonDellConcentration
    }
  };
}

// Default equality: a reference-equal engagement short-circuits. Action
// functions return a new engagement reference on every mutation, so
// engagement === prevEngagement is the right invalidation key.
export const selectVendorMix = memoizeOne(compute, ([a], [b]) => a === b);
