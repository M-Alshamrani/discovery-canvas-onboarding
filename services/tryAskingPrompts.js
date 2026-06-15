// services/tryAskingPrompts.js
//
// Dynamic try-asking prompts for the Canvas AI Assistant empty state.
//
// 3-bucket mixer (exactly 4 prompts returned per call):
//   - 1× how-to    (from core/appManifest.js workflows)
//   - 2× insight   (engagement-aware cross-reference templates)
//   - 1× showoff   (multi-tool question that demonstrates selector chaining)
//
// Deterministic per seed: callers can pass `{ seed: <int> }` to pin the
// random pick. CanvasChatOverlay generates a per-overlay-open seed so the
// empty-state doesn't reshuffle while the user is reading it.
//
// Empty-engagement fallback: if the engagement has no drivers, gaps,
// environments, or instances, the function returns a canonical fallback
// set so the empty-state always shows 4 viable suggestions.

import { WORKFLOWS } from "../core/appManifest.js";

// Static fallback set, so the no-engagement empty-state still feels
// curated.
const FALLBACK_PROMPTS = [
  "How many High-urgency gaps are open?",
  "Which environments have the most non-Dell instances?",
  "What initiatives serve our cyber resilience driver?",
  "Summarize the customer's strategic drivers in two sentences."
];

// ---- Bucket A: how-to (from app workflows) ----
function bucketHowTo(rng) {
  const candidates = WORKFLOWS.filter(w =>
    w && typeof w.name === "string" && w.name.length > 0);
  if (candidates.length === 0) return [];
  const pick = candidates[Math.floor(rng() * candidates.length)];
  // Lowercase the workflow name + use as the verb-phrase. Drop a
  // leading article ("a/an/the") if the lowercased version starts with
  // one (rare but possible).
  let phrase = pick.name.toLowerCase().replace(/^(a |an |the )/, "");
  return ["How do I " + phrase + "?"];
}

// ---- Bucket B: insight (engagement-aware cross-reference) ----
// Each template is a function (engagement, rng) => string|null. Returning
// null skips the template (e.g. "compare urgency for {topDriver}" when
// no drivers exist). The bucket picker filters out nulls.
const INSIGHT_TEMPLATES = [
  function compareUrgency(eng) {
    const drivers = (eng.drivers && eng.drivers.byId) ? Object.values(eng.drivers.byId) : [];
    const top = drivers.find(d => d && d.label) || drivers[0];
    if (!top) return null;
    return "Compare gap urgency for the " + top.label + " driver.";
  },
  function vendorDistribution() {
    return "Which environments have the highest non-Dell footprint, and what's the top consolidation candidate?";
  },
  function driverCoverage(eng) {
    const drivers = (eng.drivers && eng.drivers.byId) ? Object.values(eng.drivers.byId) : [];
    if (drivers.length === 0) return null;
    return "Which gaps directly serve the " + drivers.length + "-driver strategy, and which are orphaned?";
  },
  function layerMix() {
    return "Which layer has the most gaps, and how does it compare to the layer with the most current-state instances?";
  },
  function envOverlap() {
    return "Which two environments share the most affected gaps, and what does that tell us about replication priorities?";
  },
  function gapPhase(eng) {
    const gaps = (eng.gaps && eng.gaps.byId) ? Object.values(eng.gaps.byId) : [];
    if (gaps.length === 0) return null;
    return "Of the " + gaps.length + " open gaps, which belong in the now phase vs next vs later — and why?";
  },
  function customerNarrative(eng) {
    const c = (eng.customer && eng.customer.name) || null;
    if (!c) return null;
    return "Draft a 3-paragraph narrative for " + c + " covering current state, gaps, and roadmap.";
  },
  function dellOpportunity() {
    return "Where does Dell Technologies have the strongest opportunity in the current canvas — name the layer, the gap, and the recommended product family.";
  }
];

