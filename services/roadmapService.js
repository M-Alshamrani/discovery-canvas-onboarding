// services/roadmapService.js
// Groups gaps into Projects > Initiatives for the roadmap.
//
// HIERARCHY:
//   Project    = named cluster of related initiatives (same urgency phase + theme)
//   Initiative = one gap (atomic work item)
//
// Grouping logic:
//   1. Phase bucket (now / next / later) — primary axis on the roadmap
//   2. Within phase: cluster by gapType (enhance together, replace together, etc.)
//   3. Within cluster: sort by urgency (High first)
//
// Closed-gap behavior:
//   - filterGaps (internal helper): does NOT filter by gap.status. All gap-
//     consuming functions below inherit this — closed gaps influence
//     project urgency aggregation, layer impact, risk posture, exec summary.
//   - buildProjects: the services rollup excludes closed gaps. Other
//     rollups (urgency, phase, dellSolutions, layerIds, constituent gap
//     list) include closed gaps.
//   - computeLayerImpact: includes closed gaps in counts.
//   - computeDiscoveryCoverage: instance-side; not affected.
//   - computeRiskPosture: includes closed gaps in urgency aggregation.
//   - computeAccountHealthScore: composite; closed-gap influence inherited.
// Hidden-env behavior: not filtered here either; the caller passes a
// filter via the envId option, applied at the FilterBar layer rather
// than in this service.

import { LAYERS, ENVIRONMENTS, ENV_CATALOG, BUSINESS_DRIVERS } from "../core/config.js";
import { effectiveDriverId, effectiveDellSolutions } from "./programsService.js";
import { computeBucketMetrics } from "./healthMetrics.js";
// Centralized label resolvers. envLabel / layerLabel below delegate to
// core/labelResolvers.js, which returns structured placeholders rather
// than leaking a raw envId / layerId for unresolved input. Catalog
// typeIds (e.g. "coreDc") resolve via ENV_CATALOG; UUIDs resolve via the
// active engagement. Either input path yields a real label or a placeholder.
import {
  envLabel as _resolveEnvLabel,
  layerLabel as _resolveLayerLabel
} from "../core/labelResolvers.js";

// Action-verb map for project naming. There is no "rationalize" entry:
// the migrator coerces any legacy rationalize gaps to "ops" on load, so
// that gapType never reaches this map at runtime.
var ACTION_VERBS = {
  replace:     "Modernization",
  enhance:     "Enhancement",
  consolidate: "Consolidation",
  retire:      "Retirement",
  ops:         "Operational Improvement",
  introduce:   "Introduction"
};

// Theme colours, exposed as `project.color` for the roadmap UI.
var TYPE_THEME = {
  "replace":     { label: "Platform Replacement",    color: "proj-red"    },
  "introduce":   { label: "New Capabilities",        color: "proj-purple" },
  "enhance":     { label: "Enhancement & Upgrade",   color: "proj-blue"   },
  "consolidate": { label: "Consolidation",           color: "proj-amber"  },
  "ops":         { label: "Operational Improvements",color: "proj-gray"   },
  "null":        { label: "General Initiatives",     color: "proj-gray"   }
};

function urgencyRank(u) {
  return u === "High" ? 3 : u === "Medium" ? 2 : u === "Low" ? 1 : 0;
}

// Delegate to core/labelResolvers. The centralized resolver returns
// structured placeholders ("(unknown environment)", "(unknown layer)")
// for unresolved input and walks both the active-engagement collections
// and the static catalogs, so either input shape resolves correctly.
function envLabel(envId) { return _resolveEnvLabel(envId); }
function layerLabel(layerId) { return _resolveLayerLabel(layerId); }

function resolvePrimaryEnv(session, gap) {
  var envs = gap.affectedEnvironments || [];
  if (envs.length) return envs[0];
  var linkedCurId = (gap.relatedCurrentInstanceIds || [])[0];
  if (linkedCurId) {
    var cur = (session.instances || []).find(function(i) { return i.id === linkedCurId; });
    if (cur && cur.environmentId) return cur.environmentId;
  }
  return null;
}

