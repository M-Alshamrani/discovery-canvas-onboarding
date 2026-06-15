// services/groundingVerifier.js
//
// Runtime grounding verifier for chat. Scans an assistant response for
// entity-shaped claims (gap descriptions, vendor names in 'vendor "X"'
// shape, project-phase references like "Phase N" / "Q[1-4]", and
// parenthesized month-day deliverable dates) and cross-references each
// against the live engagement, with catalog reference data whitelisted.
//
// Pure and deterministic: no LLM calls, no state, same input always
// yields the same output.
//
// Returns { ok, violations }. Each violation carries a `severity`
// field:
//   "high"   gap-description fabrications (the engagement directly
//            carries gaps, so this is a clear hallucination)
//   "medium" out-of-engagement vendor names (could be a Dell-catalog
//            reference, so ambiguous)
//   "low"    project-phase and date-deliverable references (the schema
//            does not yet carry these fields, so the reference is
//            informational rather than a verified hallucination)
//
// chatService does not replace the response on ok:false; it attaches
// violations[] to the onComplete envelope as result.groundingViolations
// and the overlay renders a severity-tiered footer block below the
// assistant bubble.
//
// Call site: streamChat calls this after the post-stream scrubs
// (handshake strip + UUID scrub) but before returning to the overlay.
//
// The verifier asserts a structural property (entity references trace
// to the engagement), not LLM output semantics, and uses no
// mock/scripted substrate.

// Catalog whitelist: Dell product taxonomy and service families that
// commonly appear in workshop responses as reference data rather than
// engagement claims. Catalog data is not a hallucination even when it
// is not in the specific engagement. Lowercase and substring-match
// friendly.
const DELL_PRODUCT_TAXONOMY_LOWER = [
  "powerscale", "powermax", "powerstore", "poweredge", "powerflex",
  "powerprotect", "powerswitch", "powervault",
  "cyber recovery", "cyber-recovery", "cyberrecovery", "cybersense",
  "data domain", "datadomain", "networker", "avamar", "rsa",
  "apex", "vxrail", "vxblock", "vmware tanzu",
  "ecs", "cloudiq", "isilon", "unity", "compellent",
  "ome", "omnia", "openmanage",
  "dell emc", "dell technologies"
];

// Driver-label whitelist (business-driver catalog labels). Catalog
// reference data, not a hallucination.
const DRIVER_LABEL_WHITELIST_LOWER = [
  "cyber resilience", "ai & data platforms", "ai and data platforms",
  "compliance & sovereignty", "compliance and sovereignty",
  "cloud & cost optimization", "cloud and cost optimization",
  "operational excellence", "modernization", "consolidation",
  "edge transformation", "data sovereignty", "regulatory compliance"
];

// Months for parenthesized-date detection.
const MONTHS = "(?:January|February|March|April|May|June|July|August|September|October|November|December)";

// Severity-tier mapping. Each violation kind has an explicit severity
// for the chat-overlay annotation footer (high=red, medium=amber,
// low=muted). Unknown kinds default to "medium".
const SEVERITY_BY_KIND = {
  "gap-description":  "high",   // engagement directly carries gaps; fabrication is clear hallucination
  "vendor":           "medium", // could be Dell catalog reference; ambiguous
  "project-phase":    "low",    // v3 schema does not yet carry phase data; informational
  "date-deliverable": "low"     // v3 schema does not yet carry deliverable dates; informational
};

function severityFor(kind) {
  return SEVERITY_BY_KIND[kind] || "medium";
}

