// The 10 transformation steps, in one file. Each step is a pure function
// (engagement, ctx) -> engagement. Steps run in order; composition lives
// in ./index.js.

import { toCollection, toInstancesCollection } from "../helpers/collection.js";

// ═══════════════════════════════════════════════════════════════════
// Step 1 — schemaVersion stamp
// ═══════════════════════════════════════════════════════════════════
export function step01_schemaVersion(engagement, _ctx) {
  const meta = engagement.engagementMeta ?? engagement.sessionMeta ?? {};
  return {
    ...engagement,
    engagementMeta: { ...meta, schemaVersion: "3.0" }
  };
}

// ═══════════════════════════════════════════════════════════════════
// Step 2 — sessionId -> engagementId
// ═══════════════════════════════════════════════════════════════════
export function step02_engagementId(engagement, ctx) {
  const sessionMeta    = engagement.sessionMeta ?? {};
  const engagementMeta = engagement.engagementMeta ?? {};
  // Capture savedAt before sessionMeta is deleted (used by step04).
  const v2SavedAt = sessionMeta.savedAt;
  const oldId =
    sessionMeta.sessionId ??
    engagementMeta.engagementId ??
    ctx.deterministicId("engagement", engagementMeta.customerName ?? "unknown",
                                       v2SavedAt ?? "unknown");
  const next = {
    ...engagement,
    engagementMeta: { ...engagementMeta, engagementId: oldId, _v2SavedAt: v2SavedAt }
  };
  delete next.sessionMeta;
  return next;
}

// ═══════════════════════════════════════════════════════════════════
// Step 3 — ownerId default
// ═══════════════════════════════════════════════════════════════════
export function step03_ownerId(engagement, _ctx) {
  const meta = engagement.engagementMeta;
  const owner = (meta.ownerId && meta.ownerId.trim()) ? meta.ownerId : "local-user";
  return {
    ...engagement,
    engagementMeta: { ...meta, ownerId: owner }
  };
}

// ═══════════════════════════════════════════════════════════════════
// Step 4 — timestamps
// ═══════════════════════════════════════════════════════════════════
export function step04_timestamps(engagement, ctx) {
  const meta = engagement.engagementMeta;
  const fallback = meta._v2SavedAt || ctx.migrationTimestamp;
  const next = {
    ...meta,
    createdAt: meta.createdAt || fallback,
    updatedAt: meta.updatedAt || meta.createdAt || fallback
  };
  delete next._v2SavedAt;   // bookkeeping field; not part of v3.0 schema
  return { ...engagement, engagementMeta: next };
}

// ═══════════════════════════════════════════════════════════════════
// Step 5 — customer legacy fields
// ═══════════════════════════════════════════════════════════════════
export function step05_customerLegacyFields(engagement, _ctx) {
  const c = engagement.customer ?? {};
  const { segment, industry, ...rest } = c;
  const baseNotes = (rest.notes || "").trim();
  const extras = [segment, industry]
    .filter(s => typeof s === "string" && s.trim().length > 0)
    .map(s => s.trim())
    .filter(s => s !== rest.vertical)
    .filter(s => !baseNotes.includes(s));
  const notes = extras.length
    ? [baseNotes, ...extras].filter(Boolean).join(" · ")
    : baseNotes;
  return { ...engagement, customer: { ...rest, notes } };
}

// ═══════════════════════════════════════════════════════════════════
// Step 6 — extract customer.drivers[] -> drivers
// ═══════════════════════════════════════════════════════════════════
const PRIORITY_NORMALIZE = {
  high: "High", medium: "Medium", med: "Medium", low: "Low",
  "1": "High", "2": "Medium", "3": "Low",
  "High": "High", "Medium": "Medium", "Low": "Low"
};
function normalizePriority(p) {
  if (!p && p !== 0) return "Medium";
  const v = String(p).trim();
  return PRIORITY_NORMALIZE[v] || PRIORITY_NORMALIZE[v.toLowerCase()] || "Medium";
}

