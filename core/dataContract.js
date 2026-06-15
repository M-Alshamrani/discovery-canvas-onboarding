// core/dataContract.js
//
// THE single source of truth for the v3 engagement data model. Every code
// path that reads, writes, or surfaces engagement data routes through this
// file (via getDataContract / getStandardMutableDataPoints /
// getAllMutableDataPoints / getInsightsDataPoints / getLabelResolvedPaths)
// or its derived consumers (services/labelResolvers.js, state/adapter.js,
// state/engagementStore.js). Direct `engagement.<collection>.byId` access
// outside state/adapter.js is disallowed.
//
// The contract is derived, never hand-maintained: it is assembled from the
// schemas + manifest + catalogs at module load, validates itself on import,
// carries a deterministic checksum, and is serialized into the chat system
// prompt as the authoritative reference for every LLM turn.
//
// This module also publishes the bindable-path catalogs the Skill Builder
// picker consumes:
//   - STANDARD_MUTABLE_PATHS: the author-meaningful fields, including the
//     catalog-resolved label paths the schema doesn't carry but every UI
//     surface displays (driver.name, gap.driverName, etc.).
//   - INSIGHTS_PATHS: derived/computed values surfaced on the Reporting tab
//     (coverage %, risk level, totals, project pipeline, vendor mix), made
//     bindable for skills.
//   - LABEL_RESOLVED_PATHS: declares which paths require a catalog-join at
//     runtime, so skill-context assembly routes them through
//     services/labelResolvers.js.
//
// What this file does NOT define: schema fields (schema/*.js), catalog
// entries (catalogs/), FK relationships, or invariants — those live in
// their own modules and are only read here. ENTITY_DESCRIPTIONS /
// FIELD_DESCRIPTIONS / RELATIONSHIP_DESCRIPTIONS are hand-authored prose
// (content, not contract shape).

import { CustomerSchema, customerFkDeclarations }                from "../schema/customer.js";
import { DriverSchema, driverFkDeclarations }                    from "../schema/driver.js";
import { EnvironmentSchema, environmentFkDeclarations }          from "../schema/environment.js";
import { InstanceSchema, instanceFkDeclarations }                from "../schema/instance.js";
import { GapSchema, gapFkDeclarations }                          from "../schema/gap.js";
import { EngagementMetaSchema, CURRENT_SCHEMA_VERSION }          from "../schema/engagement.js";
import { generateManifest }                                       from "../services/manifestGenerator.js";
import { loadAllCatalogs }                                        from "../services/catalogLoader.js";
import { CHAT_TOOLS }                                             from "../services/chatTools.js";

// ─── Hand-authored prose ──────────────────────────────────────────────
// Human-readable descriptions joined into the contract for the LLM.

const ENTITY_DESCRIPTIONS = {
  engagementMeta: "Workshop-level metadata. One per engagement.",
  customer:       "Single customer record per engagement.",
  driver:         "Strategic / business driver the engagement addresses. Collection. Each driver references a BUSINESS_DRIVERS catalog entry + carries presales-captured priority + outcomes free-text.",
  environment:    "Physical or logical environment (data center, edge site, cloud region). Collection.",
  instance:       "A single asset OR workload at a (state, layer, environment) cell. state is 'current' (today's reality) or 'desired' (future-state plan).",
  gap:            "A discrete improvement opportunity derived from current↔desired delta + business drivers."
};

const FIELD_DESCRIPTIONS = {
  engagementMeta: { engagementId:"UUID", schemaVersion:"Locked '3.0'", isDemo:"true if engagement is the v3-native demo", ownerId:"User identifier (defaults 'local-user')", presalesOwner:"Owning presales engineer", engagementDate:"ISO date or null", status:"Draft|In review|Locked", createdAt:"ISO datetime", updatedAt:"ISO datetime" },
  customer:       { engagementId:"FK to engagement.meta.engagementId", name:"Customer name (≥1 char)", vertical:"FK to CUSTOMER_VERTICALS catalog", region:"Geographic region", notes:"Free-text notes" },
  driver:         { id:"UUID", engagementId:"FK", createdAt:"ISO", updatedAt:"ISO", businessDriverId:"FK to BUSINESS_DRIVERS catalog", catalogVersion:"Pinned catalog version", priority:"High|Medium|Low — criticality LEVEL of this driver to the customer (NOT a rank). Multiple drivers may all be High.", outcomes:"Free-text bullets capturing presales-discussion outcomes (the driver's comment/discussion field)" },
  environment:    { id:"UUID", engagementId:"FK", createdAt:"ISO", updatedAt:"ISO", envCatalogId:"FK to ENV_CATALOG", catalogVersion:"Pinned", hidden:"Soft-delete flag", alias:"Human-friendly name", location:"Geographic location", sizeKw:"Power footprint kW", sqm:"Floor space m²", tier:"Resilience tier", notes:"Free-text" },
  instance:       { id:"UUID", engagementId:"FK", createdAt:"ISO", updatedAt:"ISO", state:"current|desired", layerId:"FK to LAYERS", environmentId:"FK to environment", label:"Display label", vendor:"Vendor name", vendorGroup:"dell|nonDell|custom", criticality:"High|Medium|Low — criticality LEVEL of this asset/workload (NOT a rank)", notes:"Free-text", disposition:"FK to DISPOSITION_ACTIONS", originId:"DESIRED-only: FK to current instance this replaces", priority:"DESIRED-only: Now|Next|Later — phase-of-life, NOT criticality", mappedAssetIds:"WORKLOAD-only: array of FK to instances", aiSuggestedDellMapping:"Provenance-wrapped Dell-mapping suggestion (§S8)", aiTag:"AI-mutation provenance stamp; cleared on next engineer save" },
  gap:            { id:"UUID", engagementId:"FK", createdAt:"ISO", updatedAt:"ISO", description:"Free-text gap statement", gapType:"FK to GAP_TYPES (enhance|replace|introduce|consolidate|ops)", urgency:"High|Medium|Low — urgency LEVEL (derived from linked current's criticality unless override)", urgencyOverride:"true if user manually pinned urgency", phase:"now|next|later — phase-of-life", status:"open|in_progress|closed|deferred", reviewed:"true if presales has reviewed an auto-drafted gap", origin:"manual|autoDraft (provenance flag)", notes:"Free-text", driverId:"Optional FK to driver (the 'why' of this gap)", layerId:"Primary layer (FK to LAYERS)", affectedLayers:"Array; affectedLayers[0] === layerId (G6 invariant)", affectedEnvironments:"Array of FK to environments (cross-cutting; ≥1)", relatedCurrentInstanceIds:"Array of FK to current instances", relatedDesiredInstanceIds:"Array of FK to desired instances", services:"Array of FK to SERVICE_TYPES catalog", aiMappedDellSolutions:"Provenance-wrapped Dell-solutions list (§S8) — superseded at display time by derived effectiveDellSolutions" }
};

const RELATIONSHIP_DESCRIPTIONS = {
  "driver.businessDriverId":           "Driver references a CxO-priority entry in BUSINESS_DRIVERS. The catalog entry's `label` is what the user sees; the id is the FK.",
  "environment.envCatalogId":          "Environment references an ENV_CATALOG entry. The catalog entry's `label` is what the user sees.",
  "instance.layerId":                  "Instance lives at one of the 6 architectural layers. layerId is a string FK to LAYERS catalog.",
  "instance.environmentId":            "Instance lives in exactly one environment. FK to environments collection.",
  "instance.disposition":              "Disposition action verb (keep|enhance|replace|consolidate|retire|introduce). FK to DISPOSITION_ACTIONS catalog.",
  "instance.originId":                 "DESIRED-state-only: links a desired instance back to the current instance it replaces. FK to instances (state='current').",
  "instance.mappedAssetIds[]":         "WORKLOAD-layer-only: a workload's underlying compute/storage/dataProtection assets. CROSS-CUTTING.",
  "gap.gapType":                       "Gap action verb. FK to GAP_TYPES catalog.",
  "gap.driverId":                      "Optional: which strategic driver rationalizes this gap. FK to drivers collection.",
  "gap.layerId":                       "Primary layer the gap affects. FK to LAYERS.",
  "gap.affectedLayers[]":              "All layers the gap touches. Array. INVARIANT G6: affectedLayers[0] === layerId.",
  "gap.affectedEnvironments[]":        "All environments the gap touches. CROSS-CUTTING. Array of FK to environments.",
  "gap.relatedCurrentInstanceIds[]":   "Current-state instances anchoring the gap. Array of FK to instances (state='current').",
  "gap.relatedDesiredInstanceIds[]":   "Desired-state instances the gap proposes/depends on. Array of FK to instances (state='desired').",
  "gap.services[]":                    "Dell services scoped to address the gap. Array of FK to SERVICE_TYPES catalog.",
  "customer.vertical":                 "Customer industry/segment. FK to CUSTOMER_VERTICALS catalog."
};

const INVARIANTS = [
  { id: "G6",  description: "gap.affectedLayers[0] === gap.layerId." },
  { id: "I9",  description: "instance.mappedAssetIds non-empty ONLY on layerId='workload'." },
  { id: "I-state-originId", description: "instance.originId only on state='desired'." },
  { id: "I-state-priority", description: "instance.priority only on state='desired'." },
  { id: "I-no-self-origin", description: "instance.originId must not point at the instance itself." },
  { id: "AL7", description: "Ops-typed gaps require at least one of {links, notes, mappedDellSolutions}." },
  { id: "FK-byId-allIds-parity", description: "For every Collection<T>: byId keys must equal allIds set." },
  { id: "schemaVersion-locked", description: "engagement.meta.schemaVersion is the literal '3.0'." }
];

const CATALOG_DESCRIPTIONS = {
  BUSINESS_DRIVERS:       "CxO-priority strategic drivers. Used as the 'why' on every gap (gap.driverId). 8 entries.",
  ENV_CATALOG:            "Environment archetypes. 8 entries.",
  LAYERS:                 "6 architectural layers.",
  GAP_TYPES:              "5 gap action types.",
  DISPOSITION_ACTIONS:    "7 disposition verbs an instance can carry.",
  SERVICE_TYPES:          "Dell services that can scope a gap.",
  CUSTOMER_VERTICALS:     "Industry / segment classifications for the customer.",
  DELL_PRODUCT_TAXONOMY:  "Curated Dell product list per SPEC §S6.2.1."
};

// ─── Label-resolved path declarations ─────────────────────────────────
//
// Paths the schema doesn't carry as direct fields but every UI surface
// displays as the catalog-joined label. Skill-context assembly routes
// these through services/labelResolvers.js so a skill bound to
// "driver.name" sees "Cyber Resilience" not "cyber_resilience".
//
// Shape: { path → { entity, joinPath, joinCatalog, joinField, scope } }
//   joinPath:    the raw FK field on the record
//   joinCatalog: the catalog the FK references
//   joinField:   the catalog field to render ("label" usually)
//   scope:       "standard" or "advanced" (drives picker categorization)

