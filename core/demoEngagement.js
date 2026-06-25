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
// Customer: Meridian Heritage Development Authority (MHDA) — a FICTIONAL
//           public-sector authority overseeing a heritage, tourism, and
//           urban development mega-project. Entirely synthetic; any
//           resemblance to a real organization is coincidental.
//
// Current-state instances (54) are a hand-authored, representative estate
// across three environments: a main data center (Site 1), a DR site
// (Site 2), and an early-stage Azure NC2 landing zone. Disposition,
// drivers, desired-state Dell solutions, and gaps are authored on top of
// that estate to tell an executive-friendly modernization story.
//
// 4 strategic drivers:
//   1. Modernize Aging Infrastructure (High) — collapse the parallel
//      Dell/Nutanix/VMware compute+virt stack and the three-way storage
//      split (vSAN / Nutanix / Pure) onto one Dell platform.
//      → Dell Private Cloud (PowerFlex) + PowerScale.
//   2. Cyber Resilience (High) — Veeam policy is "TBC" at both sites;
//      Exchange has no documented DR copy (GIS does).
//      → PowerProtect Data Manager + Cyber Recovery Vault.
//   3. Cloud Strategy (Medium) — Azure NC2 landing zone has 4 nodes and
//      zero workloads; decide the hybrid platform before it fills up.
//      → Dell APEX Cloud Services pilot.
//   4. Operational Simplicity (Medium) — console sprawl across
//      ManageEngine, ITSM Remedy, Qualiex, Splunk, F5, and per-vendor
//      HCI tools.
//      → CloudIQ + Dell APEX AIOps.
//
// 3 environments:
//   1. Main Data Center (coreDc) — Site 1, primary on-prem
//   2. DR Site (drDc) — Site 2, disaster recovery
//   3. Azure (publicCloud) — Nutanix NC2 landing zone + M365 SaaS
//
// 9 gaps cover all 5 gap types (replace, consolidate, introduce, ops,
// enhance) and all 4 drivers. 7 origin="autoDraft" + 1 origin="manual"
// (the GIS DR-drill ops gap, authored directly via "+ Add gap"). Two
// gaps are left unreviewed to showcase the review workflow.
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
const DRIVER_MODERNIZE_ID = "00000000-0000-4000-8000-00d100000001";
const DRIVER_CYBER_ID     = "00000000-0000-4000-8000-00d100000002";
const DRIVER_CLOUD_ID     = "00000000-0000-4000-8000-00d100000003";
const DRIVER_OPS_ID       = "00000000-0000-4000-8000-00d100000004";

// Environments (3)
const ENV_SITE1_ID = "00000000-0000-4000-8000-00e100000001";   // Main DC — Site 1
const ENV_SITE2_ID = "00000000-0000-4000-8000-00e100000002";   // DR Site — Site 2
const ENV_AZURE_ID = "00000000-0000-4000-8000-00e100000003";   // Azure (NC2 landing zone)

// ─── Current-state instances (54, ported from the discovery import) ──
// Compute (5)
const I_DELL_S1_ID   = "00000000-0000-4000-8000-00f100000010";
const I_NX_S1_ID     = "00000000-0000-4000-8000-00f100000011";
const I_NX_S2_ID     = "00000000-0000-4000-8000-00f100000012";
const I_DELL_S2_ID   = "00000000-0000-4000-8000-00f100000013";
const I_NC2_AZURE_ID = "00000000-0000-4000-8000-00f100000014";

// Virtualization (7)
const I_VSPHERE_S1_ID   = "00000000-0000-4000-8000-00f100000020";
const I_AHV_S1_ID       = "00000000-0000-4000-8000-00f100000021";
const I_VSAN_S1_ID      = "00000000-0000-4000-8000-00f100000022";
const I_VSPHERE_S2_ID   = "00000000-0000-4000-8000-00f100000023";
const I_AHV_S2_ID       = "00000000-0000-4000-8000-00f100000024";
const I_VSAN_S2_ID      = "00000000-0000-4000-8000-00f100000025";
const I_AHV_NC2_AZURE_ID= "00000000-0000-4000-8000-00f100000026";

// Storage (6)
const I_NUTVM_S1_ID     = "00000000-0000-4000-8000-00f100000030";
const I_NUTOBJ_S1_ID    = "00000000-0000-4000-8000-00f100000031";
const I_PURE_S1_ID      = "00000000-0000-4000-8000-00f100000032";
const I_FILESHARE_S1_ID = "00000000-0000-4000-8000-00f100000033";
const I_NUTVM_S2_ID     = "00000000-0000-4000-8000-00f100000034";
const I_NUTOBJ_S2_ID    = "00000000-0000-4000-8000-00f100000035";

// Data Protection (6)
const I_DD_S1_ID       = "00000000-0000-4000-8000-00f100000040";
const I_VEEAM_S1_ID    = "00000000-0000-4000-8000-00f100000041";
const I_OPENTEXT_S1_ID = "00000000-0000-4000-8000-00f100000042";
const I_DDCRS_S2_ID    = "00000000-0000-4000-8000-00f100000043";
const I_VEEAM_S2_ID    = "00000000-0000-4000-8000-00f100000044";
const I_OPENTEXT_S2_ID = "00000000-0000-4000-8000-00f100000045";

// Infrastructure (23)
const I_CISCONET_S1_ID  = "00000000-0000-4000-8000-00f100000050";
const I_DELLTOR_S1_ID   = "00000000-0000-4000-8000-00f100000051";
const I_PALOALTO_S1_ID  = "00000000-0000-4000-8000-00f100000052";
const I_FORTINET_S1_ID  = "00000000-0000-4000-8000-00f100000053";
const I_CISCOISE_S1_ID  = "00000000-0000-4000-8000-00f100000054";
const I_AD_S1_ID        = "00000000-0000-4000-8000-00f100000055";
const I_RIVERBED_S1_ID  = "00000000-0000-4000-8000-00f100000056";
const I_MENCM_S1_ID     = "00000000-0000-4000-8000-00f100000057";
const I_F5_S1_ID        = "00000000-0000-4000-8000-00f100000058";
const I_SPLUNK_S1_ID    = "00000000-0000-4000-8000-00f100000059";
const I_ITSM_S1_ID      = "00000000-0000-4000-8000-00f100000060";
const I_MESAM_S1_ID     = "00000000-0000-4000-8000-00f100000061";
const I_CISCONET_S2_ID  = "00000000-0000-4000-8000-00f100000062";
const I_DELLTOR_S2_ID   = "00000000-0000-4000-8000-00f100000063";
const I_PALOALTO_S2_ID  = "00000000-0000-4000-8000-00f100000064";
const I_FORTINET_S2_ID  = "00000000-0000-4000-8000-00f100000065";
const I_AD_S2_ID        = "00000000-0000-4000-8000-00f100000066";
const I_INFOBLOX_S2_ID  = "00000000-0000-4000-8000-00f100000067";
const I_QUALIEX_S2_ID   = "00000000-0000-4000-8000-00f100000068";
const I_SPLUNK_S2_ID    = "00000000-0000-4000-8000-00f100000069";
const I_ITSM_S2_ID      = "00000000-0000-4000-8000-00f100000070";
const I_MESAM_S2_ID     = "00000000-0000-4000-8000-00f100000071";
const I_VPNGW_AZURE_ID  = "00000000-0000-4000-8000-00f100000072";