export function step06_extractDrivers(engagement, ctx) {
  const v2Drivers = engagement.customer?.drivers ?? [];
  const eid = engagement.engagementMeta.engagementId;
  const t   = engagement.engagementMeta.createdAt;
  const catalogVersion = ctx.catalogSnapshot?.BUSINESS_DRIVERS?.catalogVersion ?? "2026.04";

  const drivers = v2Drivers.map((d, idx) => ({
    id:               ctx.deterministicId("driver", eid, d.driverId ?? d.businessDriverId ?? "unknown", idx),
    engagementId:     eid,
    businessDriverId: d.driverId ?? d.businessDriverId ?? "unknown",
    catalogVersion,
    priority:         normalizePriority(d.priority),
    outcomes:         (d.outcomes ?? "").trim(),
    createdAt:        t,
    updatedAt:        t
  }));

  const next = {
    ...engagement,
    drivers: toCollection(drivers),
    customer: { ...engagement.customer }
  };
  delete next.customer.drivers;
  return next;
}

// ═══════════════════════════════════════════════════════════════════
// Step 7 — array -> Collection<T> on load
// ═══════════════════════════════════════════════════════════════════
export function step07_collections(engagement, ctx) {
  const eid = engagement.engagementMeta.engagementId;
  const t   = engagement.engagementMeta.createdAt;
  const envCatVer = ctx.catalogSnapshot?.ENV_CATALOG?.catalogVersion ?? "2026.04";

  // Environments: stamp ids + catalogVersion + cross-cutting fields.
  const envArr = (engagement.environments ?? []).map((env, idx) => ({
    id:             env.id || ctx.deterministicId("environment", eid, env.envCatalogId || env.id || "unknown", idx),
    engagementId:   eid,
    envCatalogId:   env.envCatalogId || env.id,           // v2.0 used `id` as catalog key
    catalogVersion: envCatVer,
    hidden:         !!env.hidden,
    alias:          env.alias ?? null,
    location:       env.location ?? null,
    sizeKw:         (typeof env.sizeKw === "number") ? env.sizeKw : null,
    sqm:            (typeof env.sqm === "number") ? env.sqm : null,
    tier:           env.tier ?? null,
    notes:          env.notes ?? "",
    createdAt:      t,
    updatedAt:      t
  }));

  // Instances: handle the 3 input shapes (unified array, {current,desired} split, byId).
  const instArr = mergeAndStampInstances(engagement, eid, t);

  // Gaps: stamp + cross-cutting fields. projectId is dropped here too
  // (step08 is the explicit drop; this is just construction).
  const gapArr = (engagement.gaps ?? []).map((g, idx) => ({
    id:                        g.id || ctx.deterministicId("gap", eid, g.layerId, g.description ?? "unknown", idx),
    engagementId:              eid,
    description:               g.description ?? "",
    gapType:                   g.gapType ?? "ops",
    urgency:                   g.urgency ?? "Medium",
    urgencyOverride:           !!g.urgencyOverride,
    phase:                     g.phase ?? "now",
    status:                    g.status ?? "open",
    reviewed:                  !!g.reviewed,
    notes:                     g.notes ?? "",
    driverId:                  g.driverId ?? null,
    layerId:                   g.layerId,
    affectedLayers:            g.affectedLayers && g.affectedLayers.length ? g.affectedLayers : [g.layerId],
    affectedEnvironments:      g.affectedEnvironments && g.affectedEnvironments.length ? g.affectedEnvironments : [],
    relatedCurrentInstanceIds: g.relatedCurrentInstanceIds ?? [],
    relatedDesiredInstanceIds: g.relatedDesiredInstanceIds ?? [],
    services:                  g.services ?? [],
    aiMappedDellSolutions:     null,                       // step09 wraps this if v2.x had a string
    mappedDellSolutions:       g.mappedDellSolutions ?? null,  // bookkeeping; step09 consumes + deletes
    createdAt:                 t,
    updatedAt:                 t
  }));

  return {
    ...engagement,
    environments: toCollection(envArr),
    instances:    toInstancesCollection(instArr),
    gaps:         toCollection(gapArr)
  };
}