function bucketInsight(eng, rng) {
  const live = INSIGHT_TEMPLATES
    .map(fn => { try { return fn(eng, rng); } catch (_e) { return null; } })
    .filter(s => typeof s === "string" && s.length > 0);
  if (live.length < 2) return live; // graceful: return whatever we have
  // Pick 2 distinct.
  const picks = [];
  const pool  = live.slice();
  while (picks.length < 2 && pool.length > 0) {
    const idx = Math.floor(rng() * pool.length);
    picks.push(pool.splice(idx, 1)[0]);
  }
  return picks;
}

// ---- Bucket C: showoff (multi-tool questions) ----
const SHOWOFF_TEMPLATES = [
  "Cross-reference the cyber-resilience drivers with current backup gaps, then propose a 90-day roadmap with phasing.",
  "Show me the Dell density story by layer + by environment, and tell me which 2 environments would consolidate first.",
  "For every High-urgency gap, list the affected environments, the current vendor, and the recommended Dell product.",
  "Map gaps to drivers, then show which drivers have no gaps yet (white space) and which gaps have no driver (orphaned)."
];

function bucketShowoff(rng) {
  const idx = Math.floor(rng() * SHOWOFF_TEMPLATES.length);
  return [SHOWOFF_TEMPLATES[idx]];
}

// ---- Mulberry32 — small deterministic PRNG ----
// Same seed produces the same prompts. Used by the overlay's per-session
// seed so the empty-state doesn't reshuffle while the user is reading it.
function makeRng(seed) {
  let state = (seed | 0) || Math.floor(Date.now() % 2147483647);
  return function rng() {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// generateTryAskingPrompts(engagement, opts?) → string[] of length 4.
// opts.seed: integer; same seed → same prompts.
export function generateTryAskingPrompts(engagement, opts) {
  const eng = engagement && typeof engagement === "object" ? engagement : null;
  const o   = opts || {};
  const seed = typeof o.seed === "number" ? o.seed : null;

  // Empty-engagement fallback.
  const isEmpty = !eng ||
    (((eng.drivers       && eng.drivers.allIds)       || []).length === 0 &&
     ((eng.gaps          && eng.gaps.allIds)          || []).length === 0 &&
     ((eng.environments  && eng.environments.allIds)  || []).length === 0 &&
     ((eng.instances     && eng.instances.allIds)     || []).length === 0);
  if (isEmpty) return FALLBACK_PROMPTS.slice();

  const rng = makeRng(seed === null ? Date.now() : seed);
  const buckets = generatePromptsByBucket(eng, { seed: seed === null ? Date.now() : seed, _rng: rng });

  const merged = []
    .concat(buckets.howTo.slice(0, 1))
    .concat(buckets.insight.slice(0, 2))
    .concat(buckets.showoff.slice(0, 1));

  // Pad with fallback prompts if any bucket came up short (e.g. workflows
  // empty, insight-templates all returned null) so we always emit 4.
  while (merged.length < 4) {
    const next = FALLBACK_PROMPTS[merged.length] || FALLBACK_PROMPTS[merged.length % FALLBACK_PROMPTS.length];
    merged.push(next);
  }
  return merged.slice(0, 4);
}

// generatePromptsByBucket(engagement, opts?) → { howTo, insight, showoff }
// Exposes the per-bucket arrays so callers can introspect the mix.
// Production code should call generateTryAskingPrompts above.
export function generatePromptsByBucket(engagement, opts) {
  const eng = engagement && typeof engagement === "object" ? engagement : null;
  const o = opts || {};
  const rng = (o._rng || makeRng(typeof o.seed === "number" ? o.seed : Date.now()));
  const safeEng = eng || { drivers: { byId: {}, allIds: [] }, gaps: { byId: {}, allIds: [] },
                            environments: { byId: {}, allIds: [] }, instances: { byId: {}, allIds: [] } };
  return {
    howTo:   bucketHowTo(rng),
    insight: bucketInsight(safeEng, rng),
    showoff: bucketShowoff(rng)
  };
}