export const LABEL_RESOLVED_PATHS = Object.freeze({
  "customer.verticalLabel": {
    entity: "customer", joinPath: "vertical",
    joinCatalog: "CUSTOMER_VERTICALS", joinField: "label", scope: "standard"
  },
  "driver.name": {
    entity: "driver", joinPath: "businessDriverId",
    joinCatalog: "BUSINESS_DRIVERS", joinField: "label", scope: "standard"
  },
  "driver.hint": {
    entity: "driver", joinPath: "businessDriverId",
    joinCatalog: "BUSINESS_DRIVERS", joinField: "hint", scope: "advanced"
  },
  "environment.name": {
    entity: "environment", joinPath: "envCatalogId",
    joinCatalog: "ENV_CATALOG", joinField: "label",
    fallbackField: "alias", scope: "standard"
  },
  "environment.kindLabel": {
    entity: "environment", joinPath: "envCatalogId",
    joinCatalog: "ENV_CATALOG", joinField: "label", scope: "advanced"
  },
  "instance.layerLabel": {
    entity: "instance", joinPath: "layerId",
    joinCatalog: "LAYERS", joinField: "label", scope: "standard"
  },
  "instance.environmentName": {
    entity: "instance", joinPath: "environmentId",
    joinCatalog: "environments", joinField: "alias", scope: "standard"
    // NOTE: joinCatalog="environments" signals cross-entity join to the
    // engagement's environments collection, not a static catalog. The
    // resolver computes env.alias || ENV_CATALOG.byId[env.envCatalogId].label.
  },
  "instance.dispositionLabel": {
    entity: "instance", joinPath: "disposition",
    joinCatalog: "DISPOSITION_ACTIONS", joinField: "label", scope: "standard"
  },
  "gap.gapTypeLabel": {
    entity: "gap", joinPath: "gapType",
    joinCatalog: "GAP_TYPES", joinField: "label", scope: "standard"
  },
  "gap.layerLabel": {
    entity: "gap", joinPath: "layerId",
    joinCatalog: "LAYERS", joinField: "label", scope: "standard"
  },
  "gap.driverName": {
    entity: "gap", joinPath: "driverId",
    joinCatalog: "drivers", joinField: "name", scope: "standard"
    // NOTE: multi-hop. Resolves gap.driverId → engagement.drivers.byId[id].businessDriverId
    //                 → BUSINESS_DRIVERS.byId[bid].label.
  },
  "gap.affectedLayerLabels": {
    entity: "gap", joinPath: "affectedLayers",
    joinCatalog: "LAYERS", joinField: "label", scope: "standard",
    isArray: true
  },
  "gap.affectedEnvironmentNames": {
    entity: "gap", joinPath: "affectedEnvironments",
    joinCatalog: "environments", joinField: "alias", scope: "standard",
    isArray: true
  },
  "gap.servicesLabels": {
    entity: "gap", joinPath: "services",
    joinCatalog: "SERVICE_TYPES", joinField: "label", scope: "standard",
    isArray: true
  }
});

// ─── STANDARD_MUTABLE_PATHS ───────────────────────────────────────────
//
// The author-meaningful subset of bindable paths — each one maps to a real
// surface the user authors or reads on the canvas.
//
// Categorization rules:
// · Customer-meaningful authored content → Standard
// · Catalog-resolved labels for the FK fields the UI actually displays → Standard
// · Driver-, env-, gap-level "notes" / "outcomes" free-text → Standard
// · Raw FK ids → Advanced (rare; kept for skills that need ids)
// · UUIDs, audit timestamps, provenance metadata, catalog versions → excluded

export const STANDARD_MUTABLE_PATHS = Object.freeze([
  // ─── Customer (singleton, 4 paths) ───
  "customer.name",                   // Tab 1 §2 input
  "customer.verticalLabel",          // LABEL_RESOLVED; renders "Healthcare" not "healthcare"
  "customer.region",                 // Tab 1 §2 input
  "customer.notes",                  // Tab 1 §2 textarea (added 2026-05-11 WB-2)
  // customer.vertical (raw FK id) lives in Advanced; reachable via getAllMutableDataPoints.

  // ─── EngagementMeta (singleton, 1 path) ───
  "engagementMeta.presalesOwner",    // Tab 1 §2 input (wired 2026-05-11 WB-1)

  // ─── Driver (collection, 3 paths) ───
  "driver.name",                     // LABEL_RESOLVED from BUSINESS_DRIVERS — the customer-facing driver name
  "driver.priority",                 // Tab 1 §4 dropdown — High/Medium/Low criticality LEVEL (NOT a rank)
  "driver.outcomes",                 // Tab 1 §4 textarea — the per-driver discussion/comment field

  // ─── Environment (collection, 6 paths) ───
  "environment.name",                // alias || catalog label fallback
  "environment.location",            // Tab 1 §6 input
  "environment.tier",                // Tab 1 §6 datalist
  "environment.sizeKw",              // Tab 1 §6 number input
  "environment.sqm",                 // Tab 1 §6 number input
  "environment.notes",               // Tab 1 §6 input (was misclassified as dead-end in earlier audit pass)

  // ─── Instance (collection — current + desired, 9 paths) ───
  "instance.label",                  // Tab 2/3 §5/§7 from + Add palette
  "instance.vendor",                 // Tab 2/3 §6/§11 palette / vendor chooser
  "instance.vendorGroup",            // Tab 2/3 — dell/nonDell/custom (drives vendor-mix narration)
  "instance.layerLabel",             // LABEL_RESOLVED from LAYERS
  "instance.environmentName",        // LABEL_RESOLVED from environments collection
  "instance.criticality",            // Tab 2 §7 dropdown — criticality LEVEL (NOT a rank)
  "instance.dispositionLabel",       // LABEL_RESOLVED — DESIRED-only; renders "Replace" not "replace"
  "instance.priority",               // Tab 3 §9 — Now/Next/Later phase-of-life (NOT criticality)
  "instance.notes",                  // Tab 2/3 §7/§9 textarea

  // ─── Gap (collection, 11 paths) ───
  "gap.description",                 // Tab 4 §8e textarea + §10 add dialog
  "gap.urgency",                     // Tab 4 §8e override-aware urgency group
  "gap.phase",                       // Tab 4 §6 drag-drop + §8e dropdown
  "gap.status",                      // Tab 4 §8e dropdown — open/in_progress/closed/deferred
  "gap.gapTypeLabel",                // LABEL_RESOLVED from GAP_TYPES
  "gap.layerLabel",                  // LABEL_RESOLVED from LAYERS
  "gap.driverName",                  // LABEL_RESOLVED multi-hop (gap.driverId → driver.businessDriverId → BUSINESS_DRIVERS.label)
  "gap.notes",                       // Tab 4 §8e textarea
  "gap.affectedEnvironmentNames",    // LABEL_RESOLVED array
  "gap.affectedLayerLabels",         // LABEL_RESOLVED array
  "gap.servicesLabels"               // LABEL_RESOLVED array from SERVICE_TYPES
]);

// ─── INSIGHTS_PATHS (derived paths) ───────────────────────────────────
//
// Derived/computed values surfaced on the Reporting tab. These are NOT
// schema fields; they come from the analytical-view selectors and the
// Reporting render functions. Exposing them as bindable paths lets a skill
// author write "Give me an account plan" and reference
// {{insights.coverage.percent}} or {{insights.totals.highUrgencyGaps}}
// without re-implementing the math.

export const INSIGHTS_PATHS = Object.freeze({
  // ─── Coverage / Risk (from roadmapService) ───
  "insights.coverage.percent": {
    type: "number", source: "roadmapService.computeDiscoveryCoverage",
    description: "Discovery completeness percentage (0-100). UI: Tab 5 Overview §5.A.4 big number + bar fill."
  },
  "insights.coverage.actions": {
    type: "array<string>", source: "roadmapService.computeDiscoveryCoverage",
    description: "List of suggested next-to-fill fields. UI: Tab 5 Overview §5.A.4 hint list."
  },
  "insights.risk.level": {
    type: "enum<High|Medium|Low>", source: "roadmapService.computeRiskPosture",
    description: "Overall risk posture for the engagement. UI: Tab 5 Overview §5.A.4 pill."
  },
  "insights.risk.actions": {
    type: "array<string>", source: "roadmapService.computeRiskPosture",
    description: "Risk mitigation actions. UI: Tab 5 Overview §5.A.4 hint list."
  },

  // ─── Totals (from healthMetrics) ───
  "insights.totals.currentInstances": {
    type: "number", source: "healthMetrics.getHealthSummary",
    description: "Count of state='current' instances. UI: Tab 5 §5.A.5 + §5.B.2."
  },
  "insights.totals.desiredInstances": {
    type: "number", source: "healthMetrics.getHealthSummary",
    description: "Count of state='desired' instances. UI: Tab 5 §5.A.5 + §5.B.2."
  },
  "insights.totals.gaps": {
    type: "number", source: "healthMetrics.getHealthSummary",
    description: "Total gaps count. UI: Tab 5 §5.A.5 + §5.B.2."
  },
  "insights.totals.highUrgencyGaps": {
    type: "number", source: "healthMetrics.getHealthSummary",
    description: "Count of gaps with urgency='High'. UI: Tab 5 §5.A.5 stat chip."
  },
  "insights.totals.unreviewedGaps": {
    type: "number", source: "gap-walk filter",
    description: "Count of gaps with reviewed=false + status='open'. UI: Tab 5 Roadmap §5.E.4 pulse bar."
  },

  // ─── Vendor mix (from vendorMixService) ───
  "insights.dellDensity.percent": {
    type: "number", source: "vendorMixService.computeMixByLayer",
    description: "Dell instance count / total instance count, expressed as %. UI: Tab 5 Vendor §5.D.4 KPI."
  },
  "insights.dellDensity.byLayer": {
    type: "object<layerId, number>", source: "vendorMixService.computeMixByLayer",
    description: "Per-layer Dell density %. UI: Tab 5 Vendor §5.D.4."
  },

  // ─── Projects (from roadmapService.buildProjects) ───
  "insights.projects.names": {
    type: "array<string>", source: "roadmapService.buildProjects",
    description: "All auto-derived project names. UI: Tab 5 Roadmap §5.E.5 cards."
  },
  "insights.projects.byPhase": {
    type: "object<phase, array<projectName>>", source: "roadmapService.buildProjects",
    description: "Projects grouped by phase (now/next/later). UI: Tab 5 Overview §5.A.7 pipeline."
  },
  "insights.projects.byDriver": {
    type: "object<driverId, array<projectName>>", source: "programsService.groupProjectsByProgram",
    description: "Projects grouped by strategic driver swimlane. UI: Tab 5 Roadmap §5.E.5."
  },

  // ─── Executive Summary brief ───
  "insights.executiveSummary.brief": {
    type: "array<{label, text}>", source: "roadmapService.generateSessionBrief",
    description: "Structured brief rows for CxO consumption. UI: Tab 5 Overview §5.A.8 right pane."
  }
});

// ─── PICKER_METADATA ──────────────────────────────────────────────────
//
// Runtime structured metadata for the Skill Builder two-pane picker. For
// every path that appears in the picker (Standard + Insights + the most
// useful Advanced entries) we provide:
//   - label:       human-friendly display name (left list)
//   - description: plain-English meaning (right pane primary text)
//   - sampleHint:  fallback hint text when the live engagement has no value
//   - category:    "standard" | "insights" | "advanced"
//   - entity:      which entity this path lives on (or "insights")
//
// The picker reads from this map directly so the right pane never needs to
// parse Markdown.

