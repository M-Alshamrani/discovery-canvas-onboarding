// core/helpContent.js — contextual help prose, keyed by tab / sub-tab id.
// Each entry: { title, body: string[] }. Rendered by ui/views/HelpModal.js.

export const HELP_CONTENT = {

  context: {
    title: "Context — the customer's strategic drivers",
    body: [
      "Capture the essentials: customer name, vertical, region, presales owner.",
      "Add strategic drivers from the 8-item catalog. Each driver carries a suggested conversation starter on the right panel.",
      "Open any driver to set a priority (High / Medium / Low) and capture business outcomes. Press Enter in the outcomes field to start a new bullet.",
      "Drivers added here anchor the Roadmap swimlanes in Tab 5 — they become the strategic language the CxO recognizes."
    ]
  },

  current: {
    title: "Current State — what the customer has today",
    body: [
      "Click '+ Add' in any cell to browse the catalog, or type a custom name to pick Dell SKU / 3rd-party vendor / Custom-internal.",
      "The catalog filters by environment — PowerEdge appears in Core DC, AWS EC2 only in Public Cloud.",
      "Click any tile to set its criticality (Low / Medium / High). Criticality drives the Heatmap and gap urgency in Tab 4.",
      "Left-border colour + shape glyph (▲ ● ○) signal criticality at a glance."
    ]
  },

  desired: {
    title: "Desired State — what happens to today's estate, and what's net-new",
    body: [
      "Grey dashed 'ghost' tiles are current items not yet reviewed. Click each to set a disposition: Keep / Enhance / Replace / Consolidate / Retire / Operational.",
      "Keep = no change, no gap. Every other disposition auto-drafts a gap into Tab 4.",
      "Each desired tile has a Phase (Now / Next / Later). Changing it re-syncs the linked gap's phase — one source of truth.",
      "Net-new tiles default to Phase = Next. Criticality from the source current instance carries through visually."
    ]
  },

  gaps: {
    title: "Gaps — the control tower for what needs to change",
    body: [
      "Three columns are phases (Now / Next / Later). Filter by layer, environment, type, status, or 'Needs review only'.",
      "Auto-drafted gaps show a pulsing red dot until approved. Either click 'Approve draft' or edit anything — both flip the gap to reviewed.",
      "Urgency and gap-type are read-only on auto-drafts. Urgency derives from the linked current's criticality; type from the source disposition.",
      "Pick a Strategic Driver in the detail panel (★ = confirmed, ☆ = auto-suggested). This anchors the gap to a Roadmap swimlane.",
      "Drag cards between phases to reschedule; the linked desired tile's phase updates with it."
    ]
  },

  reporting_overview: {
    title: "Reporting — Overview",
    body: [
      "Two health panels side-by-side. Discovery Coverage (0-100%) measures discovery completeness — drivers added, dispositions set, drafts reviewed, programs assigned.",
      "Risk Posture (Stable / Moderate / Elevated / High) derives from the Heatmap + urgency rules + unreviewed critical tiles. It's a label, not a number — no arbitrary weights to defend.",
      "The Executive Summary generates a CxO-ready narrative from session data. Click Regenerate after edits.",
      "Strategic-driver chips mirror what the CxO told you in Tab 1."
    ]
  },

  reporting_health: {
    title: "Reporting — Heatmap",
    body: [
      "5 × 4 grid: Layers (rows) × Environments (columns). Each cell's number is its bucket risk score.",
      "Score = sum of current-instance criticality weights + sum of linked gap urgency weights.",
      "Colour + shape: red/▲ = High (>6), amber/● = Moderate (4-6), green/○ = Minor (1-3), grey = no data.",
      "Click any cell to drill into its detail panel."
    ]
  },

  reporting_gaps: {
    title: "Reporting — Gaps Board (read-only)",
    body: [
      "A stakeholder-safe mirror of Tab 4's kanban. Use during client reviews.",
      "Same filter row as Tab 4, but filter state is independent — changing filters here doesn't affect Tab 4.",
      "No inline edits, no drag — changes happen in Tab 4."
    ]
  },

  reporting_vendor: {
    title: "Reporting — Vendor Mix",
    body: [
      "Stacked bars per layer: Dell / Non-Dell / Custom for Current vs Desired.",
      "Vendor table shows each vendor's instance count — useful for Non-Dell consolidation conversations.",
      "Custom-added items still carry a specific vendor (HPE, Cisco, etc.) captured at add-time — they don't collapse into 'Other'."
    ]
  },

  reporting_vendor_criticality: {
    title: "Reporting — Vendor Criticality",
    body: [
      "Workload-centric: the unit is the current business workload, not the servers/storage under it. A server isn't a workload — it's a server running one. So the bands are workloads by THEIR criticality: Critical (top), Medium, Low (bottom).",
      "Each band is split by the vendors exposed to those workloads. A vendor relates to a workload by being its application vendor, or by supplying technology the workload is mapped to (its compute/storage/backup/etc.). Map a workload's stack in Current State to surface that underlying vendor lock-in.",
      "The 'Vendor exposure from' chips pick which sources count: 'Business app' = the workload's own vendor; the others = the mapped underlying layers. Vendors keep one colour across all bands; the long tail collapses into 'Other'.",
      "The right panel ranks vendors by how many workloads they're exposed to. Click a vendor (or a chart segment) to list those workloads — each with its own Criticality dropdown that commits immediately and reflows the bands. Current state only."
    ]
  },

  reporting_roadmap: {
    title: "Reporting — Roadmap (the crown jewel)",
    body: [
      "Two-level hierarchy: Programs (swimlanes) × Phases (columns). Programs are your Strategic Drivers from Tab 1.",
      "Project cards at intersections auto-derive by (environment, layer, gap type). Name: '{Env} — {Layer} {ActionVerb}' e.g. 'Core DC — Storage Modernization'.",
      "Aggregate urgency = max of constituent gaps. Phase = mode. Dell solutions = deduped labels of linked Dell desired tiles.",
      "The Unassigned swimlane collects projects whose gaps haven't been mapped to a driver yet.",
      "The pulse bar above the grid summarises: total projects, phase split, unreviewed gaps count.",
      "Read-only. Edit gaps in Tab 4 to reshape the roadmap."
    ]
  }

};