// Public API. Returns { ok: bool, violations: [{kind, claim, reason, severity}] }.
export function verifyGrounding(response, engagement) {
  const text = (response == null) ? "" : String(response);
  if (text.length === 0) return { ok: true, violations: [] };

  const map = buildGroundingMap(engagement);
  const violations = [];

  // Beyond-canvas blocks are the model's explicitly-marked
  // general/external analysis (competitive reads, strategy, benchmarks,
  // recommendations) — not claims about this engagement. Strip them
  // before scanning so legitimate outside analysis inside
  // ':::beyond-canvas ... :::' is never flagged as a hallucination. The
  // boundary contract (never fabricate the customer's own data, even
  // inside the marker) lives in the system prompt; the marker render
  // lives in the chat overlay.
  const scanText = text.replace(/:::beyond-canvas[\s\S]*?(?::::|$)/g, " ");

  // 1 · Gap-description claims · pattern: gap titled 'X' / gap "X" / gap named X
  // Also matches "another titled 'X'" when preceded by "gap" within a phrase.
  const GAP_QUOTED_RE = /\bgaps?\s+(?:titled|named|called)?\s*['"‘’“”]([^'"‘’“”]{4,200})['"‘’“”]/gi;
  let m;
  while ((m = GAP_QUOTED_RE.exec(scanText)) !== null) {
    const claim = m[1].trim();
    if (!gapClaimTraces(claim, map)) {
      violations.push({
        kind:     "gap-description",
        claim:    claim,
        reason:   "no matching gap description in engagement",
        severity: severityFor("gap-description")
      });
    }
  }
  // Also match "another titled 'X'" / "another gap 'X'" — companion
  // pattern for multi-gap fabrications.
  const ANOTHER_TITLED_RE = /\b(?:another|second|third)\s+(?:gap\s+)?(?:titled|named|called)\s+['"‘’“”]([^'"‘’“”]{4,200})['"‘’“”]/gi;
  while ((m = ANOTHER_TITLED_RE.exec(scanText)) !== null) {
    const claim = m[1].trim();
    if (!gapClaimTraces(claim, map)) {
      violations.push({
        kind:     "gap-description",
        claim:    claim,
        reason:   "no matching gap description in engagement (companion phrase)",
        severity: severityFor("gap-description")
      });
    }
  }

  // 2 · Vendor claims · pattern: vendor 'X' / vendor "X" (with optional
  // qualifier like fictional / unknown). Quoted vendor names are
  // strong signals of an engagement-specific claim.
  const VENDOR_QUOTED_RE = /\b(?:fictional\s+|imaginary\s+|hypothetical\s+|new\s+)?vendor\s+['"‘’“”]([^'"‘’“”]{2,100})['"‘’“”]/gi;
  while ((m = VENDOR_QUOTED_RE.exec(scanText)) !== null) {
    const claim = m[1].trim();
    if (!vendorClaimTraces(claim, map)) {
      violations.push({
        kind:     "vendor",
        claim:    claim,
        reason:   "vendor not in engagement instances and not in DELL_PRODUCT_TAXONOMY",
        severity: severityFor("vendor")
      });
    }
  }

  // 3 · Project-phase claims · "Phase N" or "Q[1-4]" appearing as a
  // deliverable / planning marker. v3.0 engagements do NOT carry phase
  // metadata yet, so any such claim is unsupported. v3.1 may add an
  // engagement-projects-phase whitelist; until then, the absence of
  // phase data in the engagement is itself the contract.
  const PHASE_RE = /\bPhase\s+(\d+)\b/g;
  while ((m = PHASE_RE.exec(scanText)) !== null) {
    if (!map.projectPhasesLower.has("phase " + m[1])) {
      violations.push({
        kind:     "project-phase",
        claim:    m[0],
        reason:   "phase number not declared in engagement",
        severity: severityFor("project-phase")
      });
    }
  }
  const QUARTER_RE = /\bQ([1-4])\b(?!\w)/g;
  while ((m = QUARTER_RE.exec(scanText)) !== null) {
    if (!map.projectPhasesLower.has("q" + m[1])) {
      violations.push({
        kind:     "project-phase",
        claim:    m[0],
        reason:   "quarter reference not declared in engagement",
        severity: severityFor("project-phase")
      });
    }
  }

  // 4 · Date-deliverable claims · parenthesized "(Month Day)" patterns
  // are workshop-project-plan style and almost always fabrication on a
  // v3.0 engagement (which carries engagementDate but no per-deliverable
  // calendar dates).
  const PAREN_DATE_RE = new RegExp("\\(\\s*" + MONTHS + "\\s+\\d{1,2}\\s*\\)", "gi");
  while ((m = PAREN_DATE_RE.exec(scanText)) !== null) {
    if (!map.dateDeliverablesLower.has(m[0].toLowerCase())) {
      violations.push({
        kind:     "date-deliverable",
        claim:    m[0],
        reason:   "deliverable date not declared in engagement",
        severity: severityFor("date-deliverable")
      });
    }
  }
  // Companion: parenthesized "(Q[1-4] <verb>)" like "(Q2 close)" — also
  // caught by QUARTER_RE above, but recorded specifically as a
  // date-deliverable when surrounded by a parenthesized hint.
  const PAREN_QUARTER_RE = /\(\s*Q[1-4][^)]{0,40}\)/g;
  while ((m = PAREN_QUARTER_RE.exec(scanText)) !== null) {
    if (!map.dateDeliverablesLower.has(m[0].toLowerCase())) {
      violations.push({
        kind:     "date-deliverable",
        claim:    m[0],
        reason:   "parenthesized quarter-deliverable not declared in engagement",
        severity: severityFor("date-deliverable")
      });
    }
  }

  return { ok: violations.length === 0, violations: violations };
}