// ---- gap filtering ----
function filterGaps(session, opts) {
  var layerIds = opts && opts.layerIds ? opts.layerIds : [];
  var envId    = opts && opts.envId    ? opts.envId    : "all";

  return (session.gaps || []).filter(function(g) {
    var layers = (g.affectedLayers && g.affectedLayers.length) ? g.affectedLayers : [g.layerId];
    var envs   = g.affectedEnvironments || [];
    var lOk = !layerIds.length || layers.some(function(l) { return layerIds.indexOf(l) >= 0; });
    var eOk = envId === "all" || envs.length === 0 || envs.indexOf(envId) >= 0;
    return lOk && eOk;
  });
}

// ---- V1: one initiative per gap ----
export function groupGapsIntoInitiatives(session, opts) {
  var initiatives = filterGaps(session, opts).map(function(gap) {
    var layers = (gap.affectedLayers && gap.affectedLayers.length)
      ? gap.affectedLayers.slice()
      : [gap.layerId];
    return {
      id:              "init-" + gap.id,
      phase:           gap.phase || "now",
      title:           gap.description || "(no description)",
      layers:          layers,
      environments:    (gap.affectedEnvironments || []).slice(),
      urgency:         gap.urgency || "Medium",
      mappedSolutions: gap.mappedDellSolutions || "",
      gapType:         gap.gapType || null,
      status:          gap.status  || "open",
      gaps:            [gap]
    };
  });
  return { initiatives: initiatives };
}

// ---- Auto-derive Projects by (primaryEnv, layerId, gapType) ----
// Each project bundles the gaps that match its tuple and exposes
// aggregated urgency, phase (mode), Dell solutions (deduped), and a
// resolved driverId (for roadmap swimlane assignment).
//
// Project shape:
//   id, envId, layerId, gapType, gaps[], gapCount, urgency, phase,
//   name ("{Env} — {Layer} {ActionVerb}"), driverId,
//   dellSolutions[], layerIds[] (affected-layers union)
//
// Aliases for the roadmap UI:
//   label (= name OR TYPE_THEME label for null gapType),
//   color (from TYPE_THEME),
//   layers (= layerIds),
//   initiatives (= gaps)
export function buildProjects(session, opts) {
  var gaps = filterGaps(session, opts);
  var buckets = {};

  gaps.forEach(function(gap) {
    var primaryEnv   = resolvePrimaryEnv(session, gap);
    var envKey       = primaryEnv || "crossCutting";
    var gapTypeKey   = gap.gapType || "null";
    // Group by the explicit gap.projectId when present; otherwise fall
    // back to an env::layer::gapType key. The migrator backfills
    // projectId on load, so the fallback is a safety net.
    var key = (typeof gap.projectId === "string" && gap.projectId.length > 0)
      ? gap.projectId
      : envKey + "::" + gap.layerId + "::" + gapTypeKey;

    if (!buckets[key]) {
      var verb  = ACTION_VERBS[gap.gapType] || "Initiative";
      var name  = envLabel(envKey) + " — " + layerLabel(gap.layerId) + " " + verb;
      var theme = TYPE_THEME[gapTypeKey] || TYPE_THEME["null"];
      buckets[key] = {
        id:            "proj-" + key,
        projectId:     key,               // v2.4.9 · explicit echo for callers
        envId:         envKey,
        layerId:       gap.layerId,
        gapType:       gap.gapType || null,
        gaps:          [],
        gapCount:      0,
        urgency:       "Low",
        phase:         "now",
        name:          name,
        label:         name,              // compat
        color:         theme.color,       // compat
        driverId:      null,
        dellSolutions: [],
        layerIds:      [],
        // Services rollup: union of constituent gap.services, deduped, in
        // first-occurrence order across the gaps in this bucket.
        services:      []
      };
    }

    var proj = buckets[key];
    proj.gaps.push(gap);

    if (urgencyRank(gap.urgency) > urgencyRank(proj.urgency)) proj.urgency = gap.urgency;

    // v2.1: Dell solutions derive from linked Dell desired tiles (not free-text).
    effectiveDellSolutions(gap, session).forEach(function(label) {
      if (proj.dellSolutions.indexOf(label) < 0) proj.dellSolutions.push(label);
    });

    var layers = (gap.affectedLayers && gap.affectedLayers.length) ? gap.affectedLayers : [gap.layerId];
    layers.forEach(function(l) {
      if (proj.layerIds.indexOf(l) < 0) proj.layerIds.push(l);
    });

    // Accumulate services from this gap into the project rollup. Skip
    // closed gaps so their stale services don't bleed into it; closed
    // gaps remain in the gaps list (users can reopen them) but no longer
    // drive the services-needed view of the project.
    if (gap.status !== "closed") {
      (gap.services || []).forEach(function(sid) {
        if (proj.services.indexOf(sid) < 0) proj.services.push(sid);
      });
    }
  });

  var projects = Object.keys(buckets).map(function(k) { return buckets[k]; });
  var driverOrder = (session.customer && session.customer.drivers || []).map(function(d) { return d.id; });

  projects.forEach(function(proj) {
    // Phase = mode of constituent gaps' phase; ties → earliest phase.
    var counts = { now: 0, next: 0, later: 0 };
    proj.gaps.forEach(function(g) { counts[g.phase || "now"]++; });
    var bestPhase = "now", bestCount = -1;
    ["now", "next", "later"].forEach(function(ph) {
      if (counts[ph] > bestCount) { bestPhase = ph; bestCount = counts[ph]; }
    });
    proj.phase = bestPhase;
    proj.gapCount = proj.gaps.length;
    // Aliases for the roadmap UI:
    proj.layers      = proj.layerIds;
    proj.initiatives = proj.gaps;

    // Program (driverId) = mode of constituent gaps' effective driver;
    // ties → first driver in session order (stable).
    var driverCounts = {};
    proj.gaps.forEach(function(g) {
      var did = effectiveDriverId(g, session);
      if (did) driverCounts[did] = (driverCounts[did] || 0) + 1;
    });
    var bestDriver = null, bestDriverCount = 0;
    driverOrder.forEach(function(did) {
      var c = driverCounts[did] || 0;
      if (c > bestDriverCount) { bestDriver = did; bestDriverCount = c; }
    });
    proj.driverId = bestDriver;

    // Retirement verb override. When every constituent gap's linked
    // desired instance(s) carry disposition "retire", relabel the project
    // from "Operational Improvement" to "Retirement" — capturing the
    // semantic distinction without adding a new gapType.
    if (proj.gapType === "ops") {
      var allRetire = proj.gaps.every(function(g) {
        var desiredIds = g.relatedDesiredInstanceIds || [];
        if (desiredIds.length === 0) return false;
        return desiredIds.every(function(did) {
          var d = (session.instances || []).find(function(i) { return i.id === did; });
          return d && d.disposition === "retire";
        });
      });
      if (allRetire) {
        var retName = envLabel(proj.envId) + " — " + layerLabel(proj.layerId) + " Retirement";
        proj.name  = retName;
        proj.label = retName;
      }
    }
  });

  return { projects: projects };
}

