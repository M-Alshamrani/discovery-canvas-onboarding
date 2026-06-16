// state/integritySweep.js
//
// Checks a loaded engagement for broken references between records and
// repairs or quarantines them. A "foreign key" (FK) here is a field on
// one record that holds the id of another record or catalog entry.
//
// The sweep is pure: it takes (engagement, catalogs) and returns
// { repaired, log, quarantine } without mutating its inputs. The same
// input always produces the same output.
//
// What it handles:
//   - Orphaned FK references (the target record no longer exists).
//   - Catalog-version drift on AI-generated fields (the catalog the AI
//     mapping was based on has since changed).
//   - Quarantine for records whose required FK cannot be repaired.
//
// It runs after the engagement has already passed schema validation, so
// it only deals with problems schema validation does not catch: dangling
// references to deleted records, and AI mappings that have gone stale.

import { driverFkDeclarations }      from "../schema/driver.js";
import { environmentFkDeclarations } from "../schema/environment.js";
import { instanceFkDeclarations }    from "../schema/instance.js";
import { gapFkDeclarations }         from "../schema/gap.js";

// Map collection name -> FK declarations array.
const FK_DECLARATIONS_BY_COLLECTION = {
  drivers:      driverFkDeclarations,
  environments: environmentFkDeclarations,
  instances:    instanceFkDeclarations,
  gaps:         gapFkDeclarations
};

// Singular record-kind names, written into each log/quarantine entry.
const KIND_BY_COLLECTION = {
  drivers:      "driver",
  environments: "environment",
  instances:    "instance",
  gaps:         "gap"
};

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

export function runIntegritySweep(engagement, catalogs) {
  const log        = [];
  const quarantine = [];
  const ts = "2026-01-01T00:00:00.000Z";   // fixed timestamp so output stays deterministic

  // Build id lookup tables once, for fast FK resolution.
  // Collection FKs are checked against the ids in each engagement collection;
  // catalog FKs are checked against the entry ids in the matching catalog.
  const collectionIdSets = {
    drivers:      new Set(engagement.drivers?.allIds      ?? []),
    environments: new Set(engagement.environments?.allIds ?? []),
    instances:    new Set(engagement.instances?.allIds    ?? []),
    gaps:         new Set(engagement.gaps?.allIds         ?? [])
  };
  const catalogIdSets = {};
  for (const id of Object.keys(catalogs || {})) {
    catalogIdSets[id] = new Set((catalogs[id]?.entries || []).map(e => e.id));
  }

  // Start from the original engagement and replace collections as we touch
  // them, so the input object is never mutated.
  let repaired = engagement;

  // Walk every collection that has FK fields.
  for (const collName of Object.keys(FK_DECLARATIONS_BY_COLLECTION)) {
    const decls = FK_DECLARATIONS_BY_COLLECTION[collName];
    const coll = repaired[collName];
    if (!coll) continue;

    const newById = {};
    const survivingIds = [];
    for (const id of coll.allIds) {
      const record = coll.byId[id];
      const result = applyFkRules(record, decls, collectionIdSets, catalogIdSets, engagement);
      if (result.quarantine) {
        quarantine.push({
          ruleId:     result.quarantine.ruleId,
          recordKind: KIND_BY_COLLECTION[collName],
          recordId:   id,
          field:      result.quarantine.field,
          before:     coll.byId[id],
          after:      null,
          timestamp:  ts
        });
        log.push(...result.logs);
        // Quarantined record is dropped from the active engagement.
        continue;
      }
      survivingIds.push(id);
      newById[id] = result.record;
      log.push(...result.logs);
    }

    // If records were dropped, rebuild the collection. The instances
    // collection also keeps a byState index, which must be rebuilt to match.
    if (collectionChanged(coll, survivingIds)) {
      const newColl = { byId: newById, allIds: survivingIds };
      if (collName === "instances") {
        newColl.byState = rebuildByState(newById, survivingIds);
      }
      repaired = { ...repaired, [collName]: newColl };
    } else {
      // No records dropped, but individual FK fields may still have been
      // cleared. Swap in the rebuilt byId so those edits are kept.
      const newColl = { ...coll, byId: newById };
      if (collName === "instances") newColl.byState = rebuildByState(newById, coll.allIds);
      repaired = { ...repaired, [collName]: newColl };
    }
  }

  // Flag AI mappings whose source catalog has changed since they were made.
  const driftResult = detectAndFlagDrift(repaired, catalogs, ts);
  repaired = driftResult.engagement;
  log.push(...driftResult.log);

  return { repaired, log, quarantine };
}