export const PICKER_METADATA = Object.freeze({
  // ─── Customer ─────────────────────────────────────────────────────
  "customer.name": {
    label: "Customer Name", category: "standard", entity: "customer",
    description: "The customer organization's name. The single most-referenced field across the canvas.",
    sampleHint: "e.g. Northstar Health Network"
  },
  "customer.verticalLabel": {
    label: "Vertical / Segment", category: "standard", entity: "customer",
    description: "The customer's industry segment (Healthcare, Financial Services, etc.). Label-resolved from the CUSTOMER_VERTICALS catalog.",
    sampleHint: "e.g. Healthcare"
  },
  "customer.region": {
    label: "Region", category: "standard", entity: "customer",
    description: "Geographic region the engagement covers (EMEA, North America, MENA, etc.). Free-text.",
    sampleHint: "e.g. North America"
  },
  "customer.notes": {
    label: "Customer Notes", category: "standard", entity: "customer",
    description: "Free-text notes about the customer. Catch-all for context that doesn't fit other fields.",
    sampleHint: "e.g. CIO-sponsored workshop; recent ransomware near-miss"
  },
  "customer.vertical": {
    label: "Vertical (raw FK id)", category: "advanced", entity: "customer",
    description: "Raw catalog id for the vertical. Most skills should use customer.verticalLabel instead — this is for skills that need the id for matching.",
    sampleHint: "e.g. healthcare"
  },

  // ─── EngagementMeta ───────────────────────────────────────────────
  "engagementMeta.presalesOwner": {
    label: "Presales Owner", category: "standard", entity: "engagementMeta",
    description: "Name of the presales engineer running the workshop. Goes on the Reporting cover.",
    sampleHint: "e.g. Jane Smith"
  },

  // ─── Driver ───────────────────────────────────────────────────────
  "driver.name": {
    label: "Driver Name", category: "standard", entity: "driver",
    description: "The customer-facing strategic driver name (Cyber Resilience, AI & Data Platforms, etc.). Label-resolved from BUSINESS_DRIVERS catalog. Joined across all the engagement's drivers.",
    sampleHint: "e.g. Cyber Resilience"
  },
  "driver.priority": {
    label: "Driver Priority", category: "standard", entity: "driver",
    description: "How critical this driver is TO THE CUSTOMER (criticality level, NOT a rank). Multiple drivers can all be High.",
    sampleHint: "High / Medium / Low"
  },
  "driver.outcomes": {
    label: "Driver Outcomes", category: "standard", entity: "driver",
    description: "Free-text bullets capturing the desired business outcomes the customer named for this driver. The per-driver discussion/comment field.",
    sampleHint: "e.g. Recover from ransomware within 4 hours, proven quarterly."
  },
  "driver.hint": {
    label: "Driver Hint (catalog)", category: "advanced", entity: "driver",
    description: "The short catalog hint text for the driver (e.g. 'We must recover from attacks without paying'). Catalog-derived; not authored.",
    sampleHint: "(catalog hint string)"
  },
  "driver.businessDriverId": {
    label: "Driver (raw FK id)", category: "advanced", entity: "driver",
    description: "Raw catalog id for the driver. Use driver.name for narrative; this is for id-matching skills.",
    sampleHint: "e.g. cyber_resilience"
  },

  // ─── Environment ──────────────────────────────────────────────────
  "environment.name": {
    label: "Environment Name", category: "standard", entity: "environment",
    description: "Customer's name for the site (alias) with fallback to the catalog label. Joined across all the engagement's environments.",
    sampleHint: "e.g. Primary Data Center"
  },
  "environment.location": {
    label: "Location", category: "standard", entity: "environment",
    description: "Where the site physically is. Free-text.",
    sampleHint: "e.g. Dallas, TX"
  },
  "environment.tier": {
    label: "Tier", category: "standard", entity: "environment",
    description: "Resilience tier of the site (Tier I-IV, Public, Sovereign, Edge). Datalist-suggested, free-text fallback.",
    sampleHint: "e.g. Tier III"
  },
  "environment.sizeKw": {
    label: "Capacity (MW)", category: "standard", entity: "environment",
    description: "Power footprint in megawatts. (Field is internally sizeKw for historical reasons; UI treats it as MW.)",
    sampleHint: "e.g. 5"
  },
  "environment.sqm": {
    label: "Floor Area (m²)", category: "standard", entity: "environment",
    description: "Floor space in square meters. Useful for telco/colo conversations.",
    sampleHint: "e.g. 320"
  },
  "environment.notes": {
    label: "Environment Notes", category: "standard", entity: "environment",
    description: "Free-form per-site context (lease, age, vendor relationships, etc.).",
    sampleHint: "e.g. Lease renews Q2 2027. 100% renewable cert."
  },
  "environment.envCatalogId": {
    label: "Environment Kind (raw FK)", category: "advanced", entity: "environment",
    description: "Raw catalog id for the environment kind. Use environment.name for narrative.",
    sampleHint: "e.g. coreDc"
  },
  "environment.kindLabel": {
    label: "Environment Kind (catalog label)", category: "advanced", entity: "environment",
    description: "The ENV_CATALOG label (e.g. 'Primary Data Center') without the alias fallback applied. Use environment.name for the standard authoring surface.",
    sampleHint: "e.g. Primary Data Center"
  },
  "environment.alias": {
    label: "Environment Alias (raw)", category: "advanced", entity: "environment",
    description: "The author's custom name for the env, with NO fallback to the catalog label.",
    sampleHint: "e.g. Riyadh DC"
  },
  "environment.hidden": {
    label: "Environment Hidden Flag", category: "advanced", entity: "environment",
    description: "Boolean soft-delete flag. Hidden environments are dropped from reports but preserved in the saved file.",
    sampleHint: "true / false"
  },

  // ─── Instance ─────────────────────────────────────────────────────
  "instance.label": {
    label: "Instance Name", category: "standard", entity: "instance",
    description: "What the customer calls this asset/workload. The single most-shown instance field.",
    sampleHint: "e.g. Oracle Production DB"
  },
  "instance.vendor": {
    label: "Vendor", category: "standard", entity: "instance",
    description: "Vendor company name. Drives the vendor-mix donut + the Dell-mapping skill.",
    sampleHint: "e.g. Oracle"
  },
  "instance.vendorGroup": {
    label: "Vendor Group", category: "standard", entity: "instance",
    description: "Three-way classification: dell / nonDell / custom. Drives the headline vendor-mix bar.",
    sampleHint: "dell / nonDell / custom"
  },
  "instance.layerLabel": {
    label: "Architectural Layer", category: "standard", entity: "instance",
    description: "The architectural layer this instance lives at (Workload, Compute, Storage, Data Protection, Virtualization, Infrastructure). Label-resolved.",
    sampleHint: "e.g. Compute"
  },
  "instance.environmentName": {
    label: "Environment", category: "standard", entity: "instance",
    description: "Which environment the instance lives in (one of the engagement's environments). Label-resolved.",
    sampleHint: "e.g. Primary Data Center"
  },
  "instance.criticality": {
    label: "Criticality", category: "standard", entity: "instance",
    description: "How business-critical THIS specific asset is (criticality LEVEL, NOT a rank).",
    sampleHint: "High / Medium / Low"
  },
  "instance.dispositionLabel": {
    label: "Disposition (Action)", category: "standard", entity: "instance",
    description: "What we propose to DO with this instance — Keep / Enhance / Replace / Consolidate / Retire / Introduce / Operational. Desired-state only. Label-resolved from DISPOSITION_ACTIONS.",
    sampleHint: "e.g. Replace"
  },
  "instance.priority": {
    label: "Phase (Now/Next/Later)", category: "standard", entity: "instance",
    description: "When in the roadmap this DESIRED-state instance should land. Phase-of-life ordering (this IS ordered, unlike criticality).",
    sampleHint: "Now / Next / Later"
  },
  "instance.notes": {
    label: "Instance Notes", category: "standard", entity: "instance",
    description: "Free-text per-instance. Current: pain/EOL/debt. Desired: requirements/constraints.",
    sampleHint: "e.g. EOL Q4 2026. Performance complaints from finance."
  },
  "instance.state": {
    label: "State (current/desired)", category: "advanced", entity: "instance",
    description: "Current vs desired state filter. Metadata for filtering, rarely used as narrative content.",
    sampleHint: "current / desired"
  },
  "instance.layerId": {
    label: "Layer (raw FK)", category: "advanced", entity: "instance",
    description: "Raw LAYERS catalog id. Use instance.layerLabel for narrative.",
    sampleHint: "e.g. compute"
  },
  "instance.environmentId": {
    label: "Environment (raw FK UUID)", category: "advanced", entity: "instance",
    description: "Raw UUID of the env this instance lives in. Use instance.environmentName for narrative.",
    sampleHint: "(UUID)"
  },
  "instance.disposition": {
    label: "Disposition (raw FK)", category: "advanced", entity: "instance",
    description: "Raw DISPOSITION_ACTIONS catalog id. Desired-only. Use instance.dispositionLabel for narrative.",
    sampleHint: "e.g. replace"
  },
  "instance.originId": {
    label: "Origin Instance ID", category: "advanced", entity: "instance",
    description: "Desired-only. FK back to the current instance this replaces (the replace-lifecycle anchor).",
    sampleHint: "(UUID)"
  },
  "instance.mappedAssetIds": {
    label: "Mapped Asset IDs", category: "advanced", entity: "instance",
    description: "Workload-only. Array of FK to instances representing the workload's underlying assets. Cross-cutting (assets may span environments).",
    sampleHint: "(array of UUIDs)"
  },

  // ─── Gap ──────────────────────────────────────────────────────────
  "gap.description": {
    label: "Gap Description", category: "standard", entity: "gap",
    description: "Free-text one-line statement of the gap or initiative. The primary content shown on every kanban card.",
    sampleHint: "e.g. Replace EOL Oracle DB with PowerStore-backed PostgreSQL"
  },
  "gap.urgency": {
    label: "Urgency", category: "standard", entity: "gap",
    description: "How urgent this gap is (urgency LEVEL, derived from linked current's criticality unless overridden). NOT a rank.",
    sampleHint: "High / Medium / Low"
  },
  "gap.phase": {
    label: "Phase", category: "standard", entity: "gap",
    description: "When in the roadmap this gap should be addressed. Phase-of-life ordering (this IS ordered).",
    sampleHint: "now / next / later"
  },
  "gap.status": {
    label: "Status", category: "standard", entity: "gap",
    description: "Workflow state. open=needs work, in_progress=under way, closed=done, deferred=parked.",
    sampleHint: "open / in_progress / closed / deferred"
  },
  "gap.gapTypeLabel": {
    label: "Gap Type (Action)", category: "standard", entity: "gap",
    description: "Category of work — Replace / Enhance / Introduce / Consolidate / Operational. Label-resolved from GAP_TYPES.",
    sampleHint: "e.g. Replace"
  },
  "gap.layerLabel": {
    label: "Primary Layer", category: "standard", entity: "gap",
    description: "Primary architectural layer this gap affects (the project bucket).",
    sampleHint: "e.g. Compute"
  },
  "gap.driverName": {
    label: "Strategic Driver", category: "standard", entity: "gap",
    description: "Which strategic driver justifies this gap (the 'why'). Multi-hop label resolution.",
    sampleHint: "e.g. Modernize Aging Infrastructure"
  },
  "gap.notes": {
    label: "Gap Notes", category: "standard", entity: "gap",
    description: "Free-text business context, risk, regulatory drivers, customer pain.",
    sampleHint: "e.g. CIO sponsored. PowerStore POC Q1 2027."
  },
  "gap.affectedEnvironmentNames": {
    label: "Affected Environments", category: "standard", entity: "gap",
    description: "Array of env names this gap touches (cross-cutting; multi-env gap is one record). Label-resolved.",
    sampleHint: "e.g. Primary Data Center, Disaster Recovery Site"
  },
  "gap.affectedLayerLabels": {
    label: "Affected Layers", category: "standard", entity: "gap",
    description: "Array of layer names this gap touches. First is the primary layer (G6 invariant).",
    sampleHint: "e.g. Compute, Virtualization"
  },
  "gap.servicesLabels": {
    label: "Services Needed", category: "standard", entity: "gap",
    description: "Array of Dell services scoped to address this gap (Assessment / Migration / Operate). Label-resolved from SERVICE_TYPES.",
    sampleHint: "e.g. Assessment, Migration"
  },
  "gap.gapType": {
    label: "Gap Type (raw FK)", category: "advanced", entity: "gap",
    description: "Raw GAP_TYPES catalog id. Use gap.gapTypeLabel for narrative.",
    sampleHint: "e.g. replace"
  },
  "gap.layerId": {
    label: "Primary Layer (raw FK)", category: "advanced", entity: "gap",
    description: "Raw LAYERS catalog id. Use gap.layerLabel for narrative.",
    sampleHint: "e.g. compute"
  },
  "gap.driverId": {
    label: "Driver ID (raw FK)", category: "advanced", entity: "gap",
    description: "Raw UUID of the driver record. Use gap.driverName for narrative.",
    sampleHint: "(UUID)"
  },
  "gap.reviewed": {
    label: "Reviewed Flag", category: "advanced", entity: "gap",
    description: "True if presales has reviewed/approved an auto-drafted gap. Workflow metadata.",
    sampleHint: "true / false"
  },
  "gap.origin": {
    label: "Origin (manual/autoDraft)", category: "advanced", entity: "gap",
    description: "Provenance flag — was this gap typed in (manual) or auto-drafted from a Tab 3 disposition (autoDraft)?",
    sampleHint: "manual / autoDraft"
  },
  "gap.urgencyOverride": {
    label: "Urgency Override Flag", category: "advanced", entity: "gap",
    description: "True if the author pinned urgency manually (otherwise it's derived from linked current's criticality).",
    sampleHint: "true / false"
  },
  "gap.affectedEnvironments": {
    label: "Affected Environments (raw UUIDs)", category: "advanced", entity: "gap",
    description: "Array of raw env UUIDs. Use gap.affectedEnvironmentNames for narrative.",
    sampleHint: "(array of UUIDs)"
  },
  "gap.affectedLayers": {
    label: "Affected Layers (raw FK array)", category: "advanced", entity: "gap",
    description: "Array of LAYERS catalog ids. Use gap.affectedLayerLabels for narrative.",
    sampleHint: "(array of layer ids)"
  },
  "gap.relatedCurrentInstanceIds": {
    label: "Linked Current Instance IDs", category: "advanced", entity: "gap",
    description: "Array of FK to current-state instances this gap anchors on.",
    sampleHint: "(array of UUIDs)"
  },
  "gap.relatedDesiredInstanceIds": {
    label: "Linked Desired Instance IDs", category: "advanced", entity: "gap",
    description: "Array of FK to desired-state instances this gap proposes.",
    sampleHint: "(array of UUIDs)"
  },
  "gap.services": {
    label: "Services (raw FK array)", category: "advanced", entity: "gap",
    description: "Array of SERVICE_TYPES catalog ids. Use gap.servicesLabels for narrative.",
    sampleHint: "(array of service ids)"
  },

  // ─── Insights (15 derived) ────────────────────────────────────────
  "insights.coverage.percent": {
    label: "Discovery Coverage %", category: "insights", entity: "insights",
    description: "How complete the discovery is, 0-100. Aggregates current/desired/gaps/drivers/envs coverage.",
    sampleHint: "e.g. 78"
  },
  "insights.coverage.actions": {
    label: "Coverage Suggestions", category: "insights", entity: "insights",
    description: "List of suggestions for what to fill in next to improve coverage.",
    sampleHint: "e.g. Add criticality to 12 current tiles"
  },
  "insights.risk.level": {
    label: "Risk Posture", category: "insights", entity: "insights",
    description: "Overall risk level the engagement reveals. Aggregates criticality + gap urgency.",
    sampleHint: "High / Medium / Low / Elevated"
  },
  "insights.risk.actions": {
    label: "Risk Mitigation Actions", category: "insights", entity: "insights",
    description: "Concrete steps to lower the risk posture.",
    sampleHint: "e.g. 3 High-urgency gaps in Now phase need owners"
  },
  "insights.totals.currentInstances": {
    label: "Total Current Instances", category: "insights", entity: "insights",
    description: "Count of state='current' instances across the engagement.",
    sampleHint: "e.g. 42"
  },
  "insights.totals.desiredInstances": {
    label: "Total Desired Instances", category: "insights", entity: "insights",
    description: "Count of state='desired' instances.",
    sampleHint: "e.g. 38"
  },
  "insights.totals.gaps": {
    label: "Total Gaps", category: "insights", entity: "insights",
    description: "Total gaps count across all statuses.",
    sampleHint: "e.g. 17"
  },
  "insights.totals.highUrgencyGaps": {
    label: "High-Urgency Gaps", category: "insights", entity: "insights",
    description: "Count of gaps with urgency='High'.",
    sampleHint: "e.g. 5"
  },
  "insights.totals.unreviewedGaps": {
    label: "Unreviewed Gaps", category: "insights", entity: "insights",
    description: "Count of gaps with reviewed=false AND status='open'. Auto-drafted gaps still waiting for presales approval.",
    sampleHint: "e.g. 3"
  },
  "insights.dellDensity.percent": {
    label: "Dell Density %", category: "insights", entity: "insights",
    description: "Dell instance count / total instance count, %. The headline vendor-mix KPI.",
    sampleHint: "e.g. 34"
  },
  "insights.dellDensity.byLayer": {
    label: "Dell Density by Layer", category: "insights", entity: "insights",
    description: "Per-layer Dell density % map. Useful for 'which layer is most/least Dell-concentrated'.",
    sampleHint: "{ compute: 48, storage: 71, ... }"
  },
  "insights.projects.names": {
    label: "Project Names", category: "insights", entity: "insights",
    description: "All auto-derived project names. Projects bundle gaps by (envId, layerId, gapType).",
    sampleHint: "e.g. Replace Oracle on Primary DC"
  },
  "insights.projects.byPhase": {
    label: "Projects by Phase", category: "insights", entity: "insights",
    description: "Projects grouped by their phase (Now/Next/Later).",
    sampleHint: "{ now: [...], next: [...], later: [...] }"
  },
  "insights.projects.byDriver": {
    label: "Projects by Driver", category: "insights", entity: "insights",
    description: "Projects grouped by strategic-driver swimlane. Plus 'unassigned' for projects without a driver.",
    sampleHint: "{ \"Cyber Resilience\": [...], ... }"
  },
  "insights.executiveSummary.brief": {
    label: "Session Brief", category: "insights", entity: "insights",
    description: "Structured one-line rollups across coverage, risk, top drivers, pipeline, Dell-mapped solutions. Designed for CxO consumption.",
    sampleHint: "[{label:\"Coverage\", text:\"78% complete...\"}, ...]"
  }
});

