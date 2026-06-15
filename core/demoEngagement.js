// core/demoEngagement.js
//
// The v3-native demo engagement: a hand-curated, schema-strict engagement
// designed for executive narrative + full app-feature coverage. It is
// constructed entirely through the real schemas + factories — no fixtures,
// no mocks, no hardcoded outputs. The matrix view, gaps kanban, vendor mix,
// health summary, executive summary, linked composition, and projects
// selectors all read this engagement through their normal code paths.
//
// All ids are deterministic UUIDs (hand-coded, not random) so the demo is
// stable and deeply diff-able.
//
// ─── Narrative ──────────────────────────────────────────────────────
// Customer: Northstar Health Network (regional healthcare provider,
//           ~12K employees, multi-site hospital + outpatient clinic
//           + cloud workloads, HIPAA regulated).
//
// 4 strategic drivers — each woven into the gap → Dell solution
// narrative for an executive audience:
//   1. Cyber Resilience (High) — HIPAA + ransomware defense.
//      → PowerProtect DD9410 + Cyber Recovery Vault + APEX Backup.
//   2. Modernize Aging Infrastructure (High) — replace EOL HPE/NetApp.
//      → PowerEdge R770 + PowerStore 1200T (replace HPE + NetApp).
//   3. AI & Data Platforms (High) — radiology AI + clinical analytics.
//      → PowerEdge XE9680 GPU + PowerScale F210 + GCP burst.
//   4. Cost Optimization (Medium) — reduce TCO + cloud sprawl.
//      → VxRail VD-4000 branch consolidation + CloudIQ unified ops.
//
// 4 environments:
//   1. Main Data Center (coreDc) — primary on-prem
//   2. DR Site (drDc) — disaster recovery, warm standby
//   3. Branch Clinic (edge) — outpatient site
//   4. Google Cloud / GCP (publicCloud) — analytics + DR egress
//
// Current + desired instances span Dell + non-Dell + custom vendor groups
// so the vendor-mix selector tells a story (current ≈ 25% Dell density →
// desired ≈ 90% Dell).
//
// 8 gaps cover all 5 gap types and all 4 drivers. Most are
// origin="autoDraft" (generated from desired-state dispositions); the HIPAA
// tabletop ops gap is origin="manual". Two gaps are left unreviewed to
// showcase the review workflow.
//
// Build-time guarantee: the EngagementSchema.parse call at the bottom of
// this file runs at import time. If the demo drifts out of schema
// compliance, the module throws and the build fails loudly.
//
// This module must not: import from tests, use non-deterministic UUIDs,
// read from the session store (the demo is a constant), or mutate the
// cached engagement after it's returned.

import { EngagementSchema, EngagementMetaSchema } from "../schema/engagement.js";
import { createEmptyCustomer }    from "../schema/customer.js";
import { createEmptyDriver }      from "../schema/driver.js";
import { createEmptyEnvironment } from "../schema/environment.js";
import { createEmptyInstance }    from "../schema/instance.js";
import { createEmptyGap }         from "../schema/gap.js";

// ─── Deterministic UUIDs ─────────────────────────────────────────────
//
// Format: 00000000-0000-4000-8000-XXXXYYYYYYYY
//   XXXX tags entity kind (engagement=0001, driver=00d1, env=00e1,
//   instance=00f1, gap=00a1). YYYYYYYY is sequence within kind.
// Valid UUID v4. Easy to grep.

const ENGAGEMENT_ID = "00000000-0000-4000-8000-000100000001";

// Drivers (4)
const DRIVER_CYBER_ID      = "00000000-0000-4000-8000-00d100000001";
const DRIVER_MODERNIZE_ID  = "00000000-0000-4000-8000-00d100000002";
const DRIVER_AI_ID         = "00000000-0000-4000-8000-00d100000003";
const DRIVER_COST_ID       = "00000000-0000-4000-8000-00d100000004";

// Environments (4)
const ENV_MAIN_ID    = "00000000-0000-4000-8000-00e100000001";   // Main Data Center
const ENV_DR_ID      = "00000000-0000-4000-8000-00e100000002";   // DR Site
const ENV_BRANCH_ID  = "00000000-0000-4000-8000-00e100000003";   // Branch Clinic
const ENV_GCP_ID     = "00000000-0000-4000-8000-00e100000004";   // Google Cloud (GCP)

// ─── Current-state instances ─────────────────────────────────────────
// Workloads (5)
const I_EHR_ID            = "00000000-0000-4000-8000-00f100000001";  // workload (EHR, Main DC)
const I_PACS_ID           = "00000000-0000-4000-8000-00f100000002";  // workload (PACS imaging, Main DC)
const I_ANALYTICS_ID      = "00000000-0000-4000-8000-00f100000003";  // workload (clinical analytics, Main DC)
const I_PATIENT_PORTAL_ID = "00000000-0000-4000-8000-00f100000004";  // workload (patient portal, Branch Clinic)
const I_RAD_AI_ID         = "00000000-0000-4000-8000-00f100000005";  // workload (Radiology AI, current = empty placeholder)

// Compute (4)
const I_HPE_MAIN_ID    = "00000000-0000-4000-8000-00f100000010";  // compute (HPE ProLiant DL380, Main DC)
const I_HPE_DR_ID      = "00000000-0000-4000-8000-00f100000011";  // compute (HPE ProLiant DL380, DR)
const I_CISCO_UCS_ID   = "00000000-0000-4000-8000-00f100000012";  // compute (Cisco UCS B-Series, Main DC)
const I_LENOVO_BRANCH_ID = "00000000-0000-4000-8000-00f100000013";  // compute (Lenovo ThinkSystem, Branch Clinic)

// Storage (3)
const I_NETAPP_MAIN_ID = "00000000-0000-4000-8000-00f100000020";  // storage (NetApp AFF A400, Main DC)
const I_NETAPP_DR_ID   = "00000000-0000-4000-8000-00f100000021";  // storage (NetApp AFF A220, DR)
const I_PURE_ID        = "00000000-0000-4000-8000-00f100000022";  // storage (Pure Storage FlashArray, Main DC)

// Cloud current (2) — Patient portal cloud + Analytics cloud burst
const I_GCE_PORTAL_ID  = "00000000-0000-4000-8000-00f100000030";  // compute (Google Compute Engine, GCP)
const I_GCS_PORTAL_ID  = "00000000-0000-4000-8000-00f100000031";  // storage (Google Cloud Storage, GCP)

