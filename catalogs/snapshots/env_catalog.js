// ENV_CATALOG: eight environment kinds an asset can live in, each with a
// one-line hint describing the kind of site it represents.

export default Object.freeze({
  catalogId: "ENV_CATALOG",
  catalogVersion: "2026.04",
  entries: [
    { id: "coreDc",         label: "Primary Data Center",     hint: "The main on-premises site" },
    { id: "drDc",           label: "Disaster Recovery Site",  hint: "Active or warm standby for failover" },
    { id: "archiveSite",    label: "Archive Site",            hint: "Compliance archive, immutable backups, tertiary tier" },
    { id: "publicCloud",    label: "Public Cloud",            hint: "AWS, Azure, GCP, Oracle" },
    { id: "edge",           label: "Branch & Edge Sites",     hint: "Retail, factory floor, remote offices" },
    { id: "coLo",           label: "Co-location",             hint: "Third-party data center space" },
    { id: "managedHosting", label: "Managed Hosting",         hint: "Provider-operated dedicated hosting" },
    { id: "sovereignCloud", label: "Sovereign Cloud",         hint: "In-region regulated cloud (UAE, KSA, EU)" }
  ]
});