// ─── Internal helpers ───────────────────────────────────────────────

// Build the grounding map from the engagement: lowercased indexes of
// every label/string the verifier may need to cross-reference against.
function buildGroundingMap(engagement) {
  const eng = engagement || {};
  const gapDescriptionsLower = [];
  const vendorsLower         = [];
  const instanceLabelsLower  = [];
  const projectPhasesLower   = new Set();
  const dateDeliverablesLower = new Set();

  if (eng.gaps && eng.gaps.allIds) {
    for (const id of eng.gaps.allIds) {
      const g = eng.gaps.byId && eng.gaps.byId[id];
      if (g && g.description) gapDescriptionsLower.push(String(g.description).toLowerCase());
    }
  }
  if (eng.instances && eng.instances.allIds) {
    for (const id of eng.instances.allIds) {
      const i = eng.instances.byId && eng.instances.byId[id];
      if (!i) continue;
      if (i.vendor)        vendorsLower.push(String(i.vendor).toLowerCase());
      if (i.vendorGroup === "custom" && i.vendor) vendorsLower.push(String(i.vendor).toLowerCase());
      if (i.label)         instanceLabelsLower.push(String(i.label).toLowerCase());
    }
  }
  // engagement.projects[] carries phase/deliverable data when present;
  // it is currently empty for these engagements.
  if (eng.projects && Array.isArray(eng.projects)) {
    for (const p of eng.projects) {
      if (p && p.phase) projectPhasesLower.add(String(p.phase).toLowerCase());
      if (p && p.deliverableDate) dateDeliverablesLower.add(String(p.deliverableDate).toLowerCase());
    }
  }
  return {
    gapDescriptionsLower,
    vendorsLower,
    instanceLabelsLower,
    projectPhasesLower,
    dateDeliverablesLower
  };
}

// A gap claim traces if the claim string is a substring of any
// engagement gap description (case-insensitive) — or vice versa, to
// allow paraphrasing of long gap descriptions in shorter chat turns.
function gapClaimTraces(claim, map) {
  const c = claim.toLowerCase();
  if (c.length < 4) return true;
  for (const desc of map.gapDescriptionsLower) {
    if (desc.indexOf(c) >= 0) return true;
    // Allow long-claim-contains-short-description pattern only if the
    // description is meaningful (not a single common word). Require
    // ≥6-char overlap.
    if (c.indexOf(desc) >= 0 && desc.length >= 6) return true;
  }
  return false;
}

// A vendor claim traces if it matches a vendor in the engagement
// instances or appears in the Dell product-taxonomy whitelist. The
// whitelist is a hard pass-through (catalog reference data is allowed).
function vendorClaimTraces(claim, map) {
  const c = claim.toLowerCase();
  for (const v of map.vendorsLower) {
    if (v === c || v.indexOf(c) >= 0 || c.indexOf(v) >= 0) return true;
  }
  for (const p of DELL_PRODUCT_TAXONOMY_LOWER) {
    if (c.indexOf(p) >= 0 || p.indexOf(c) >= 0) return true;
  }
  for (const d of DRIVER_LABEL_WHITELIST_LOWER) {
    if (c.indexOf(d) >= 0) return true;
  }
  return false;
}