// ---- Layer impact matrix ----
export function computeLayerImpact(session, opts) {
  var ids    = (opts && opts.layerIds && opts.layerIds.length) ? opts.layerIds : LAYERS.map(function(l) { return l.id; });
  var impact = {};
  ids.forEach(function(id) { impact[id] = { now: 0, next: 0, later: 0 }; });
  LAYERS.forEach(function(l) { if (!impact[l.id]) impact[l.id] = { now: 0, next: 0, later: 0 }; });

  filterGaps(session, opts).forEach(function(gap) {
    var layers = (gap.affectedLayers && gap.affectedLayers.length) ? gap.affectedLayers : [gap.layerId];
    var phase  = gap.phase || "now";
    layers.forEach(function(lid) {
      if (!impact[lid]) impact[lid] = { now: 0, next: 0, later: 0 };
      impact[lid][phase] = (impact[lid][phase] || 0) + 1;
    });
  });
  return impact;
}

// ---- Discovery Coverage (0-100 %) ----
// Pure; accepts a session snapshot.
export function computeDiscoveryCoverage(session) {
  var cust = (session && session.customer) || {};
  var instances = (session && session.instances) || [];
  var gaps = (session && session.gaps) || [];
  var drivers = Array.isArray(cust.drivers) ? cust.drivers : [];

  var currentTiles = instances.filter(function(i) { return i.state === "current"; });

  // Fraction 1: current tiles with a disposition (via a desired counterpart)
  var currentWithDisposition = currentTiles.filter(function(cur) {
    return instances.some(function(d) {
      return d.state === "desired" && d.originId === cur.id && d.disposition;
    });
  }).length;
  var fracDisposed = currentTiles.length === 0 ? 1 : (currentWithDisposition / currentTiles.length);

  // Fraction 2: auto-drafted gaps that are reviewed
  var autoGaps = gaps.filter(function(g) {
    return (g.relatedDesiredInstanceIds || []).length > 0;
  });
  var reviewedAuto = autoGaps.filter(function(g) { return g.reviewed === true; }).length;
  var fracReviewed = autoGaps.length === 0 ? 1 : (reviewedAuto / autoGaps.length);

  // Fraction 3: gaps with explicit driverId
  var gapsWithDriver = gaps.filter(function(g) { return !!g.driverId; }).length;
  var fracDriverAssigned = gaps.length === 0 ? 1 : (gapsWithDriver / gaps.length);

  // Fraction 4: session has ≥1 strategic driver
  var fracDriversPresent = drivers.length >= 1 ? 1 : 0;

  var weighted = 0.40 * fracDisposed
               + 0.30 * fracReviewed
               + 0.20 * fracDriverAssigned
               + 0.10 * fracDriversPresent;
  var percent = Math.round(weighted * 100);

  // Empty session edge case: nothing captured → 0
  if (currentTiles.length === 0 && gaps.length === 0 && drivers.length === 0) percent = 0;

  var actions = [];
  var draftsToReview = autoGaps.length - reviewedAuto;
  if (draftsToReview > 0) {
    actions.push(draftsToReview + " draft" + (draftsToReview > 1 ? "s" : "") + " to review");
  }
  var unassigned = gaps.length - gapsWithDriver;
  if (unassigned > 0) {
    actions.push(unassigned + " gap" + (unassigned > 1 ? "s" : "") + " unassigned to a driver");
  }
  var missingDisp = currentTiles.length - currentWithDisposition;
  if (missingDisp > 0) {
    actions.push(missingDisp + " current tile" + (missingDisp > 1 ? "s" : "") + " without a disposition");
  }
  if (drivers.length === 0) {
    actions.push("No strategic drivers added yet");
  }

  return { percent: percent, actions: actions.slice(0, 3) };
}