// ─── RELATIONSHIPS_METADATA ───────────────────────────────────────────
//
// Structured catalog of data-binding relationships per path. Feeds:
//   1. The Skill Builder picker right pane (RELATIONSHIPS / MANDATORY
//      PAIRINGS / ORDERING / FK chain diagram sections).
//   2. The Improve meta-skill system prompt, so generated prompts respect
//      anchor binding + level-vs-phase semantics + state-conditional fields
//      + cross-cutting cardinalities.
//
// Entry shape:
//   {
//     isAnchor:         true if this is the entity's identifying anchor
//                       (driver.name / environment.name / instance.label /
//                       gap.description / customer.name). Anchors do NOT
//                       have a mandatoryWith — they ARE the pairing target.
//     fkPair:           "<other.path>" if this path is the FK-id or
//                       label-resolved counterpart of another path
//                       (bidirectional reference).
//     multiHop:         array of resolution-chain nodes for catalog-
//                       joined paths. Each node:
//                         { kind: "source"|"join"|"catalog"|"result", ... }
//                       The picker renders these as a visual FK chain
//                       diagram (e.g. gap.driverId → driver record →
//                       BUSINESS_DRIVERS → .label).
//     stateConditional: { onField, value, description } when the field
//                       only applies on certain record states (e.g.
//                       instance.disposition is desired-only).
//     mandatoryWith:    array of paths that should be picked together
//                       (anchor + state qualifier). Soft warning in
//                       the picker; the "Add suggested set" button
//                       batch-adds these.
//     ordering:         { kind: "level"|"phase"|"categorical"|
//                                "free-text"|"numeric"|"boolean"|"timestamp",
//                         note: "<one-line semantic note>" }
//                       Critically separates LEVELS (driver.priority,
//                       instance.criticality, gap.urgency) from PHASES
//                       (instance.priority Now/Next/Later, gap.phase).
//     derivedFrom:      { selector, sourceFields, description } for
//                       Insights paths + auto-derived fields like
//                       gap.urgency (when urgencyOverride=false).
//     crossCutting:     true when one record spans multiple categories
//                       (gap.affectedEnvironments[], gap.affectedLayers[],
//                       instance.mappedAssetIds[]).
//     provenance:       "system" | "ai" | null. System-set fields
//                       (instance.aiTag stamped by AI mutation; cleared
//                       on next engineer save; gap.origin set by add
//                       dialog vs disposition apply).
//   }
//
// Invariants this map upholds:
//   · Every mandatoryWith reference points to a real PICKER_METADATA path
//   · Every fkPair reference is bidirectional
//   · Every stateConditional.onField is a real path
//   · Every Standard collection-entity path's mandatoryWith includes
//     the entity's anchor
//   · Every Insights path has derivedFrom set
//   · Exactly 3 paths have ordering.kind === "level" (driver.priority,
//     instance.criticality, gap.urgency) and exactly 2 have
//     ordering.kind === "phase" (instance.priority, gap.phase)