// Workload (7)
const I_GIS_S1_ID      = "00000000-0000-4000-8000-00f100000080";
const I_EXCHANGE_S1_ID = "00000000-0000-4000-8000-00f100000081";
const I_WEBAPPS_S1_ID  = "00000000-0000-4000-8000-00f100000082";
const I_APPIN_S1_ID    = "00000000-0000-4000-8000-00f100000083";
const I_VDIGPU_S2_ID   = "00000000-0000-4000-8000-00f100000084";
const I_GIS_S2_ID      = "00000000-0000-4000-8000-00f100000085";
const I_M365_AZURE_ID  = "00000000-0000-4000-8000-00f100000086";

// ─── Desired-state instances (9) ──────────────────────────────────────
const D_PRIVATECLOUD_S1_ID = "00000000-0000-4000-8000-00f100000100";
const D_PRIVATECLOUD_S2_ID = "00000000-0000-4000-8000-00f100000101";
const D_POWERSCALE_S1_ID   = "00000000-0000-4000-8000-00f100000102";
const D_PPDM_S1_ID         = "00000000-0000-4000-8000-00f100000103";
const D_PPDM_S2_ID         = "00000000-0000-4000-8000-00f100000104";
const D_PPCRVAULT_S2_ID    = "00000000-0000-4000-8000-00f100000105";
const D_APEXCLOUD_AZURE_ID = "00000000-0000-4000-8000-00f100000106";
const D_CLOUDIQ_S1_ID      = "00000000-0000-4000-8000-00f100000107";
const D_GIS_S1_ID          = "00000000-0000-4000-8000-00f100000108";

// ─── Gaps (9) ──────────────────────────────────────────────────────────
const GAP_CONSOLIDATE_HCI_ID  = "00000000-0000-4000-8000-00a100000001";  // modernize, consolidate, now
const GAP_STORAGE_REPLACE_ID  = "00000000-0000-4000-8000-00a100000002";  // modernize, replace, next
const GAP_BACKUP_REPLACE_ID   = "00000000-0000-4000-8000-00a100000003";  // cyber, replace, now
const GAP_CYBER_VAULT_ID      = "00000000-0000-4000-8000-00a100000004";  // cyber, introduce, now
const GAP_EXCHANGE_RETIRE_ID  = "00000000-0000-4000-8000-00a100000005";  // cyber, ops, next
const GAP_NC2_DECISION_ID     = "00000000-0000-4000-8000-00a100000006";  // cloud, ops, next (unreviewed)
const GAP_CLOUDIQ_ID          = "00000000-0000-4000-8000-00a100000007";  // ops, introduce, later (unreviewed)
const GAP_GIS_DR_DRILL_ID     = "00000000-0000-4000-8000-00a100000008";  // cyber, ops, now (origin: manual)
const GAP_GIS_ENHANCE_ID      = "00000000-0000-4000-8000-00a100000009";  // modernize, enhance, next

