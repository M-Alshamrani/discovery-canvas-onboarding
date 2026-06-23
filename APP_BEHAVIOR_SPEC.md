# Dell Discovery Canvas — App Behavior Specification

## What this document is

This is a plain-language description of how the Dell Discovery Canvas app is
supposed to behave. Every statement below is a behavior the app guarantees —
something a user, an automated test, or a future maintainer can rely on.

These behaviors were distilled from the app's automated test suite. The test
suite itself lives in the main source repository (not in this intern copy). This
document is the human-readable version of that contract: read it to understand
what the app does, and use it as the basis for writing fresh tests later.

A few orientation notes before the behaviors:

- **The Canvas** is a single-page app that walks a Dell presales engineer through
  a customer discovery workshop. It has five main steps (tabs): Context, Current
  state, Desired state, Gaps, and Reporting. (The Reporting tab has its own
  sub-views: Overview, Heatmap, Gaps board, Vendor mix, Roadmap, and Export
  report.)
- **An engagement** is the whole working document for one customer: their profile,
  business drivers, environments, technology instances, and gaps. The app holds
  one active engagement at a time.
- **Layers** are the six technology groups every engagement is organised by:
  Workload, Compute, Storage, Data protection, Virtualization, Infrastructure.
- **Environments** are deployment contexts (e.g. Core data center, DR site,
  Public cloud). Engagements can add, rename, and hide them.
- **Instances** are individual pieces of technology placed in a layer-and-
  environment cell, in either the *current* state or the *desired* state.
- **Gaps** are the things that need to change to get from current to desired.
- **The AI Assistant** is a chat panel grounded in the engagement that can answer
  questions and propose changes. **Skills** are reusable AI prompts.

How to read a bullet: each "The app must…" line is one promise. Where many
related checks enforce a single rule, the rule is stated once.

---

## 1. Data model and invariants

### Catalogs (the fixed reference data)

- The app must define exactly **6 layers**, in canvas order: Workload, Compute,
  Storage, Data protection, Virtualization, Infrastructure. Every layer has a
  unique id and a non-empty label.
- The app must define a catalog of **8 environment types** with stable ids
  (Core DC, DR DC, Archive site, Public cloud, Edge, Co-lo, Managed hosting,
  Sovereign cloud); each has a non-empty label.
- The app must define **8 business drivers** with stable ids; each driver carries
  a short hint and a conversation-starter sentence used for coaching.
- The app must define **7 actions** (dispositions): keep, enhance, replace,
  consolidate, retire, introduce, ops. Each has a label and a picker hint.
- The app must derive **5 gap types** from the actions: enhance, replace,
  consolidate, introduce, ops. (The "keep" action produces no gap type.) The
  legacy "rationalize" type must never appear.
- The app must define a catalog of **10 service types** with stable ids
  (assessment, migration, deployment, integration, training, knowledge transfer,
  runbook, managed, decommissioning, custom development).
- The app must offer a list of **customer verticals**, kept in alphabetical
  order, including Energy and Utilities.
- The app must define a **technology catalog** with one non-empty list per layer.
  Every catalog tile has a label, a vendor, and a vendor group of `dell`,
  `nonDell`, or `custom`. Every layer's catalog has at least one Dell tile and at
  least one non-Dell tile, with no duplicate labels inside a layer.
- The app must define a **Dell product taxonomy** used for AI Dell-solution
  mapping. It must contain the current product ids and must not contain
  discontinued or renamed ones.
- All catalog data must be plain serialisable values (no functions or DOM
  references), so it can be sent to an AI model as context.
- Each catalog and every catalog version stamp must follow the `YYYY.MM` format.

### Engagement shape

- The app must store the engagement as a schema-validated object with a fixed
  shape: a customer, engagement metadata, and collections of drivers,
  environments, instances, and gaps.
- The app must store each collection as an id-keyed map plus an ordered list of
  ids. The set of map keys must always exactly match the list of ids.
- The app must stamp the schema version as the current version and reject any
  engagement claiming a different schema version.
- The app must require ids to be UUID-shaped, and must reject ids that are not.
- The app must record created and updated timestamps in ISO date-time format,
  must reject invalid dates, and must keep "updated" at or after "created".
- The app must stamp every record with the engagement's own id, taken from the
  engagement context (never from a caller-supplied argument), and must reject a
  record whose engagement id does not match.
- The app must default the engagement owner to a local-user value when none is
  set, and must keep the owner with the saved file.
- The app must keep working-only fields (such as the currently selected entity,
  secondary lookup indexes, and the integrity log) out of the saved file, and
  must rebuild the lookup indexes when a file is loaded.