// Helper · level / phase ordering literals reused across entries.
const _LEVEL_ORDERING = Object.freeze({
  kind: "level",
  note: "Criticality LEVEL — High/Medium/Low — NOT a rank. Multiple records can simultaneously be 'High'. Skills should say 'list the High-X items', NEVER 'the top-priority X'."
});
const _PHASE_ORDERING = Object.freeze({
  kind: "phase",
  note: "Phase-of-life ordering: Now > Next > Later. This IS ordered (unlike level). Skills can say 'first-phase X' or 'next-phase X'."
});
const _PHASE_LOWER_ORDERING = Object.freeze({
  kind: "phase",
  note: "Phase-of-life ordering: now > next > later (lowercase enum, same semantic as instance.priority)."
});
const _CATEGORICAL = function(note) { return { kind: "categorical", note: note }; };
const _FREE_TEXT   = function(note) { return { kind: "free-text", note: note }; };
const _NUMERIC     = function(note) { return { kind: "numeric", note: note }; };
const _BOOLEAN     = function(note) { return { kind: "boolean", note: note }; };

export const RELATIONSHIPS_METADATA = Object.freeze({
  // ─── Customer (singleton) ─────────────────────────────────────────
  "customer.name": {
    isAnchor: true, fkPair: null, multiHop: null, stateConditional: null,
    mandatoryWith: [], crossCutting: false, provenance: null, derivedFrom: null,
    ordering: _FREE_TEXT("Free-text customer organization name. The most-referenced field; the anchor for the entire engagement narrative.")
  },
  // customer.* are SINGLETON fields, so mandatoryWith is empty: the
  // engagement context already implies whose data this is, and forcing
  // customer.name as a pairing would create picker busywork without value.
  // The anchor-pairing rule applies to COLLECTIONS, not singletons.
  "customer.verticalLabel": {
    isAnchor: false, fkPair: "customer.vertical", crossCutting: false, provenance: null, derivedFrom: null,
    stateConditional: null,
    multiHop: [
      { kind: "source",  path: "customer.vertical",      label: "FK id" },
      { kind: "catalog", catalogId: "CUSTOMER_VERTICALS", label: "CUSTOMER_VERTICALS catalog" },
      { kind: "result",  field: "label",                  label: "→ .label (resolved)" }
    ],
    mandatoryWith: [],
    ordering: _CATEGORICAL("Catalog-resolved industry segment label.")
  },
  "customer.vertical": {
    isAnchor: false, fkPair: "customer.verticalLabel", crossCutting: false, provenance: null, derivedFrom: null,
    multiHop: null, stateConditional: null, mandatoryWith: [],
    ordering: _CATEGORICAL("Raw FK id form. Most skills want customer.verticalLabel instead — this is for id-matching skills.")
  },
  "customer.region": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null,
    mandatoryWith: [], crossCutting: false, provenance: null, derivedFrom: null,
    ordering: _FREE_TEXT("Free-text region. Not validated.")
  },
  "customer.notes": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null,
    mandatoryWith: [], crossCutting: false, provenance: null, derivedFrom: null,
    ordering: _FREE_TEXT("Free-text catch-all customer context.")
  },

  // ─── EngagementMeta (singleton) ───────────────────────────────────
  // engagementMeta.presalesOwner is a SINGLETON field, so mandatoryWith is
  // empty: presales-owner is workshop-level metadata that stands alone
  // semantically (not coupled to the customer narrative).
  "engagementMeta.presalesOwner": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null,
    mandatoryWith: [], crossCutting: false, provenance: null, derivedFrom: null,
    ordering: _FREE_TEXT("Free-text presales engineer name. Workshop-level metadata.")
  },

  // ─── Driver (collection) ──────────────────────────────────────────
  "driver.name": {
    isAnchor: true, fkPair: "driver.businessDriverId", crossCutting: false, provenance: null, derivedFrom: null,
    stateConditional: null,
    multiHop: [
      { kind: "source",  path: "driver.businessDriverId", label: "FK id" },
      { kind: "catalog", catalogId: "BUSINESS_DRIVERS",   label: "BUSINESS_DRIVERS catalog" },
      { kind: "result",  field: "label",                   label: "→ .label" }
    ],
    mandatoryWith: [],
    ordering: _CATEGORICAL("Catalog-resolved driver name. The anchor for any driver-level skill.")
  },
  "driver.priority": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null,
    mandatoryWith: ["driver.name"], crossCutting: false, provenance: null, derivedFrom: null,
    ordering: _LEVEL_ORDERING
  },
  "driver.outcomes": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null,
    mandatoryWith: ["driver.name"], crossCutting: false, provenance: null, derivedFrom: null,
    ordering: _FREE_TEXT("Free-text business outcomes per driver. The per-driver discussion field.")
  },
  "driver.hint": {
    isAnchor: false, fkPair: null, crossCutting: false, provenance: null, derivedFrom: null,
    stateConditional: null, mandatoryWith: ["driver.name"],
    multiHop: [
      { kind: "source",  path: "driver.businessDriverId", label: "FK id" },
      { kind: "catalog", catalogId: "BUSINESS_DRIVERS",   label: "BUSINESS_DRIVERS catalog" },
      { kind: "result",  field: "hint",                   label: "→ .hint (catalog-derived)" }
    ],
    ordering: _FREE_TEXT("Catalog hint text. Not authored — comes from the BUSINESS_DRIVERS catalog.")
  },
  "driver.businessDriverId": {
    isAnchor: false, fkPair: "driver.name", multiHop: null, stateConditional: null,
    mandatoryWith: ["driver.name"], crossCutting: false, provenance: null, derivedFrom: null,
    ordering: _CATEGORICAL("Raw FK id. Use driver.name for narrative.")
  },

  // ─── Environment (collection) ─────────────────────────────────────
  "environment.name": {
    isAnchor: true, fkPair: null, crossCutting: false, provenance: null, derivedFrom: null,
    stateConditional: null, mandatoryWith: [],
    multiHop: [
      { kind: "source",  path: "environment.alias",        label: "alias (if set)" },
      { kind: "fallback", path: "environment.envCatalogId", label: "OR FK id" },
      { kind: "catalog", catalogId: "ENV_CATALOG",          label: "ENV_CATALOG catalog" },
      { kind: "result",  field: "label",                    label: "→ .label" }
    ],
    ordering: _FREE_TEXT("Alias-or-catalog-label fallback. The anchor for any env-level skill.")
  },
  "environment.location": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null,
    mandatoryWith: ["environment.name"], crossCutting: false, provenance: null, derivedFrom: null,
    ordering: _FREE_TEXT("Free-text site location.")
  },
  "environment.tier": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null,
    mandatoryWith: ["environment.name"], crossCutting: false, provenance: null, derivedFrom: null,
    ordering: _CATEGORICAL("Tier datalist (Tier I-IV / Public / Sovereign / Edge). Free-text fallback.")
  },
  "environment.sizeKw": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null,
    mandatoryWith: ["environment.name"], crossCutting: false, provenance: null, derivedFrom: null,
    ordering: _NUMERIC("Megawatts (despite the field name). Range 0-200.")
  },
  "environment.sqm": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null,
    mandatoryWith: ["environment.name"], crossCutting: false, provenance: null, derivedFrom: null,
    ordering: _NUMERIC("Square meters. Range 0-100,000.")
  },
  "environment.notes": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null,
    mandatoryWith: ["environment.name"], crossCutting: false, provenance: null, derivedFrom: null,
    ordering: _FREE_TEXT("Free-text per-site notes.")
  },
  "environment.envCatalogId": {
    isAnchor: false, fkPair: "environment.kindLabel", multiHop: null, stateConditional: null,
    mandatoryWith: ["environment.name"], crossCutting: false, provenance: null, derivedFrom: null,
    ordering: _CATEGORICAL("Raw FK id. Use environment.name or environment.kindLabel for narrative.")
  },
  "environment.kindLabel": {
    isAnchor: false, fkPair: "environment.envCatalogId", crossCutting: false, provenance: null, derivedFrom: null,
    stateConditional: null, mandatoryWith: ["environment.name"],
    multiHop: [
      { kind: "source",  path: "environment.envCatalogId", label: "FK id" },
      { kind: "catalog", catalogId: "ENV_CATALOG",          label: "ENV_CATALOG catalog" },
      { kind: "result",  field: "label",                    label: "→ .label" }
    ],
    ordering: _CATEGORICAL("Catalog-only label (no alias fallback). Use environment.name for the normal author-facing label.")
  },
  "environment.alias": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null,
    mandatoryWith: ["environment.name"], crossCutting: false, provenance: null, derivedFrom: null,
    ordering: _FREE_TEXT("Author's custom site name, with NO catalog fallback. Use environment.name to get fallback behavior.")
  },
  "environment.hidden": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null,
    mandatoryWith: ["environment.name"], crossCutting: false, provenance: null, derivedFrom: null,
    ordering: _BOOLEAN("Soft-delete flag. Hidden envs are dropped from reports but preserved in the saved file.")
  },

  // ─── Instance (collection — current + desired) ────────────────────
  "instance.label": {
    isAnchor: true, fkPair: null, multiHop: null, stateConditional: null,
    mandatoryWith: [], crossCutting: false, provenance: null, derivedFrom: null,
    ordering: _FREE_TEXT("Display name. The anchor for any instance-level skill.")
  },
  "instance.vendor": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null,
    mandatoryWith: ["instance.label"], crossCutting: false, provenance: null, derivedFrom: null,
    ordering: _FREE_TEXT("Free-text vendor name.")
  },
  "instance.vendorGroup": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null,
    mandatoryWith: ["instance.label"], crossCutting: false, provenance: null, derivedFrom: null,
    ordering: _CATEGORICAL("Three-way classification: dell / nonDell / custom. Drives the vendor-mix bar.")
  },
  "instance.layerLabel": {
    isAnchor: false, fkPair: "instance.layerId", crossCutting: false, provenance: null, derivedFrom: null,
    stateConditional: null, mandatoryWith: ["instance.label"],
    multiHop: [
      { kind: "source",  path: "instance.layerId", label: "FK id" },
      { kind: "catalog", catalogId: "LAYERS",       label: "LAYERS catalog" },
      { kind: "result",  field: "label",            label: "→ .label" }
    ],
    ordering: _CATEGORICAL("Catalog-resolved layer name.")
  },
  "instance.environmentName": {
    isAnchor: false, fkPair: "instance.environmentId", crossCutting: false, provenance: null, derivedFrom: null,
    stateConditional: null, mandatoryWith: ["instance.label"],
    multiHop: [
      { kind: "source",  path: "instance.environmentId", label: "FK to environment" },
      { kind: "join",    path: "engagement.environments.byId[id]", label: "environment record" },
      { kind: "result",  field: "alias || ENV_CATALOG.label", label: "→ alias or catalog label" }
    ],
    ordering: _FREE_TEXT("Catalog-resolved environment label (with alias fallback).")
  },
  "instance.criticality": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null,
    mandatoryWith: ["instance.label"], crossCutting: false, provenance: null, derivedFrom: null,
    ordering: _LEVEL_ORDERING
  },
  "instance.dispositionLabel": {
    isAnchor: false, fkPair: "instance.disposition", crossCutting: false, provenance: null, derivedFrom: null,
    stateConditional: { onField: "instance.state", value: "desired", description: "DESIRED-state instances only. Current-state instances render as '-' in the engagement-data table — pick instance.state to qualify which rows are which." },
    mandatoryWith: ["instance.label", "instance.state"],
    multiHop: [
      { kind: "source",  path: "instance.disposition",     label: "FK id" },
      { kind: "catalog", catalogId: "DISPOSITION_ACTIONS", label: "DISPOSITION_ACTIONS catalog" },
      { kind: "result",  field: "label",                    label: "→ .label" }
    ],
    ordering: _CATEGORICAL("Catalog-resolved disposition action (Keep / Enhance / Replace / Consolidate / Retire / Introduce / Operational).")
  },
  "instance.priority": {
    isAnchor: false, fkPair: null, multiHop: null, crossCutting: false, provenance: null, derivedFrom: null,
    stateConditional: { onField: "instance.state", value: "desired", description: "DESIRED-state instances only. The roadmap-phase ordering — drives which kanban column the linked gap lives in." },
    mandatoryWith: ["instance.label", "instance.state"],
    ordering: _PHASE_ORDERING
  },
  "instance.notes": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null,
    mandatoryWith: ["instance.label"], crossCutting: false, provenance: null, derivedFrom: null,
    ordering: _FREE_TEXT("Free-text per-instance notes. Current=pain/EOL; desired=requirements/constraints.")
  },
  "instance.state": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null,
    mandatoryWith: ["instance.label"], crossCutting: false, provenance: null, derivedFrom: null,
    ordering: _CATEGORICAL("current vs desired. State filter, rarely narrative content — but required as a qualifier whenever the picker includes a state-conditional field.")
  },
  "instance.layerId": {
    isAnchor: false, fkPair: "instance.layerLabel", multiHop: null, stateConditional: null,
    mandatoryWith: ["instance.label"], crossCutting: false, provenance: null, derivedFrom: null,
    ordering: _CATEGORICAL("Raw FK id. Use instance.layerLabel for narrative.")
  },
  "instance.environmentId": {
    isAnchor: false, fkPair: "instance.environmentName", multiHop: null, stateConditional: null,
    mandatoryWith: ["instance.label"], crossCutting: false, provenance: null, derivedFrom: null,
    ordering: _CATEGORICAL("Raw UUID. Use instance.environmentName for narrative.")
  },
  "instance.disposition": {
    isAnchor: false, fkPair: "instance.dispositionLabel", multiHop: null,
    stateConditional: { onField: "instance.state", value: "desired", description: "DESIRED-state only — current instances have null disposition." },
    mandatoryWith: ["instance.label", "instance.state"], crossCutting: false, provenance: null, derivedFrom: null,
    ordering: _CATEGORICAL("Raw FK id. Use instance.dispositionLabel for narrative.")
  },
  "instance.originId": {
    isAnchor: false, fkPair: null, multiHop: null,
    stateConditional: { onField: "instance.state", value: "desired", description: "DESIRED-state only — FK back to the current instance this replaces. System-set when a disposition apply creates a desired counterpart." },
    mandatoryWith: ["instance.label", "instance.state"],
    crossCutting: false, provenance: "system", derivedFrom: null,
    ordering: _CATEGORICAL("Raw UUID. Replace-lifecycle anchor — set automatically by Tab 3 disposition apply.")
  },
  // crossCutting is false: mapped assets are SAME-ENV only. The
  // mapWorkloadAssets action enforces invariant I7
  // (asset.environmentId === workload.environmentId), so a workload's
  // mapped assets must share its environment.
  "instance.mappedAssetIds": {
    isAnchor: false, fkPair: null, multiHop: null,
    stateConditional: { onField: "instance.layerId", value: "workload", description: "WORKLOAD-LAYER only. Other layers have empty mappedAssetIds." },
    mandatoryWith: ["instance.label"],
    crossCutting: false, provenance: null, derivedFrom: null,
    ordering: _CATEGORICAL("Array of FK to instances. SAME-ENV: mapWorkloadAssets I7 invariant enforces asset.environmentId === workload.environmentId — mapped assets MUST share the workload's environment. Cross-environment mappings are forbidden by the action layer.")
  },

  // ─── Gap (collection) ─────────────────────────────────────────────
  "gap.description": {
    isAnchor: true, fkPair: null, multiHop: null, stateConditional: null,
    mandatoryWith: [], crossCutting: false, provenance: null, derivedFrom: null,
    ordering: _FREE_TEXT("Free-text one-line gap statement. The anchor for any gap-level skill.")
  },
  // Urgency propagation is most-recently-changed-wins, not a max-aggregate.
  // The disposition-sync logic iterates every gap whose
  // relatedCurrentInstanceIds contains the changed instance and writes
  // urgency = curInst.criticality, so with multiple linked currents the
  // last-changed one wins.
  "gap.urgency": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null,
    mandatoryWith: ["gap.description"], crossCutting: false, provenance: null,
    derivedFrom: { selector: "(propagation)", sourceFields: ["gap.relatedCurrentInstanceIds[*].criticality (most-recently-changed wins)"], description: "Auto-derived from linked current instances' criticality unless gap.urgencyOverride=true. When override is set, the value is author-pinned. With multiple linked currents, the sync logic (state/dispositionLogic.js syncGapsFromCurrentCriticalityAction) updates urgency to match whichever linked current's criticality most recently changed — NOT a max-aggregate." },
    ordering: _LEVEL_ORDERING
  },
  "gap.phase": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null,
    mandatoryWith: ["gap.description"], crossCutting: false, provenance: null, derivedFrom: null,
    ordering: _PHASE_LOWER_ORDERING
  },
  "gap.status": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null,
    mandatoryWith: ["gap.description"], crossCutting: false, provenance: null, derivedFrom: null,
    ordering: _CATEGORICAL("Workflow state: open / in_progress / closed / deferred.")
  },
  // Auto-drafted gaps (gap.origin==='autoDraft') lock the gap-type
  // read-only in the Tab 4 UI. To change the gap-type on an auto-drafted
  // gap, the engineer changes the source disposition in Tab 3, which
  // re-derives the gap-type through commitSyncGapFromDesired.
  "gap.gapTypeLabel": {
    isAnchor: false, fkPair: "gap.gapType", crossCutting: false, provenance: null,
    stateConditional: null, mandatoryWith: ["gap.description"],
    derivedFrom: { selector: "(disposition source)", sourceFields: ["instance.disposition (when gap.origin=autoDraft)"], description: "Auto-derived from the source disposition for auto-drafted gaps (gap.origin='autoDraft'). Manual gaps have author-set gapType. Auto-drafted gaps are LOCKED read-only in the Tab 4 UI (§8e dropdown disabled when gap.origin==='autoDraft') — change the source disposition in Tab 3 §8 to change the gap-type, which propagates through commitSyncGapFromDesired." },
    multiHop: [
      { kind: "source",  path: "gap.gapType",      label: "FK id" },
      { kind: "catalog", catalogId: "GAP_TYPES",   label: "GAP_TYPES catalog" },
      { kind: "result",  field: "label",            label: "→ .label" }
    ],
    ordering: _CATEGORICAL("Catalog-resolved gap action (Replace / Enhance / Introduce / Consolidate / Operational).")
  },
  "gap.layerLabel": {
    isAnchor: false, fkPair: "gap.layerId", crossCutting: false, provenance: null, derivedFrom: null,
    stateConditional: null, mandatoryWith: ["gap.description"],
    multiHop: [
      { kind: "source",  path: "gap.layerId", label: "FK id" },
      { kind: "catalog", catalogId: "LAYERS",   label: "LAYERS catalog" },
      { kind: "result",  field: "label",        label: "→ .label" }
    ],
    ordering: _CATEGORICAL("Catalog-resolved primary-layer name.")
  },
  "gap.driverName": {
    isAnchor: false, fkPair: "gap.driverId", crossCutting: false, provenance: null, derivedFrom: null,
    stateConditional: null, mandatoryWith: ["gap.description"],
    multiHop: [
      { kind: "source",  path: "gap.driverId",                label: "FK to driver" },
      { kind: "join",    path: "engagement.drivers.byId[id]", label: "driver record" },
      { kind: "lookup",  path: "driver.businessDriverId",      label: "FK to BUSINESS_DRIVERS" },
      { kind: "catalog", catalogId: "BUSINESS_DRIVERS",         label: "BUSINESS_DRIVERS catalog" },
      { kind: "result",  field: "label",                        label: "→ .label" }
    ],
    ordering: _CATEGORICAL("Multi-hop catalog-resolved driver name (3 hops: gap → driver → BUSINESS_DRIVERS).")
  },
  "gap.notes": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null,
    mandatoryWith: ["gap.description"], crossCutting: false, provenance: null, derivedFrom: null,
    ordering: _FREE_TEXT("Free-text business context per gap.")
  },
  "gap.affectedEnvironmentNames": {
    isAnchor: false, fkPair: "gap.affectedEnvironments", crossCutting: true, provenance: null, derivedFrom: null,
    stateConditional: null, mandatoryWith: ["gap.description"],
    multiHop: [
      { kind: "source",  path: "gap.affectedEnvironments[]", label: "FK array to envs" },
      { kind: "join",    path: "engagement.environments.byId[id]", label: "env records" },
      { kind: "result",  field: "alias || ENV_CATALOG.label",       label: "→ joined labels" }
    ],
    ordering: _CATEGORICAL("Array of resolved env names. CROSS-CUTTING: one gap may span multiple environments (cardinality 1 gap : N envs).")
  },
  "gap.affectedLayerLabels": {
    isAnchor: false, fkPair: "gap.affectedLayers", crossCutting: true, provenance: null, derivedFrom: null,
    stateConditional: null, mandatoryWith: ["gap.description"],
    multiHop: [
      { kind: "source",  path: "gap.affectedLayers[]", label: "FK array to LAYERS" },
      { kind: "catalog", catalogId: "LAYERS",           label: "LAYERS catalog" },
      { kind: "result",  field: "label",                 label: "→ joined labels" }
    ],
    ordering: _CATEGORICAL("Array of resolved layer names. CROSS-CUTTING: G6 invariant holds — affectedLayers[0] === layerId (primary first).")
  },
  "gap.servicesLabels": {
    isAnchor: false, fkPair: "gap.services", crossCutting: false, provenance: null, derivedFrom: null,
    stateConditional: null, mandatoryWith: ["gap.description"],
    multiHop: [
      { kind: "source",  path: "gap.services[]",      label: "FK array to SERVICE_TYPES" },
      { kind: "catalog", catalogId: "SERVICE_TYPES",   label: "SERVICE_TYPES catalog" },
      { kind: "result",  field: "label",               label: "→ joined labels" }
    ],
    ordering: _CATEGORICAL("Array of resolved Dell-services labels (Assessment / Migration / Operate / etc.).")
  },
  "gap.gapType": {
    isAnchor: false, fkPair: "gap.gapTypeLabel", multiHop: null, stateConditional: null,
    mandatoryWith: ["gap.description"], crossCutting: false, provenance: null,
    derivedFrom: { selector: "(disposition source)", sourceFields: ["instance.disposition"], description: "Auto-derived from the source disposition for auto-drafted gaps." },
    ordering: _CATEGORICAL("Raw FK id. Use gap.gapTypeLabel for narrative.")
  },
  "gap.layerId": {
    isAnchor: false, fkPair: "gap.layerLabel", multiHop: null, stateConditional: null,
    mandatoryWith: ["gap.description"], crossCutting: false, provenance: null, derivedFrom: null,
    ordering: _CATEGORICAL("Raw FK id. Use gap.layerLabel for narrative.")
  },
  "gap.driverId": {
    isAnchor: false, fkPair: "gap.driverName", multiHop: null, stateConditional: null,
    mandatoryWith: ["gap.description"], crossCutting: false, provenance: null, derivedFrom: null,
    ordering: _CATEGORICAL("Raw UUID. Use gap.driverName for narrative.")
  },
  "gap.reviewed": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null,
    mandatoryWith: ["gap.description"], crossCutting: false, provenance: "system", derivedFrom: null,
    ordering: _BOOLEAN("true after presales approves an auto-drafted gap. Workflow flag.")
  },
  "gap.origin": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null,
    mandatoryWith: ["gap.description"], crossCutting: false, provenance: "system", derivedFrom: null,
    ordering: _CATEGORICAL("Provenance: 'manual' if author added via dialog; 'autoDraft' if created by a Tab 3 disposition apply.")
  },
  "gap.urgencyOverride": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null,
    mandatoryWith: ["gap.description"], crossCutting: false, provenance: null, derivedFrom: null,
    ordering: _BOOLEAN("true if the author manually pinned urgency (otherwise urgency is auto-derived from linked current's criticality).")
  },
  "gap.affectedEnvironments": {
    isAnchor: false, fkPair: "gap.affectedEnvironmentNames", multiHop: null, stateConditional: null,
    mandatoryWith: ["gap.description"], crossCutting: true, provenance: null, derivedFrom: null,
    ordering: _CATEGORICAL("Array of raw env UUIDs. Use gap.affectedEnvironmentNames for narrative.")
  },
  "gap.affectedLayers": {
    isAnchor: false, fkPair: "gap.affectedLayerLabels", multiHop: null, stateConditional: null,
    mandatoryWith: ["gap.description"], crossCutting: true, provenance: null, derivedFrom: null,
    ordering: _CATEGORICAL("Array of LAYERS catalog ids. Use gap.affectedLayerLabels for narrative.")
  },
  "gap.relatedCurrentInstanceIds": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null,
    mandatoryWith: ["gap.description"], crossCutting: false, provenance: null, derivedFrom: null,
    ordering: _CATEGORICAL("Array of FK to current-state instances this gap anchors on.")
  },
  "gap.relatedDesiredInstanceIds": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null,
    mandatoryWith: ["gap.description"], crossCutting: false, provenance: null, derivedFrom: null,
    ordering: _CATEGORICAL("Array of FK to desired-state instances this gap proposes.")
  },
  "gap.services": {
    isAnchor: false, fkPair: "gap.servicesLabels", multiHop: null, stateConditional: null,
    mandatoryWith: ["gap.description"], crossCutting: false, provenance: null, derivedFrom: null,
    ordering: _CATEGORICAL("Array of SERVICE_TYPES catalog ids. Use gap.servicesLabels for narrative.")
  },

  // ─── Insights (derived; all are derivedFrom) ──────────────────────
  "insights.coverage.percent": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null, mandatoryWith: [],
    crossCutting: false, provenance: null,
    derivedFrom: { selector: "roadmapService.computeDiscoveryCoverage", sourceFields: ["instances.*.criticality", "instances.byState.desired.disposition", "drivers.*.priority"], description: "Aggregates how complete the workshop fields are. Computed every render." },
    ordering: _NUMERIC("0-100. Aggregate.")
  },
  "insights.coverage.actions": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null, mandatoryWith: [],
    crossCutting: false, provenance: null,
    derivedFrom: { selector: "roadmapService.computeDiscoveryCoverage", sourceFields: ["(coverage gaps)"], description: "Suggested next-to-fill fields." },
    ordering: _CATEGORICAL("Array of suggestion strings.")
  },
  "insights.risk.level": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null, mandatoryWith: [],
    crossCutting: false, provenance: null,
    derivedFrom: { selector: "roadmapService.computeRiskPosture", sourceFields: ["gaps.*.urgency", "instances.*.criticality"], description: "Overall risk posture." },
    ordering: _CATEGORICAL("Aggregate. High / Medium / Low / Elevated.")
  },
  "insights.risk.actions": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null, mandatoryWith: [],
    crossCutting: false, provenance: null,
    derivedFrom: { selector: "roadmapService.computeRiskPosture", sourceFields: ["(risk drivers)"], description: "Concrete mitigation actions." },
    ordering: _CATEGORICAL("Array of action strings.")
  },
  "insights.totals.currentInstances": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null, mandatoryWith: [],
    crossCutting: false, provenance: null,
    derivedFrom: { selector: "healthMetrics.getHealthSummary", sourceFields: ["instances filtered state=current"], description: "Count of current-state instances." },
    ordering: _NUMERIC("Integer count.")
  },
  "insights.totals.desiredInstances": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null, mandatoryWith: [],
    crossCutting: false, provenance: null,
    derivedFrom: { selector: "healthMetrics.getHealthSummary", sourceFields: ["instances filtered state=desired"], description: "Count of desired-state instances." },
    ordering: _NUMERIC("Integer count.")
  },
  "insights.totals.gaps": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null, mandatoryWith: [],
    crossCutting: false, provenance: null,
    derivedFrom: { selector: "healthMetrics.getHealthSummary", sourceFields: ["gaps"], description: "Total gaps across all statuses." },
    ordering: _NUMERIC("Integer count.")
  },
  "insights.totals.highUrgencyGaps": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null, mandatoryWith: [],
    crossCutting: false, provenance: null,
    derivedFrom: { selector: "healthMetrics.getHealthSummary", sourceFields: ["gaps filtered urgency=High"], description: "Count of urgency=High gaps." },
    ordering: _NUMERIC("Integer count.")
  },
  "insights.totals.unreviewedGaps": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null, mandatoryWith: [],
    crossCutting: false, provenance: null,
    derivedFrom: { selector: "(gap walk)", sourceFields: ["gaps filtered reviewed=false + status=open"], description: "Auto-drafted gaps still awaiting presales approval." },
    ordering: _NUMERIC("Integer count.")
  },
  "insights.dellDensity.percent": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null, mandatoryWith: [],
    crossCutting: false, provenance: null,
    derivedFrom: { selector: "vendorMixService.computeMixByLayer", sourceFields: ["instances.*.vendorGroup"], description: "Dell instance count / total, expressed as %." },
    ordering: _NUMERIC("0-100. Aggregate.")
  },
  "insights.dellDensity.byLayer": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null, mandatoryWith: [],
    crossCutting: false, provenance: null,
    derivedFrom: { selector: "vendorMixService.computeMixByLayer", sourceFields: ["instances.*.vendorGroup grouped by layerId"], description: "Per-layer Dell density % map." },
    ordering: _CATEGORICAL("Object<layerId -> percent>.")
  },
  "insights.projects.names": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null, mandatoryWith: [],
    crossCutting: false, provenance: null,
    derivedFrom: { selector: "roadmapService.buildProjects", sourceFields: ["gaps bundled by (envId, layerId, gapType)"], description: "Auto-derived project names." },
    ordering: _CATEGORICAL("Array of strings.")
  },
  "insights.projects.byPhase": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null, mandatoryWith: [],
    crossCutting: false, provenance: null,
    derivedFrom: { selector: "roadmapService.buildProjects", sourceFields: ["projects grouped by phase"], description: "Projects grouped by Now/Next/Later." },
    ordering: _CATEGORICAL("Object<phase -> array<projectName>>.")
  },
  "insights.projects.byDriver": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null, mandatoryWith: [],
    crossCutting: false, provenance: null,
    derivedFrom: { selector: "programsService.groupProjectsByProgram", sourceFields: ["projects grouped by driverId"], description: "Projects grouped by strategic-driver swimlane." },
    ordering: _CATEGORICAL("Object<driverName -> array<projectName>>.")
  },
  "insights.executiveSummary.brief": {
    isAnchor: false, fkPair: null, multiHop: null, stateConditional: null, mandatoryWith: [],
    crossCutting: false, provenance: null,
    derivedFrom: { selector: "roadmapService.generateSessionBrief", sourceFields: ["coverage / risk / drivers / pipeline / Dell solutions"], description: "Structured one-line rollups for CxO consumption." },
    ordering: _CATEGORICAL("Array<{label, text}>.")
  }
});

