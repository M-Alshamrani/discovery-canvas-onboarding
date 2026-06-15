// DELL_PRODUCT_TAXONOMY: the catalog of Dell products that asset mappings
// reference, reflecting current Dell positioning. Notable rules:
//
//   - Boomi and Secureworks Taegis are excluded (divested).
//   - VMware is partner technology, not a Dell product (partnerOnly: true).
//   - VxRail is superseded by Dell Private Cloud (via Dell Automation
//     Platform with PowerFlex), which is the current positioning.
//   - The current product is "SmartFabric Manager", not "SmartFabric Director".
//   - CloudIQ sits under the "Dell APEX AIOps" umbrella, not standalone.
//
// Per-entry fields:
//   id          stable identifier (referenced by aiSuggestedDellMapping)
//   label       Dell-correct product name
//   category    one of: compute | storage | data_protection | networking |
//               private_cloud | sds | aiops | apex | workstation | ai_factory | partner
//   umbrella    parent product family for components (e.g. CloudIQ -> Dell APEX AIOps)
//   partnerOnly true for partner technologies referenced but not sold by Dell

export default Object.freeze({
  catalogId: "DELL_PRODUCT_TAXONOMY",
  catalogVersion: "2026.04",
  entries: [
    // ── Compute ──────────────────────────────────────────────────────
    { id: "poweredge_rack",     label: "PowerEdge (Rack)",         category: "compute" },
    { id: "poweredge_tower",    label: "PowerEdge (Tower)",        category: "compute" },
    { id: "poweredge_modular",  label: "PowerEdge MX (Modular)",   category: "compute" },

    // ── Storage ──────────────────────────────────────────────────────
    { id: "powerstore",         label: "PowerStore",               category: "storage" },
    { id: "powerscale",         label: "PowerScale",               category: "storage" },
    { id: "powermax",           label: "PowerMax",                 category: "storage" },
    { id: "powervault",         label: "PowerVault",               category: "storage" },
    { id: "objectscale",        label: "ObjectScale",              category: "storage" },

    // ── Data Protection ─────────────────────────────────────────────
    { id: "powerprotect_dm",    label: "PowerProtect Data Manager", category: "data_protection" },
    { id: "powerprotect_dd",    label: "PowerProtect DD",           category: "data_protection" },
    { id: "powerprotect_cyber", label: "PowerProtect Cyber Recovery", category: "data_protection" },

    // ── Networking ──────────────────────────────────────────────────
    { id: "powerswitch",        label: "PowerSwitch",              category: "networking" },
    // The current product is "SmartFabric Manager"; "SmartFabric Director"
    // is its retired predecessor and must not appear.
    { id: "smartfabric_manager", label: "SmartFabric Manager",     category: "networking" },

    // ── Private Cloud ───────────────────────────────────────────────
    // VxRail is not current positioning; Dell Private Cloud (via Dell
    // Automation Platform with PowerFlex) replaces it.
    { id: "dell_private_cloud",       label: "Dell Private Cloud",        category: "private_cloud" },
    { id: "dell_automation_platform", label: "Dell Automation Platform",  category: "private_cloud" },
    { id: "powerflex",                label: "PowerFlex",                 category: "sds" },

    // ── AIOps ───────────────────────────────────────────────────────
    // CloudIQ lives under the "Dell APEX AIOps" umbrella, not standalone.
    { id: "apex_aiops",         label: "Dell APEX AIOps",          category: "aiops" },
    { id: "cloudiq",            label: "CloudIQ",                  category: "aiops",
      umbrella: "Dell APEX AIOps" },

    // ── APEX (subscription / cloud) ─────────────────────────────────
    { id: "apex_cloud_services", label: "APEX Cloud Services",     category: "apex" },
    { id: "apex_file_storage",   label: "APEX File Storage",       category: "apex" },
    { id: "apex_block_storage",  label: "APEX Block Storage",      category: "apex" },

    // ── AI Factory ──────────────────────────────────────────────────
    { id: "dell_ai_factory",    label: "Dell AI Factory",          category: "ai_factory" },
    { id: "poweredge_xe9680",   label: "PowerEdge XE9680",         category: "ai_factory" },

    // ── Workstations ────────────────────────────────────────────────
    { id: "precision_mobile",   label: "Precision (Mobile)",       category: "workstation" },
    { id: "precision_tower",    label: "Precision (Tower)",        category: "workstation" },
    { id: "latitude",           label: "Latitude",                 category: "workstation" },
    { id: "optiplex",           label: "OptiPlex",                 category: "workstation" },

    // ── Partner technologies (referenced, not sold by Dell) ─────────
    // VMware is partner technology, not a Dell product.
    { id: "vmware_vsphere",     label: "VMware vSphere",           category: "partner",
      partnerOnly: true },
    { id: "vmware_vsan",        label: "VMware vSAN",              category: "partner",
      partnerOnly: true }

    // ── Explicitly excluded ─────────────────────────────────────────
    //   "boomi"                  — divested, no longer Dell taxonomy
    //   "secureworks_taegis"     — divested
    //   "vxrail"                 — superseded by Dell Private Cloud + PowerFlex
    //   "smartfabric_director"   — replaced by SmartFabric Manager
  ]
});