function mergeAndStampInstances(engagement, eid, t) {
  const raw = engagement.instances;
  let arr = [];
  if (Array.isArray(raw)) {
    arr = raw;
  } else if (raw && Array.isArray(raw.current)) {
    arr = [
      ...raw.current.map(x => ({ ...x, state: "current" })),
      ...raw.desired.map(x => ({ ...x, state: "desired" }))
    ];
  } else if (raw && raw.byId) {
    arr = Object.values(raw.byId);
  }
  return arr.map((inst, idx) => ({
    id:             inst.id || ("inst-" + idx),         // step09 retains; ids should already exist in v2.x
    engagementId:   eid,
    state:          inst.state ?? "current",
    layerId:        inst.layerId,
    environmentId:  inst.environmentId,
    label:          inst.label ?? "",
    vendor:         inst.vendor ?? "",
    vendorGroup:    inst.vendorGroup ?? "custom",
    criticality:    inst.criticality ?? "Medium",
    notes:          inst.notes ?? "",
    disposition:    inst.disposition ?? "keep",
    originId:       (inst.state === "desired") ? (inst.originId ?? null) : null,
    priority:       (inst.state === "desired") ? (inst.priority ?? null) : null,
    mappedAssetIds: (inst.layerId === "workload") ? (inst.mappedAssetIds ?? []) : [],
    aiSuggestedDellMapping: null,                        // step09 territory
    createdAt:      t,
    updatedAt:      t
  }));
}

// ═══════════════════════════════════════════════════════════════════
// Step 8 — drop gap.projectId
// ═══════════════════════════════════════════════════════════════════
export function step08_dropProjectId(engagement, _ctx) {
  const gaps = engagement.gaps;
  const next = Object.create(null);
  for (const id of gaps.allIds) {
    // eslint-disable-next-line no-unused-vars
    const { projectId, ...rest } = gaps.byId[id];
    next[id] = rest;
  }
  return { ...engagement, gaps: { byId: next, allIds: gaps.allIds } };
}

// ═══════════════════════════════════════════════════════════════════
// Step 9 — wrap free-text AI fields
// ═══════════════════════════════════════════════════════════════════
export function step09_wrapAILegacyFields(engagement, ctx) {
  const gaps = engagement.gaps;
  const t = ctx.migrationTimestamp;
  let wrappedCount = 0;
  const next = Object.create(null);

  for (const id of gaps.allIds) {
    const gap = { ...gaps.byId[id] };
    const legacy = gap.mappedDellSolutions;   // captured by step07
    if (typeof legacy === "string" && legacy.trim().length > 0) {
      gap.aiMappedDellSolutions = {
        value: { rawLegacy: legacy.trim(), products: [] },
        provenance: {
          model:            "unknown",
          promptVersion:    "legacy:v2.4.x",
          skillId:          "unknown",
          runId:            ctx.deterministicId("provenanceRun", gap.id, "legacy"),
          timestamp:        t,
          catalogVersions:  { DELL_PRODUCT_TAXONOMY: "unknown" },
          validationStatus: "stale"
        }
      };
      wrappedCount += 1;
    }
    delete gap.mappedDellSolutions;   // bookkeeping field; not part of v3.0 schema
    next[id] = gap;
  }

  // Surface count via integrityLog so the user is informed on next sweep.
  const log = engagement.integrityLog ? [...engagement.integrityLog] : [];
  if (wrappedCount > 0) {
    log.push({
      ruleId:     "MIG-AI-WRAPPED",
      recordKind: "engagementMeta",
      recordId:   engagement.engagementMeta.engagementId,
      field:      "aiMappedDellSolutions",
      before:     wrappedCount + " legacy plain-string AI fields",
      after:      wrappedCount + " provenance-wrapped with validationStatus=stale",
      timestamp:  t
    });
  }

  return {
    ...engagement,
    gaps: { byId: next, allIds: gaps.allIds },
    integrityLog: log
  };
}

// ═══════════════════════════════════════════════════════════════════
// Step 10 — stamp engagementId on every record
// ═══════════════════════════════════════════════════════════════════
export function step10_stampEngagementId(engagement, _ctx) {
  const eid = engagement.engagementMeta.engagementId;
  const stampCol = (col) => {
    if (!col) return col;
    const next = Object.create(null);
    for (const id of col.allIds) {
      next[id] = { ...col.byId[id], engagementId: eid };
    }
    return { ...col, byId: next };
  };
  return {
    ...engagement,
    customer:     { ...engagement.customer, engagementId: eid },
    drivers:      stampCol(engagement.drivers),
    environments: stampCol(engagement.environments),
    instances:    stampCol(engagement.instances),
    gaps:         stampCol(engagement.gaps)
  };
}
