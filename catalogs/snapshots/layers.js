// LAYERS catalog: the authoritative six-layer taxonomy used to classify
// every asset, from business workloads down to infrastructure services.

export default Object.freeze({
  catalogId: "LAYERS",
  catalogVersion: "2026.04",
  entries: [
    { id: "workload",       label: "Workloads & Business Apps" },
    { id: "compute",        label: "Compute" },
    { id: "storage",        label: "Data Storage" },
    { id: "dataProtection", label: "Data Protection & Recovery" },
    { id: "virtualization", label: "Virtualization & Hypervisors" },
    { id: "infrastructure", label: "Infrastructure Services" }
  ]
});