// ---- Risk Posture (labeled level) ----
// First-match rule ladder over bucket scores + now-phase gaps.
export function computeRiskPosture(session) {
  var gaps = (session && session.gaps) || [];
  var instances = (session && session.instances) || [];

  // Bucket scores across the full LAYER × ENV matrix.
  var bucketScores = [];
  LAYERS.forEach(function(layer) {
    ENVIRONMENTS.forEach(function(env) {
      var m = computeBucketMetrics(layer.id, env.id, session);
      bucketScores.push({ layer: layer, env: env, score: m.totalScore });
    });
  });
  var bucketsHigh = bucketScores.filter(function(b) { return b.score > 6; });
  var bucketsMid  = bucketScores.filter(function(b) { return b.score >= 4 && b.score <= 6; });

  var nowHighGaps = gaps.filter(function(g) {
    return g.phase === "now" && g.urgency === "High" && g.status !== "closed";
  });
  var nowMedGaps = gaps.filter(function(g) {
    return g.phase === "now" && g.urgency === "Medium" && g.status !== "closed";
  });

  // Critical current tiles without any disposition set yet
  var criticalUnreviewed = instances.filter(function(i) {
    if (i.state !== "current" || i.criticality !== "High") return false;
    return !instances.some(function(d) {
      return d.state === "desired" && d.originId === i.id;
    });
  });

  var level, colour;
  if (bucketsHigh.length >= 2 || nowHighGaps.length >= 3 || criticalUnreviewed.length > 0) {
    level = "High";     colour = "var(--crit-high)";
  } else if (bucketsHigh.length >= 1 || nowHighGaps.length >= 1) {
    level = "Elevated"; colour = "#ea580c";
  } else if (bucketsMid.length >= 1 || nowMedGaps.length >= 2) {
    level = "Moderate"; colour = "var(--crit-medium)";
  } else {
    level = "Stable";   colour = "var(--crit-low)";
  }

  var actions = [];
  if (nowHighGaps.length > 0) {
    actions.push("Close " + nowHighGaps.length + " High-urgency gap" +
      (nowHighGaps.length > 1 ? "s" : "") + " in Now phase");
  }
  if (bucketsHigh.length > 0) {
    var b = bucketsHigh[0];
    actions.push("Address risk in " + b.layer.label + " × " + b.env.label);
  }
  if (criticalUnreviewed.length > 0) {
    actions.push("Review " + criticalUnreviewed.length + " critical current tile" +
      (criticalUnreviewed.length > 1 ? "s" : "") + " without a disposition");
  }
  if (level === "Stable" && actions.length === 0) {
    actions.push("Posture is stable — maintain discovery hygiene");
  }

  return { level: level, colour: colour, actions: actions.slice(0, 2) };
}