// ─────────────────────────────────────────────────────────────────────
// FK rule application — checks one record against its FK declarations
// ─────────────────────────────────────────────────────────────────────

// Applies every FK rule for one record. Returns either
// { record, logs } with the cleaned record, or { quarantine, logs } when a
// required FK is broken and the record cannot be saved.
function applyFkRules(record, decls, collectionIdSets, catalogIdSets, engagement) {
  let r = record;
  const logs = [];
  for (const decl of decls) {
    const targetSet = resolveTargetSet(decl.target, collectionIdSets, catalogIdSets);
    if (!targetSet) continue;   // target collection not present — skip this rule

    if (decl.isArray) {
      const arr = r[decl.field] || [];
      const filtered = arr.filter(id => {
        const exists = targetSet.has(id);
        // Some FKs also require the target to be in a certain state, e.g. an
        // id list that may only point at instances whose state is "current".
        if (exists && decl.targetFilter && decl.target === "instances") {
          const targetRecord = engagement.instances?.byId?.[id];
          for (const k of Object.keys(decl.targetFilter)) {
            if (targetRecord?.[k] !== decl.targetFilter[k]) return false;
          }
        }
        return exists;
      });
      if (filtered.length !== arr.length) {
        const removed = arr.filter(id => !filtered.includes(id));
        for (const id of removed) {
          logs.push({
            ruleId: targetSet === catalogIdSets[stripCatalogPrefix(decl.target)]
              ? "INT-ORPHAN-ARR" : "INT-ORPHAN-ARR",
            recordKind: "(set by caller)",
            recordId:   r.id,
            field:      decl.field + "[]",
            before:     id,
            after:      null,
            timestamp:  "2026-01-01T00:00:00.000Z"
          });
        }
        r = { ...r, [decl.field]: filtered };
      }
    } else {
      // Single-value FK.
      const value = r[decl.field];
      if (value == null) {
        if (decl.required) {
          // A required FK that is missing cannot be repaired — quarantine.
          return {
            quarantine: { ruleId: "INT-ORPHAN-REQ", field: decl.field },
            logs
          };
        }
        // Optional and empty: nothing to check.
        continue;
      }
      const exists = targetSet.has(value);
      if (!exists) {
        if (decl.required) {
          return {
            quarantine: { ruleId: "INT-ORPHAN-REQ", field: decl.field },
            logs
          };
        }
        // Optional FK points at a missing record: clear it to null.
        logs.push({
          ruleId:     "INT-ORPHAN-OPT",
          recordKind: "(set by caller)",
          recordId:   r.id,
          field:      decl.field,
          before:     value,
          after:      null,
          timestamp:  "2026-01-01T00:00:00.000Z"
        });
        r = { ...r, [decl.field]: null };
        continue;
      }
      // Target exists but may be in the wrong state, e.g. a field that must
      // point at a "current" instance but points at a "desired" one.
      if (decl.targetFilter && decl.target === "instances") {
        const targetRecord = engagement.instances?.byId?.[value];
        let filterOk = true;
        for (const k of Object.keys(decl.targetFilter)) {
          if (targetRecord?.[k] !== decl.targetFilter[k]) { filterOk = false; break; }
        }
        if (!filterOk) {
          logs.push({
            ruleId:     "INT-FILTER-MISS",
            recordKind: "(set by caller)",
            recordId:   r.id,
            field:      decl.field,
            before:     value,
            after:      null,
            timestamp:  "2026-01-01T00:00:00.000Z"
          });
          r = { ...r, [decl.field]: null };
        }
      }
    }
  }
  return { record: r, logs };
}