// Public accessor exports for the picker right pane + Improve prompt.
export function getRelationshipsMetadata() {
  return Object.assign({}, RELATIONSHIPS_METADATA);
}

// getMandatorySetFor(path) → suggested set the picker "Add suggested set"
// button adds. Recursively walks mandatoryWith so anchors-of-anchors land
// (e.g., picking gap.driverName recommends gap.description + transitively
// nothing further since gap.description is the anchor).
export function getMandatorySetFor(path) {
  var seen = new Set();
  var queue = [path];
  while (queue.length > 0) {
    var p = queue.shift();
    if (seen.has(p)) continue;
    seen.add(p);
    var meta = RELATIONSHIPS_METADATA[p];
    if (!meta) continue;
    (meta.mandatoryWith || []).forEach(function(q) { queue.push(q); });
  }
  seen.delete(path);  // exclude the path itself; only return its companions
  return Array.from(seen);
}

// ─── Non-mutable field exclusion list ─────────────────────────────────
// Schema fields excluded from getAllMutableDataPoints() because they're
// computed / provenance / migration metadata and never user-mutable.

const _NON_MUTABLE_FIELD_NAMES = new Set([
  // Provenance wrappers — populated by AI dispatch, not author-set.
  "aiSuggestedDellMapping",
  "aiMappedDellSolutions",
  "aiTag",

  // Audit + cross-cutting metadata.
  "engagementId",
  "createdAt",
  "updatedAt",
  "validatedAgainst",

  // Engagement-meta plumbing.
  "schemaVersion",
  "checksum",
  "generatedAt",

  // Identity + catalog-version plumbing — never author-meaningful.
  "id",                     // every record's UUID — system-set, never author-meaningful
  "catalogVersion"          // pinned catalog version — data-architecture plumbing
]);