- The app must save and load the `.canvas` file in the engagement's own shape, with
  no translation through an older format. Save validates the engagement before
  writing; load validates it, rebuilds the lookup indexes, runs the integrity sweep,
  and restores the skills library and provider settings. A file written by an older
  app version is declined with a clear message rather than mangled, so links (such
  as a gap's driver) always survive a save-then-reopen.
- The schema must be read only at the three boundaries — load, save, and action
  commit — and must never be imported by the read-only selector layer.

### Instance rules

- The app must accept a valid instance and reject one that is missing its id, has
  a non-string id, has an empty or non-string label, sits in an unknown layer or
  environment, or carries an unknown vendor group.
- The app must allow the three vendor groups (dell, nonDell, custom) and no
  others.
- The app must treat each instance as either *current* or *desired* and reject any
  other state.
- The app must reject a "desired-only" field (an origin link or a priority) on a
  current-state instance, and must reject a current-state link (origin) pointing
  at a desired instance.
- The app must only allow mapped-asset links on a Workload-layer instance; a
  non-workload instance must carry no mapped assets.
- The app must reject an instance whose origin link points at itself.
- The app must store AI-suggested Dell mappings as a structured provenance
  wrapper, and reject a plain string in that field.

### Gap rules

- The app must accept a minimal valid gap and reject one missing its id or
  description, or carrying an unknown layer, urgency, phase, gap type, or status.
- The app must require a gap's first affected layer to equal the gap's primary
  layer, and reject a gap where they differ.
- The app must require every gap to affect at least one layer and at least one
  environment.
- The app must allow urgency values High, Medium, and Low, and phase values now,
  next, and later, and no others.
- The app must reject a service id in a gap's services list that is not in the
  service catalog.
- The app must reject a non-boolean value for a gap's urgency-override flag.
- The app must store AI-mapped Dell solutions on a gap as a structured provenance
  wrapper, and reject a plain string there.

### Foreign-key and integrity sweep

- The app must run an integrity sweep on every engagement after loading and
  before showing it on screen.
- The sweep must repair danglers without destroying user content:
  - A missing *optional* reference (e.g. a gap's driver, an instance's origin) is
    set to empty, and the repair is logged.
  - A missing element inside a *list* reference (e.g. one bad environment, layer,
    related-instance, or service id) is removed from the list, and the repair is
    logged.
  - A record whose *required* reference is missing (e.g. an instance's
    environment, a gap's layer or gap type, a gap left with no valid affected
    environments) is quarantined out of the live engagement and recorded in the
    integrity log.
  - A link that points at the wrong state (e.g. an origin pointing at a desired
    instance, a current-instance link pointing at a desired instance) is cleared
    and logged.
  - A gap whose first affected layer is not its primary layer is mechanically
    reordered.
- The sweep must never create new records, never edit user-authored text (labels,
  notes, descriptions, outcomes), and never throw on any engagement that passes
  the schema.
- The sweep must be pure and idempotent: running it twice on an already-clean
  engagement returns the same result, by reference.
- The sweep must touch no browser or network APIs (no local storage, no document,
  no window, no fetch) and must not log repaired violations as errors.

---

## 2. Context tab (customer, drivers, environments)

### Customer

- The app must render an input for the customer name, pre-filled from the
  engagement, plus a save control.
- The app must render a vertical dropdown listing every vertical plus a
  placeholder.
- The app must expose the presales-owner and customer-notes fields as editable
  inputs, wired to the engagement.
- The app must start a brand-new engagement with an empty customer name and empty
  vertical — not with placeholder or catalog-first-entry defaults.

### Drivers

- The app must show no driver tiles and a visible "+ Add driver" control on an
  empty engagement.
- The app must open a command overlay listing the available drivers when "+ Add
  driver" is clicked.
- The app must add a chosen driver, and adding the same driver twice must be a
  no-op (no duplicates).
- The app must let a driver tile be removed.
- The app must show a coaching card with the driver's conversation starter when a
  driver tile is clicked.
- The app must offer a priority selector (High / Medium / Low) and an outcomes
  text area for the selected driver, and persist edits to that driver.
- The outcomes editor must auto-bullet: pressing Enter on an empty line inserts a
  bullet; pressing Enter after text starts a new bulleted line at the caret;
  Backspace at the start of a bulleted line removes the bullet.
- The app must write all driver changes through the engagement's write helpers,
  not by mutating an old session object directly.

### Environments

- The app must list the active environments and an "+ Add" control whose palette
  excludes environments already in the engagement.
- The app must append a chosen environment to the engagement.
- The app must open a detail panel when an environment tile is clicked, with a
  Hide button there.
- The app must keep at least one active environment: it must refuse to hide the
  last visible one.
- Hiding an environment must be soft-delete: it flips a hidden flag and never
  deletes instances or gaps (zero data loss), and the change survives a save/load
  round-trip.
- The app must show hidden environments in a separate "Hidden" section, each with
  a Restore button that un-hides without a confirmation prompt.
- The app must guard a hide behind a confirmation when there are unsaved changes;
  the confirmation names the environment and shows how many instances it holds.
- The app must let each environment carry a custom display alias, and use that
  alias as its label.
- The app must write all environment changes through the engagement's write
  helpers.

### Fresh-start and demo affordances

- The app must show a fresh-start welcome card on the Context tab when the
  engagement is empty, and hide it once the user has data.
- The app must keep a persistent "Load demo" button available in the footer.
- The app must show a demo banner on every tab while the active engagement is the
  demo.

---

## 3. Current state and desired state

### Matrix (the layer × environment grid)

- The app must render exactly one data cell per visible layer-and-environment
  combination, each tagged with its layer id and environment id.
- The app must render the grid for both the current and desired views without
  errors, and exclude any hidden environment's column entirely.
- The app must give every cell an "add instance" control.
- The app must render an existing instance as a tile in the correct
  layer-and-environment cell, with a class reflecting its vendor group.
- The app must show a high-criticality tile with a distinct accent and a non-text
  shape marker (so criticality is not conveyed by colour alone); medium and low
  criticality get matching accent classes.
- The app must offer three add paths for a typed custom name: a Dell SKU, a
  third-party vendor, and a fully custom entry. Choosing third-party records the
  vendor name with vendor group `nonDell`; "Other (type)" lets the user type a
  vendor and create the instance on Enter.
- The "Add" palette must respect the environment: a public-cloud cell offers
  cloud-native items and excludes on-prem-only items; an on-prem cell still
  offers on-prem hardware. Every layer must offer at least one cloud-native item
  in the public-cloud environment.

### Lifecycle dates and risk scoring (current state only)

- The app must let a current-state instance on the compute, storage, or
  data-protection layer carry optional `endOfSaleDate`, `endOfSupportDate`, and
  `endOfServiceLifeDate` fields (`YYYY-MM-DD`, blank by default) and an optional
  non-negative `nodeCount`, edited from the detail panel under a "Lifecycle data"
  divider; these fields are hidden on every other layer and on desired-state
  instances.
- The app must render a tile-level summary chip for each lifecycle date that is
  set, labelled "Sale", "Support", or "Life", plus a "Nodes N" chip when a node
  count is set; the chips refresh on a 60-second timer while the current-state
  matrix is open, and only for the compute/storage/data-protection cells.
- The app must derive a lifecycle risk severity from `endOfSupportDate` and
  `endOfServiceLifeDate` against the current date: **critical** (past end of
  service life), **high** (past end of support), **elevated** (either date within
  180 days), or **none** — service-life severity always takes precedence over
  support severity.
- The app must weight lifecycle risk into the health heatmap's bucket score
  (critical=3, high=2, elevated=1, summed as `lifecycleScore`, added to the
  bucket's `totalScore` alongside criticality and gap scores).
- The app must auto-draft a gap (`gapType: "replace"`, origin `autoDraft`,
  description prefixed `"Lifecycle risk: "`) the first time an instance's
  computed risk is elevated or worse, assigning urgency High and phase `now`
  (Medium / `next` for elevated), and must update that same gap in place — never
  duplicate it — on every subsequent save, unless the user has set
  `urgencyOverride` on it.
- The app must auto-close (not delete) a lifecycle-risk gap once its instance's
  risk clears back to "none", and must re-open a previously-closed one if the
  risk recurs.

### Dispositions (desired state)

- The app must show a "mirror" (ghost) tile in the desired view for each current
  item that has no desired counterpart yet, and show no mirror tiles in the
  current view.
- The app must show a disposition badge on a tile once a disposition is set.
- The app must show an unreviewed banner when current items exist without a
  desired counterpart.
- The app must let the desired detail panel set a single Phase value with
  compound labels, and hide the Phase control when the disposition is "keep".
- The app must default the Phase of a brand-new desired tile to "Next".
- The app must keep a "keep" tile's criticality accent inherited from its origin,
  and a desired counterpart of a high-criticality current item must carry the
  high accent. A net-new desired tile (no origin) must carry no criticality
  accent.
- The app must give the Phase control a hover tooltip explaining its behaviour.
- The app must keep the right-hand detail panel terse (about one card at rest).

### Workload asset mapping

- The app must let a Workload-layer instance map to two or more other instances
  ("assets"), and every mapped asset id must point at a real instance.
- The app must offer to raise the criticality of mapped assets up to the
  workload's criticality, but only upward — assets that already meet or exceed
  the workload's criticality are left alone — and only when the user opts in. The
  proposal must never mutate instances on its own.
- The app must refuse an asset mapping when the source is not a workload, the
  target is itself a workload, the asset does not exist, the workload maps to
  itself, the two are in different states, the two are in different environments,
  or the target is marked for retirement. Each refusal returns a clear failure
  code rather than silently succeeding.
- The app must silently de-duplicate repeated asset ids, keeping the first
  occurrence and preserving order.
- A valid same-state, same-environment, non-retired asset mapping must commit
  atomically.

### Selection survives re-render

- The app must keep the selected instance (and its detail panel) selected after
  an edit triggers the grid to re-render.

---

## 4. Gaps tab (types, urgency, phase, status, links, auto-draft)

### Board layout

- The app must render the gaps board as exactly three columns headed now, next,
  and later, plus an "Add gap" button.
- The app must render each gap as a card in the column for its phase, showing its
  description, and carrying classes/attributes for its urgency, layer, and gap
  type.
- The app must not put an editable urgency control on the gap card itself.
- The app must show a default hint in the right panel when no gap is selected, and
  populate the detail panel when a gap card is clicked.

### Creating and editing gaps

- The app must create a manually-added gap with defaults phase = next,
  urgency = Medium, status = open, and then auto-select the new gap.
- The app must tag a manually-added gap as origin "manual" and an auto-drafted
  gap as origin "autoDraft", and judge "is this auto-drafted?" from that origin
  field.
- The app must move a gap to a new phase when its card is dragged to another
  column, and keep that phase in sync with any linked desired tile's phase
  (bidirectional).
- The app must keep the selected gap selected across link, unlink, and edit cycles
  that trigger a re-render.

### Action-link rules (enforced once a gap is reviewed)

- The app must enforce per-gap-type link rules only on **reviewed** gaps;
  unreviewed auto-drafts bypass every link rule.
- **Replace** must link exactly one current and one desired instance. Zero current
  is rejected (it needs the technology being replaced); two-or-more current is
  rejected and points the user to Consolidate.
- **Consolidate** must link two or more current instances to one desired (the
  canonical many-to-one); one current is rejected.
- **Introduce** must link zero current and at least one desired (a net-new
  capability); linking a current is rejected and points the user to Replace.
- **Ops** needs either at least one link or notes of at least ten characters; an
  ops gap with no links and too-short notes is rejected.
- The app must phrase every rejection as a workshop-friendly message, not as raw
  rule text.
- The app must enforce these same rules at creation time and when flipping a gap
  to reviewed. A structural edit (changing links) that would violate the rule on
  an already-reviewed gap is rejected with a clear failure code, while a
  pure-metadata edit (urgency, notes, phase) on a reviewed gap is allowed even if
  a pre-existing violation is present.
- The app must refuse to remove the last required link from a reviewed gap, on
  both the current and desired side, with a clear failure code; the same removal
  on an unreviewed gap is allowed.

### Linking and phase conflicts

- The app must refuse to link a desired instance whose phase conflicts with the
  gap's phase unless the caller acknowledges the conflict; with acknowledgement
  the link commits. A non-conflicting link needs no acknowledgement, and the
  current-side link is never subject to the phase-conflict gate.
- The app must re-balance a gap's affected layers when its primary layer changes:
  if only the primary layer is changed, the affected-layers list is updated so the
  first entry matches; a new primary layer not already listed is prepended,
  preserving existing entries; when the caller supplies both, the caller's intent
  is respected.

### Status and reviewed

- The app must accept the valid status values and reject unknown ones.
- The app must start every auto-drafted gap as not-reviewed, and let a gap be
  flipped to reviewed.
- The app must flip linked gaps to closed when a linked instance's disposition
  becomes "keep".
- The app must render an unreviewed gap card with a "needs review" treatment and a
  review dot.
- The app must offer a "needs-review" filter that hides reviewed cards.
- The app must offer a "Review all" action that highlights every unreviewed
  auto-drafted gap card at once (scan-and-pick, not one-at-a-time).

### Auto-draft content

- The app must, when auto-drafting a gap from a disposition, write a description
  using an arrow template when both a source and a desired label are present, and
  pre-fill notes for every action (not only ops).

### Services on a gap

- The app must let any gap carry a list of services drawn from the full service
  catalog, regardless of gap type, and de-duplicate that list.
- The app must persist a gap's services through add, edit, save, and load.
- The app must not auto-change a gap's services when its gap type changes
  (services are opt-in), and must treat an empty list as a valid value.
- The app must suggest a sensible set of service chips per gap type, while still
  allowing any service to be added.

### Drivers behind gaps

- The app must let a gap carry an explicit driver, and otherwise suggest one from
  simple rules (e.g. data-protection work suggests cyber-resilience, ops work
  suggests operational simplicity, public-cloud context suggests cloud strategy).
- The app must prefer an explicit driver over a suggested one, and report whether
  a gap's driver is explicit, suggested, or none, with a reason.
- The app must skip a suggested driver when that driver is not in the engagement.

---

## 5. Reporting views (overview, heatmap, gaps board, vendor mix, roadmap, export report)

### Health and scoring

- The app must compute a health summary with numeric totals for current
  instances, high-risk gaps, and bucket counts, where total buckets equal layers
  times environments.
- The app must count only current-state instances as current, and only High-
  urgency gaps as high-risk, and must exclude closed gaps from the high-risk
  count.
- The app must score each bucket by combining a current-criticality score (High =
  2, Medium = 1, Low = 0.5), a gap-urgency score (High = 3, Medium = 2, Low = 1),
  and a lifecycle-risk score (critical = 3, high = 2, elevated = 1, summed across
  the bucket's current instances), and translate the total into a risk label,
  including "No data" when a bucket is empty and "Stable" at score zero with
  data.
- The app must compute an account health score as an integer between 0 and 100
  (and return nothing for an empty engagement).
- The app must compute a discovery-coverage percentage (0 on an empty engagement,
  100 when everything is filled in) and lower it when a current tile lacks a
  disposition.
- The app must compute a risk posture that is "Stable" on an empty engagement,
  rises to at least "Elevated" when a High-urgency gap sits in the Now phase, and
  is forced to High when a critical current tile lacks a disposition; the posture
  includes suggested actions whenever it is not Stable.

### Overview

- The app must render the overview with a two-panel health summary: a coverage
  percentage and a risk-level pill.
- The app must show the executive summary text in the overview, and generate a
  non-empty summary that mentions the customer name when set.
- The app must render a single 100%-stacked headline bar with three proportional
  segments that sum to about 100%, labelling any segment wider than ~6% with an
  inline percentage.
- The app must render three headline KPI tiles, a driver chip per engagement
  driver, and a Refresh button that re-rolls the session brief.
- The app must label the fifth step "Reporting".

### Heatmap

- The app must render the heatmap with one bucket cell per layer-and-environment,
  excluding hidden environments.

### Gaps summary, vendor mix

- The app must render the gaps summary as three phase columns.
- The app must compute a vendor mix per layer and per environment, each with Dell,
  non-Dell, custom, and total counts where the total equals the sum of the parts.
- The app must restrict the per-state vendor mix correctly (current excludes
  desired instances and vice-versa).
- The app must build a vendor table with one row per vendor (vendor, vendor group,
  current count, desired count, total), sorted by total descending, where each
  row's total equals current plus desired.
- The app must populate a vendor-detail panel when a vendor row is clicked.
- The app must compute three vendor KPIs (Dell density, the most diverse layer,
  and the top non-Dell concentration).

### Roadmap and projects

- The app must group gaps into projects by their environment, layer, and gap type:
  gaps that share all three group together; gaps in different environments or of
  different types form separate projects.
- The app must name a project from its environment label, layer label, and an
  action verb, set its urgency to the highest urgency among its gaps, set its
  phase to the earliest among its gaps, and assign its driver from the most common
  driver of its gaps.
- The app must use the verb "Retirement" for a project whose gaps are all retire
  actions.
- The app must form a cross-cutting project for gaps with no environment and no
  linked instances, and count a multi-linked instance only once in a project's
  technology count.
- The app must render the roadmap as three phase columns with one swimlane per
  engagement driver plus an "Unassigned" lane, and render project cards showing a
  name, an urgency badge, and a gap count.
- The app must show a portfolio-pulse bar whose totals match the project counts,
  and an empty state when the engagement has no gaps.
- The app must open a project detail panel when a project card is clicked, and a
  driver detail panel when a swimlane header is clicked.
- The app must list a project's services as the de-duplicated union of its gaps'
  services, and exclude services from closed gaps in that roll-up.
- The app must list a gap's effective Dell solutions as the labels of its linked,
  Dell-tagged desired tiles, de-duplicated.

### Export report

- The app must offer a sixth Reporting sub-tab, "Export report", alongside
  Overview, Heatmap, Gaps board, Vendor mix, and Roadmap.
- The app must generate a self-contained HTML report (no external dependencies
  besides Google Fonts) covering: an executive header (customer name, KPI
  summary, date, prepared-by), an overview dashboard (vendor-mix donut, Dell vs.
  non-Dell bars, category snapshot), a per-environment breakdown, a full asset
  inventory table, the heatmap, a risks-and-gaps panel (including the lifecycle
  risk list), the strategic roadmap, and an executive session brief — all
  populated from the live engagement.
- The app must offer two actions: "Generate & Open Report" (opens the HTML in a
  new browser tab) and "Download HTML" (saves it to a file named from the
  customer and a timestamp); the report must be printable to PDF via the
  browser's print dialog.
- The app must show a "No instances found" warning in the preview panel when the
  engagement has zero instances, without blocking report generation.

---

## 6. Selectors and adapters (how views read the engagement)

- The app must derive every view's data through read-only selector functions: a
  matrix-view selector, a gaps-kanban selector, a projects selector, a vendor-mix
  selector, a health-summary selector, an executive-summary-inputs selector, and a
  linked-composition selector.
- The matrix selector must return an environment-by-layer grid (per state) with
  layers in catalog order, count the vendor mix per cell correctly, and exclude
  hidden environments unless explicitly asked to include them.
- The gaps-kanban selector must group gaps by phase and status and keep closed
  gaps out of the active counts, with deterministic ordering inside each group.
- The linked-composition selector must, for a given driver, instance, gap,
  environment, or project, return that entity plus everything linked to it, and
  return a graceful empty result for an id that does not exist.
- Every selector must be pure: identical input returns the very same output
  object, and any action that changes the underlying data invalidates the cached
  result.
- No selector file may touch the browser or network (no local storage, document,
  window, or fetch), declare hidden mutable module state, or pull in an external
  memoization library.
- The app must also expose adapters that present the engagement in each of the six
  view shapes (context, architecture, heatmap, workload, gaps, reporting) without
  throwing on an empty engagement, preserving links, services, and project ids,
  and counting a multi-environment gap only once.
- A context edit through the adapter must update the customer and notify
  subscribers, using an immutable update (write-through, not in-place mutation).

---

## 7. AI Assistant (grounding, no fabrication, natural voice, beyond-canvas)

### Grounded system prompt

- The app must build the assistant's system prompt as a five-part structure: a
  role section, a data-model section, a field manifest, the live engagement data,
  and the available views.
- The app must classify the user's question to the relevant read-only views and
  inline those real engagement values into the prompt — actual gap descriptions,
  vendor names, counts — not just generic catalog descriptions.
- The app must produce a "the canvas is empty" grounding when the engagement has
  no data, without throwing.
- The app must keep within a token budget on a very large engagement, dropping
  some inlined detail if needed while always preserving the summary metadata.
- The app must embed a data-contract block (with a checksum and at least one real
  catalog label) and a concept dictionary and workflow guide into the cached
  prompt prefix.

### No fabrication

- The app must verify the model's answer against the engagement and flag claims
  that do not trace to it.
- The app must rank flagged claims by severity: a fabricated gap description is
  high; an out-of-engagement vendor name is medium; a fabricated project phase or
  delivery date is low (because the data model does not yet carry those fields).
- The app must treat Dell-catalog product names as legitimate reference data: a
  Dell product the customer does not happen to use is not a fabrication.
- The app must attach the list of flagged claims to the finished answer and show a
  footer note when claims were flagged, while keeping the model's wording on
  screen (soft warning, not a replacement of the answer).

### Natural analyst voice

- The app must instruct the model to call its views silently and answer in a
  natural analyst voice — never citing internal selector names, internal field
  names, version markers, or workflow/concept identifiers in user-facing prose.
- The app must never let raw UUIDs reach the user: it replaces known ids with
  their human labels and replaces unknown ids with a neutral "unknown reference"
  placeholder, skipping code blocks, and is safe to run more than once.
- The app must strip the model's first-turn internal handshake before showing
  text — at the start, mid-stream, and with bracket, whitespace, or emphasis
  variations — including healing older saved transcripts that still contain it.
- The app must answer questions about quantities truthfully: while the data model
  has no quantity field, it must enumerate items by name rather than invent
  counts or percentages for install-base, vendor, or instance questions.

### Beyond-canvas knowledge

- The app must allow the model to add outside industry knowledge, but only when it
  is clearly wrapped in a "beyond-canvas" block, and never as a substitute for the
  customer's own data.
- The app must render a beyond-canvas block as a visually distinct passage, and
  must ignore a fabrication that sits inside such a block while still flagging the
  same fabrication outside it.

### Conversation affordances

- The app must show a typing indicator while the model is working, a status pill
  naming the tool currently in use, and a round badge once the conversation passes
  the first round.
- The app must offer exactly four "try asking…" prompts: at least one how-to, at
  least two engagement-aware insights, and at least one multi-tool showcase. On an
  empty engagement it falls back to static example prompts, and the same seed
  always yields the same four.

### Providers, retries, and requests

- The app must read AI configuration with sensible defaults when none is saved,
  round-trip saved settings, and migrate a deprecated model id to its replacement
  on load.
- The app must let the user pick the model from a dropdown of known ids for the
  proxy-backed providers (Anthropic, Gemini), with a "Custom…" option that reveals
  a free-text field; the user-defined providers (local, Local B, Dell Sales Chat)
  keep a plain free-text model field. A saved model that is not in the list must
  not be lost — it is shown under "Custom…", pre-filled.
- The app must treat the local provider as ready without a key, and require a key
  for public providers.
- The app must build each provider's request in that provider's own shape
  (OpenAI-compatible, Anthropic, and Gemini), translating shared message content
  into each provider's tool-call and tool-result conventions, and consolidating
  multiple system messages into one where the provider needs that.
- The app must include the required browser-access opt-in header for the Anthropic
  provider, and mark the cacheable prefix for caching on providers that support
  it.
- The app must retry a transient server error and succeed when the upstream
  recovers, but must not retry a terminal authentication error.
- The app must fall back to the next model in a configured chain when the primary
  exhausts its retries, and surface the last transient error only when every
  candidate fails.
- The app must keep retry backoff within bounds and roughly double it per attempt.
- The app must surface a friendly server-configuration hint (not the raw upstream
  payload) when a local model rejects an automatic tool-choice request.
- The app must present provider choices as a single active pill with a popover:
  clicking a ready inactive provider switches to it, the active row carries a
  Dell-blue treatment, a ready-but-inactive row shows a Dell-blue dot, and a
  needs-key row shows an amber dot. Provider state is re-read from fresh config
  each time (never a stale build-time snapshot).
- The app must show a footer breadcrumb after each turn with the provider, model,
  token count, and elapsed time.
- The app must open the assistant with Cmd+K / Ctrl+K, and reach it from a single
  topbar "AI Assist" button.

### Action proposals from chat

- The app must register a "propose action" tool the model can call to emit
  structured change proposals, and carry those proposed actions on the chat
  response.
- The app must treat the proposal tool as mandatory when the user's request
  matches a supported action kind, and provide worked examples for adding a
  driver, adding a current instance, and closing a gap (with the close-reason
  field required).

### Transcript memory

- The app must save and reload a chat transcript, preserving its messages and
  summary, and clear it on request.
- The app must collapse older turns into a single prior-context message when the
  transcript grows, and that collapse must be safe to re-run.
- The app must scope chat memory to the engagement's id, so starting a new
  engagement yields a clean transcript and the old transcript is dropped from
  storage.
- The chat layer must not import the engagement's write actions or state module
  (it reads through selectors only).

---

## 8. AI Notes and workshop import

### AI Notes (capture during a workshop)

- The app must provide an "AI Notes" overlay, opened from its own topbar button
  (the topbar carries two AI buttons: AI Assist and AI Notes).
- The app must present AI Notes as two stacked panes — raw bullets below,
  processed notes above — separated by a draggable divider whose split is
  remembered.
- The app must keep the latest typed line visible (scroll-to-caret) and let the
  notes area fill its pane and scroll.
- The app must send notes to the model with enough output room (a raised token
  limit) so a long reply is not clipped mid-string, and retry once with a
  strict-JSON reminder if the reply will not parse.
- The app must parse the model's reply defensively: it strips markdown code
  fences, attempts repair on truncated output, and never throws — returning a
  clear failure instead.
- The app must show import errors as an in-overlay banner, and offer an "Import to
  canvas" action that hands the processed notes to the importer.
- The app must distinguish the different zero-result states (nothing pushed yet,
  pushed but nothing extracted, pushed but everything dropped) rather than always
  saying "push notes first".

### Workshop data import (the paste-from-LLM flow)

- The app must offer a single "Import data" footer button next to Save/Open that
  opens a two-step modal.
- The app must generate a downloadable instructions `.txt` file named by customer
  and timestamp, embedding the customer name and the live list of environment
  slots at the moment of the click.
- The instructions file must contain three labelled phases (A, B, C), a verbatim
  strict-match warning, a "stop and confirm" approval step, a naming-confirmation
  prompt, and a fallback chain for the mapping table (markdown → CSV → fixed-width
  plain text).
- The app must also produce a context-aware kickoff prompt that embeds the
  customer name and environment count, commands the model to follow the three
  phases, forbids emitting JSON before approval, and tells the engineer to upload
  the source file to the model (not to the canvas).
- The app must validate the pasted import JSON against a schema and reject
  malformed input with a clear error.
- The app must strictly reject an import that references an environment not in the
  live engagement — no partial apply.
- The app must support three import item kinds: add an instance, add a driver, and
  close a gap, each shown in a preview modal with a confidence chip and an
  LLM-state hint, one row per item.
- The app must let the user pick the apply-scope (Current, Desired, or Both) as the
  authoritative choice, flagging any row whose own state differs from the chosen
  scope. "Both" must create two truly independent records with no origin link
  between them.
- The app must stamp imported changes with an external-LLM provenance tag, render
  the matching badge on the resulting tile, and default a legacy tag without a kind
  to "skill".
- The app must suppress a desired "ghost" on the heatmap when a desired instance
  with the same label already exists in the same cell.
- The app must disable the instructions download (and refuse to build them) when
  the engagement has no environments.
- The app must let the import modals scroll when their content is taller than the
  viewport, and pass the full applier result (including any per-item errors) back
  so partial failures can be surfaced.

---

## 9. Skills (authoring and running AI prompts)

### Storage and lifecycle

- The app must return an empty skill list on a fresh install (there are no
  built-in seed skills); the user authors skills from scratch.
- The app must add, update, and delete skills, persisting them locally, and emit a
  "skills changed" event on every such change (including deploy, undeploy, and
  reassign).
- The app must return an empty list (never throw) when the saved skills are
  missing, corrupt, or not an array.

### Authoring form (Skill Builder)

- The app must provide a Skill Builder reached from the chat right-rail
  "+ Author new skill" button and from Settings, labelled without any version
  suffix.
- The app must give each skill a first-class Description field, a Seed-prompt text
  area, a Data-points selector with a Standard/Advanced toggle, an Improve button,
  and a read-only Improved-prompt text area.
- The app must offer exactly four output formats: text, dimensional, json-array,
  and scalar.
- The app must show a mutation-policy choice (exactly "ask" or "auto-tag") only
  when the output format is json-array or scalar.
- The app must store a skill in the v3.2 shape (description, seed prompt, data
  points, improved prompt, output format, mutation policy) and reject any other
  output-format or mutation-policy value.
- The app must let a skill declare parameters with a name, type, description, and
  required flag, and support a file-type parameter with an accepts filter for
  run-time uploads.
- The app must wire the Improve button to a real model call (no mock provider),
  keep the improved-prompt text area read-only by default, allow an Edit to unlock
  it, and re-lock and re-run on Re-improve.
- The Improve meta-prompt must instruct the model to embed engagement data in a
  context block, never leak real values into the format section, and use clearly
  fake example placeholders.
- The app must present the Data-points picker as a two-pane shell (a list on the
  left, a detail pane on the right) with category toggles (Standard, Insights,
  Advanced) and search, and show that pane's relationships, mandatory pairings, and
  ordering for the selected data point.
- The app must render the skill list as styled cards with pill-chip meta tags, and
  lay out the Test, Cancel, and Save buttons as siblings in one horizontal row.

### Data points and their relationships

- The app must offer a curated "Standard" set of data points that is a non-empty
  subset of the full mutable set.
- Every Standard path must resolve against a realistic engagement without
  returning a bare "not found" marker, and every Insights path (coverage, risk,
  totals, Dell density, projects, brief) must likewise resolve.
- Catalog-resolved data points must return human labels, not raw ids (e.g. a
  driver name reads "Cyber Resilience", not its internal id; a vertical reads
  "Healthcare", not its internal id).
- The data-point metadata must be self-consistent: every mandatory-pairing and
  foreign-key reference points at a real path; foreign-key pairs are bidirectional;
  every Insights path declares where it is derived from; the level-ordered paths
  are exactly driver priority, instance criticality, and gap urgency, and the
  phase-ordered paths are exactly instance priority and gap phase; desired-only
  fields match the schema's state rules; and every multi-hop relationship chain
  ends in a result.

### Running a skill

- The app must run a skill against a real model using the improved prompt with
  parameters substituted (no mock provider).
- The app must inject the selected data points as a resolved `<engagement-data>`
  block ahead of the prompt; paths that do not resolve render as "[not set]"; an
  empty data-points selection emits no block at all.
- The app must format that block as an ordered list of `path: value` lines, but as
  a row-structured markdown table when three or more fields come from the same
  collection (so per-record relationships are preserved across columns).
- The app must show only model responses and errors in the chat dialog when a
  skill runs — never the resolved prompt as a fake user turn.
- The app must expose the file-type parameter's accepts filter at the run-time
  file picker.

### Skills tab and mutations

- The app must give the chat overlay a permanent Chat tab and a permanent Skills
  launcher tab; the Skills tab is a read-only launcher (no edit, save, or delete
  controls inside it).
- The app must prompt to confirm cancelling a running skill before launching a
  second one.
- The app must, for a skill whose mutation policy is "ask", show an approval modal
  before committing any change.
- The app must apply skill mutations only to instances (not drivers, environments,
  gaps, customer, or engagement metadata), and stamp the mutated instance with an
  AI tag recording the skill id, run id, and time.
- The app must show a "Done by AI" badge on a tile carrying that tag, and strip the
  tag automatically when an engineer next saves that instance (ownership transfers
  back to the human).

---

## 10. Save, open, import, and clear

- The app must save the engagement to a `.canvas` file wrapped in an envelope that
  records the file-format version, app version, schema version, and a saved-at
  timestamp.
- The app must strip API keys from the saved file by default, including them only
  when the user explicitly opts in.
- The app must suggest a safe `.canvas` filename built from the customer name and
  the date.
- The app must reject garbage JSON and a file from a newer Canvas version with a
  readable error, while tolerating unknown top-level keys for forward
  compatibility.
- The app must warn when an opened file carries bundled API keys, and keep the
  user's own keys by default.
- The app must round-trip cleanly: save, then parse, then apply must reproduce the
  same engagement (gaps, drivers, and environments preserved).
- The app must offer a "Clear all data" footer control, styled as destructive,
  that opens a confirmation; the data survives until the user confirms.

---

## 11. Persistence and file versioning

### Boot persistence

- The app must persist the active engagement to local storage and restore it on
  the next load, including all of its gaps.
- The app must start fresh, without throwing, when the stored value is corrupt
  (malformed JSON or schema-invalid), and keep working normally afterwards.

### Loading a file from a different schema version

There is no migration path: `services/canvasFile.js` accepts a file only when its
declared schema version matches `CURRENT_SCHEMA_VERSION` exactly.

- The app must reject a file whose schema version is older than the build's,
  surfacing a `FILE_FROM_PREVIOUS_VERSION` error with a message naming both
  versions and a "start a fresh session" recovery hint — it must not attempt to
  upgrade or partially load the file.
- The app must reject a file whose schema version is newer than the build's,
  surfacing a `FILE_NEWER_THAN_BUILD` error asking the user to open it in a newer
  build.
- The app must leave the original file untouched in both rejection cases (the
  envelope is only parsed, never written back).

### Catalog drift

- The app must, when an engagement was stamped against an older catalog version
  than the one now loaded, mark the affected AI-authored fields "stale" — but only
  their validation status, never their value — and surface the drift count as a
  non-blocking banner.
- The app must preserve a "user-edited" or "invalid" status through drift (it is
  not downgraded to "stale").
- The drift detector must be pure: the same engagement and catalog always produce
  the same result.

---

## 12. AI provenance

- The app must record, for every AI-authored field, a provenance wrapper carrying
  the model, prompt version, run id, and timestamp, and reject a plain string
  where a wrapper is required.
- The app must flip a field's status to "user-edited" when a person edits it,
  while preserving the original provenance fields.
- The app must show a distinct status indicator per validation status (a plain
  sparkle for valid, an amber dot for stale, a red dot for invalid, a
  pencil-with-sparkle for user-edited) with a tooltip naming the model, skill, and
  time.
- The app must reject an AI Dell-mapping value that names a product outside the
  Dell taxonomy, exhausting a small retry budget before marking the field
  "invalid".
- Only the skill-runner may set provenance.

---

## 13. App shell, navigation, and visual rules

- The app must render a stepper of all five steps, with exactly one active at a
  time (and an "active" style on it), landing on the Context step on a fresh load.
- The app must render the stepper steps with a pointer cursor and a hover
  affordance, and with a mono leading-zero numbering pattern (01–05).
- The app must disable the Gaps and Reporting steps (greyed and marked
  unavailable) while the engagement has zero visible environments.
- The app must provide the main left and right panels, plus export and
  new-session controls.
- The app must put a help icon on every main tab's header card; clicking it opens
  a modal with non-empty body text that closes via Escape, a backdrop click, or
  the close button.
- The app must show a centred "no environments" card in the Matrix, Gaps, and
  Reporting tabs when the engagement has none, sharing one component (no
  duplicated copies).
- The app must scale the matrix columns to the number of visible environments and
  avoid a page-level scroll, with no hardcoded element heights.
- The app must keep the app-version chip in the footer (not the topbar), and the
  app version must be a valid semver-shaped string distinct from the schema
  version, sourced from one place (no hardcoded version strings elsewhere).
- The app must keep its overlays well-behaved: opening one marks it open; Escape,
  a backdrop click, and the close button all close it; a click inside does not;
  and a side-panel overlay stacks on top of an existing one, with Escape closing
  only the top layer and the underlying overlay restoring to full width when the
  top is closed.
- The app must keep the chat transcript area dark, render assistant replies as
  parsed markdown (headings, inline and fenced code, tables, blockquotes), and
  keep its theme tokens and fonts aligned to the reference design.
- The app must use clean typography in served copy (e.g. no stray em-dashes in the
  shipped UI files).

---

## 14. Things the suite checks that are not user-facing behavior

The following groups of tests exist, but they police the codebase rather than
describe user-visible behavior, so they are summarised here rather than expanded
into "the app must…" bullets:

- **Architecture-discipline lints** — that the old v2 modules are deleted and not
  imported anywhere; that production code never imports the test folder; that
  chat and selector layers stay free of forbidden dependencies; that there are no
  version prefixes in file names or user-facing labels; that no mock AI providers
  exist; and that no swallowed error handlers or test-only environment branches
  ship in production code.
- **Anti-cheat meta-tests** — that the tests themselves are not hollow (no
  self-referential always-true assertions) and that every spec rule has at least
  one matching test.
- **Performance budgets** — that loading, migrating, the integrity sweep, the
  selectors, and a single tab render all complete within calibrated time limits,
  and that the demo file has its expected size.
- **Deployment hygiene** — that no served file name begins with an underscore (so
  it is not hidden by static hosting), and that required diagnostic files are
  fetchable.
- **Manifest/contract self-checks** — that the field manifest and data contract
  are generated (not hand-maintained), are deterministic, and self-validate at
  load, so any schema change that is not regenerated is caught.

---

## Demo data (the "Load demo" engagement)

The demo engagement is itself held to standards, so that loading it exercises real
features:

- The demo must validate cleanly against the schema at build time, and loading it
  twice must return the very same object.
- Every demo instance and gap must pass validation, and every reference (driver,
  environment, instance, service) must resolve.
- The demo must be marked as a demo and populate the customer, at least three
  drivers, and four environments, with every driver linked by at least one gap.
- The demo must exercise breadth: instances in the Workload layer with assets
  mapped across environments; a desired instance linked back to a current one;
  both Dell and non-Dell vendors; the "keep", "retire", and "introduce" patterns;
  at least three distinct dispositions; coverage of all five gap types; a gap with
  an explicit driver; a driver with non-empty outcomes; an instance referenced by
  two or more gaps; at least one gap with an urgency override; actionable gaps
  carrying services; at least one service mapped to a domain; and at least one
  AI-authored field with full provenance.
- Applying an AI proposal and then undoing it must return the demo engagement to a
  byte-identical state, and both apply and undo must notify subscribers so the UI
  re-renders.
- The app must ship at least two demo personas, each of which builds a
  schema-valid engagement.

---

## Known gaps between this spec and the current build

This document describes how the app is *meant* to behave. Where the current build doesn't fully
meet it yet, the deviations (with their fixes or workarounds) are tracked in
[KNOWN_ISSUES.md](KNOWN_ISSUES.md) — read the two together. When you fix one of those issues, the
matching behavior above is the contract to test against.