// Finds the set of valid ids a FK may point at. A "catalog:" prefix means
// the target is a catalog; otherwise it is an engagement collection.
// Returns null when the target is not loaded, so the caller skips the rule
// instead of wrongly treating every reference as broken.
function resolveTargetSet(target, collectionIdSets, catalogIdSets) {
  if (target.startsWith("catalog:")) {
    return catalogIdSets[target.slice("catalog:".length)] || null;
  }
  return collectionIdSets[target] || null;
}

function stripCatalogPrefix(target) {
  return target.startsWith("catalog:") ? target.slice("catalog:".length) : target;
}

// ─────────────────────────────────────────────────────────────────────
// Catalog version drift detection
// ─────────────────────────────────────────────────────────────────────

// Marks AI mappings as stale when the catalog they were based on has a newer
// version. Two fields carry AI mappings: one on gaps, one on instances.
function detectAndFlagDrift(engagement, catalogs, ts) {
  const log = [];
  let next = engagement;

  next = flagDriftInCollection(next, "gaps", "aiMappedDellSolutions",     catalogs, log, ts);
  next = flagDriftInCollection(next, "instances", "aiSuggestedDellMapping", catalogs, log, ts);

  return { engagement: next, log };
}

function flagDriftInCollection(engagement, collName, fieldName, catalogs, log, ts) {
  const coll = engagement[collName];
  if (!coll) return engagement;
  let mutated = false;
  const newById = {};
  for (const id of coll.allIds) {
    const record = coll.byId[id];
    const wrapper = record[fieldName];
    if (!wrapper || !wrapper.provenance) {
      newById[id] = record;
      continue;
    }
    const status = wrapper.provenance.validationStatus;
    // Only a "valid" mapping can drift to "stale". Mappings the user has
    // edited or that are already invalid are left untouched.
    if (status !== "valid") {
      newById[id] = record;
      continue;
    }
    let isStale = false;
    const recorded = wrapper.provenance.catalogVersions || {};
    for (const catId of Object.keys(recorded)) {
      const current = catalogs?.[catId]?.catalogVersion;
      if (current && current !== recorded[catId]) {
        isStale = true;
        break;
      }
    }
    if (isStale) {
      mutated = true;
      const newWrapper = {
        ...wrapper,
        provenance: { ...wrapper.provenance, validationStatus: "stale" }
      };
      newById[id] = { ...record, [fieldName]: newWrapper };
      log.push({
        ruleId:     "INT-AI-DRIFT",
        recordKind: KIND_BY_COLLECTION[collName],
        recordId:   id,
        field:      fieldName + ".provenance.validationStatus",
        before:     "valid",
        after:      "stale",
        timestamp:  ts
      });
    } else {
      newById[id] = record;
    }
  }
  if (!mutated) return engagement;
  const newColl = { ...coll, byId: newById };
  if (collName === "instances") newColl.byState = engagement.instances.byState;
  return { ...engagement, [collName]: newColl };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

// True when the surviving id list differs from the original (any record
// dropped or reordered), meaning the collection must be rebuilt.
function collectionChanged(oldColl, newAllIds) {
  if (oldColl.allIds.length !== newAllIds.length) return true;
  for (let i = 0; i < newAllIds.length; i++) {
    if (oldColl.allIds[i] !== newAllIds[i]) return true;
  }
  return false;
}

// Rebuilds the instances byState index, splitting ids into current and
// desired buckets after some instances may have been removed.
function rebuildByState(byId, allIds) {
  const current = [];
  const desired = [];
  for (const id of allIds) {
    const inst = byId[id];
    if (inst.state === "current") current.push(id);
    else if (inst.state === "desired") desired.push(id);
  }
  return { current, desired };
}