// ─── Schema introspection helpers ─────────────────────────────────────

function unwrapZod(s) {
  let cur = s;
  while (cur && cur._def && cur._def.schema) cur = cur._def.schema;
  return cur;
}

function shapeOf(s) {
  const u = unwrapZod(s);
  if (u && u._def && typeof u._def.shape === "function") return u._def.shape();
  if (u && u._def && u._def.shape) return u._def.shape;
  return {};
}

function zodTypeOf(field) {
  if (!field || !field._def) return "unknown";
  const tn = field._def.typeName || "";
  if (tn === "ZodOptional" || tn === "ZodNullable" || tn === "ZodDefault") {
    return zodTypeOf(field._def.innerType);
  }
  switch (tn) {
    case "ZodString":   return "string";
    case "ZodNumber":   return "number";
    case "ZodBoolean":  return "boolean";
    case "ZodEnum":     return "enum";
    case "ZodLiteral":  return "literal";
    case "ZodArray":    return "array";
    case "ZodObject":   return "object";
    case "ZodRecord":   return "record";
    case "ZodUnknown":  return "unknown";
    case "ZodNullable": return "nullable";
    default:            return tn || "unknown";
  }
}

function zodEnumValues(field) {
  if (!field || !field._def) return null;
  if (field._def.typeName === "ZodOptional" || field._def.typeName === "ZodNullable" || field._def.typeName === "ZodDefault") {
    return zodEnumValues(field._def.innerType);
  }
  if (field._def.typeName === "ZodEnum") return field._def.values || null;
  return null;
}

