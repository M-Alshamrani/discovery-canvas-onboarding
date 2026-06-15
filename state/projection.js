// state/projection.js -- engagement -> v2-shape session projector.
//
// Read-only consumers (Reporting + the 4 Summary views) need session-
// shape data because the services they call (services/healthMetrics,
// services/roadmapService, etc.) take `session` as a parameter. Rather
// than refactoring all those services, this module projects the
// engagement to session-shape at the view boundary so the view modules
// don't import sessionStore directly.

import { getActiveEngagement } from "./engagementStore.js";
import { ENV_CATALOG } from "../core/config.js";

// getEngagementAsSession() -- returns a fresh v2-shape session object
// derived from the active engagement. Always returns a defined shape
// (empty arrays + empty customer when the engagement is null).
//
// Mutating the returned object has no effect on the engagement, which
// is the source of truth; treat the result as a read-only snapshot.
export function getEngagementAsSession() {
  const eng = getActiveEngagement();
  if (!eng) {
    return {
      sessionId:    "no-engagement",
      isDemo:       false,
      customer: {
        name:     "",
        vertical: "",
        region:   "",
        notes:    "",
        drivers:  []
      },
      sessionMeta: {
        date:          new Date().toISOString().slice(0, 10),
        presalesOwner: "",
        status:        "Draft",
        version:       "2.0"
      },
      environments: [],
      instances:    [],
      gaps:         []
    };
  }

  // Drivers (v2 shape: { id (= businessDriverId), priority, outcomes }).
  // Also build a UUID→typeId map so gap.driverId can be remapped below.
  // The v2-shape session.customer.drivers[].id is a typeId, so gap.driverId
  // must be remapped from UUID to typeId for downstream matching
  // (e.g. services/programsService.groupProjectsByProgram checks Set
  // membership of driver ids); otherwise every project falls into the
  // "unassigned" swimlane. Mirrors the envUuidToCatalogId remap below.
  const driverUuidToTypeId = {};
  const drivers = (eng.drivers && eng.drivers.allIds) ? eng.drivers.allIds.map(id => {
    const d = eng.drivers.byId[id];
    if (!d) return null;
    if (d.id && d.businessDriverId) driverUuidToTypeId[d.id] = d.businessDriverId;
    return {
      id:       d.businessDriverId,
      priority: d.priority || "Medium",
      outcomes: typeof d.outcomes === "string" ? d.outcomes : ""
    };
  }).filter(Boolean) : [];

  // Environments (v2 shape: { id (= envCatalogId), hidden, alias?, location?, ... }).
  // Also build an envUuidToCatalogId map so instance.environmentId and
  // gap.affectedEnvironments can be remapped from UUID to envCatalogId
  // (typeId) below. v2-shape consumers (services/roadmapService.js envLabel,
  // services/healthMetrics.js env grouping, etc.) look up env labels via the
  // ENVIRONMENTS catalog keyed by typeId; passing through UUIDs makes those
  // lookups fail silently and leak the raw UUID into UI surfaces.
  const envUuidToCatalogId = {};
  const environments = (eng.environments && eng.environments.allIds) ? eng.environments.allIds.map(id => {
    const e = eng.environments.byId[id];
    if (!e) return null;
    if (e.id && e.envCatalogId) envUuidToCatalogId[e.id] = e.envCatalogId;
    const out = { id: e.envCatalogId, hidden: !!e.hidden };
    if (typeof e.alias    === "string" && e.alias.length    > 0) out.alias    = e.alias;
    if (typeof e.location === "string" && e.location.length > 0) out.location = e.location;
    if (typeof e.sizeKw   === "number") out.sizeKw   = e.sizeKw;
    if (typeof e.sqm      === "number") out.sqm      = e.sqm;
    if (typeof e.tier     === "string" && e.tier.length     > 0) out.tier     = e.tier;
    if (typeof e.notes    === "string" && e.notes.length    > 0) out.notes    = e.notes;
    return out;
  }).filter(Boolean) : [];

  // Instances (v2 shape: pass-through with UUID ids).
  // environmentId is remapped from UUID to envCatalogId so v2-shape
  // services group instances by typeId instead of UUID. instance.id
  // stays a UUID — gap.relatedCurrent/DesiredInstanceIds are UUIDs and
  // must continue to match for downstream lookup.
  const instances = (eng.instances && eng.instances.allIds) ? eng.instances.allIds.map(id => {
    const i = eng.instances.byId[id];
    if (!i) return null;
    const out = {
      id:            i.id,
      state:         i.state,
      layerId:       i.layerId,
      environmentId: envUuidToCatalogId[i.environmentId] || i.environmentId,
      label:         i.label,
      vendor:        i.vendor,
      vendorGroup:   i.vendorGroup,
      criticality:   i.criticality,
      notes:         i.notes,
      disposition:   i.disposition
    };
    if (i.priority   !== null && i.priority   !== undefined) out.priority   = i.priority;
    if (i.originId   !== null && i.originId   !== undefined) out.originId   = i.originId;
    if (Array.isArray(i.mappedAssetIds) && i.mappedAssetIds.length > 0) out.mappedAssetIds = i.mappedAssetIds.slice();
    return out;
  }).filter(Boolean) : [];

  // Gaps (v2 shape: pass-through; gaps already have all v2-relevant fields).
  // affectedEnvironments is remapped from UUIDs to envCatalogIds, and
  // driverId from UUID to typeId, so groupProjectsByProgram can match the
  // v2-shape session.customer.drivers (which carry typeId ids per the
  // drivers projection above). gap.id + relatedCurrent/DesiredInstanceIds
  // stay UUID — downstream selectors look those up against the projected
  // instances, which keep their UUID id.
  const gaps = (eng.gaps && eng.gaps.allIds) ? eng.gaps.allIds.map(id => {
    const g = eng.gaps.byId[id];
    if (!g) return null;
    const out = { ...g };
    if (Array.isArray(g.affectedEnvironments)) {
      out.affectedEnvironments = g.affectedEnvironments.map(envId => envUuidToCatalogId[envId] || envId);
    }
    // Remap driverId UUID → typeId; null is preserved when the gap has no driver.
    if (g.driverId && driverUuidToTypeId[g.driverId]) {
      out.driverId = driverUuidToTypeId[g.driverId];
    }
    return out;
  }).filter(Boolean) : [];

  return {
    sessionId:    (eng.meta && eng.meta.engagementId) || "v3-engagement",
    isDemo:       !!(eng.meta && eng.meta.isDemo),
    customer: {
      name:     (eng.customer && eng.customer.name)     || "",
      vertical: (eng.customer && eng.customer.vertical) || "",
      region:   (eng.customer && eng.customer.region)   || "",
      notes:    (eng.customer && eng.customer.notes)    || "",
      drivers
    },
    sessionMeta: {
      date:          new Date().toISOString().slice(0, 10),
      presalesOwner: "",
      status:        "Draft",
      version:       "2.0"
    },
    environments,
    instances,
    gaps
  };
}

// Convenience helper for views that need just visible envs (matches
// core/config.js getVisibleEnvironments contract).
export function getVisibleEnvsFromEngagement() {
  const eng = getActiveEngagement();
  if (!eng || !eng.environments || !Array.isArray(eng.environments.allIds)) return [];
  return eng.environments.allIds.map(id => {
    const e = eng.environments.byId[id];
    if (!e || e.hidden) return null;
    const cat = ENV_CATALOG.find(c => c.id === e.envCatalogId);
    return {
      id:    e.envCatalogId,
      label: cat ? cat.label : e.envCatalogId,
      hint:  cat ? cat.hint : "",
      hidden: false
    };
  }).filter(Boolean);
}