// ---- Account health score (0-100) ----
// Superseded by computeDiscoveryCoverage + computeRiskPosture, which
// drive the Overview. Retained for AI / legacy readers; do not drive
// the Overview from here.
export function computeAccountHealthScore(session) {
  var gaps = session.gaps || [];
  var instances = session.instances || [];
  if (!gaps.length && !instances.length) return null;

  var highGaps   = gaps.filter(function(g) { return g.urgency === "High" && g.status !== "closed"; }).length;
  var medGaps    = gaps.filter(function(g) { return g.urgency === "Medium" && g.status !== "closed"; }).length;
  var closedGaps = gaps.filter(function(g) { return g.status === "closed"; }).length;
  var totalGaps  = gaps.length;

  // Simple scoring: start at 100, deduct for open high/medium gaps, credit for closed
  var score = 100;
  score -= highGaps * 12;
  score -= medGaps  *  5;
  score += closedGaps * 3;
  score = Math.max(0, Math.min(100, score));
  return Math.round(score);
}

// ---- Structured session brief ----
// Returns [{ label, text }] so the UI can render a scannable definition
// list. Each row is a factual roll-up of current session state using the
// Coverage + Risk + program model.
export function generateSessionBrief(session) {
  var cust = (session && session.customer) || {};
  var drivers = Array.isArray(cust.drivers) ? cust.drivers : [];
  var gaps = (session && session.gaps) || [];
  var instances = (session && session.instances) || [];
  var coverage = computeDiscoveryCoverage(session);
  var risk = computeRiskPosture(session);
  var rows = [];

  // Customer
  var custParts = [];
  custParts.push(cust.name || "(no customer name)");
  if (cust.vertical) custParts.push(cust.vertical);
  if (cust.region)   custParts.push(cust.region);
  rows.push({ label: "Customer", text: custParts.join(" · ") });

  // Strategic drivers
  if (drivers.length) {
    var driverText = drivers.map(function(d) {
      var meta = BUSINESS_DRIVERS.find(function(b) { return b.id === d.id; });
      return (meta ? meta.label : d.id) + " (" + (d.priority || "Medium") + ")";
    }).join(", ");
    rows.push({ label: "Strategic Drivers", text: driverText });
  } else {
    rows.push({ label: "Strategic Drivers", text: "None added yet — start in Tab 1" });
  }

  // Risk Posture — level + first action hint
  var riskText = risk.level;
  if (risk.actions && risk.actions.length) riskText += " — " + risk.actions[0];
  rows.push({ label: "Risk Posture", text: riskText });

  // Discovery Coverage — % + first 2 actions
  var covActions = (coverage.actions || []).slice(0, 2).join("; ");
  var covText = coverage.percent + "%" + (covActions ? " — " + covActions : "");
  rows.push({ label: "Discovery Coverage", text: covText });

  // Pipeline
  if (gaps.length) {
    var nowC = gaps.filter(function(g) { return g.phase === "now"; }).length;
    var nextC = gaps.filter(function(g) { return g.phase === "next"; }).length;
    var laterC = gaps.filter(function(g) { return g.phase === "later"; }).length;
    rows.push({ label: "Pipeline", text: nowC + " Now · " + nextC + " Next · " + laterC + " Later" });
  }

  // Top 3 High-urgency gaps in Now phase (critical focus)
  var topHighNow = gaps.filter(function(g) {
    return g.urgency === "High" && g.phase === "now" && g.status !== "closed";
  }).slice(0, 3);
  if (topHighNow.length) {
    var topText = topHighNow.map(function(g) {
      return '"' + (g.description || "untitled gap") + '"';
    }).join("; ");
    rows.push({ label: "Top gaps (High · Now)", text: topText });
  }

  // Dell solutions — unique deduped count + preview
  var solutionSet = {};
  gaps.forEach(function(g) {
    effectiveDellSolutions(g, session).forEach(function(s) { solutionSet[s] = true; });
  });
  var solutionsList = Object.keys(solutionSet);
  if (solutionsList.length) {
    var preview = solutionsList.slice(0, 3).join(", ");
    if (solutionsList.length > 3) preview += ", +" + (solutionsList.length - 3) + " more";
    rows.push({ label: "Dell solutions mapped", text: solutionsList.length + " unique — " + preview });
  }

  // Instances footprint
  var currentCount = instances.filter(function(i) { return i.state === "current"; }).length;
  var desiredCount = instances.filter(function(i) { return i.state === "desired"; }).length;
  rows.push({ label: "Instances", text: currentCount + " current · " + desiredCount + " desired" });

  return rows;
}