function fieldRequired(field) {
  if (!field || !field._def) return true;
  const tn = field._def.typeName;
  if (tn === "ZodOptional" || tn === "ZodDefault") return false;
  return true;
}

// ─── DataPoint builder ────────────────────────────────────────────────

function _scopeNote(entity, field) {
  if (entity === "instance" && field === "disposition") return "desired-state only";
  if (entity === "instance" && field === "originId")    return "desired-state only; FK to current";
  if (entity === "instance" && field === "priority")    return "desired-state only";
  if (entity === "instance" && field === "mappedAssetIds") return "workload-layer only";
  return null;
}

function _buildDataPoint(entityKind, field) {
  var path = entityKind + "." + field.name;
  var dp = {
    path:        path,
    entity:      entityKind,
    field:       field.name,
    type:        field.type,
    required:    !!field.required,
    description: field.description || "",
    scope:       STANDARD_MUTABLE_PATHS.indexOf(path) >= 0 ? "standard" : "advanced"
  };
  if (Array.isArray(field.values)) dp.values = field.values.slice();
  var note = _scopeNote(entityKind, field.name);
  if (note) dp.note = note;
  return dp;
}

function deriveFields(schema, kindKey) {
  const shape = shapeOf(schema);
  const fields = [];
  const descs = FIELD_DESCRIPTIONS[kindKey] || {};
  for (const name of Object.keys(shape)) {
    if (_NON_MUTABLE_FIELD_NAMES.has(name)) continue;     // skip excluded fields
    const f = shape[name];
    const entry = { name, type: zodTypeOf(f), required: fieldRequired(f), description: descs[name] || "" };
    const enumValues = zodEnumValues(f);
    if (enumValues) entry.values = enumValues;
    fields.push(entry);
  }
  return fields;
}

// ─── Public API: getAllMutableDataPoints + curated getters ────────────

export function getAllMutableDataPoints() {
  const out = [];
  out.push(...deriveFields(EngagementMetaSchema, "engagementMeta").map(f => _buildDataPoint("engagementMeta", f)));
  out.push(...deriveFields(CustomerSchema,       "customer").map(f => _buildDataPoint("customer", f)));
  out.push(...deriveFields(DriverSchema,         "driver").map(f => _buildDataPoint("driver", f)));
  out.push(...deriveFields(EnvironmentSchema,    "environment").map(f => _buildDataPoint("environment", f)));
  out.push(...deriveFields(InstanceSchema,       "instance").map(f => _buildDataPoint("instance", f)));
  out.push(...deriveFields(GapSchema,            "gap").map(f => _buildDataPoint("gap", f)));

  // Append label-resolved synthetic paths.
  Object.keys(LABEL_RESOLVED_PATHS).forEach(function(path) {
    var meta = LABEL_RESOLVED_PATHS[path];
    out.push({
      path:         path,
      entity:       meta.entity,
      field:        path.split(".").pop(),
      type:         meta.isArray ? "array<string>" : "string",
      required:     false,
      description:  "Label-resolved from " + meta.joinCatalog + "." + meta.joinField,
      scope:        meta.scope,
      labelResolved: true,
      joinPath:     meta.joinPath,
      joinCatalog:  meta.joinCatalog,
      joinField:    meta.joinField
    });
  });

  return out;
}

export function getStandardMutableDataPoints() {
  var all = getAllMutableDataPoints();
  var standardSet = new Set(STANDARD_MUTABLE_PATHS);
  return all.filter(function(dp) { return standardSet.has(dp.path); });
}

export function getInsightsDataPoints() {
  return Object.keys(INSIGHTS_PATHS).map(function(path) {
    var meta = INSIGHTS_PATHS[path];
    return {
      path:        path,
      entity:      "insights",
      field:       path.split(".").slice(1).join("."),
      type:        meta.type,
      required:    false,
      description: meta.description,
      scope:       "insights",
      source:      meta.source
    };
  });
}

export function getLabelResolvedPaths() {
  return Object.assign({}, LABEL_RESOLVED_PATHS);
}

// Picker metadata exports.

export function getPickerMetadata() {
  return Object.assign({}, PICKER_METADATA);
}

// getPickerEntries(scope) → array of { path, label, description, sampleHint, category, entity }
// scope = "standard" | "insights" | "advanced" | "all" (default "all")
// Sorts by category then by entity then by label for picker display.
export function getPickerEntries(scope) {
  var s = scope || "all";
  var entries = Object.keys(PICKER_METADATA).map(function(path) {
    var m = PICKER_METADATA[path];
    return {
      path: path,
      label: m.label,
      description: m.description,
      sampleHint: m.sampleHint,
      category: m.category,
      entity: m.entity
    };
  });
  if (s !== "all") {
    entries = entries.filter(function(e) { return e.category === s; });
  }
  // Stable sort: category → entity → label
  var catOrder = { standard: 0, insights: 1, advanced: 2 };
  var entityOrder = {
    customer: 0, engagementMeta: 1, driver: 2,
    environment: 3, instance: 4, gap: 5, insights: 6
  };
  entries.sort(function(a, b) {
    var c = (catOrder[a.category] || 99) - (catOrder[b.category] || 99);
    if (c !== 0) return c;
    var e = (entityOrder[a.entity] || 99) - (entityOrder[b.entity] || 99);
    if (e !== 0) return e;
    return a.label.localeCompare(b.label);
  });
  return entries;
}

// ─── Relationship + invariant + contract assembly ─────────────────────

function relationshipsFromFkDeclarations() {
  const relsByEntity = {
    customer:    customerFkDeclarations,
    driver:      driverFkDeclarations,
    environment: environmentFkDeclarations,
    instance:    instanceFkDeclarations,
    gap:         gapFkDeclarations
  };
  const out = [];
  for (const kind of Object.keys(relsByEntity)) {
    for (const fk of relsByEntity[kind]) {
      const fromKey = kind + "." + fk.field + (fk.isArray ? "[]" : "");
      out.push({
        from:        fromKey,
        to:          fk.target,
        cardinality: (fk.required ? "1" : "0") + ".." + (fk.isArray ? "n" : "1"),
        constraint:  fk.targetFilter ? JSON.stringify(fk.targetFilter) : "",
        description: RELATIONSHIP_DESCRIPTIONS[fromKey] || ""
      });
    }
  }
  out.push({ from: "instance.originId", to: "instances.id (state='current')", cardinality: "0..1", constraint: "ONLY on state='desired'; no self-reference", description: RELATIONSHIP_DESCRIPTIONS["instance.originId"] || "" });
  out.push({ from: "instance.mappedAssetIds[]", to: "instances.id", cardinality: "0..n", constraint: "ONLY on layerId='workload'", description: RELATIONSHIP_DESCRIPTIONS["instance.mappedAssetIds[]"] || "" });
  return out;
}

// FNV-1a 32-bit checksum — gives the contract a deterministic fingerprint.

function fnv1a8(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function serializeForChecksum(c) {
  const { checksum: _ck, generatedAt: _ga, ...rest } = c;
  return JSON.stringify(rest);
}

function validateContract(c) {
  for (const cat of c.catalogs) {
    if (!Array.isArray(cat.entries) || cat.entries.length === 0) {
      throw new Error("dataContract.next: catalog '" + cat.id + "' has zero entries");
    }
    const ids = cat.entries.map(e => e.id);
    if (new Set(ids).size !== ids.length) {
      throw new Error("dataContract.next: catalog '" + cat.id + "' has duplicate entry ids");
    }
  }
  const declaredKinds = new Set(c.entities.map(e => e.kind));
  for (const rel of c.relationships) {
    const fromKind = (rel.from || "").split(".")[0];
    if (!declaredKinds.has(fromKind)) {
      throw new Error("dataContract.next: relationship.from '" + rel.from + "' references undeclared entity kind");
    }
  }
  const invIds = c.invariants.map(i => i.id);
  if (new Set(invIds).size !== invIds.length) {
    throw new Error("dataContract.next: invariant ids are not unique");
  }
}

const _catalogs = await loadAllCatalogs();

function buildContract() {
  const entities = [
    { kind: "engagementMeta", description: ENTITY_DESCRIPTIONS.engagementMeta, fields: deriveFields(EngagementMetaSchema, "engagementMeta") },
    { kind: "customer",       description: ENTITY_DESCRIPTIONS.customer,       fields: deriveFields(CustomerSchema,       "customer")       },
    { kind: "driver",         description: ENTITY_DESCRIPTIONS.driver,         fields: deriveFields(DriverSchema,         "driver")         },
    { kind: "environment",    description: ENTITY_DESCRIPTIONS.environment,    fields: deriveFields(EnvironmentSchema,    "environment")    },
    { kind: "instance",       description: ENTITY_DESCRIPTIONS.instance,       fields: deriveFields(InstanceSchema,       "instance")       },
    { kind: "gap",            description: ENTITY_DESCRIPTIONS.gap,            fields: deriveFields(GapSchema,            "gap")            }
  ];

  const relationships = relationshipsFromFkDeclarations();

  const catalogs = Object.entries(_catalogs).map(([id, cat]) => ({
    id,
    version:     cat.catalogVersion || "unknown",
    description: CATALOG_DESCRIPTIONS[id] || "",
    entries:     (cat.entries || []).map(e => ({
      id:          e.id,
      label:       e.label || e.name || e.id,
      description: e.description || e.shortHint || e.hint || ""
    }))
  }));

  const _SELECTOR_NAMES = new Set([
    "selectMatrixView", "selectGapsKanban", "selectVendorMix",
    "selectHealthSummary", "selectExecutiveSummaryInputs",
    "selectLinkedComposition", "selectProjects"
  ]);
  const analyticalViews = CHAT_TOOLS.filter(t => _SELECTOR_NAMES.has(t.name)).map(t => ({
    name:        t.name,
    description: t.description,
    inputSchema: t.input_schema || { type: "object", properties: {} },
    outputShape: ""
  }));

  const contract = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    checksum:      "",
    generatedAt:   "2026-05-02T00:00:00.000Z",   // deterministic
    entities,
    relationships,
    invariants:    INVARIANTS,
    catalogs,
    bindablePaths: generateManifest(),
    analyticalViews,
    // Bindable-path catalogs surfaced at top level for picker consumption.
    standardPaths:        STANDARD_MUTABLE_PATHS,
    labelResolvedPaths:   LABEL_RESOLVED_PATHS,
    insightsPaths:        INSIGHTS_PATHS
  };

  validateContract(contract);
  contract.checksum = fnv1a8(serializeForChecksum(contract));

  return contract;
}

const _CONTRACT = buildContract();

export function getDataContract()     { return _CONTRACT; }
export function getContractChecksum() { return _CONTRACT.checksum; }