// Data Protection (1)
const I_VEEAM_ID       = "00000000-0000-4000-8000-00f100000040";  // dataProtection (Veeam B&R, Main DC)

// Virtualization (2 — kept; virtualizes the underlying compute)
const I_VSPHERE_MAIN_ID = "00000000-0000-4000-8000-00f100000050";  // virtualization (VMware vSphere, Main DC)
const I_VSPHERE_DR_ID   = "00000000-0000-4000-8000-00f100000051";  // virtualization (VMware vSphere, DR)

// Infrastructure (1)
const I_CISCO_NET_ID    = "00000000-0000-4000-8000-00f100000060";  // infrastructure (Cisco Catalyst, Main DC)

// ─── Desired-state instances ─────────────────────────────────────────
// Compute (4)
const D_R770_MAIN_ID   = "00000000-0000-4000-8000-00f100000101";  // compute (PowerEdge R770, Main DC) — replaces HPE Main
const D_R770_DR_ID     = "00000000-0000-4000-8000-00f100000102";  // compute (PowerEdge R770, DR) — replaces HPE DR
const D_XE9680_ID      = "00000000-0000-4000-8000-00f100000103";  // compute (PowerEdge XE9680 GPU, Main DC) — net-new for Radiology AI
const D_VXRAIL_ID      = "00000000-0000-4000-8000-00f100000104";  // compute (VxRail VD-4000, Branch Clinic) — replaces Lenovo

// Storage (2)
const D_POWERSTORE_ID  = "00000000-0000-4000-8000-00f100000110";  // storage (PowerStore 1200T, Main DC) — replaces NetApp + Pure tier-1
const D_POWERSCALE_ID  = "00000000-0000-4000-8000-00f100000111";  // storage (PowerScale F210, Main DC) — replaces Pure for Analytics + AI

// Data Protection (3)
const D_PPDM_ID        = "00000000-0000-4000-8000-00f100000120";  // dataProtection (PowerProtect DD9410, Main DC) — replaces Veeam
const D_PPCR_VAULT_ID  = "00000000-0000-4000-8000-00f100000121";  // dataProtection (Cyber Recovery Vault, DR) — net-new
const D_APEX_BACKUP_ID = "00000000-0000-4000-8000-00f100000122";  // dataProtection (APEX Backup Services, GCP) — net-new

// Infrastructure (1)
const D_CLOUDIQ_ID     = "00000000-0000-4000-8000-00f100000130";  // infrastructure (CloudIQ + APEX AIOps, Main DC) — net-new

// Desired workloads (5) mirror current shape
const D_EHR_ID            = "00000000-0000-4000-8000-00f100000200";
const D_PACS_ID           = "00000000-0000-4000-8000-00f100000201";
const D_ANALYTICS_ID      = "00000000-0000-4000-8000-00f100000202";
const D_PATIENT_PORTAL_ID = "00000000-0000-4000-8000-00f100000203";
const D_RAD_AI_ID         = "00000000-0000-4000-8000-00f100000204";

// ─── Gaps (8) ────────────────────────────────────────────────────────
const GAP_EHR_REPLACE_ID     = "00000000-0000-4000-8000-00a100000001";   // modernize, replace, now
const GAP_STORAGE_REPLACE_ID = "00000000-0000-4000-8000-00a100000002";   // modernize, replace, now
const GAP_CYBER_REPLACE_ID   = "00000000-0000-4000-8000-00a100000003";   // cyber, replace, now
const GAP_POWERSCALE_ID      = "00000000-0000-4000-8000-00a100000004";   // ai_data, replace, next
const GAP_RAD_AI_ID          = "00000000-0000-4000-8000-00a100000005";   // ai_data, introduce, next
const GAP_BRANCH_CONSOL_ID   = "00000000-0000-4000-8000-00a100000006";   // cost, consolidate, later
const GAP_GCP_DR_ID          = "00000000-0000-4000-8000-00a100000007";   // cyber, introduce, next
const GAP_HIPAA_DRILL_ID     = "00000000-0000-4000-8000-00a100000008";   // cyber, ops, now (origin: manual)
const GAP_ANALYTICS_ENHANCE_ID = "00000000-0000-4000-8000-00a100000009"; // ai_data, enhance, next (Clinical Analytics workload upgrade)

const CATALOG_VERSION = "2026.04";
const TS              = "2026-05-09T18:00:00.000Z";

// ─── Build the engagement (executes once at module load) ─────────────