// ---- Executive summary (string API) ----
// Returns a single string for AI / legacy readers, built from the same
// structured brief the Overview UI uses.
export function generateExecutiveSummary(session) {
  var gaps = session.gaps || [];
  var cust = session.customer || {};
  if (!gaps.length) {
    return (cust.name || "The customer") +
      " — no gaps defined yet. Complete Current State and Desired State, then return to Reporting.";
  }
  // Flatten the same structured brief the Overview UI uses.
  var rows = generateSessionBrief(session);
  return rows.map(function(r) { return r.label + ": " + r.text; }).join(" | ");
}

// ---- Legacy narrative generator ----
// Superseded by generateSessionBrief; retained internally for any
// external callers.
function _legacyNarrativeSummary(session) {
  var gaps     = session.gaps || [];
  var cust     = session.customer || {};
  var highGaps = gaps.filter(function(g) { return g.urgency === "High" && g.status !== "closed"; });
  var nowGaps  = gaps.filter(function(g) { return g.phase === "now"; });
  var score    = computeAccountHealthScore(session);

  if (!gaps.length) {
    return "No gaps have been defined yet. Complete the Current State and Desired State steps, then return to Reporting to see the executive summary.";
  }

  var name = cust.name || "the customer";
  var driversList = Array.isArray(cust.drivers) ? cust.drivers : [];
  var topDriver   = driversList.find(function(d) { return d.priority === "High"; }) || driversList[0];
  var driverLabel = "infrastructure modernisation";
  if (topDriver && topDriver.id) {
    var meta = BUSINESS_DRIVERS.find(function(d) { return d.id === topDriver.id; });
    if (meta) driverLabel = meta.label.toLowerCase();
  }

  var lines = [];
  lines.push(name + " is engaged on a journey driven by " + driverLabel + ".");
  if (highGaps.length > 0) {
    lines.push(highGaps.length + " High-urgency initiative" + (highGaps.length > 1 ? "s require" : " requires") +
      " immediate attention: " + highGaps.slice(0, 2).map(function(g) { return g.description; }).join("; ") +
      (highGaps.length > 2 ? " and " + (highGaps.length - 2) + " more" : "") + ".");
  }
  if (nowGaps.length > 0) {
    lines.push(nowGaps.length + " initiative" + (nowGaps.length > 1 ? "s are" : " is") +
      " planned for the next 12 months, with Dell solutions mapped across " +
      countUniqueLayers(nowGaps) + " architecture layers.");
  }
  if (score !== null) {
    var health = score >= 70 ? "healthy" : score >= 40 ? "moderate" : "at risk";
    lines.push("Overall account health score: " + score + "/100 (" + health + ") -- " +
      (score >= 70 ? "strong progress toward the desired state."
                   : "key gaps remain open and require joint action."));
  }
  return lines.join(" ");
}

function countUniqueLayers(gaps) {
  var set = {};
  gaps.forEach(function(g) {
    var layers = (g.affectedLayers && g.affectedLayers.length) ? g.affectedLayers : [g.layerId];
    layers.forEach(function(l) { set[l] = true; });
  });
  return Object.keys(set).length;
}
