// core/conceptManifest.js
//
// Concept dictionary for the AI assistant — the definitional layer that
// complements the structural data contract in core/dataContract.js and
// the procedural workflows in core/appManifest.js.
//
// Each concept entry: { category, label, definition, example, whenToUse,
// vsAlternatives?, typicalDellSolutions? }. The TOC + 1-line headlines are
// inlined in the system prompt; full entry bodies are fetched on demand via
// the selectConcept(id) tool.
//
// Categories cover: gap_type · layer · urgency · phase · status ·
// disposition · driver · env · vendor_group · instance_state · entity
// (engagement, customer, driver, environment, instance, gap, project) ·
// relationship · skill.
//
// What this is NOT:
//   - NOT structural metadata (entities/relationships/invariants live in
//     core/dataContract.js, derived from schemas).
//   - NOT a workflow guide (procedural how-to-use-the-app lives in
//     core/appManifest.js).
//   - NOT marketing collateral (one-line "typical Dell solutions" hint
//     per driver only).
//
// SCHEMA VERSION: bump on every breaking-shape change. Wire builders +
// tests pin to this version.

export const CONCEPT_SCHEMA_VERSION = "v3.0-concept-1";

// ─────────────────────────────────────────────────────────────────────
// Convenience constructor: enforces the canonical entry shape.
// ─────────────────────────────────────────────────────────────────────
function E(id, category, label, definition, example, whenToUse, extras) {
  const out = {
    id, category, label, definition, example, whenToUse
  };
  if (extras && extras.vsAlternatives) out.vsAlternatives = extras.vsAlternatives;
  if (extras && extras.typicalDellSolutions) out.typicalDellSolutions = extras.typicalDellSolutions;
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// CONCEPT MANIFEST — organized by category. Read top-to-bottom or jump
// by category header.
// ─────────────────────────────────────────────────────────────────────

export const CONCEPTS = [

  // ╔══════════════════════════════════════════════════════════════════
  // ║ Category: gap_type (5)
  // ║ How a gap moves the customer from current → desired state.
  // ╚══════════════════════════════════════════════════════════════════

  E("gap_type.replace", "gap_type", "Replace",
    "Swap one current item for one desired item — a 1-for-1 exchange.",
    "Replace Veeam Backup & Replication with PowerProtect Data Manager.",
    "When a single legacy product is being retired and a single new product takes its place.",
    { vsAlternatives: {
        "gap_type.consolidate": "Use 'consolidate' if N current items merge into 1 desired (vendor reduction).",
        "gap_type.introduce":   "Use 'introduce' when there's no current item being replaced (net-new capability)."
      }
    }),

  E("gap_type.consolidate", "gap_type", "Consolidate",
    "Merge N current items into 1 desired item — N→1 rationalization.",
    "Consolidate PowerEdge R740 + Cisco UCS B-series onto a single PowerEdge R760 cluster (vendor reduction + power savings).",
    "When multiple legacy systems are being collapsed to reduce vendor count, ops complexity, or power draw.",
    { vsAlternatives: {
        "gap_type.replace": "Use 'replace' for a 1-for-1 swap with no merging.",
        "disposition.retire": "Use 'retire' for items being removed without replacement."
      }
    }),

  E("gap_type.introduce", "gap_type", "Introduce",
    "Add a NET-NEW desired item — no current item is being replaced.",
    "Introduce PowerProtect Cyber Recovery vault + CyberSense in Jeddah DR (no prior cyber-recovery footprint).",
    "When the customer is adding capability they don't have today.",
    { vsAlternatives: {
        "gap_type.replace": "Use 'replace' when there IS a current item being swapped.",
        "gap_type.enhance": "Use 'enhance' when improving an existing item in place rather than adding a new one."
      }
    }),

  E("gap_type.enhance", "gap_type", "Enhance",
    "Upgrade or expand an EXISTING current item in place — no new asset, no retirement.",
    "Enhance Cisco Catalyst with micro-segmentation policies for EMR + PACS isolation.",
    "When the current item stays but is upgraded with capacity, capability, or configuration.",
    { vsAlternatives: {
        "gap_type.replace":   "Use 'replace' when swapping the entire item.",
        "gap_type.introduce": "Use 'introduce' when adding a new item alongside the existing one."
      }
    }),

  E("gap_type.ops", "gap_type", "Operational",
    "Operational / services work — runbooks, training, governance, integration, decommissioning. NO infrastructure asset change.",
    "Run a quarterly ransomware-recovery test playbook for EMR + PACS workloads.",
    "When the gap is process or services, not infrastructure.",
    { vsAlternatives: {
        "gap_type.enhance":  "Use 'enhance' when actually upgrading an item.",
        "gap_type.replace":  "Use 'replace' when swapping items."
      }
    }),

  // ╔══════════════════════════════════════════════════════════════════
  // ║ Category: layer (6)
  // ║ The 6-layer infrastructure taxonomy — what kind of thing the
  // ║ instance IS (workload vs the infra that runs it).
  // ╚══════════════════════════════════════════════════════════════════

  E("layer.workload", "layer", "Workloads & Business Apps",
    "Business applications + custom integrations — the 'what runs', not the 'where it runs'.",
    "Core EMR (Epic), PACS Imaging (Sectra), Clinical Analytics Platform.",
    "Use for the customer-owned application tier. Workloads typically carry mappedAssetIds linking to compute/storage they consume.",
    { vsAlternatives: {
        "layer.compute": "Use 'compute' for the underlying servers/HCI that the workload runs on."
      }
    }),

  E("layer.compute", "layer", "Compute",
    "Servers, blades, hyperconverged nodes — the CPU + RAM tier.",
    "PowerEdge R760 cluster, Cisco UCS B-series, VxRail HCI nodes, AWS EC2 instances.",
    "Use for any item whose primary function is execution capacity.",
    { vsAlternatives: {
        "layer.workload":       "Workloads RUN ON compute; they're separate layers.",
        "layer.virtualization": "Use 'virtualization' for hypervisor / SDS abstractions on top of compute."
      }
    }),

  E("layer.storage", "layer", "Data Storage",
    "Block, file, object, or unstructured persistence.",
    "PowerStore 5000T (block), Unity XT, NetApp AFF, AWS S3 (object), PowerScale F710 (unstructured/AI).",
    "Use for any persistent-data tier — primary, secondary, archive, AI inference data path.",
    { vsAlternatives: {
        "layer.dataProtection": "Use 'dataProtection' for backup/recovery tiers, not primary storage."
      }
    }),

  E("layer.dataProtection", "layer", "Data Protection & Recovery",
    "Backup, replication, recovery, immutable vault.",
    "Veeam B&R, Commvault, PowerProtect Data Manager, PowerProtect Cyber Recovery vault + CyberSense.",
    "Use for items whose primary function is to protect or recover data, NOT to serve production reads.",
    { vsAlternatives: {
        "layer.storage": "Use 'storage' if the item primarily serves production data."
      }
    }),

  E("layer.virtualization", "layer", "Virtualization & Hypervisors",
    "Hypervisors + software-defined storage / compute layers that abstract physical resources.",
    "VMware vSphere + vSAN, PowerFlex, Dell Private Cloud.",
    "Use for the abstraction layer between physical compute/storage and workloads.",
    { vsAlternatives: {
        "layer.compute": "Use 'compute' for bare-metal or HCI without an SDC abstraction in scope."
      }
    }),

  E("layer.infrastructure", "layer", "Infrastructure Services",
    "Networking, identity, monitoring, ops tooling, automation — the operational fabric.",
    "PowerSwitch + SmartFabric Manager, CloudIQ + APEX AIOps, Cisco Catalyst, Microsoft Entra ID.",
    "Use for any cross-cutting fabric the other layers depend on.",
    { vsAlternatives: {
        "layer.compute": "Use 'compute' if the item primarily provides compute capacity, not fabric."
      }
    }),

  // ╔══════════════════════════════════════════════════════════════════
  // ║ Category: urgency (3)
  // ║ How quickly a gap demands action.
  // ╚══════════════════════════════════════════════════════════════════

  E("urgency.High", "urgency", "High",
    "Compliance, security, or business-impact gap that demands action this quarter.",
    "Replace Veeam with PPDM is High — no immutable tier today exposes ransomware risk.",
    "When delay creates real business or regulatory risk."),

  E("urgency.Medium", "urgency", "Medium",
    "Important to address but not crisis-level — typical 6-12 month scope.",
    "Consolidate Cisco UCS onto PowerEdge R760 is Medium — vendor-reduction value, not a hot fix.",
    "When the gap is important but the customer can absorb planned-cycle delivery."),

  E("urgency.Low", "urgency", "Low",
    "Polish, tactical optimization, or future-proofing — can slip a quarter without business impact.",
    "Stand up CloudIQ + AIOps once the new estate stabilizes is Low — reactive ops works in the interim.",
    "When deferral is acceptable. Useful as 'good to have' on the roadmap."),

  // ╔══════════════════════════════════════════════════════════════════
  // ║ Category: phase (3)
  // ║ When the gap is scheduled in the engagement timeline.
  // ╚══════════════════════════════════════════════════════════════════

  E("phase.now", "phase", "Now",
    "Active in the current 90-day window. Scope locked + delivery committed (or starting).",
    "Replace Veeam with PPDM is in 'now' — foundation for the cyber-recovery story.",
    "When the gap is being scoped + sized for current-quarter delivery."),

  E("phase.next", "phase", "Next",
    "Planned for the next quarter or two. Scope locked, delivery not yet started.",
    "Introduce PowerEdge XE9680 GPU is in 'next' — waiting on storage refresh first.",
    "When the gap is identified + agreed but waiting on the now-phase to clear."),

  E("phase.later", "phase", "Later",
    "On the roadmap but unscoped or unscheduled (12+ months out).",
    "Stand up CloudIQ AIOps is in 'later' — Acme will commit a window once the estate is stable.",
    "When the gap is real but the customer hasn't committed to a delivery window."),

  // ╔══════════════════════════════════════════════════════════════════
  // ║ Category: status (4)
  // ║ Where the gap stands in delivery.
  // ╚══════════════════════════════════════════════════════════════════

  E("status.open", "status", "Open",
    "Identified, no work started yet. Default state when a gap is first authored.",
    "All 8 demo gaps in Acme Healthcare start with status='open'.",
    "Default status when a gap is first captured."),

  E("status.in_progress", "status", "In progress",
    "Work has started — assessment, design, pilot, deployment underway.",
    "Once the SOW for PPDM replacement is signed, flip the gap to in_progress.",
    "When the gap has been picked up by delivery."),

  E("status.closed", "status", "Closed",
    "Work complete; the desired state is in place. EXCLUDED from active rollups (selectVendorMix, selectHealthSummary).",
    "After PPDM is deployed and Veeam decommissioned, mark the gap closed.",
    "When the gap is fully resolved."),

  E("status.deferred", "status", "Deferred",
    "Identified but explicitly deprioritized — preserved for future re-evaluation.",
    "If budget cuts pause the GPU compute introduction, mark the gap deferred (not closed).",
    "When the gap is real but won't be acted on this fiscal cycle."),

  // ╔══════════════════════════════════════════════════════════════════
  // ║ Category: disposition (7)
  // ║ The action declared on a current-state instance — auto-drafts
  // ║ the matching gap_type.
  // ╚══════════════════════════════════════════════════════════════════

  E("disposition.keep", "disposition", "Keep",
    "Disposition for current-state items that stay as-is. NO gap drafted.",
    "PowerEdge R740 DR cluster (disposition: keep — mirrors Riyadh capacity, no refresh needed).",
    "When documenting current state and an item simply stays."),

  E("disposition.enhance", "disposition", "Enhance (disposition)",
    "Disposition for current-state items being upgraded in place. Auto-drafts a gap of type='enhance'.",
    "Cisco Catalyst (disposition: enhance → auto-drafts a micro-segmentation enhancement gap).",
    "When the current item stays but gets upgraded."),

  E("disposition.replace", "disposition", "Replace (disposition)",
    "Disposition: a current item is being swapped 1-for-1. Auto-drafts a gap of type='replace'.",
    "Unity XT 480F (disposition: replace; replaced by PowerStore 5000T).",
    "When a single legacy item is being retired and a single new item takes its place."),

  E("disposition.consolidate", "disposition", "Consolidate (disposition)",
    "Disposition: this current item folds into a larger merge. Auto-drafts a gap of type='consolidate'.",
    "Cisco UCS B-series (disposition: consolidate → folds into PowerEdge R760 with the R740 cluster).",
    "When this item is one of N being merged into a smaller set."),

  E("disposition.retire", "disposition", "Retire",
    "Disposition: item is being decommissioned without replacement. Auto-drafts a gap of type='ops'.",
    "Commvault (disposition: retire — folds into PPDM coverage post-migration).",
    "When you're removing capability without buying replacement infrastructure."),

  E("disposition.introduce", "disposition", "Introduce (disposition)",
    "Disposition for desired-state items only. Net-new capability with no current predecessor. Auto-drafts a gap of type='introduce'.",
    "PowerEdge XE9680 GPU (disposition: introduce — no current GPU footprint).",
    "When you're adding capability the customer doesn't have today."),

  E("disposition.ops", "disposition", "Operational (disposition)",
    "Disposition flagging operational/services work. Auto-drafts a gap of type='ops'.",
    "Network operations runbook authoring (disposition: ops — pure services, no asset change).",
    "When the gap is process or services, not infrastructure."),

  // ╔══════════════════════════════════════════════════════════════════
  // ║ Category: driver (8)
  // ║ The strategic outcomes a customer is pursuing — drive what gaps
  // ║ get prioritized.
  // ╚══════════════════════════════════════════════════════════════════

  E("driver.cyber_resilience", "driver", "Cyber Resilience",
    "Recover from ransomware without paying — and prove it in a controlled test.",
    "Acme Healthcare: NIS2 compliance evidence by Q3 2026; RTO ≤4hr; immutable backups tested quarterly; air-gapped recovery.",
    "When the customer's pain is around ransomware recovery, evidence-of-recovery, or compliance frameworks like NIS2 / DORA / NIST CSF.",
    { typicalDellSolutions: "PowerProtect Data Manager + PowerProtect Cyber Recovery vault + CyberSense ML detection + PowerProtect DD storage tier." }),

  E("driver.ai_data", "driver", "AI & Data Platforms",
    "Get measurable business value from AI and data — fast.",
    "Acme Healthcare: AI-native operating model in 18 months; clinical-imaging AI inference on PowerScale; ML re-admission risk scoring.",
    "When the customer's pain is around modernizing their data tier, activating AI workloads, or operationalizing ML.",
    { typicalDellSolutions: "PowerScale F710 (unstructured AI tier), PowerEdge XE9680 (8x H100 GPU), Dell AI Factory, CloudIQ + APEX AIOps." }),

  E("driver.cost_optimization", "driver", "Cost Optimization",
    "Cut infrastructure spend without breaking delivery.",
    "Reduce TCO 20% over 24 months; consolidate vendor count; reduce power draw.",
    "When the customer is pressured to reduce OpEx or CapEx, often after a budget review or M&A.",
    { typicalDellSolutions: "PowerEdge R760 (consolidation), Dell Private Cloud, PowerStore (NVMe density / lower watts/TB)." }),

  E("driver.cloud_strategy", "driver", "Cloud Strategy",
    "Right workload, right place — stop cloud bills spiralling.",
    "Repatriate workloads from public cloud to private cloud where TCO dictates; standardize hybrid pattern.",
    "When the customer is rationalizing public cloud spend or looking for hybrid / sovereign control.",
    { typicalDellSolutions: "APEX Cloud Services, Dell Private Cloud, PowerFlex." }),

  E("driver.modernize_infra", "driver", "Modernize Aging Infrastructure",
    "Replace too-old, too-fragile estate. Refresh end-of-warranty hardware on a planned cycle.",
    "End-of-warranty PowerEdge R740 cluster; legacy Cisco UCS 12-blade; aging NetApp AFF unstructured tier.",
    "When the customer's estate has aging hardware approaching EOL and needs a planned-refresh roadmap.",
    { typicalDellSolutions: "PowerEdge R760, PowerStore, PowerScale, VxRail." }),

  E("driver.ops_simplicity", "driver", "Operational Simplicity",
    "Fewer tools, less toil, more planned work — reduce vendor + console sprawl.",
    "Replace Veeam + Commvault with one PPDM pane; introduce CloudIQ for predictive ops.",
    "When the customer's team is firefighting and wants tool consolidation + automation.",
    { typicalDellSolutions: "PowerProtect Data Manager (unified backup), CloudIQ + APEX AIOps, SmartFabric Manager." }),

  E("driver.compliance_sovereignty", "driver", "Compliance & Sovereignty",
    "Meet regulator and data-residency requirements — PDNS, GDPR, NIST CSF, sectoral frameworks.",
    "Acme Healthcare: PDNS-compliant infra; eliminate AWS dependency for patient-data by Q4 2026.",
    "When the customer faces audit, residency, or sovereign-cloud requirements.",
    { typicalDellSolutions: "APEX Cloud Services on sovereign cloud, PowerProtect Cyber Recovery vault, immutable archive tier, PowerSwitch + SmartFabric for micro-segmentation." }),

  E("driver.sustainability", "driver", "Sustainability / ESG",
    "Measurable energy + carbon targets. Report infrastructure's contribution to the customer's ESG commitments.",
    "Reduce kW draw via consolidation; report carbon footprint of compute + storage.",
    "When the customer has board-level commitments to carbon, energy efficiency, or ESG disclosure.",
    { typicalDellSolutions: "PowerEdge R760 (efficiency), PowerStore (lower watts/TB), PowerFlex (high utilization), CloudIQ for energy reporting." }),

  // ╔══════════════════════════════════════════════════════════════════
  // ║ Category: env (8)
  // ║ The environment kinds an instance can live in.
  // ╚══════════════════════════════════════════════════════════════════

  E("env.coreDc", "env", "Primary Data Center",
    "The customer's main on-premises site.",
    "Acme Healthcare: Riyadh Core DC (180kW, Tier III).",
    "When the env is the customer's primary on-prem footprint."),

  E("env.drDc", "env", "Disaster Recovery Site",
    "Active or warm-standby site for failover.",
    "Acme Healthcare: Jeddah DR (warm standby; cyber-recovery vault here).",
    "When the env exists for resilience/failover, not primary load."),

  E("env.archiveSite", "env", "Archive Site",
    "Compliance archive, immutable backups, tertiary retention tier.",
    "A separate data center holding 7-year financial records on object-lock.",
    "When the env's purpose is long-term retention or compliance, not active workloads."),

  E("env.publicCloud", "env", "Public Cloud",
    "Hyperscale public cloud — AWS, Azure, GCP, Oracle (non-sovereign).",
    "Workloads on AWS me-south-1 hyperscale; analytics workloads consuming S3.",
    "When the env is a hyperscale-public footprint.",
    { vsAlternatives: {
        "env.sovereignCloud": "Use 'sovereignCloud' for in-region regulated cloud (UAE, KSA, EU)."
      }
    }),

  E("env.edge", "env", "Branch & Edge Sites",
    "Distributed branch / retail / hospital / factory / remote sites.",
    "Acme Healthcare: 200 hospital sites with VxRail HCI nodes.",
    "When the env is distributed across many small sites with similar footprint."),

  E("env.coLo", "env", "Co-location",
    "Third-party data center space — customer-managed inside a colo provider's facility.",
    "Equinix-hosted compute footprint, colo-managed connectivity.",
    "When the env is hosted in a colo provider's facility but operated by the customer."),

  E("env.managedHosting", "env", "Managed Hosting",
    "Provider-operated dedicated hosting.",
    "An ISV-hosted dedicated platform.",
    "When the env is operated by a hosting provider, not the customer."),

  E("env.sovereignCloud", "env", "Sovereign Cloud",
    "In-region regulated cloud (UAE me-central-1, KSA, EU PDNS-compliant zones).",
    "Acme Healthcare: me-central-1 sovereign cloud for patient-data analytics post-AWS migration.",
    "When residency or regulatory requirements pin data inside a sovereign region.",
    { vsAlternatives: {
        "env.publicCloud": "Use 'publicCloud' for non-regulated hyperscale workloads."
      }
    }),

  // ╔══════════════════════════════════════════════════════════════════
  // ║ Category: vendor_group (3)
  // ║ Vendor classification for vendor-mix analysis.
  // ╚══════════════════════════════════════════════════════════════════

  E("vendor_group.dell", "vendor_group", "Dell",
    "Dell-branded hardware or software (PowerEdge, PowerStore, PowerScale, PPDM, APEX, CloudIQ, etc.).",
    "PowerEdge R760, PowerStore 5000T, PowerProtect Data Manager — all 'dell'.",
    "When the item is a Dell offering. Used by selectVendorMix to compute Dell density."),

  E("vendor_group.nonDell", "vendor_group", "Non-Dell",
    "Non-Dell vendor — competitor or partner product.",
    "Cisco UCS, NetApp AFF, Veeam, AWS S3, VMware vSphere — all 'nonDell'.",
    "When the item is from a competitor or partner. Drives the consolidation/replacement narrative."),

  E("vendor_group.custom", "vendor_group", "Custom",
    "Customer-owned custom integrations or workloads — no commercial vendor.",
    "Epic + custom integration layer (the EMR workload), Sectra + custom (PACS imaging).",
    "When the item is a custom-built application or integration layer. Workloads are typically 'custom'."),

  // ╔══════════════════════════════════════════════════════════════════
  // ║ Category: instance_state (2)
  // ║ Whether an instance documents 'as-is' or 'to-be'.
  // ╚══════════════════════════════════════════════════════════════════

  E("instance_state.current", "instance_state", "Current state",
    "What exists today in the customer's estate.",
    "All 14 current-state instances in the Acme Healthcare demo (R740 cluster, Cisco UCS, Unity, NetApp, Veeam, etc.).",
    "When documenting the as-is footprint."),

  E("instance_state.desired", "instance_state", "Desired state",
    "What the customer wants/needs — the post-engagement target state.",
    "All 9 desired-state instances in the demo (e.g., PowerEdge R760 replacing R740 + UCS).",
    "When documenting the to-be footprint. Desired items can have originId linking to a current predecessor (replace/consolidate lifecycle)."),

  // ╔══════════════════════════════════════════════════════════════════
  // ║ Category: entity (7) — top-level data-model nouns
  // ║ The principal entities the data contract derives from schemas.
  // ╚══════════════════════════════════════════════════════════════════

  E("entity.engagement", "entity", "Engagement",
    "The whole record of a customer interaction — meta + customer + drivers + envs + instances + gaps. The top-level schema entity.",
    "Acme Healthcare Group's engagement carries all the demo data (3 drivers, 4 envs, 23 instances, 8 gaps).",
    "When referring to the entire workshop output that's saved/loaded."),

  E("entity.customer", "entity", "Customer",
    "The customer org's identity — name, vertical, region, notes. ONE per engagement.",
    "Acme Healthcare Group, Healthcare, EMEA.",
    "When referring to the org being served. Drivers + envs + instances + gaps are all attributes OF the customer's engagement."),

  E("entity.driver", "entity", "Driver",
    "A strategic business driver the customer is pursuing. References BUSINESS_DRIVERS catalog.",
    "Cyber Resilience driver in the demo — priority: High; 4 outcomes; 2 linked gaps.",
    "When capturing strategic intent. Typically 1-5 drivers per engagement."),

  E("entity.environment", "entity", "Environment",
    "A physical/logical location where workloads + assets live. References ENV_CATALOG.",
    "Riyadh Core DC environment in the demo — 180kW, Tier III, hosts EMR + PACS workloads.",
    "When mapping where instances live."),

  E("entity.instance", "entity", "Instance",
    "A specific item — workload, compute, storage, dataProtection, virtualization, or infrastructure — in a specific environment, in a specific state (current OR desired).",
    "PowerStore 5000T (storage layer, Riyadh Core DC, desired state, dell, replaces Unity XT).",
    "When documenting individual systems or workloads."),

  E("entity.gap", "entity", "Gap",
    "A delta between current and desired state, OR an operational task. Typed by gap_type; links to driver(s) + instances + services.",
    "Replace Veeam with PowerProtect Data Manager — gap_type: replace, urgency: High, driver: cyber_resilience.",
    "When capturing what changes between current and desired state."),

  E("entity.project", "entity", "Project",
    "DERIVED grouping of gaps by phase × environment × gap_type. Computed by selectProjects, NOT stored on the engagement.",
    "All 'now-phase' gaps in Riyadh Core DC of type 'replace' would form one project.",
    "When you want gap clustering for a Statement of Work or roadmap deliverable."),

  // ╔══════════════════════════════════════════════════════════════════
  // ║ Category: relationship (3) — important cross-cutting links
  // ╚══════════════════════════════════════════════════════════════════

  E("relationship.workload", "relationship", "Workload",
    "An instance whose layerId='workload' — the customer's BUSINESS APP or integration. Workloads carry mappedAssetIds.",
    "Core EMR workload (Epic + custom integration) maps to PowerEdge R740 + Unity XT + Veeam (its supporting infra footprint).",
    "When the item is the application, not the infrastructure underneath it.",
    { vsAlternatives: {
        "layer.compute": "Use 'compute' for the underlying servers/HCI; workloads run ON compute."
      }
    }),

  E("relationship.mappedAssetIds", "relationship", "Mapped asset IDs",
    "FK array on a workload pointing to the compute/storage/dataProtection instances that workload consumes — possibly across environments.",
    "PACS workload's mappedAssetIds = [NetApp AFF, Commvault, R740 Core] — the imaging stack it touches.",
    "When you want to express 'this workload runs on these specific assets'. Used by selectLinkedComposition."),

  E("relationship.originId", "relationship", "Origin ID",
    "FK on a desired-state instance pointing to the current-state instance it replaces (or one of N if a consolidation).",
    "PowerStore 5000T (desired) has originId → Unity XT (current); R760 (desired) has originId → R740 Core (current).",
    "When showing a 1-for-1 replacement lifecycle. Required for replace + consolidate dispositions."),

  // ╔══════════════════════════════════════════════════════════════════
  // ║ Category: skill (3) — AI prompt + binding template authoring
  // ╚══════════════════════════════════════════════════════════════════

  E("skill.skill", "skill", "Skill",
    "An AI prompt + binding template the user authors via the Skill Builder. Two scopes: click-to-run (entity-specific) + session-wide (engagement-level).",
    "Dell Mapping skill — click-to-run on a Gap; outputs structured Dell product list.",
    "When the user wants to capture a reusable AI workflow they'll re-run across many engagements."),

  E("skill.click_to_run", "skill", "Click-to-run scope",
    "Skill scope: invoked on a SPECIFIC entity (gap, instance, driver, etc.). Pre-fills the prompt with that entity's data.",
    "Click 'Dell Mapping' on a gap → skill resolves {{gap.description}}, {{gap.layerLabel}}, {{gap.driverLabel}} from the picked entity.",
    "When the skill needs entity-specific context.",
    { vsAlternatives: {
        "skill.session_wide": "Use 'session-wide' when the skill operates on the whole engagement, not one entity."
      }
    }),

  E("skill.session_wide", "skill", "Session-wide scope",
    "Skill scope: runs against the WHOLE engagement, not one entity. Resolves customer + drivers + counts as bindings.",
    "Executive Summary skill — uses {{customer.name}}, {{drivers}}, {{gaps.totalsByStatus}} to produce a session-level deliverable.",
    "When the skill produces engagement-level output (executive summary, roadmap, gap roll-up).",
    { vsAlternatives: {
        "skill.click_to_run": "Use 'click-to-run' when the skill operates on a single picked entity."
      }
    })
];

// ─────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────

const _BY_ID = {};
CONCEPTS.forEach(function(c) { _BY_ID[c.id] = c; });

// Returns a single concept by id, or null if unknown.
export function getConcept(id) {
  return _BY_ID[id] || null;
}

// Returns the TOC: [{id, category, label, definition_headline}].
// definition_headline is the FIRST sentence of definition (cheap inline).
export function getConceptTOC() {
  return CONCEPTS.map(function(c) {
    var first = String(c.definition).split(/(?<=\.)\s+/)[0] || c.definition;
    return { id: c.id, category: c.category, label: c.label, definition_headline: first };
  });
}

// Returns all concepts in a given category. Empty array if the category
// doesn't exist.
export function getConceptsByCategory(category) {
  return CONCEPTS.filter(function(c) { return c.category === category; });
}

// Returns the list of categories present in the manifest, in declaration
// order, deduped.
export function getConceptCategories() {
  var seen = {};
  var out  = [];
  CONCEPTS.forEach(function(c) {
    if (!seen[c.category]) { seen[c.category] = true; out.push(c.category); }
  });
  return out;
}