function buildDemoEngagement() {
  const cc = (id) => ({
    id,
    engagementId: ENGAGEMENT_ID,
    createdAt:    TS,
    updatedAt:    TS
  });

  const meta = EngagementMetaSchema.parse({
    engagementId:   ENGAGEMENT_ID,
    schemaVersion:  "3.0",
    isDemo:         true,
    ownerId:        "local-user",
    presalesOwner:  "Dell Discovery Demo",
    engagementDate: "2026-05-09",
    status:         "Draft",
    createdAt:      TS,
    updatedAt:      TS
  });

  const customer = createEmptyCustomer({
    engagementId: ENGAGEMENT_ID,
    name:         "Northstar Health Network",
    vertical:     "Healthcare",
    region:       "North America",
    notes:        "Regional healthcare provider; ~12K employees across one main hospital, a DR site, an outpatient branch clinic, and Google Cloud workloads. HIPAA regulated. Demo engagement showcasing the v3 data model + AI assistant against four executive-friendly strategic drivers (cyber resilience, modernize aging infrastructure, AI/data, cost optimization)."
  });

  // ─── Drivers ─────────────────────────────────────────────────────
  const driverCyber = createEmptyDriver({
    ...cc(DRIVER_CYBER_ID),
    businessDriverId: "cyber_resilience",
    catalogVersion:   CATALOG_VERSION,
    priority:         "High",
    outcomes:         "• Survive a ransomware event without patient-care disruption.\n• Air-gapped immutable backups for tier-1 clinical systems, tested quarterly.\n• Recovery time objective <= 4 hours for the EHR, PACS, and patient portal.\n• HIPAA breach-readiness evidence for board reporting by Q4."
  });
  const driverModernize = createEmptyDriver({
    ...cc(DRIVER_MODERNIZE_ID),
    businessDriverId: "modernize_infra",
    catalogVersion:   CATALOG_VERSION,
    priority:         "High",
    outcomes:         "• Retire HPE ProLiant + NetApp AFF + Pure FlashArray (all at end-of-life within 18 months).\n• Standardize on a single Dell hardware platform across Main DC + DR.\n• Reduce hardware footprint by 30% via PowerEdge R770 density gains.\n• Cut maintenance contract spend by ~$1.2M/yr."
  });
  const driverAI = createEmptyDriver({
    ...cc(DRIVER_AI_ID),
    businessDriverId: "ai_data",
    catalogVersion:   CATALOG_VERSION,
    priority:         "High",
    outcomes:         "• Stand up clinical-imaging AI inference (radiology CV models on PACS feed).\n• Reduce radiologist read time by 30% via AI triage.\n• Quantify reduction in re-admission risk via ML scoring within 12 months.\n• Unstructured data tier sized for 4 years of imaging growth."
  });
  const driverCost = createEmptyDriver({
    ...cc(DRIVER_COST_ID),
    businessDriverId: "cost_optimization",
    catalogVersion:   CATALOG_VERSION,
    priority:         "Medium",
    outcomes:         "• Consolidate Branch Clinic infrastructure to a single VxRail node.\n• Cap Google Cloud spend through right-sizing + APEX Backup substitution.\n• Reduce data center power footprint by 25% via PowerEdge R770 efficiency.\n• Single CloudIQ pane for unified ops (no per-vendor consoles)."
  });

  // ─── Environments ────────────────────────────────────────────────
  const envMain = createEmptyEnvironment({
    ...cc(ENV_MAIN_ID),
    envCatalogId:   "coreDc",
    catalogVersion: CATALOG_VERSION,
    alias:          "Main Data Center",
    location:       "Headquarters Campus",
    sizeKw:         180,
    sqm:            850,
    tier:           "Tier III",
    notes:          "Primary on-prem site; hosts EHR, PACS, clinical analytics, and the Radiology AI build-out."
  });
  const envDr = createEmptyEnvironment({
    ...cc(ENV_DR_ID),
    envCatalogId:   "drDc",
    catalogVersion: CATALOG_VERSION,
    alias:          "DR Site",
    location:       "Co-located DR facility, separate metro",
    sizeKw:         90,
    sqm:            420,
    tier:           "Tier II",
    notes:          "Warm standby for EHR + PACS. Async replication from Main DC. Will host the Cyber Recovery Vault for ransomware isolation."
  });
  const envBranch = createEmptyEnvironment({
    ...cc(ENV_BRANCH_ID),
    envCatalogId:   "edge",
    catalogVersion: CATALOG_VERSION,
    alias:          "Branch Clinic",
    location:       "Outpatient site",
    sizeKw:         8,
    sqm:            40,
    tier:           "Tier I",
    notes:          "Outpatient clinic; runs the patient portal locally for offline-tolerance + lightweight EHR cache. Replication to Main DC nightly."
  });
  const envGcp = createEmptyEnvironment({
    ...cc(ENV_GCP_ID),
    envCatalogId:   "publicCloud",
    catalogVersion: CATALOG_VERSION,
    alias:          "Google Cloud (GCP)",
    location:       "us-central1",
    sizeKw:         null,
    sqm:            null,
    tier:           null,
    notes:          "GCP region for patient-portal cloud burst + analytics extract pipelines + DR egress. APEX Backup target post-modernization."
  });

  // ─── Current-state workloads (5) ─────────────────────────────────
  // mappedAssetIds chain each workload to the underlying compute/storage/
  // backup/network assets so the AI grounding meta-model + workload-
  // mapping selector tell a clean story.
  const instEHR = createEmptyInstance({
    ...cc(I_EHR_ID),
    state:          "current",
    layerId:        "workload",
    environmentId:  ENV_MAIN_ID,
    label:          "Electronic Health Records (EHR)",
    vendor:         "Epic / custom integration",
    vendorGroup:    "custom",
    criticality:    "High",
    disposition:    "keep",
    notes:          "Primary clinical system; HA-clustered Main DC + DR. Patient data; HIPAA scope.",
    mappedAssetIds: [I_HPE_MAIN_ID, I_HPE_DR_ID, I_NETAPP_MAIN_ID, I_NETAPP_DR_ID, I_VEEAM_ID, I_VSPHERE_MAIN_ID, I_VSPHERE_DR_ID]
  });
  const instPACS = createEmptyInstance({
    ...cc(I_PACS_ID),
    state:          "current",
    layerId:        "workload",
    environmentId:  ENV_MAIN_ID,
    label:          "Imaging / PACS",
    vendor:         "Sectra / custom integration",
    vendorGroup:    "custom",
    criticality:    "High",
    disposition:    "keep",
    notes:          "Radiology imaging; unstructured data growing 35%/yr. Will benefit from PowerScale + Radiology AI inference layer.",
    mappedAssetIds: [I_CISCO_UCS_ID, I_NETAPP_MAIN_ID, I_VEEAM_ID, I_VSPHERE_MAIN_ID]
  });
  const instAnalytics = createEmptyInstance({
    ...cc(I_ANALYTICS_ID),
    state:          "current",
    layerId:        "workload",
    environmentId:  ENV_MAIN_ID,
    label:          "Clinical Analytics",
    vendor:         "Custom (Spark + ML pipelines)",
    vendorGroup:    "custom",
    criticality:    "Medium",
    disposition:    "enhance",
    notes:          "Re-admission risk scoring + cost analytics. On Pure Storage today; will move to PowerScale + GCP burst extracts.",
    mappedAssetIds: [I_HPE_MAIN_ID, I_PURE_ID, I_VSPHERE_MAIN_ID]
  });
  const instPatientPortal = createEmptyInstance({
    ...cc(I_PATIENT_PORTAL_ID),
    state:          "current",
    layerId:        "workload",
    environmentId:  ENV_BRANCH_ID,
    label:          "Patient Portal",
    vendor:         "Custom (web + native)",
    vendorGroup:    "custom",
    criticality:    "Medium",
    disposition:    "consolidate",
    notes:          "Runs at the Branch Clinic for offline-tolerance + GCP for cloud reachability. Will consolidate to VxRail edge.",
    mappedAssetIds: [I_LENOVO_BRANCH_ID, I_GCE_PORTAL_ID, I_GCS_PORTAL_ID]
  });
  const instRadAI = createEmptyInstance({
    ...cc(I_RAD_AI_ID),
    state:          "current",
    layerId:        "workload",
    environmentId:  ENV_MAIN_ID,
    label:          "Radiology AI (planned)",
    vendor:         "(none yet)",
    vendorGroup:    "custom",
    criticality:    "Medium",
    disposition:    "introduce",
    notes:          "Net-new workload. No current technology — to be introduced via PowerEdge XE9680 + PowerScale F210.",
    mappedAssetIds: []
  });

  // ─── Current-state compute (4) ───────────────────────────────────
  const instHpeMain = createEmptyInstance({
    ...cc(I_HPE_MAIN_ID),
    state:         "current",
    layerId:       "compute",
    environmentId: ENV_MAIN_ID,
    label:         "HPE ProLiant DL380 (EHR + Analytics)",
    vendor:        "HPE",
    vendorGroup:   "nonDell",
    criticality:   "High",
    disposition:   "replace",
    notes:         "Hosts EHR clustered nodes + clinical analytics. End-of-life Q1 2027 per HPE roadmap. Replace with PowerEdge R770."
  });
  const instHpeDR = createEmptyInstance({
    ...cc(I_HPE_DR_ID),
    state:         "current",
    layerId:       "compute",
    environmentId: ENV_DR_ID,
    label:         "HPE ProLiant DL380 (EHR DR)",
    vendor:        "HPE",
    vendorGroup:   "nonDell",
    criticality:   "High",
    disposition:   "replace",
    notes:         "DR EHR cluster. Replace alongside Main DC nodes with PowerEdge R770 to standardize platform."
  });
  const instCiscoUCS = createEmptyInstance({
    ...cc(I_CISCO_UCS_ID),
    state:         "current",
    layerId:       "compute",
    environmentId: ENV_MAIN_ID,
    label:         "Cisco UCS B-Series (PACS)",
    vendor:        "Cisco",
    vendorGroup:   "nonDell",
    criticality:   "High",
    disposition:   "replace",
    notes:         "Hosts PACS imaging workload. UCS Manager licensing renewal expensive; replace with PowerEdge R770."
  });
  const instLenovoBranch = createEmptyInstance({
    ...cc(I_LENOVO_BRANCH_ID),
    state:         "current",
    layerId:       "compute",
    environmentId: ENV_BRANCH_ID,
    label:         "Lenovo ThinkSystem (Patient Portal)",
    vendor:        "Lenovo",
    vendorGroup:   "nonDell",
    criticality:   "Medium",
    disposition:   "consolidate",
    notes:         "Runs Patient Portal + lightweight EHR cache locally. Consolidate to VxRail VD-4000 (compute + virt + storage in one)."
  });

  // ─── Current-state storage (3) ───────────────────────────────────
  const instNetAppMain = createEmptyInstance({
    ...cc(I_NETAPP_MAIN_ID),
    state:         "current",
    layerId:       "storage",
    environmentId: ENV_MAIN_ID,
    label:         "NetApp AFF A400 (EHR + PACS tier-1)",
    vendor:        "NetApp",
    vendorGroup:   "nonDell",
    criticality:   "High",
    disposition:   "replace",
    notes:         "Tier-1 storage for EHR + PACS. End-of-support 2027. Replace with PowerStore 1200T for higher density + native dedup."
  });
  const instNetAppDR = createEmptyInstance({
    ...cc(I_NETAPP_DR_ID),
    state:         "current",
    layerId:       "storage",
    environmentId: ENV_DR_ID,
    label:         "NetApp AFF A220 (DR replication)",
    vendor:        "NetApp",
    vendorGroup:   "nonDell",
    criticality:   "High",
    disposition:   "replace",
    notes:         "DR replication target for EHR + PACS. Replace with PowerStore 1200T DR pair for protocol consistency."
  });
  const instPure = createEmptyInstance({
    ...cc(I_PURE_ID),
    state:         "current",
    layerId:       "storage",
    environmentId: ENV_MAIN_ID,
    label:         "Pure Storage FlashArray (Analytics)",
    vendor:        "Pure Storage",
    vendorGroup:   "nonDell",
    criticality:   "Medium",
    disposition:   "replace",
    notes:         "Analytics warehouse. Off-budget renewal next year; replace with PowerScale F210 to absorb AI training data growth in the same tier."
  });

  // ─── Current-state cloud assets (2) ──────────────────────────────
  const instGcePortal = createEmptyInstance({
    ...cc(I_GCE_PORTAL_ID),
    state:         "current",
    layerId:       "compute",
    environmentId: ENV_GCP_ID,
    label:         "Google Compute Engine (Patient Portal)",
    vendor:        "Google Cloud",
    vendorGroup:   "nonDell",
    criticality:   "Medium",
    disposition:   "keep",
    notes:         "Cloud-side Patient Portal nodes. GCP-native; out of Dell replace scope. Stays."
  });
  const instGcsPortal = createEmptyInstance({
    ...cc(I_GCS_PORTAL_ID),
    state:         "current",
    layerId:       "storage",
    environmentId: ENV_GCP_ID,
    label:         "Google Cloud Storage (Patient Portal)",
    vendor:        "Google Cloud",
    vendorGroup:   "nonDell",
    criticality:   "Medium",
    disposition:   "keep",
    notes:         "Patient-portal blob storage. GCP-native; stays."
  });

  // ─── Current-state data protection (1) ───────────────────────────
  const instVeeam = createEmptyInstance({
    ...cc(I_VEEAM_ID),
    state:         "current",
    layerId:       "dataProtection",
    environmentId: ENV_MAIN_ID,
    label:         "Veeam Backup & Replication (with tape)",
    vendor:        "Veeam",
    vendorGroup:   "nonDell",
    criticality:   "High",
    disposition:   "replace",
    notes:         "Backup of EHR, PACS, Analytics. Tape rotation manual; no immutable copy. Cyber gap. Replace with PowerProtect DD9410 + Cyber Recovery Vault."
  });

  // ─── Current-state virtualization (2) ────────────────────────────
  const instVsphereMain = createEmptyInstance({
    ...cc(I_VSPHERE_MAIN_ID),
    state:         "current",
    layerId:       "virtualization",
    environmentId: ENV_MAIN_ID,
    label:         "VMware vSphere (Main DC)",
    vendor:        "VMware",
    vendorGroup:   "nonDell",
    criticality:   "High",
    disposition:   "keep",
    notes:         "Hypervisor for EHR + PACS + Analytics VMs. Stays; PowerEdge R770 hardware refresh underneath."
  });
  const instVsphereDR = createEmptyInstance({
    ...cc(I_VSPHERE_DR_ID),
    state:         "current",
    layerId:       "virtualization",
    environmentId: ENV_DR_ID,
    label:         "VMware vSphere (DR)",
    vendor:        "VMware",
    vendorGroup:   "nonDell",
    criticality:   "High",
    disposition:   "keep",
    notes:         "DR hypervisor. Stays; hardware refresh to PowerEdge R770."
  });

  // ─── Current-state infrastructure (1) ────────────────────────────
  const instCiscoNet = createEmptyInstance({
    ...cc(I_CISCO_NET_ID),
    state:         "current",
    layerId:       "infrastructure",
    environmentId: ENV_MAIN_ID,
    label:         "Cisco Catalyst (Main DC networking)",
    vendor:        "Cisco",
    vendorGroup:   "nonDell",
    criticality:   "Medium",
    disposition:   "keep",
    notes:         "Core networking. Out of Dell replace scope this round; stays. Future opportunity for PowerSwitch."
  });

  // ─── Desired-state Dell solutions ────────────────────────────────
  // Compute (4)
  const desR770Main = createEmptyInstance({
    ...cc(D_R770_MAIN_ID),
    state:         "desired",
    layerId:       "compute",
    environmentId: ENV_MAIN_ID,
    label:         "PowerEdge R770 (EHR + Analytics)",
    vendor:        "Dell",
    vendorGroup:   "dell",
    criticality:   "High",
    priority:      "Now",
    disposition:   "replace",
    originId:      I_HPE_MAIN_ID,
    notes:         "Replaces HPE DL380 in the Main DC. Hosts the EHR cluster + Clinical Analytics nodes. Higher density + native iDRAC + CloudIQ telemetry."
  });
  const desR770DR = createEmptyInstance({
    ...cc(D_R770_DR_ID),
    state:         "desired",
    layerId:       "compute",
    environmentId: ENV_DR_ID,
    label:         "PowerEdge R770 (EHR DR)",
    vendor:        "Dell",
    vendorGroup:   "dell",
    criticality:   "High",
    priority:      "Now",
    disposition:   "replace",
    originId:      I_HPE_DR_ID,
    notes:         "Replaces HPE DL380 in the DR Site. Standardizes platform across Main + DR for unified ops."
  });
  const desXe9680 = createEmptyInstance({
    ...cc(D_XE9680_ID),
    state:         "desired",
    layerId:       "compute",
    environmentId: ENV_MAIN_ID,
    label:         "PowerEdge XE9680 (Radiology AI inference)",
    vendor:        "Dell",
    vendorGroup:   "dell",
    criticality:   "Medium",
    priority:      "Next",
    disposition:   "introduce",
    notes:         "Net-new for Radiology AI workload. 8x H100 GPUs for clinical CV inference + model fine-tuning on de-identified imaging data."
  });
  const desVxrail = createEmptyInstance({
    ...cc(D_VXRAIL_ID),
    state:         "desired",
    layerId:       "compute",
    environmentId: ENV_BRANCH_ID,
    label:         "VxRail VD-4000 (Branch Clinic edge)",
    vendor:        "Dell",
    vendorGroup:   "dell",
    criticality:   "Medium",
    priority:      "Later",
    disposition:   "consolidate",
    originId:      I_LENOVO_BRANCH_ID,
    notes:         "Consolidates Branch Clinic compute + virt + local storage into a single 1U HCI node. Replaces Lenovo + simplifies branch ops."
  });

  // Storage (2)
  const desPowerStore = createEmptyInstance({
    ...cc(D_POWERSTORE_ID),
    state:         "desired",
    layerId:       "storage",
    environmentId: ENV_MAIN_ID,
    label:         "PowerStore 1200T (EHR + PACS tier-1)",
    vendor:        "Dell",
    vendorGroup:   "dell",
    criticality:   "High",
    priority:      "Now",
    disposition:   "replace",
    originId:      I_NETAPP_MAIN_ID,
    notes:         "Replaces NetApp AFF A400 for tier-1 EHR + PACS. Native AppSync for Epic + 4:1 dedup ratio. DR pair on the DR site replaces NetApp A220 too."
  });
  const desPowerScale = createEmptyInstance({
    ...cc(D_POWERSCALE_ID),
    state:         "desired",
    layerId:       "storage",
    environmentId: ENV_MAIN_ID,
    label:         "PowerScale F210 (Analytics + AI training data)",
    vendor:        "Dell",
    vendorGroup:   "dell",
    criticality:   "Medium",
    priority:      "Next",
    disposition:   "replace",
    originId:      I_PURE_ID,
    notes:         "Replaces Pure FlashArray for Analytics. Single namespace also serves Radiology AI training datasets. Scale-out to 4 years of imaging growth."
  });

  // Data Protection (3)
  const desPpdm = createEmptyInstance({
    ...cc(D_PPDM_ID),
    state:         "desired",
    layerId:       "dataProtection",
    environmentId: ENV_MAIN_ID,
    label:         "PowerProtect DD9410 (primary backup)",
    vendor:        "Dell",
    vendorGroup:   "dell",
    criticality:   "High",
    priority:      "Now",
    disposition:   "replace",
    originId:      I_VEEAM_ID,
    notes:         "Replaces Veeam + tape. Native immutable backups via DD Boost; integrates with Cyber Recovery Vault on DR side."
  });
  const desPpcrVault = createEmptyInstance({
    ...cc(D_PPCR_VAULT_ID),
    state:         "desired",
    layerId:       "dataProtection",
    environmentId: ENV_DR_ID,
    label:         "Cyber Recovery Vault",
    vendor:        "Dell",
    vendorGroup:   "dell",
    criticality:   "High",
    priority:      "Now",
    disposition:   "introduce",
    notes:         "Air-gapped isolated copy of EHR + PACS at the DR site. Tested-restore drill quarterly. Ransomware-survival cornerstone."
  });
  const desApexBackup = createEmptyInstance({
    ...cc(D_APEX_BACKUP_ID),
    state:         "desired",
    layerId:       "dataProtection",
    environmentId: ENV_GCP_ID,
    label:         "APEX Backup Services (GCP egress)",
    vendor:        "Dell",
    vendorGroup:   "dell",
    criticality:   "Medium",
    priority:      "Next",
    disposition:   "introduce",
    notes:         "Cloud DR egress target. Backs up Patient Portal GCP workloads to a Dell-managed cloud target. Closes the GCP-side backup gap."
  });

  // Infrastructure (1)
  const desCloudIq = createEmptyInstance({
    ...cc(D_CLOUDIQ_ID),
    state:         "desired",
    layerId:       "infrastructure",
    environmentId: ENV_MAIN_ID,
    label:         "CloudIQ + APEX AIOps (unified ops)",
    vendor:        "Dell",
    vendorGroup:   "dell",
    criticality:   "Medium",
    priority:      "Next",
    disposition:   "introduce",
    notes:         "Single pane for the whole Dell estate (PowerEdge + PowerStore + PowerScale + PowerProtect + VxRail). Replaces vendor-specific consoles."
  });

  // ─── Desired-state workloads (5) ─────────────────────────────────
  // Each maps to its underlying desired-state Dell asset chain so the
  // workload-mapping selector tells the full story.
  const desEHR = createEmptyInstance({
    ...cc(D_EHR_ID),
    state:          "desired",
    layerId:        "workload",
    environmentId:  ENV_MAIN_ID,
    label:          "Electronic Health Records (EHR) — modernized",
    vendor:         "Epic / custom integration",
    vendorGroup:    "custom",
    criticality:    "High",
    priority:       "Now",
    disposition:    "keep",
    originId:       I_EHR_ID,
    notes:          "Same logical workload; underlying platform refreshed to Dell. Backed up via PowerProtect + Cyber Recovery Vault.",
    mappedAssetIds: [D_R770_MAIN_ID, D_R770_DR_ID, D_POWERSTORE_ID, D_PPDM_ID, D_PPCR_VAULT_ID]
  });
  const desPACS = createEmptyInstance({
    ...cc(D_PACS_ID),
    state:          "desired",
    layerId:        "workload",
    environmentId:  ENV_MAIN_ID,
    label:          "Imaging / PACS — modernized",
    vendor:         "Sectra / custom integration",
    vendorGroup:    "custom",
    criticality:    "High",
    priority:       "Now",
    disposition:    "keep",
    originId:       I_PACS_ID,
    notes:          "Same logical PACS workload; PowerEdge R770 + PowerScale F210 underneath. Feeds Radiology AI inference.",
    mappedAssetIds: [D_R770_MAIN_ID, D_POWERSCALE_ID, D_PPDM_ID]
  });
  const desAnalytics = createEmptyInstance({
    ...cc(D_ANALYTICS_ID),
    state:          "desired",
    layerId:        "workload",
    environmentId:  ENV_MAIN_ID,
    label:          "Clinical Analytics — modernized",
    vendor:         "Custom (Spark + ML pipelines)",
    vendorGroup:    "custom",
    criticality:    "Medium",
    priority:       "Next",
    disposition:    "enhance",
    originId:       I_ANALYTICS_ID,
    notes:          "Pure → PowerScale F210 + GCP burst extracts. CloudIQ-monitored for cost.",
    mappedAssetIds: [D_R770_MAIN_ID, D_POWERSCALE_ID]
  });
  const desPatientPortal = createEmptyInstance({
    ...cc(D_PATIENT_PORTAL_ID),
    state:          "desired",
    layerId:        "workload",
    environmentId:  ENV_BRANCH_ID,
    label:          "Patient Portal — consolidated",
    vendor:         "Custom (web + native)",
    vendorGroup:    "custom",
    criticality:    "Medium",
    priority:       "Later",
    disposition:    "consolidate",
    originId:       I_PATIENT_PORTAL_ID,
    notes:          "Branch local + GCP. Single VxRail node replaces the Lenovo footprint. APEX Backup for cloud-side DR.",
    mappedAssetIds: [D_VXRAIL_ID, D_APEX_BACKUP_ID]
  });
  const desRadAI = createEmptyInstance({
    ...cc(D_RAD_AI_ID),
    state:          "desired",
    layerId:        "workload",
    environmentId:  ENV_MAIN_ID,
    label:          "Radiology AI — net-new",
    vendor:         "Custom (CV inference + fine-tune)",
    vendorGroup:    "custom",
    criticality:    "Medium",
    priority:       "Next",
    disposition:    "introduce",
    originId:       I_RAD_AI_ID,
    notes:          "Net-new clinical AI. Inference on PowerEdge XE9680, training data on PowerScale F210, CloudIQ ops.",
    mappedAssetIds: [D_XE9680_ID, D_POWERSCALE_ID]
  });

  // ─── Gaps (8) ────────────────────────────────────────────────────
  // 7 origin="autoDraft" + 1 origin="manual" (the HIPAA tabletop ops gap).
  // 6 reviewed:true (polished demo) + 2 reviewed:false (showcase the
  // review workflow): GAP_RAD_AI_ID + GAP_BRANCH_CONSOL_ID.
  const gapEhrReplace = createEmptyGap({
    ...cc(GAP_EHR_REPLACE_ID),
    description:               "Replace EHR compute with PowerEdge R770 (Main DC + DR)",
    layerId:                   "compute",
    affectedLayers:            ["compute"],
    affectedEnvironments:      [ENV_MAIN_ID, ENV_DR_ID],
    gapType:                   "replace",
    urgency:                   "High",
    urgencyOverride:           false,
    phase:                     "now",
    status:                    "open",
    reviewed:                  true,
    origin:                    "autoDraft",
    notes:                     "HPE DL380 fleet hits end-of-life Q1 2027. Replace with PowerEdge R770 Main DC + DR pair. Standardizes hardware platform; iDRAC + CloudIQ telemetry from day one.",
    driverId:                  DRIVER_MODERNIZE_ID,
    relatedCurrentInstanceIds: [I_HPE_MAIN_ID, I_HPE_DR_ID],
    relatedDesiredInstanceIds: [D_R770_MAIN_ID, D_R770_DR_ID],
    services:                  ["assessment", "deployment", "knowledge_transfer"]
  });

  const gapStorageReplace = createEmptyGap({
    ...cc(GAP_STORAGE_REPLACE_ID),
    description:               "Replace tier-1 storage with PowerStore 1200T (EHR + PACS)",
    layerId:                   "storage",
    affectedLayers:            ["storage"],
    affectedEnvironments:      [ENV_MAIN_ID, ENV_DR_ID],
    gapType:                   "replace",
    urgency:                   "High",
    urgencyOverride:           false,
    phase:                     "now",
    status:                    "open",
    reviewed:                  true,
    origin:                    "autoDraft",
    notes:                     "NetApp AFF A400 (Main) + A220 (DR) both end-of-support 2027. PowerStore 1200T pair gives native dedup + Epic AppSync + protocol consistency.",
    driverId:                  DRIVER_MODERNIZE_ID,
    relatedCurrentInstanceIds: [I_NETAPP_MAIN_ID, I_NETAPP_DR_ID],
    relatedDesiredInstanceIds: [D_POWERSTORE_ID],
    services:                  ["migration", "deployment", "integration"]
  });

  const gapCyberReplace = createEmptyGap({
    ...cc(GAP_CYBER_REPLACE_ID),
    description:               "Replace Veeam with PowerProtect + Cyber Recovery Vault",
    layerId:                   "dataProtection",
    affectedLayers:            ["dataProtection"],
    affectedEnvironments:      [ENV_MAIN_ID, ENV_DR_ID],
    gapType:                   "replace",
    urgency:                   "High",
    urgencyOverride:           false,
    phase:                     "now",
    status:                    "open",
    reviewed:                  true,
    origin:                    "autoDraft",
    notes:                     "Veeam + tape can't survive a HIPAA-grade ransomware event — no immutable copy, manual rotation. PowerProtect DD9410 (Main) + Cyber Recovery Vault (DR) gives air-gapped isolated copy with quarterly tested-restore drill.",
    driverId:                  DRIVER_CYBER_ID,
    relatedCurrentInstanceIds: [I_VEEAM_ID],
    relatedDesiredInstanceIds: [D_PPDM_ID, D_PPCR_VAULT_ID],
    services:                  ["assessment", "deployment", "runbook", "managed"],
    aiMappedDellSolutions:     {
      value: {
        rawLegacy: "PowerProtect DD9410 + Cyber Recovery Vault",
        products:  ["PowerProtect DD9410", "PowerProtect Cyber Recovery"]
      },
      provenance: {
        model:            "claude-3-5-sonnet",
        promptVersion:    "skill:dellMap@1.4.0",
        skillId:          "demo-seed-dell-mapping",
        runId:            "demo-cyber-replace-001",
        timestamp:        TS,
        catalogVersions:  { "DELL_PRODUCT_TAXONOMY": "2026.04" },
        validationStatus: "valid"
      }
    }
  });

  const gapPowerScale = createEmptyGap({
    ...cc(GAP_POWERSCALE_ID),
    description:               "Replace Pure Storage with PowerScale F210 (Analytics + AI)",
    layerId:                   "storage",
    affectedLayers:            ["storage"],
    affectedEnvironments:      [ENV_MAIN_ID],
    gapType:                   "replace",
    urgency:                   "Medium",
    urgencyOverride:           false,
    phase:                     "next",
    status:                    "open",
    reviewed:                  true,
    origin:                    "autoDraft",
    notes:                     "Pure FlashArray hits a budget renewal next FY. PowerScale F210 absorbs Analytics + Radiology AI training data in a single namespace; scale-out to 4 years of imaging growth.",
    driverId:                  DRIVER_AI_ID,
    relatedCurrentInstanceIds: [I_PURE_ID],
    relatedDesiredInstanceIds: [D_POWERSCALE_ID],
    services:                  ["migration", "deployment"]
  });

  const gapRadAI = createEmptyGap({
    ...cc(GAP_RAD_AI_ID),
    description:               "Introduce Radiology AI inference on PowerEdge XE9680",
    layerId:                   "compute",
    affectedLayers:            ["compute", "workload"],
    affectedEnvironments:      [ENV_MAIN_ID],
    gapType:                   "introduce",
    urgency:                   "Medium",
    urgencyOverride:           false,
    phase:                     "next",
    status:                    "open",
    reviewed:                  false,
    origin:                    "autoDraft",
    notes:                     "Net-new clinical AI. PowerEdge XE9680 (8x H100) + PowerScale F210 for training data. Aim: 30% radiologist read-time reduction. Pilot scope: 3 CV models on chest CT.",
    driverId:                  DRIVER_AI_ID,
    relatedCurrentInstanceIds: [],
    relatedDesiredInstanceIds: [D_XE9680_ID, D_RAD_AI_ID],
    services:                  ["assessment", "deployment", "custom_dev"]
  });

  const gapBranchConsol = createEmptyGap({
    ...cc(GAP_BRANCH_CONSOL_ID),
    description:               "Consolidate Branch Clinic to VxRail VD-4000",
    layerId:                   "compute",
    affectedLayers:            ["compute", "virtualization", "storage"],
    affectedEnvironments:      [ENV_BRANCH_ID],
    gapType:                   "consolidate",
    urgency:                   "Low",
    urgencyOverride:           false,
    phase:                     "later",
    status:                    "open",
    reviewed:                  false,
    origin:                    "autoDraft",
    notes:                     "Lenovo + local virt + local storage at the Branch Clinic into a single 1U VxRail VD-4000 node. Simpler ops, lower power footprint, single Dell support contract.",
    driverId:                  DRIVER_COST_ID,
    relatedCurrentInstanceIds: [I_LENOVO_BRANCH_ID],
    relatedDesiredInstanceIds: [D_VXRAIL_ID],
    services:                  ["deployment", "decommissioning", "managed"]
  });

  const gapGcpDr = createEmptyGap({
    ...cc(GAP_GCP_DR_ID),
    description:               "Introduce APEX Backup Services for GCP DR egress",
    layerId:                   "dataProtection",
    affectedLayers:            ["dataProtection"],
    affectedEnvironments:      [ENV_GCP_ID],
    gapType:                   "introduce",
    urgency:                   "Medium",
    urgencyOverride:           false,
    phase:                     "next",
    status:                    "open",
    reviewed:                  true,
    origin:                    "autoDraft",
    notes:                     "Patient Portal GCP workloads have no DR target today. APEX Backup Services gives a Dell-managed backup target outside the GCP blast radius.",
    driverId:                  DRIVER_CYBER_ID,
    relatedCurrentInstanceIds: [],
    relatedDesiredInstanceIds: [D_APEX_BACKUP_ID],
    services:                  ["assessment", "deployment", "runbook"]
  });

  // gapType="enhance" — Clinical Analytics workload upgrade (in-place
  // capability boost, not a wholesale platform replacement). Enables
  // the AI/data driver narrative without forcing a Replace framing.
  // Pairs with gapPowerScale (storage replace) at the asset layer.
  const gapAnalyticsEnhance = createEmptyGap({
    ...cc(GAP_ANALYTICS_ENHANCE_ID),
    description:               "Enhance Clinical Analytics with PowerScale F210 + GCP burst extracts",
    layerId:                   "workload",
    affectedLayers:            ["workload", "storage"],
    affectedEnvironments:      [ENV_MAIN_ID, ENV_GCP_ID],
    gapType:                   "enhance",
    urgency:                   "Medium",
    urgencyOverride:           false,
    phase:                     "next",
    status:                    "open",
    reviewed:                  true,
    origin:                    "autoDraft",
    notes:                     "Same logical Analytics workload, upgraded data tier (PowerScale F210) + GCP burst for peak-load extracts. Enables 4-year imaging-growth headroom without re-platforming.",
    driverId:                  DRIVER_AI_ID,
    relatedCurrentInstanceIds: [I_ANALYTICS_ID],
    relatedDesiredInstanceIds: [D_ANALYTICS_ID],
    services:                  ["assessment", "migration", "knowledge_transfer"]
  });

  // origin="manual" — the HIPAA tabletop drill is a process gap the
  // user authored directly via the +Add gap dialog (no underlying
  // desired-state disposition). Demos how manual-add gaps appear
  // in the kanban WITHOUT being mis-flagged as auto-drafted.
  const gapHipaaDrill = createEmptyGap({
    ...cc(GAP_HIPAA_DRILL_ID),
    description:               "Conduct HIPAA tabletop + cyber-recovery validation drill",
    layerId:                   "dataProtection",
    affectedLayers:            ["dataProtection"],
    affectedEnvironments:      [ENV_MAIN_ID, ENV_DR_ID],
    gapType:                   "ops",
    urgency:                   "High",
    urgencyOverride:           false,
    phase:                     "now",
    status:                    "open",
    reviewed:                  true,
    origin:                    "manual",
    notes:                     "Quarterly HIPAA tabletop: simulate a clinical-system ransomware event, validate Cyber Recovery Vault restore against the EHR + PACS, document evidence for the board. Process work paired with the Cyber Recovery Vault deployment — links it for traceability so the kanban shows which asset the drill exercises.",
    driverId:                  DRIVER_CYBER_ID,
    relatedCurrentInstanceIds: [],
    relatedDesiredInstanceIds: [D_PPCR_VAULT_ID],
    services:                  ["runbook", "training", "managed"]
  });

  // ─── Assemble byId / allIds + byState collections ────────────────
  const driversAllIds = [DRIVER_CYBER_ID, DRIVER_MODERNIZE_ID, DRIVER_AI_ID, DRIVER_COST_ID];
  const envsAllIds    = [ENV_MAIN_ID, ENV_DR_ID, ENV_BRANCH_ID, ENV_GCP_ID];

  const allCurrent = [
    instEHR, instPACS, instAnalytics, instPatientPortal, instRadAI,
    instHpeMain, instHpeDR, instCiscoUCS, instLenovoBranch,
    instNetAppMain, instNetAppDR, instPure,
    instGcePortal, instGcsPortal,
    instVeeam,
    instVsphereMain, instVsphereDR,
    instCiscoNet
  ];
  const allDesired = [
    desEHR, desPACS, desAnalytics, desPatientPortal, desRadAI,
    desR770Main, desR770DR, desXe9680, desVxrail,
    desPowerStore, desPowerScale,
    desPpdm, desPpcrVault, desApexBackup,
    desCloudIq
  ];
  const allInst = allCurrent.concat(allDesired);
  const instAllIds = allInst.map(i => i.id);
  const instById = {};
  allInst.forEach(i => { instById[i.id] = i; });

  const gapsList = [
    gapEhrReplace, gapStorageReplace, gapCyberReplace,
    gapPowerScale, gapAnalyticsEnhance, gapRadAI,
    gapBranchConsol,
    gapGcpDr,
    gapHipaaDrill
  ];
  const gapsAllIds = gapsList.map(g => g.id);
  const gapsById = {};
  gapsList.forEach(g => { gapsById[g.id] = g; });

  return {
    meta,
    customer,
    drivers: {
      byId: {
        [DRIVER_CYBER_ID]:     driverCyber,
        [DRIVER_MODERNIZE_ID]: driverModernize,
        [DRIVER_AI_ID]:        driverAI,
        [DRIVER_COST_ID]:      driverCost
      },
      allIds: driversAllIds
    },
    environments: {
      byId: {
        [ENV_MAIN_ID]:   envMain,
        [ENV_DR_ID]:     envDr,
        [ENV_BRANCH_ID]: envBranch,
        [ENV_GCP_ID]:    envGcp
      },
      allIds: envsAllIds
    },
    instances: {
      byId:    instById,
      allIds:  instAllIds,
      byState: {
        current: allCurrent.map(i => i.id),
        desired: allDesired.map(i => i.id)
      }
    },
    gaps: {
      byId:   gapsById,
      allIds: gapsAllIds
    },
    activeEntity: null,
    integrityLog: []
  };
}

// ─── Module-load build + strict validation ───────────────────────────
//
// Build-time guarantee: any schema drift in this file fails the import,
// so the demo can never go stale relative to the schemas.
const _DEMO_ENGAGEMENT = EngagementSchema.parse(buildDemoEngagement());

// ─── Public API ──────────────────────────────────────────────────────

export function loadDemo() {
  return _DEMO_ENGAGEMENT;
}

export function describeDemo() {
  const e = _DEMO_ENGAGEMENT;
  return {
    customerName: e.customer.name,
    vertical:     e.customer.vertical,
    region:       e.customer.region,
    counts: {
      drivers:      e.drivers.allIds.length,
      environments: e.environments.allIds.length,
      instances:    e.instances.allIds.length,
      gaps:         e.gaps.allIds.length
    }
  };
}