const CATALOG_VERSION = "2026.04";
const TS              = "2026-06-23T12:56:30.602Z";

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
    engagementDate: "2026-06-23",
    status:         "Draft",
    createdAt:      TS,
    updatedAt:      TS
  });

  const customer = createEmptyCustomer({
    engagementId: ENGAGEMENT_ID,
    name:         "Meridian Heritage Development Authority (MHDA)",
    vertical:     "Public Sector",
    region:       "Middle East",
    notes:        "Fictional public-sector authority overseeing a heritage, tourism, and urban development mega-project. Two-site data center footprint (Site 1 main + Site 2 DR) running a mixed Dell / Nutanix / VMware HCI estate, plus an early-stage Nutanix Cloud Clusters (NC2) landing zone on Azure with no workloads yet. GIS (heritage-site mapping) and on-prem Exchange are the two most business-critical workloads. Synthetic demo engagement — showcases the v3 data model + AI assistant against a fragmented multi-vendor estate. Any resemblance to a real organization is coincidental."
  });

  // ─── Drivers ─────────────────────────────────────────────────────
  const driverModernize = createEmptyDriver({
    ...cc(DRIVER_MODERNIZE_ID),
    businessDriverId: "modernize_infra",
    catalogVersion:   CATALOG_VERSION,
    priority:         "High",
    outcomes:         "• Standardize Site 1 and Site 2 compute + virtualization on one platform instead of running Dell, Nutanix NX, VMware vSphere, and Nutanix AHV side by side.\n• Collapse three parallel storage silos (VMware vSAN, Nutanix Object/VM storage, Pure Storage Object) into a single Dell-managed tier.\n• Make Site 1 -> Site 2 DR failover a true like-for-like swap instead of a cross-vendor exercise.\n• Reduce the vendor/support-contract count currently spread across Dell, Nutanix, VMware, and Pure."
  });
  const driverCyber = createEmptyDriver({
    ...cc(DRIVER_CYBER_ID),
    businessDriverId: "cyber_resilience",
    catalogVersion:   CATALOG_VERSION,
    priority:         "High",
    outcomes:         "• Replace the Veeam estate -- backup policy still \"TBC\" at both sites per discovery -- with a documented, tested policy on PowerProtect.\n• Stand up an air-gapped Cyber Recovery vault using the Data Domain + CRS replication already running between Site 1 and Site 2.\n• Give the on-prem Exchange platform, currently the only Tier-1 workload with no documented DR copy, a resilience path via the parallel Microsoft 365 migration.\n• Quarterly tested-restore evidence for GIS, Exchange, and the web application portfolio."
  });
  const driverCloud = createEmptyDriver({
    ...cc(DRIVER_CLOUD_ID),
    businessDriverId: "cloud_strategy",
    catalogVersion:   CATALOG_VERSION,
    priority:         "Medium",
    outcomes:         "• Decide the hybrid cloud platform before the Azure NC2 landing zone (4 nodes, zero workloads today) takes its first production workload.\n• Avoid compounding Nutanix licensing in the cloud on top of the on-prem estate if Site 1/Site 2 standardize on a different platform.\n• Use the still-empty landing zone as the lowest-risk place to pilot Dell APEX Cloud Services consistency with the on-prem estate.\n• Validate VPN throughput between the Meridian sites and Azure before any workload-placement commitment."
  });
  const driverOps = createEmptyDriver({
    ...cc(DRIVER_OPS_ID),
    businessDriverId: "ops_simplicity",
    catalogVersion:   CATALOG_VERSION,
    priority:         "Medium",
    outcomes:         "• Today's estate is split across ManageEngine NCM, ManageEngine SAM, ITSM Remedy, Qualiex, Splunk, F5, and separate Nutanix/VMware/Pure consoles -- no single infrastructure health view.\n• Stand up CloudIQ + Dell APEX AIOps as the unified telemetry pane once compute/storage consolidates onto Dell.\n• Cut the time the Meridian IT team spends context-switching between consoles during incident response.\n• Keep Splunk as the SOC/SIEM system of record -- AIOps complements it, not replaces it."
  });

  // ─── Environments ────────────────────────────────────────────────
  const envSite1 = createEmptyEnvironment({
    ...cc(ENV_SITE1_ID),
    envCatalogId:   "coreDc",
    catalogVersion: CATALOG_VERSION,
    alias:          "Main Data Center – Site 1",
    location:       "Meridian City (Main Campus)",
    notes:          "Primary on-premises data center. Hosts the Dell + Nutanix + VMware HCI stack, the GIS platform, on-prem Exchange, and the customer-built web application portfolio. ~30-40% compute utilization; vSphere license renewal milestone noted during discovery."
  });
  const envSite2 = createEmptyEnvironment({
    ...cc(ENV_SITE2_ID),
    envCatalogId:   "drDc",
    catalogVersion: CATALOG_VERSION,
    alias:          "DR Site – Site 2",
    location:       "Secondary data center (disaster recovery)",
    notes:          "Disaster recovery site; mirrors the Site 1 HCI stack at smaller scale. Hosts the GIS DR copy, GPU-accelerated VDI, and the Data Domain + Cyber Recovery (CRS) replication target for Site 1 backups."
  });
  const envAzure = createEmptyEnvironment({
    ...cc(ENV_AZURE_ID),
    envCatalogId:   "publicCloud",
    catalogVersion: CATALOG_VERSION,
    alias:          "Azure (NC2 Landing Zone)",
    location:       "Microsoft Azure",
    notes:          "Nutanix Cloud Clusters (NC2) landing zone -- 4 nodes, stood up recently, no production workloads yet. Connected to both on-prem sites via a redundant VPN gateway. Hosts the Microsoft 365 / Outlook SaaS tenant, operated by Microsoft and administered by internal IT."
  });

  // ─── Current-state compute (5) ───────────────────────────────────
  const instDellS1 = createEmptyInstance({
    ...cc(I_DELL_S1_ID),
    state: "current", layerId: "compute", environmentId: ENV_SITE1_ID,
    label: "Dell Servers – Site 1 (28 nodes)", vendor: "Dell", vendorGroup: "dell",
    criticality: "High", disposition: "keep", nodeCount: 28,
    notes: "28 Dell servers; VMware + Nutanix HCI stack; ~30-40% utilization."
  });
  const instNxS1 = createEmptyInstance({
    ...cc(I_NX_S1_ID),
    state: "current", layerId: "compute", environmentId: ENV_SITE1_ID,
    label: "Nutanix NX Servers – Site 1 (34 compute nodes)", vendor: "Nutanix", vendorGroup: "nonDell",
    criticality: "High", disposition: "consolidate", nodeCount: 34,
    notes: "46 NX servers total; 34 compute nodes; remainder storage/mgmt roles. Folds into the Dell Private Cloud consolidation."
  });
  const instNxS2 = createEmptyInstance({
    ...cc(I_NX_S2_ID),
    state: "current", layerId: "compute", environmentId: ENV_SITE2_ID,
    label: "Nutanix NX Servers – Site 2 (19 compute nodes)", vendor: "Nutanix", vendorGroup: "nonDell",
    criticality: "High", disposition: "consolidate", nodeCount: 19,
    notes: "27 NX servers total; 19 compute, 8 storage; mirrors Site 1 HCI stack. Folds into the Dell Private Cloud consolidation."
  });
  const instDellS2 = createEmptyInstance({
    ...cc(I_DELL_S2_ID),
    state: "current", layerId: "compute", environmentId: ENV_SITE2_ID,
    label: "Dell Servers – Site 2 (20 nodes, 3 agency-dedic.)", vendor: "Dell", vendorGroup: "dell",
    criticality: "High", disposition: "keep", nodeCount: 20,
    notes: "17 standard Dell servers + 3 servers dedicated to a partner government agency at DR site."
  });
  const instNc2Azure = createEmptyInstance({
    ...cc(I_NC2_AZURE_ID),
    state: "current", layerId: "compute", environmentId: ENV_AZURE_ID,
    label: "Nutanix NC2 on Azure – 4 nodes (landing zone)", vendor: "Nutanix", vendorGroup: "nonDell",
    criticality: "Low", disposition: "ops", nodeCount: 4,
    notes: "4 NC2 nodes on Azure; landing zone only; no workloads yet; just started. Platform direction not yet decided."
  });

  // ─── Current-state virtualization (7) ────────────────────────────
  const instVsphereS1 = createEmptyInstance({
    ...cc(I_VSPHERE_S1_ID),
    state: "current", layerId: "virtualization", environmentId: ENV_SITE1_ID,
    label: "VMware vSphere / vCenter – Site 1", vendor: "VMware", vendorGroup: "nonDell",
    criticality: "High", disposition: "consolidate",
    notes: "Primary production hypervisor; ~30-40% utilization; license renewal milestone noted. Folds into the Dell Private Cloud consolidation."
  });
  const instAhvS1 = createEmptyInstance({
    ...cc(I_AHV_S1_ID),
    state: "current", layerId: "virtualization", environmentId: ENV_SITE1_ID,
    label: "Nutanix AHV – Site 1 (test & dev)", vendor: "Nutanix", vendorGroup: "nonDell",
    criticality: "Medium", disposition: "consolidate",
    notes: "AHV used for test and development workloads only; not primary production hypervisor. Folds into the Dell Private Cloud consolidation."
  });
  const instVsanS1 = createEmptyInstance({
    ...cc(I_VSAN_S1_ID),
    state: "current", layerId: "virtualization", environmentId: ENV_SITE1_ID,
    label: "VMware vSAN – Site 1 (1 PB, ~50% utilized)", vendor: "VMware", vendorGroup: "nonDell",
    criticality: "High", disposition: "consolidate",
    notes: "1 PB vSAN capacity; ~50% utilized; software-defined storage layer on HCI. Folds into the Dell Private Cloud consolidation."
  });
  const instVsphereS2 = createEmptyInstance({
    ...cc(I_VSPHERE_S2_ID),
    state: "current", layerId: "virtualization", environmentId: ENV_SITE2_ID,
    label: "VMware vSphere / vCenter – Site 2", vendor: "VMware", vendorGroup: "nonDell",
    criticality: "High", disposition: "consolidate",
    notes: "Primary production hypervisor at DR; ~30-40% utilization; less mature mgmt noted. Folds into the Dell Private Cloud consolidation."
  });
  const instAhvS2 = createEmptyInstance({
    ...cc(I_AHV_S2_ID),
    state: "current", layerId: "virtualization", environmentId: ENV_SITE2_ID,
    label: "Nutanix AHV – Site 2 (test & dev)", vendor: "Nutanix", vendorGroup: "nonDell",
    criticality: "Medium", disposition: "consolidate",
    notes: "AHV used for test and development workloads at DR site. Folds into the Dell Private Cloud consolidation."
  });
  const instVsanS2 = createEmptyInstance({
    ...cc(I_VSAN_S2_ID),
    state: "current", layerId: "virtualization", environmentId: ENV_SITE2_ID,
    label: "VMware vSAN – Site 2 (740 TB, ~50% utilized)", vendor: "VMware", vendorGroup: "nonDell",
    criticality: "High", disposition: "consolidate",
    notes: "740 TB vSAN; ~350 TB utilized (~50%); sufficient headroom for failover. Folds into the Dell Private Cloud consolidation."
  });
  const instAhvNc2Azure = createEmptyInstance({
    ...cc(I_AHV_NC2_AZURE_ID),
    state: "current", layerId: "virtualization", environmentId: ENV_AZURE_ID,
    label: "Nutanix AHV on NC2 – Azure (landing zone)", vendor: "Nutanix", vendorGroup: "nonDell",
    criticality: "Low", disposition: "ops",
    notes: "AHV hypervisor on NC2 Azure nodes; landing zone stage; minimal utilization. Platform direction not yet decided."
  });

  // ─── Current-state storage (6) ───────────────────────────────────
  const instNutVmS1 = createEmptyInstance({
    ...cc(I_NUTVM_S1_ID),
    state: "current", layerId: "storage", environmentId: ENV_SITE1_ID,
    label: "Nutanix VM Storage – Site 1 (~500 TB)", vendor: "Nutanix", vendorGroup: "nonDell",
    criticality: "High", disposition: "keep",
    notes: "~500 TB VM storage pool; ~120 TB currently used by VMs."
  });
  const instNutObjS1 = createEmptyInstance({
    ...cc(I_NUTOBJ_S1_ID),
    state: "current", layerId: "storage", environmentId: ENV_SITE1_ID,
    label: "Nutanix Object Storage – Site 1 (800 TB)", vendor: "Nutanix", vendorGroup: "nonDell",
    criticality: "High", disposition: "keep",
    notes: "~800 TB object storage; ~40% utilization; significant headroom remaining."
  });
  const instPureS1 = createEmptyInstance({
    ...cc(I_PURE_S1_ID),
    state: "current", layerId: "storage", environmentId: ENV_SITE1_ID,
    label: "Pure Storage Object – Site 1 (300 TB)", vendor: "Pure Storage", vendorGroup: "nonDell",
    criticality: "Medium", disposition: "replace",
    endOfSaleDate: "2026-09-30", endOfSupportDate: "2027-09-30", endOfServiceLifeDate: "2028-09-30",
    notes: "~300 TB; ~110 TB in use; at least one node located at main site. Replace with PowerScale to unify the storage tier."
  });
  const instFileshareS1 = createEmptyInstance({
    ...cc(I_FILESHARE_S1_ID),
    state: "current", layerId: "storage", environmentId: ENV_SITE1_ID,
    label: "Nutanix Fileshare – Site 1", vendor: "Nutanix", vendorGroup: "nonDell",
    criticality: "Medium", disposition: "keep",
    notes: "File sharing service on Nutanix platform; workloads include pictures and fileshares."
  });
  const instNutVmS2 = createEmptyInstance({
    ...cc(I_NUTVM_S2_ID),
    state: "current", layerId: "storage", environmentId: ENV_SITE2_ID,
    label: "Nutanix VM Storage – Site 2 (~400 TB)", vendor: "Nutanix", vendorGroup: "nonDell",
    criticality: "High", disposition: "keep",
    notes: "~400 TB VM storage; ~40 TB currently used; low utilization at DR site."
  });
  const instNutObjS2 = createEmptyInstance({
    ...cc(I_NUTOBJ_S2_ID),
    state: "current", layerId: "storage", environmentId: ENV_SITE2_ID,
    label: "Nutanix Object Storage – Site 2 (1 PB)", vendor: "Nutanix", vendorGroup: "nonDell",
    criticality: "High", disposition: "keep",
    notes: "1 PB object; ~60% for filesharing (400 TB + 600 TB diff hardware levels)."
  });

  // ─── Current-state data protection (6) ───────────────────────────
  const instDdS1 = createEmptyInstance({
    ...cc(I_DD_S1_ID),
    state: "current", layerId: "dataProtection", environmentId: ENV_SITE1_ID,
    label: "Dell Data Domain Backup Appliance – Site 1", vendor: "Dell", vendorGroup: "dell",
    criticality: "High", disposition: "keep",
    notes: "1x backup appliance DD connected to DR CRS DD; backs up VMs, GIS, fileshares."
  });
  const instVeeamS1 = createEmptyInstance({
    ...cc(I_VEEAM_S1_ID),
    state: "current", layerId: "dataProtection", environmentId: ENV_SITE1_ID,
    label: "Veeam Backup & Replication – Site 1", vendor: "Veeam", vendorGroup: "nonDell",
    criticality: "High", disposition: "replace",
    endOfSaleDate: "2027-03-31", endOfSupportDate: "2028-03-31", endOfServiceLifeDate: "2029-03-31",
    notes: "Backup software for VMs, GIS workloads, pictures, fileshares; policy TBC. Replace with PowerProtect Data Manager."
  });
  const instOpentextS1 = createEmptyInstance({
    ...cc(I_OPENTEXT_S1_ID),
    state: "current", layerId: "dataProtection", environmentId: ENV_SITE1_ID,
    label: "OpenText Archiving Solution – Site 1", vendor: "OpenText", vendorGroup: "nonDell",
    criticality: "Medium", disposition: "keep",
    notes: "Archiving solution for long-term data retention."
  });
  const instDdcrsS2 = createEmptyInstance({
    ...cc(I_DDCRS_S2_ID),
    state: "current", layerId: "dataProtection", environmentId: ENV_SITE2_ID,
    label: "Dell Data Domain + CRS – Site 2", vendor: "Dell", vendorGroup: "dell",
    criticality: "High", disposition: "keep",
    notes: "DD + CRS at DR site; acts as backup target for Site 1 Data Domain replication. Foundation for the Cyber Recovery vault."
  });
  const instVeeamS2 = createEmptyInstance({
    ...cc(I_VEEAM_S2_ID),
    state: "current", layerId: "dataProtection", environmentId: ENV_SITE2_ID,
    label: "Veeam Backup & Replication – Site 2", vendor: "Veeam", vendorGroup: "nonDell",
    criticality: "High", disposition: "replace",
    endOfSaleDate: "2027-06-30", endOfSupportDate: "2028-06-30", endOfServiceLifeDate: "2029-06-30",
    notes: "Backup software at DR site; backs up VMs, GIS workloads, fileshares; policy TBC. Replace with PowerProtect Data Manager."
  });
  const instOpentextS2 = createEmptyInstance({
    ...cc(I_OPENTEXT_S2_ID),
    state: "current", layerId: "dataProtection", environmentId: ENV_SITE2_ID,
    label: "OpenText Archiving Solution – Site 2", vendor: "OpenText", vendorGroup: "nonDell",
    criticality: "Medium", disposition: "keep",
    notes: "Archiving solution at DR site; mirrors Site 1 archiving capability."
  });

  // ─── Current-state infrastructure (23) ───────────────────────────
  const instCiscoNetS1 = createEmptyInstance({
    ...cc(I_CISCONET_S1_ID),
    state: "current", layerId: "infrastructure", environmentId: ENV_SITE1_ID,
    label: "Cisco Networking – Site 1 (25G / 200G core)", vendor: "Cisco", vendorGroup: "nonDell",
    criticality: "High", disposition: "keep",
    notes: "Servers 25G, LACP, 10G; 200G core; all redundant; storage all iSCSI; to continue."
  });
  const instDellTorS1 = createEmptyInstance({
    ...cc(I_DELLTOR_S1_ID),
    state: "current", layerId: "infrastructure", environmentId: ENV_SITE1_ID,
    label: "Dell ToR Switches – Site 1 (HCI / VxRail)", vendor: "Dell", vendorGroup: "dell",
    criticality: "High", disposition: "keep",
    notes: "Dell network top-of-rack switches supporting HCI/VxRail deployment at Site 1."
  });
  const instPaloAltoS1 = createEmptyInstance({
    ...cc(I_PALOALTO_S1_ID),
    state: "current", layerId: "infrastructure", environmentId: ENV_SITE1_ID,
    label: "Palo Alto NGFW – Site 1 (DC perimeter)", vendor: "Palo Alto", vendorGroup: "nonDell",
    criticality: "High", disposition: "keep",
    notes: "3-tier security; firewall must remain even during migration; DC perimeter protection."
  });
  const instFortinetS1 = createEmptyInstance({
    ...cc(I_FORTINET_S1_ID),
    state: "current", layerId: "infrastructure", environmentId: ENV_SITE1_ID,
    label: "Fortinet FortiGate + FortiManager – Site 1", vendor: "Fortinet", vendorGroup: "nonDell",
    criticality: "High", disposition: "keep",
    notes: "FortiGate DC firewall + FortiManager centralized management; 3-tier security stack."
  });
  const instCiscoIseS1 = createEmptyInstance({
    ...cc(I_CISCOISE_S1_ID),
    state: "current", layerId: "infrastructure", environmentId: ENV_SITE1_ID,
    label: "Cisco ISE – Network Access Control – Site 1", vendor: "Cisco", vendorGroup: "nonDell",
    criticality: "High", disposition: "keep",
    notes: "Network access control (NAC); identity-based policy enforcement."
  });
  const instAdS1 = createEmptyInstance({
    ...cc(I_AD_S1_ID),
    state: "current", layerId: "infrastructure", environmentId: ENV_SITE1_ID,
    label: "Active Directory / LDAP – Site 1", vendor: "Microsoft", vendorGroup: "nonDell",
    criticality: "High", disposition: "keep",
    notes: "Directory services and LDAP; identity foundation for Site 1."
  });
  const instRiverbedS1 = createEmptyInstance({
    ...cc(I_RIVERBED_S1_ID),
    state: "current", layerId: "infrastructure", environmentId: ENV_SITE1_ID,
    label: "Riverbed WAN Optimizer – Site 1", vendor: "Riverbed", vendorGroup: "nonDell",
    criticality: "Medium", disposition: "keep",
    notes: "WAN optimization and traffic management tool."
  });
  const instMencmS1 = createEmptyInstance({
    ...cc(I_MENCM_S1_ID),
    state: "current", layerId: "infrastructure", environmentId: ENV_SITE1_ID,
    label: "ManageEngine NCM – Network Config Mgmt", vendor: "ManageEngine", vendorGroup: "nonDell",
    criticality: "Medium", disposition: "keep",
    notes: "Network configuration management tool; part of monitoring suite."
  });
  const instF5S1 = createEmptyInstance({
    ...cc(I_F5_S1_ID),
    state: "current", layerId: "infrastructure", environmentId: ENV_SITE1_ID,
    label: "F5 WAF / Load Balancer – Site 1", vendor: "F5", vendorGroup: "nonDell",
    criticality: "High", disposition: "keep",
    notes: "Web application firewall and load balancer; application delivery control."
  });
  const instSplunkS1 = createEmptyInstance({
    ...cc(I_SPLUNK_S1_ID),
    state: "current", layerId: "infrastructure", environmentId: ENV_SITE1_ID,
    label: "Splunk SIEM – SOC – Site 1", vendor: "Splunk", vendorGroup: "nonDell",
    criticality: "High", disposition: "keep",
    notes: "SOC/SIEM platform; AHV compatibility noted as better with Splunk."
  });
  const instItsmS1 = createEmptyInstance({
    ...cc(I_ITSM_S1_ID),
    state: "current", layerId: "infrastructure", environmentId: ENV_SITE1_ID,
    label: "ITSM Remedy – Ticketing & Change Mgmt", vendor: "BMC", vendorGroup: "nonDell",
    criticality: "Medium", disposition: "keep",
    notes: "IT service management for ticketing and change management processes."
  });
  const instMesamS1 = createEmptyInstance({
    ...cc(I_MESAM_S1_ID),
    state: "current", layerId: "infrastructure", environmentId: ENV_SITE1_ID,
    label: "ManageEngine SAM – Asset & Service Mgmt", vendor: "ManageEngine", vendorGroup: "nonDell",
    criticality: "Medium", disposition: "keep",
    notes: "Service and asset management platform."
  });
  const instCiscoNetS2 = createEmptyInstance({
    ...cc(I_CISCONET_S2_ID),
    state: "current", layerId: "infrastructure", environmentId: ENV_SITE2_ID,
    label: "Cisco Networking – Site 2 (25G / 200G core)", vendor: "Cisco", vendorGroup: "nonDell",
    criticality: "High", disposition: "keep",
    notes: "Servers 25G, LACP, 10G; 200G core; all redundant; iSCSI; Cisco to continue."
  });
  const instDellTorS2 = createEmptyInstance({
    ...cc(I_DELLTOR_S2_ID),
    state: "current", layerId: "infrastructure", environmentId: ENV_SITE2_ID,
    label: "Dell ToR Switches – Site 2 (HCI / VxRail)", vendor: "Dell", vendorGroup: "dell",
    criticality: "High", disposition: "keep",
    notes: "Dell network top-of-rack switches supporting HCI/VxRail at DR site."
  });
  const instPaloAltoS2 = createEmptyInstance({
    ...cc(I_PALOALTO_S2_ID),
    state: "current", layerId: "infrastructure", environmentId: ENV_SITE2_ID,
    label: "Palo Alto NGFW – Site 2 (DC perimeter)", vendor: "Palo Alto", vendorGroup: "nonDell",
    criticality: "High", disposition: "keep",
    notes: "DC perimeter NGFW; 3-tier security; firewall must remain even during migration."
  });
  const instFortinetS2 = createEmptyInstance({
    ...cc(I_FORTINET_S2_ID),
    state: "current", layerId: "infrastructure", environmentId: ENV_SITE2_ID,
    label: "Fortinet FortiGate – Site 2", vendor: "Fortinet", vendorGroup: "nonDell",
    criticality: "High", disposition: "keep",
    notes: "FortiGate DC firewall at DR site; 3-tier security stack."
  });
  const instAdS2 = createEmptyInstance({
    ...cc(I_AD_S2_ID),
    state: "current", layerId: "infrastructure", environmentId: ENV_SITE2_ID,
    label: "Active Directory / LDAP – Site 2", vendor: "Microsoft", vendorGroup: "nonDell",
    criticality: "High", disposition: "keep",
    notes: "Directory services and LDAP at DR site; no separate management noted."
  });
  const instInfobloxS2 = createEmptyInstance({
    ...cc(I_INFOBLOX_S2_ID),
    state: "current", layerId: "infrastructure", environmentId: ENV_SITE2_ID,
    label: "Infoblox – DNS / IPAM – Site 2", vendor: "Infoblox", vendorGroup: "nonDell",
    criticality: "Medium", disposition: "keep",
    notes: "DNS and IPAM (IP address management) service at DR site."
  });
  const instQualiexS2 = createEmptyInstance({
    ...cc(I_QUALIEX_S2_ID),
    state: "current", layerId: "infrastructure", environmentId: ENV_SITE2_ID,
    label: "Qualiex – Security & Compliance Mgmt", vendor: "Qualiex", vendorGroup: "nonDell",
    criticality: "Medium", disposition: "keep",
    notes: "Security and compliance management platform at DR site."
  });
  const instSplunkS2 = createEmptyInstance({
    ...cc(I_SPLUNK_S2_ID),
    state: "current", layerId: "infrastructure", environmentId: ENV_SITE2_ID,
    label: "Splunk – Monitoring – Site 2", vendor: "Splunk", vendorGroup: "nonDell",
    criticality: "High", disposition: "keep",
    notes: "Monitoring and log management at DR site."
  });
  const instItsmS2 = createEmptyInstance({
    ...cc(I_ITSM_S2_ID),
    state: "current", layerId: "infrastructure", environmentId: ENV_SITE2_ID,
    label: "ITSM Remedy – Site 2", vendor: "BMC", vendorGroup: "nonDell",
    criticality: "Medium", disposition: "keep",
    notes: "IT service management ticketing at DR site."
  });
  const instMesamS2 = createEmptyInstance({
    ...cc(I_MESAM_S2_ID),
    state: "current", layerId: "infrastructure", environmentId: ENV_SITE2_ID,
    label: "ManageEngine SAM – Site 2", vendor: "ManageEngine", vendorGroup: "nonDell",
    criticality: "Medium", disposition: "keep",
    notes: "Service and asset management at DR site."
  });
  const instVpnGwAzure = createEmptyInstance({
    ...cc(I_VPNGW_AZURE_ID),
    state: "current", layerId: "infrastructure", environmentId: ENV_AZURE_ID,
    label: "Azure VPN Gateway – Redundant (to on-prem)", vendor: "Microsoft", vendorGroup: "nonDell",
    criticality: "Medium", disposition: "keep",
    notes: "Redundant VPN gateway connecting on-prem sites to Azure; throughput TBC."
  });

  // ─── Current-state workloads (7) ─────────────────────────────────
  const instGisS1 = createEmptyInstance({
    ...cc(I_GIS_S1_ID),
    state: "current", layerId: "workload", environmentId: ENV_SITE1_ID,
    label: "GIS Platform – Site 1", vendor: "Custom", vendorGroup: "custom",
    criticality: "High", disposition: "enhance",
    notes: "GIS workloads identified as business-critical; includes GIS data and pictures. Enhance via the modernized Dell infrastructure chain."
  });
  const instExchangeS1 = createEmptyInstance({
    ...cc(I_EXCHANGE_S1_ID),
    state: "current", layerId: "workload", environmentId: ENV_SITE1_ID,
    label: "Microsoft Exchange – Email (critical)", vendor: "Microsoft", vendorGroup: "nonDell",
    criticality: "High", disposition: "retire",
    notes: "On-premises Exchange; business-critical email platform; separate from M365 SaaS. No documented DR copy, unlike GIS. Retire in favor of completing the parallel Microsoft 365 migration."
  });
  const instWebappsS1 = createEmptyInstance({
    ...cc(I_WEBAPPS_S1_ID),
    state: "current", layerId: "workload", environmentId: ENV_SITE1_ID,
    label: "Web Applications & Databases – Site 1", vendor: "Custom", vendorGroup: "custom",
    criticality: "High", disposition: "keep",
    notes: "Multiple web applications and databases; custom/mixed portfolio."
  });
  const instAppinS1 = createEmptyInstance({
    ...cc(I_APPIN_S1_ID),
    state: "current", layerId: "workload", environmentId: ENV_SITE1_ID,
    label: "Appin Task & Process Mgmt System", vendor: "Appin", vendorGroup: "nonDell",
    criticality: "Medium", disposition: "keep",
    notes: "Task and process management system (monument system)."
  });
  const instVdigpuS2 = createEmptyInstance({
    ...cc(I_VDIGPU_S2_ID),
    state: "current", layerId: "workload", environmentId: ENV_SITE2_ID,
    label: "Nutanix VDI with GPU – Site 2", vendor: "Nutanix", vendorGroup: "nonDell",
    criticality: "High", disposition: "keep",
    notes: "GPU-accelerated VDI workload on Nutanix platform at DR site."
  });
  const instGisS2 = createEmptyInstance({
    ...cc(I_GIS_S2_ID),
    state: "current", layerId: "workload", environmentId: ENV_SITE2_ID,
    label: "GIS Platform – Site 2 (DR)", vendor: "Custom", vendorGroup: "custom",
    criticality: "High", disposition: "keep",
    notes: "GIS DR workload; Exchange also noted as business-critical at DR site."
  });
  const instM365Azure = createEmptyInstance({
    ...cc(I_M365_AZURE_ID),
    state: "current", layerId: "workload", environmentId: ENV_AZURE_ID,
    label: "Microsoft Outlook / M365 SaaS – Azure", vendor: "Microsoft", vendorGroup: "nonDell",
    criticality: "High", disposition: "keep",
    notes: "SaaS; operated by Microsoft; administered by internal IT; separate from on-prem Exchange. Target platform for the Exchange retirement gap."
  });

  // ─── Desired-state Dell solutions (9) ────────────────────────────
  const desPrivateCloudS1 = createEmptyInstance({
    ...cc(D_PRIVATECLOUD_S1_ID),
    state: "desired", layerId: "compute", environmentId: ENV_SITE1_ID,
    label: "Dell Private Cloud (PowerFlex) – Site 1", vendor: "Dell", vendorGroup: "dell",
    criticality: "High", priority: "Now", disposition: "consolidate", originId: I_NX_S1_ID,
    notes: "Consolidates the Site 1 Dell + Nutanix NX compute, VMware vSphere, Nutanix AHV, and VMware vSAN into one Dell Automation Platform / PowerFlex private cloud. Single platform makes Site 1 -> Site 2 failover a like-for-like swap."
  });
  const desPrivateCloudS2 = createEmptyInstance({
    ...cc(D_PRIVATECLOUD_S2_ID),
    state: "desired", layerId: "compute", environmentId: ENV_SITE2_ID,
    label: "Dell Private Cloud (PowerFlex) – Site 2", vendor: "Dell", vendorGroup: "dell",
    criticality: "High", priority: "Now", disposition: "consolidate", originId: I_NX_S2_ID,
    notes: "Mirrors the Site 1 Dell Private Cloud build at the DR site, replacing the parallel Nutanix NX + VMware vSphere/AHV/vSAN stack."
  });
  const desPowerScaleS1 = createEmptyInstance({
    ...cc(D_POWERSCALE_S1_ID),
    state: "desired", layerId: "storage", environmentId: ENV_SITE1_ID,
    label: "PowerScale (unified storage) – Site 1", vendor: "Dell", vendorGroup: "dell",
    criticality: "Medium", priority: "Next", disposition: "replace", originId: I_PURE_S1_ID,
    notes: "Replaces the standalone Pure Storage Object tier. Single namespace also absorbs growth headroom the Nutanix Object/VM storage pools already have, simplifying the storage estate over time."
  });
  const desPpdmS1 = createEmptyInstance({
    ...cc(D_PPDM_S1_ID),
    state: "desired", layerId: "dataProtection", environmentId: ENV_SITE1_ID,
    label: "PowerProtect Data Manager – Site 1", vendor: "Dell", vendorGroup: "dell",
    criticality: "High", priority: "Now", disposition: "replace", originId: I_VEEAM_S1_ID,
    notes: "Replaces Veeam at Site 1 with a documented, policy-driven backup platform integrated with the existing Data Domain appliance."
  });
  const desPpdmS2 = createEmptyInstance({
    ...cc(D_PPDM_S2_ID),
    state: "desired", layerId: "dataProtection", environmentId: ENV_SITE2_ID,
    label: "PowerProtect Data Manager – Site 2", vendor: "Dell", vendorGroup: "dell",
    criticality: "High", priority: "Now", disposition: "replace", originId: I_VEEAM_S2_ID,
    notes: "Replaces Veeam at the DR site, paired with the Site 1 deployment under one backup policy."
  });
  const desPpcrVaultS2 = createEmptyInstance({
    ...cc(D_PPCRVAULT_S2_ID),
    state: "desired", layerId: "dataProtection", environmentId: ENV_SITE2_ID,
    label: "PowerProtect Cyber Recovery Vault – Site 2", vendor: "Dell", vendorGroup: "dell",
    criticality: "High", priority: "Now", disposition: "introduce",
    notes: "Net-new air-gapped vault built on the existing Data Domain + CRS replication between Site 1 and Site 2. Closes the ransomware-isolation gap the current Veeam + DD setup doesn't cover."
  });
  const desApexCloudAzure = createEmptyInstance({
    ...cc(D_APEXCLOUD_AZURE_ID),
    state: "desired", layerId: "compute", environmentId: ENV_AZURE_ID,
    label: "Dell APEX Cloud Services – Azure (hybrid extension)", vendor: "Dell", vendorGroup: "dell",
    criticality: "Low", priority: "Next", disposition: "introduce",
    notes: "Pilot of Dell-consistent hybrid cloud services in the still-empty NC2 landing zone, ahead of any production workload landing on it -- the lowest-risk point to settle the platform decision."
  });
  const desCloudIqS1 = createEmptyInstance({
    ...cc(D_CLOUDIQ_S1_ID),
    state: "desired", layerId: "infrastructure", environmentId: ENV_SITE1_ID,
    label: "CloudIQ + Dell APEX AIOps (unified ops) – Site 1", vendor: "Dell", vendorGroup: "dell",
    criticality: "Medium", priority: "Later", disposition: "introduce",
    notes: "Single telemetry pane across the consolidated Dell Private Cloud + PowerScale + PowerProtect estate. Complements Splunk SIEM rather than replacing it."
  });
  const desGisS1 = createEmptyInstance({
    ...cc(D_GIS_S1_ID),
    state: "desired", layerId: "workload", environmentId: ENV_SITE1_ID,
    label: "GIS Platform – Site 1 (modernized)", vendor: "Custom", vendorGroup: "custom",
    criticality: "High", priority: "Now", disposition: "enhance", originId: I_GIS_S1_ID,
    notes: "Same logical GIS workload; underlying platform refreshed to Dell Private Cloud + PowerScale, backed up via PowerProtect Data Manager + the Cyber Recovery vault.",
    mappedAssetIds: [D_PRIVATECLOUD_S1_ID, D_POWERSCALE_S1_ID, D_PPDM_S1_ID, D_PPCRVAULT_S2_ID]
  });

  // ─── Gaps (9) ──────────────────────────────────────────────────────
  const gapConsolidateHci = createEmptyGap({
    ...cc(GAP_CONSOLIDATE_HCI_ID),
    description:               "Consolidate Site 1 + Site 2 compute/virtualization onto Dell Private Cloud (PowerFlex)",
    layerId:                   "compute",
    affectedLayers:            ["compute", "virtualization"],
    affectedEnvironments:      [ENV_SITE1_ID, ENV_SITE2_ID],
    gapType:                   "consolidate",
    urgency:                   "High",
    phase:                     "now",
    status:                    "open",
    reviewed:                  true,
    origin:                    "autoDraft",
    notes:                     "Both sites run Dell servers, Nutanix NX servers, VMware vSphere, and Nutanix AHV side by side. Consolidating onto Dell Private Cloud (Dell Automation Platform + PowerFlex) standardizes the platform and makes DR failover a like-for-like swap instead of a cross-vendor exercise.",
    driverId:                  DRIVER_MODERNIZE_ID,
    relatedCurrentInstanceIds: [I_NX_S1_ID, I_VSPHERE_S1_ID, I_AHV_S1_ID, I_VSAN_S1_ID, I_NX_S2_ID, I_VSPHERE_S2_ID, I_AHV_S2_ID, I_VSAN_S2_ID],
    relatedDesiredInstanceIds: [D_PRIVATECLOUD_S1_ID, D_PRIVATECLOUD_S2_ID],
    services:                  ["assessment", "migration", "deployment", "decommissioning"]
  });

  const gapStorageReplace = createEmptyGap({
    ...cc(GAP_STORAGE_REPLACE_ID),
    description:               "Replace Pure Storage Object with PowerScale (Site 1)",
    layerId:                   "storage",
    affectedLayers:            ["storage"],
    affectedEnvironments:      [ENV_SITE1_ID],
    gapType:                   "replace",
    urgency:                   "Medium",
    phase:                     "next",
    status:                    "open",
    reviewed:                  true,
    origin:                    "autoDraft",
    notes:                     "Pure Storage Object is a standalone single-vendor tier with EOL approaching. PowerScale absorbs it into the same unified storage tier the Dell Private Cloud consolidation is already building toward.",
    driverId:                  DRIVER_MODERNIZE_ID,
    relatedCurrentInstanceIds: [I_PURE_S1_ID],
    relatedDesiredInstanceIds: [D_POWERSCALE_S1_ID],
    services:                  ["migration", "deployment"]
  });

  const gapBackupReplace = createEmptyGap({
    ...cc(GAP_BACKUP_REPLACE_ID),
    description:               "Replace Veeam with PowerProtect Data Manager (Site 1 + Site 2)",
    layerId:                   "dataProtection",
    affectedLayers:            ["dataProtection"],
    affectedEnvironments:      [ENV_SITE1_ID, ENV_SITE2_ID],
    gapType:                   "replace",
    urgency:                   "High",
    phase:                     "now",
    status:                    "open",
    reviewed:                  true,
    origin:                    "autoDraft",
    notes:                     "Discovery notes flagged the Veeam backup policy as \"TBC\" at both sites. PowerProtect Data Manager gives a documented, policy-driven backup platform integrated with the existing Data Domain appliances at both sites.",
    driverId:                  DRIVER_CYBER_ID,
    relatedCurrentInstanceIds: [I_VEEAM_S1_ID, I_VEEAM_S2_ID],
    relatedDesiredInstanceIds: [D_PPDM_S1_ID, D_PPDM_S2_ID],
    services:                  ["assessment", "migration", "deployment", "runbook"],
    aiMappedDellSolutions:     {
      value: {
        rawLegacy: "PowerProtect Data Manager + PowerProtect DD",
        products:  ["PowerProtect Data Manager", "PowerProtect DD"]
      },
      provenance: {
        model:            "claude-3-5-sonnet",
        promptVersion:    "skill:dellMap@1.4.0",
        skillId:          "demo-seed-dell-mapping",
        runId:            "demo-mhda-backup-replace-001",
        timestamp:        TS,
        catalogVersions:  { "DELL_PRODUCT_TAXONOMY": "2026.04" },
        validationStatus: "valid"
      }
    }
  });

  const gapCyberVault = createEmptyGap({
    ...cc(GAP_CYBER_VAULT_ID),
    description:               "Introduce a Cyber Recovery vault on the existing Data Domain + CRS replication",
    layerId:                   "dataProtection",
    affectedLayers:            ["dataProtection"],
    affectedEnvironments:      [ENV_SITE2_ID],
    gapType:                   "introduce",
    urgency:                   "High",
    phase:                     "now",
    status:                    "open",
    reviewed:                  true,
    origin:                    "autoDraft",
    notes:                     "Site 1 Data Domain already replicates to a CRS DD target at Site 2 -- the foundation for an air-gapped vault is already in place. Introducing PowerProtect Cyber Recovery closes the ransomware-isolation gap that Veeam + DD alone don't cover.",
    driverId:                  DRIVER_CYBER_ID,
    relatedCurrentInstanceIds: [I_DDCRS_S2_ID],
    relatedDesiredInstanceIds: [D_PPCRVAULT_S2_ID],
    services:                  ["deployment", "runbook", "managed"]
  });

  const gapExchangeRetire = createEmptyGap({
    ...cc(GAP_EXCHANGE_RETIRE_ID),
    description:               "Retire on-prem Exchange; complete the Microsoft 365 migration",
    layerId:                   "workload",
    affectedLayers:            ["workload"],
    affectedEnvironments:      [ENV_SITE1_ID, ENV_AZURE_ID],
    gapType:                   "ops",
    urgency:                   "High",
    phase:                     "next",
    status:                    "open",
    reviewed:                  true,
    origin:                    "autoDraft",
    notes:                     "GIS has a documented DR copy at Site 2; on-prem Exchange -- equally business-critical -- does not. The M365 / Outlook SaaS tenant already running in Azure is the resilience path: complete the migration, then decommission the on-prem Exchange box.",
    driverId:                  DRIVER_CYBER_ID,
    relatedCurrentInstanceIds: [I_EXCHANGE_S1_ID, I_M365_AZURE_ID],
    relatedDesiredInstanceIds: [],
    services:                  ["migration", "decommissioning", "runbook"]
  });

  // gapType="ops" + reviewed=false — the NC2-on-Azure platform decision is
  // a live discovery question, not yet validated with the customer; left
  // unreviewed to showcase the review workflow.
  const gapNc2Decision = createEmptyGap({
    ...cc(GAP_NC2_DECISION_ID),
    description:               "Decide the hybrid cloud platform before the NC2 landing zone takes workloads",
    layerId:                   "compute",
    affectedLayers:            ["compute", "virtualization"],
    affectedEnvironments:      [ENV_AZURE_ID],
    gapType:                   "ops",
    urgency:                   "Medium",
    phase:                     "next",
    status:                    "open",
    reviewed:                  false,
    origin:                    "autoDraft",
    notes:                     "The Azure NC2 landing zone has 4 nodes and zero workloads -- the cheapest point to decide whether to standardize on Dell APEX Cloud Services or keep extending Nutanix licensing into the cloud. Once a workload lands, the choice gets expensive to reverse.",
    driverId:                  DRIVER_CLOUD_ID,
    relatedCurrentInstanceIds: [I_NC2_AZURE_ID, I_AHV_NC2_AZURE_ID],
    relatedDesiredInstanceIds: [D_APEXCLOUD_AZURE_ID],
    services:                  ["assessment"]
  });

  // gapType="introduce" + reviewed=false — forward-looking ops tooling,
  // not yet validated with the customer; showcases the review workflow.
  const gapCloudIq = createEmptyGap({
    ...cc(GAP_CLOUDIQ_ID),
    description:               "Introduce CloudIQ + Dell APEX AIOps for unified infrastructure ops",
    layerId:                   "infrastructure",
    affectedLayers:            ["infrastructure"],
    affectedEnvironments:      [ENV_SITE1_ID, ENV_SITE2_ID],
    gapType:                   "introduce",
    urgency:                   "Medium",
    phase:                     "later",
    status:                    "open",
    reviewed:                  false,
    origin:                    "autoDraft",
    notes:                     "Today's estate spans ManageEngine NCM, ManageEngine SAM, ITSM Remedy, Qualiex, Splunk, F5, and separate Nutanix/VMware/Pure consoles. Once compute/storage consolidates onto Dell, CloudIQ + APEX AIOps gives one telemetry pane without displacing Splunk as the SOC/SIEM system of record.",
    driverId:                  DRIVER_OPS_ID,
    relatedCurrentInstanceIds: [],
    relatedDesiredInstanceIds: [D_CLOUDIQ_S1_ID],
    services:                  ["deployment", "training"]
  });

  // origin="manual" — the GIS DR-drill is a process gap the user authored
  // directly via the "+ Add gap" dialog (no underlying desired-state
  // disposition). Demos how manual-add gaps appear in the kanban WITHOUT
  // being mis-flagged as auto-drafted.
  const gapGisDrDrill = createEmptyGap({
    ...cc(GAP_GIS_DR_DRILL_ID),
    description:               "Validate GIS Site 1 -> Site 2 DR failover quarterly",
    layerId:                   "workload",
    affectedLayers:            ["workload"],
    affectedEnvironments:      [ENV_SITE1_ID, ENV_SITE2_ID],
    gapType:                   "ops",
    urgency:                   "Medium",
    phase:                     "now",
    status:                    "open",
    reviewed:                  true,
    origin:                    "manual",
    notes:                     "GIS is the one workload discovery confirmed has a DR copy at Site 2. A quarterly tested failover drill turns that into a proven recovery capability rather than an assumed one, and gives the board evidence ahead of the broader backup/cyber-recovery rollout.",
    driverId:                  DRIVER_CYBER_ID,
    relatedCurrentInstanceIds: [I_GIS_S1_ID, I_GIS_S2_ID],
    relatedDesiredInstanceIds: [],
    services:                  ["runbook", "training"]
  });

  const gapGisEnhance = createEmptyGap({
    ...cc(GAP_GIS_ENHANCE_ID),
    description:               "Enhance GIS Platform with the modernized Dell infrastructure chain",
    layerId:                   "workload",
    affectedLayers:            ["workload", "compute", "storage", "dataProtection"],
    affectedEnvironments:      [ENV_SITE1_ID, ENV_SITE2_ID],
    gapType:                   "enhance",
    urgency:                   "Medium",
    phase:                     "next",
    status:                    "open",
    reviewed:                  true,
    origin:                    "autoDraft",
    notes:                     "Same logical GIS workload, upgraded underneath: Dell Private Cloud + PowerScale for compute/storage, PowerProtect Data Manager + Cyber Recovery vault for backup. No re-platforming of the GIS application itself.",
    driverId:                  DRIVER_MODERNIZE_ID,
    relatedCurrentInstanceIds: [I_GIS_S1_ID],
    relatedDesiredInstanceIds: [D_GIS_S1_ID],
    services:                  ["assessment", "migration", "knowledge_transfer"]
  });

  // ─── Assemble byId / allIds + byState collections ────────────────
  const driversAllIds = [DRIVER_MODERNIZE_ID, DRIVER_CYBER_ID, DRIVER_CLOUD_ID, DRIVER_OPS_ID];
  const envsAllIds    = [ENV_SITE1_ID, ENV_SITE2_ID, ENV_AZURE_ID];

  const allCurrent = [
    instDellS1, instNxS1, instNxS2, instDellS2, instNc2Azure,
    instVsphereS1, instAhvS1, instVsanS1, instVsphereS2, instAhvS2, instVsanS2, instAhvNc2Azure,
    instNutVmS1, instNutObjS1, instPureS1, instFileshareS1, instNutVmS2, instNutObjS2,
    instDdS1, instVeeamS1, instOpentextS1, instDdcrsS2, instVeeamS2, instOpentextS2,
    instCiscoNetS1, instDellTorS1, instPaloAltoS1, instFortinetS1, instCiscoIseS1, instAdS1,
    instRiverbedS1, instMencmS1, instF5S1, instSplunkS1, instItsmS1, instMesamS1,
    instCiscoNetS2, instDellTorS2, instPaloAltoS2, instFortinetS2, instAdS2, instInfobloxS2,
    instQualiexS2, instSplunkS2, instItsmS2, instMesamS2, instVpnGwAzure,
    instGisS1, instExchangeS1, instWebappsS1, instAppinS1, instVdigpuS2, instGisS2, instM365Azure
  ];
  const allDesired = [
    desPrivateCloudS1, desPrivateCloudS2, desPowerScaleS1,
    desPpdmS1, desPpdmS2, desPpcrVaultS2,
    desApexCloudAzure, desCloudIqS1, desGisS1
  ];
  const allInst = allCurrent.concat(allDesired);
  const instAllIds = allInst.map(i => i.id);
  const instById = {};
  allInst.forEach(i => { instById[i.id] = i; });

  const gapsList = [
    gapConsolidateHci, gapStorageReplace, gapBackupReplace, gapCyberVault,
    gapExchangeRetire, gapNc2Decision, gapCloudIq, gapGisDrDrill, gapGisEnhance
  ];
  const gapsAllIds = gapsList.map(g => g.id);
  const gapsById = {};
  gapsList.forEach(g => { gapsById[g.id] = g; });

  return {
    meta,
    customer,
    drivers: {
      byId: {
        [DRIVER_MODERNIZE_ID]: driverModernize,
        [DRIVER_CYBER_ID]:     driverCyber,
        [DRIVER_CLOUD_ID]:     driverCloud,
        [DRIVER_OPS_ID]:       driverOps
      },
      allIds: driversAllIds
    },
    environments: {
      byId: {
        [ENV_SITE1_ID]: envSite1,
        [ENV_SITE2_ID]: envSite2,
        [ENV_AZURE_ID]: envAzure
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
