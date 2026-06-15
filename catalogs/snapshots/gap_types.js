// GAP_TYPES catalog: the five gap-creating outcomes — replace, consolidate,
// introduce, enhance, and ops. These mirror the disposition actions, leaving
// out "keep" (creates no gap) and folding "retire" into the "ops" type.
// dispositionMatch lists which dispositions auto-draft each gap type.

export default Object.freeze({
  catalogId: "GAP_TYPES",
  catalogVersion: "2026.04",
  entries: [
    {
      id: "replace",
      label: "Replace",
      dispositionMatch: ["replace"]
    },
    {
      id: "consolidate",
      label: "Consolidate",
      dispositionMatch: ["consolidate"]
    },
    {
      id: "introduce",
      label: "Introduce",
      dispositionMatch: ["introduce"]
    },
    {
      id: "enhance",
      label: "Enhance",
      dispositionMatch: ["enhance"]
    },
    {
      id: "ops",
      label: "Operational",
      dispositionMatch: ["retire", "ops"]
    }
  ]
});
