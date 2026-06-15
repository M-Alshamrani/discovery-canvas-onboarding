// SERVICE_TYPES catalog: ten kinds of professional-services work, each
// optionally tagged with a domain (data / ops) and a one-line description.

export default Object.freeze({
  catalogId: "SERVICE_TYPES",
  catalogVersion: "2026.04",
  entries: [
    { id: "assessment",         label: "Assessment / Health check",   domain: null,   description: "Pre-engagement audit before the work starts" },
    { id: "migration",          label: "Migration",                   domain: "data", description: "Move data / workloads from current to desired platform" },
    { id: "deployment",         label: "Deployment / Install",        domain: null,   description: "Build out the desired-state system" },
    { id: "integration",        label: "Integration",                 domain: "ops",  description: "Connect to existing systems, APIs, identity, monitoring" },
    { id: "training",           label: "Training",                    domain: null,   description: "Skill the customer's ops team on the new platform" },
    { id: "knowledge_transfer", label: "Knowledge transfer",          domain: null,   description: "Hand-off documentation + walkthroughs" },
    { id: "runbook",            label: "Runbook authoring",           domain: "ops",  description: "Operational playbooks (DR, incident response, change-mgmt)" },
    { id: "managed",            label: "Managed services",            domain: "ops",  description: "Ongoing operational support contract" },
    { id: "decommissioning",    label: "Decommissioning",             domain: "data", description: "Safe removal + data archive of retired systems" },
    { id: "custom_dev",         label: "Custom development",          domain: null,   description: "Bespoke connectors, scripts, tooling" }
  ]
});
