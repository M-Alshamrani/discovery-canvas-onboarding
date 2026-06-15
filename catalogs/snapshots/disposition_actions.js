// DISPOSITION_ACTIONS catalog: seven actions describing what happens to an
// asset. gapTypeId names the gap type the action auto-drafts (null for "keep").

export default Object.freeze({
  catalogId: "DISPOSITION_ACTIONS",
  catalogVersion: "2026.04",
  entries: [
    {
      id: "keep",
      label: "Keep",
      hint: "No change planned. Document for completeness.",
      gapTypeId: null,
      assetLifecycle: "1 stays"
    },
    {
      id: "enhance",
      label: "Enhance",
      hint: "Upgrade, expand capacity, or improve in place.",
      gapTypeId: "enhance",
      assetLifecycle: "1 stays + uplift"
    },
    {
      id: "replace",
      label: "Replace",
      hint: "Swap one-for-one for a different platform.",
      gapTypeId: "replace",
      assetLifecycle: "1 retired + 1 introduced (1-for-1 swap)"
    },
    {
      id: "consolidate",
      label: "Consolidate",
      hint: "Merge two or more systems into one.",
      gapTypeId: "consolidate",
      assetLifecycle: "N retired + 1 introduced (N-to-1 merge)"
    },
    {
      id: "retire",
      label: "Retire",
      hint: "Decommission. No replacement planned.",
      gapTypeId: "ops",
      assetLifecycle: "1 retired (no replacement)"
    },
    {
      id: "introduce",
      label: "Introduce",
      hint: "Net-new capability. No current item to replace.",
      gapTypeId: "introduce",
      assetLifecycle: "0 + 1 introduced (net new)"
    },
    {
      id: "ops",
      label: "Operational / Services",
      hint: "Process or services work — runbooks, training, governance, integration, decommissioning.",
      gapTypeId: "ops",
      assetLifecycle: "0 asset change · ≥10 chars notes OR ≥1 link required"
    }
  ]
});
