// core/appManifest.js
//
// Application + workflow manifest for the AI assistant — the PROCEDURAL
// grounding layer that complements:
//   - core/dataContract.js   (structural metadata: entities, FKs, etc.)
//   - core/conceptManifest.js (definitional metadata: what each term
//                              means, when to use it)
//
// Three exports:
//   - WORKFLOWS: numbered step-by-step procedures the user follows in the
//     app. Each: { id, name, intent, app_surface, steps[],
//     relatedConcepts[], typicalOutcome }.
//   - RECOMMENDATIONS: a regex-trigger → guidance map. Each entry:
//     { id, triggers[regex], answer, relatedWorkflowIds, relatedConceptIds }.
//   - APP_SURFACES: the major UX surfaces (top-bar tabs, overlays,
//     buttons) the LLM should know about so it can direct the user
//     ("open Tab 4", "click + Add gap", etc.).
//
// Inline strategy: the workflow TOC + recommendation table are inlined on
// the cached prompt prefix (each TOC row: id · name · 1-line intent); full
// workflow bodies (steps + outcomes) are fetched on demand via the
// selectWorkflow(id) tool. APP_SURFACES is small enough to inline verbatim.
//
// SCHEMA VERSION: bump on every breaking-shape change.

export const APP_SCHEMA_VERSION = "v3.0-app-1";

// ─────────────────────────────────────────────────────────────────────
// APP_SURFACES — the major UX surfaces the LLM points users at.
// Small, stable. Inlined verbatim in the system prompt.
// ─────────────────────────────────────────────────────────────────────
export const APP_SURFACES = {
  app_purpose: "Dell Discovery Canvas — a presales workshop tool for capturing customer infrastructure state, identifying gaps from current → desired state, mapping gaps to Dell solutions, and generating executive deliverables.",
  topbar_tabs: [
    { id: "context",     label: "Context",      purpose: "Capture customer identity (name, vertical, region) and 1-5 strategic business drivers." },
    { id: "current",     label: "Current state", purpose: "Document the customer's TODAY footprint — environments + instances per layer (workload / compute / storage / dataProtection / virtualization / infrastructure)." },
    { id: "desired",     label: "Desired state", purpose: "Document the TO-BE footprint. Desired instances can carry originId linking to a current predecessor (replace + consolidate lifecycle)." },
    { id: "gaps",        label: "Gaps",         purpose: "Identify deltas between current and desired — typed gaps (replace / consolidate / introduce / enhance / ops). Each gap links to drivers + instances + services." },
    { id: "reporting",   label: "Reporting",    purpose: "Executive deliverables: vendor-mix dashboard, gap kanban, health summary, executive summary, projects view." }
  ],
  global_actions: [
    { id: "load_demo",   label: "Load demo",     where: "Footer button",        purpose: "Replace the canvas with the Acme Healthcare demo (3 drivers, 4 envs, 23 instances, 8 gaps)." },
    { id: "save_file",   label: "Save to file",  where: "Footer button",        purpose: "Download the engagement as a .canvas file for backup or hand-off." },
    { id: "open_file",   label: "Open file",     where: "Footer button",        purpose: "Load a previously-saved .canvas file." },
    { id: "new_session", label: "New session",   where: "Footer button",        purpose: "Clear the canvas and start fresh (warns first; cannot be undone)." },
    { id: "settings",    label: "Settings (⚙)", where: "Top-right gear icon",  purpose: "Configure AI providers (Anthropic / Gemini / Local LLM / Dell Sales Chat) + author Skills." },
    { id: "canvas_chat", label: "Canvas Chat",   where: "Top-right button",     purpose: "Open the AI assistant overlay. Ask anything about the canvas, the data model, or the app's concepts/workflows." }
  ]
};

// ─────────────────────────────────────────────────────────────────────
// Workflow constructor — enforces canonical shape.
// ─────────────────────────────────────────────────────────────────────
function W(id, name, intent, appSurface, steps, relatedConcepts, typicalOutcome) {
  return { id, name, intent, appSurface, steps, relatedConcepts, typicalOutcome };
}

// ─────────────────────────────────────────────────────────────────────
// WORKFLOWS — ~16 step-by-step procedures.
// ─────────────────────────────────────────────────────────────────────
export const WORKFLOWS = [

  W("workflow.capture_context",
    "Capture engagement context",
    "Set the customer's identity at the start of the workshop.",
    "Context tab",
    [
      "Open the Context tab (top of the page).",
      "Fill the customer name, vertical (Healthcare / Financial Services / etc.), and region (EMEA / APAC / etc.).",
      "Add 1-5 strategic drivers from the BUSINESS_DRIVERS catalog (Cyber Resilience / AI & Data / Cost Optimization / etc.). For each driver, set priority (High / Medium / Low) and outcomes (free-text bullet points).",
      "Click Save context."
    ],
    ["entity.engagement", "entity.customer", "entity.driver", "driver.cyber_resilience"],
    "engagement.customer + engagement.drivers populated; the Reporting tab now has narrative anchors."),

  W("workflow.add_environment",
    "Add an environment to the canvas",
    "Declare a physical/logical location where workloads + assets live.",
    "Context tab → Environments section",
    [
      "Open the Context tab → scroll to the Environments section.",
      "Click + Add environment.",
      "Pick the env kind from the catalog (coreDc / drDc / edge / publicCloud / sovereignCloud / coLo / managedHosting / archiveSite).",
      "Set alias (e.g., 'Riyadh Core DC'), location, sizeKw, sqm, tier — these are presentation labels the chat assistant uses instead of UUIDs."
    ],
    ["entity.environment", "env.coreDc", "env.drDc", "env.publicCloud", "env.sovereignCloud"],
    "engagement.environments has a new entry; instances + gaps can now reference this env."),

  W("workflow.document_current_state",
    "Document the customer's current state",
    "Capture what infrastructure + workloads exist today, layer by layer.",
    "Current state tab",
    [
      "Open the Current state tab.",
      "For each environment, add instances per layer: workload (the apps), compute, storage, dataProtection, virtualization, infrastructure.",
      "Per instance: pick layer + env, set label (human-readable), vendor + vendorGroup (dell / nonDell / custom), criticality (High / Medium / Low), disposition (keep / enhance / replace / consolidate / retire).",
      "Workloads (layerId='workload') get mappedAssetIds — pick the compute / storage / dataProtection instances this workload consumes (possibly across environments)."
    ],
    ["instance_state.current", "layer.workload", "layer.compute", "layer.storage", "layer.dataProtection", "vendor_group.dell", "vendor_group.nonDell", "relationship.mappedAssetIds", "disposition.keep", "disposition.replace"],
    "engagement.instances.byState.current populated; Reporting → Vendor mix becomes meaningful."),

  W("workflow.document_desired_state",
    "Document the target / desired state",
    "Capture what the customer needs after the engagement — including 1-for-1 replacements and N→1 consolidations.",
    "Desired state tab",
    [
      "Open the Desired state tab.",
      "For each layer where change is needed, add desired instances.",
      "Per desired instance: pick layer + env, label, vendor (typically Dell at this point — PowerEdge R760 / PowerStore / PowerScale / PPDM / APEX), disposition (replace / consolidate / introduce / enhance).",
      "If this desired item REPLACES a current item, set originId pointing to that current instance. If CONSOLIDATES N current items, set originId to the primary one and link the rest via the gap's relatedCurrentInstanceIds[]."
    ],
    ["instance_state.desired", "relationship.originId", "disposition.replace", "disposition.consolidate", "disposition.introduce", "gap_type.replace", "gap_type.consolidate"],
    "engagement.instances.byState.desired populated; the Gaps tab can now show current → desired pairings."),

  W("workflow.identify_gaps",
    "Identify gaps from current vs desired",
    "Translate current → desired deltas into typed gaps the team can scope + sell.",
    "Gaps tab",
    [
      "Open the Gaps tab.",
      "Click + Add gap.",
      "Pick gap_type: replace (1-for-1) / consolidate (N→1) / introduce (net-new) / enhance (in-place) / ops (services-only).",
      "Set urgency (High / Medium / Low), phase (now / next / later), status (default open).",
      "Pick the layer + affected environment(s).",
      "Link the gap to its driver via the driver dropdown (e.g., Cyber Resilience).",
      "If gap_type is replace / consolidate / enhance: link relatedCurrentInstanceIds (what's being changed). If introduce / replace / consolidate: link relatedDesiredInstanceIds (what replaces it)."
    ],
    ["entity.gap", "gap_type.replace", "gap_type.consolidate", "gap_type.introduce", "gap_type.enhance", "gap_type.ops", "urgency.High", "phase.now", "status.open"],
    "engagement.gaps populated; the Gaps Kanban + Vendor Mix delta + Health Summary all surface the new gap."),

  W("workflow.link_gap_to_driver",
    "Link a gap to a strategic driver",
    "Make the driver → gap → solution narrative explicit so executive reporting tells a story.",
    "Gaps tab → driver dropdown on each gap",
    [
      "Open the Gaps tab.",
      "Click the gap you want to attribute.",
      "In the driver dropdown, select the driver this gap serves (e.g., Cyber Resilience for a PPDM replacement).",
      "Save."
    ],
    ["entity.driver", "entity.gap", "driver.cyber_resilience", "driver.ai_data", "driver.compliance_sovereignty"],
    "gap.driverId populated; Reporting → Executive Summary now shows the gap under its driver."),

  W("workflow.map_gap_to_dell_solutions_with_ai",
    "Map a gap to Dell products via the AI assistant",
    "Use the chat assistant or a click-to-run skill to suggest Dell solutions for a gap.",
    "Gaps tab + Canvas Chat (or click 'Use AI' on a gap)",
    [
      "Option A · Conversational: open Canvas Chat. Ask 'For the [gap description] gap, what Dell products would you recommend?' The assistant uses the data contract + concept dictionary to suggest products + cite the driver.",
      "Option B · Skill-driven: click 'Use AI' on a gap and pick the 'Dell mapping' click-to-run skill. The skill resolves {{gap.description}}, {{gap.driverLabel}}, {{gap.layerLabel}} as bindings + returns a structured Dell product list with provenance.",
      "Either way: review the suggestion. The assistant proposes; you decide whether to record it in the gap's aiMappedDellSolutions field."
    ],
    ["entity.gap", "skill.skill", "skill.click_to_run", "driver.cyber_resilience", "driver.ai_data"],
    "gap.aiMappedDellSolutions populated with provenance ({model, promptVersion, runId, timestamp})."),

  W("workflow.generate_executive_summary",
    "Generate the executive summary deliverable",
    "Produce the workshop-output narrative the customer's CXO will read.",
    "Reporting tab → Executive Summary OR Canvas Chat",
    [
      "Option A · Built-in panel: open the Reporting tab → Executive Summary. The panel shows customer + drivers + headline counts + gap highlights + vendor mix summary, ready to copy.",
      "Option B · AI-authored: open Canvas Chat. Ask 'Summarize this engagement for an executive audience in 3 paragraphs.' The assistant uses selectExecutiveSummaryInputs + the engagement snapshot to compose the prose.",
      "Option C · Skill-driven: invoke the seed 'Executive summary' skill (session-wide scope) for a deterministic AI authoring path with provenance."
    ],
    ["entity.engagement", "entity.driver", "entity.gap", "skill.session_wide"],
    "Markdown text suitable for inclusion in a customer-facing deliverable."),

  W("workflow.review_vendor_mix",
    "Show the vendor-mix story to the customer",
    "Surface 'how Dell are we today' vs 'how Dell would we be after the desired state' with concrete numbers.",
    "Reporting tab → Vendor mix",
    [
      "Open the Reporting tab → Vendor mix tile.",
      "Read the global Dell density % (current state).",
      "Drill into per-layer + per-environment breakdown via the KPI tiles (Dell density / Most diverse layer / Top non-Dell concentration).",
      "Switch to the Desired-state view (if implemented) to show the post-engagement Dell density."
    ],
    ["vendor_group.dell", "vendor_group.nonDell", "vendor_group.custom"],
    "Quantified narrative for the customer: 'You're 56% Dell today; this engagement gets you to 95% Dell with 3 vendors retired.'"),

  W("workflow.review_gaps_kanban",
    "Walk the customer through the gap roadmap",
    "Show what's being delivered now / next / later and at what status.",
    "Reporting tab → Gaps Kanban OR Gaps tab",
    [
      "Open the Reporting tab → Gaps Kanban (or the Gaps tab).",
      "Filter by phase (now / next / later) to show the time horizon.",
      "Filter by urgency to focus on High-priority items.",
      "Use the chat assistant for ad-hoc cuts: 'How many High-urgency gaps are open in the data protection layer?'"
    ],
    ["entity.gap", "phase.now", "phase.next", "phase.later", "urgency.High", "status.open"],
    "Customer sees the engagement as a phased roadmap, not just a list of items."),

  W("workflow.save_engagement_to_file",
    "Save the engagement to a .canvas file",
    "Persist the engagement so it can be re-opened later, shared with colleagues, or backed up.",
    "Footer → Save to file",
    [
      "Click Save to file in the footer.",
      "Pick a filename (defaults to the customer name).",
      "The browser downloads the .canvas file (JSON envelope: schema version + engagement + provenance)."
    ],
    ["entity.engagement"],
    ".canvas file downloaded; can be re-opened via Open file or shared as an artifact."),

  W("workflow.open_engagement_from_file",
    "Open a previously-saved .canvas file",
    "Resume work on a prior engagement.",
    "Footer → Open file",
    [
      "Click Open file in the footer.",
      "Pick the .canvas file.",
      "If the file is older than the current schema version, the migrator runs automatically (per SPEC §S9).",
      "The canvas + chat + reporting views all reflect the loaded engagement."
    ],
    ["entity.engagement"],
    "Engagement loaded; chat assistant is grounded in the loaded data."),

  W("workflow.configure_ai_provider",
    "Configure an AI provider",
    "Plug an LLM endpoint into the app so the chat assistant + skills can run.",
    "Settings (gear icon) → Providers section",
    [
      "Click the gear icon top-right.",
      "Pick a provider pill: Local LLM / Anthropic Claude / Google Gemini / Dell Sales Chat.",
      "Fill the endpoint URL (only editable for Local + Dell Sales Chat; the Anthropic + Gemini endpoints are container-proxied and read-only).",
      "Pick a model (Claude opus-4-7 / haiku-4-5 / sonnet-4-5; gemini-2.5-flash; etc.).",
      "Paste an API key (skipped for Local).",
      "Click Test connection to verify the wiring.",
      "Click Save."
    ],
    ["skill.skill"],
    "Active provider configured; the chat header chip flips from 'Configure provider' to 'Connected to <X>'."),

  W("workflow.use_canvas_chat",
    "Use the Canvas Chat assistant",
    "Get answers about the engagement, the data model, the app's concepts, or the workflows — without manually combing through tabs.",
    "Canvas Chat overlay (top-right button)",
    [
      "Open Canvas Chat (top-right).",
      "Ask in natural language. Examples: 'How many High-urgency gaps are open?' / 'Which environments have the most non-Dell instances?' / 'What does the consolidate gap type mean?' / 'How do I link a gap to a driver?'",
      "The assistant uses the data contract + concept dictionary + workflow manifest + analytical tools (selectMatrixView, selectGapsKanban, etc.) to answer.",
      "For deeper concept questions, the assistant calls selectConcept(id) for full body. For procedural questions, selectWorkflow(id) for step-by-step."
    ],
    ["skill.skill", "entity.engagement"],
    "Customer-facing or self-service answers + (when proposing changes) actionable cards that open the relevant tab pre-filled."),

  W("workflow.author_a_skill",
    "Author a custom AI skill",
    "Capture a reusable AI workflow as a Skill so it shows up as a one-click action.",
    "Settings → Skills builder",
    [
      "Open Settings → Skills builder.",
      "Pick a scope: click-to-run (operates on a specific entity — a gap, instance, driver, etc.) OR session-wide (operates on the whole engagement).",
      "If click-to-run: pick the entity kind (gap / instance / driver / environment / project).",
      "Author the prompt template using {{path}} bindings from the chip palette. The chips show the bindable paths the active scope provides.",
      "Click Validate. Save-time validation rejects unknown paths + structural errors.",
      "Test the skill against the active real LLM provider via the run button (Anthropic / Gemini / Local A per Settings → AI Providers).",
      "Click Save. The skill appears in your saved-skills list (eventually surfaced as a card in the chat right-rail)."
    ],
    ["skill.skill", "skill.click_to_run", "skill.session_wide"],
    "Skill saved to localStorage; available as a one-click shortcut from chat or the relevant entity's 'Use AI' button."),

  W("workflow.start_a_new_engagement",
    "Start a new engagement from scratch",
    "Begin a fresh customer workshop without the demo data.",
    "Footer → New session",
    [
      "Click New session in the footer.",
      "Confirm the warning (cannot be undone; save first if there's work to keep).",
      "The canvas resets to empty. Settings + saved skills + AI provider config are preserved.",
      "Start the workshop with workflow.capture_context."
    ],
    ["entity.engagement"],
    "Empty engagement ready for capture.")
];

// ─────────────────────────────────────────────────────────────────────
// RECOMMENDATIONS — regex-trigger → guidance map.
// The LLM scans this when answering "how do I..." or "where is..."
// questions; matching entry surfaces a direct answer + workflow ref.
// ─────────────────────────────────────────────────────────────────────
function R(id, triggers, answer, relatedWorkflowIds, relatedConceptIds) {
  return { id, triggers, answer, relatedWorkflowIds: relatedWorkflowIds || [], relatedConceptIds: relatedConceptIds || [] };
}

export const RECOMMENDATIONS = [

  R("rec.add_gap",
    [/how (do I |to )(?:add|create|make) (?:a )?gap/i, /where (?:do I |to )(?:add|create) gap/i],
    "Open the Gaps tab → click + Add gap. Pick gap_type (replace / consolidate / introduce / enhance / ops), set urgency + phase + layer + affected env(s), and link the driver. See workflow.identify_gaps for the full procedure.",
    ["workflow.identify_gaps"],
    ["entity.gap", "gap_type.replace"]),

  R("rec.link_gap_to_driver",
    [/how (?:do I |to )?link (?:a )?gap.*driver/i, /attribute gap.*driver/i, /connect gap.*driver/i],
    "Open the Gaps tab → click the gap → pick the driver from the dropdown. The driver attribution surfaces in the Reporting → Executive Summary view. See workflow.link_gap_to_driver.",
    ["workflow.link_gap_to_driver"],
    ["entity.driver", "entity.gap"]),

  R("rec.gap_type_decision",
    [/which gap (?:_)?type/i, /what gap (?:_)?type.*pick/i, /(?:replace|consolidate|introduce) vs/i],
    "Decision tree: 1-for-1 swap (single old → single new) → 'replace'. N→1 merge (multiple legacy → single new, vendor reduction) → 'consolidate'. Net-new capability with no current predecessor → 'introduce'. Upgrade an existing item in place (no new asset) → 'enhance'. Pure services / runbook / training (no asset change) → 'ops'. Each gap_type has a full body via selectConcept('gap_type.<X>').",
    ["workflow.identify_gaps"],
    ["gap_type.replace", "gap_type.consolidate", "gap_type.introduce", "gap_type.enhance", "gap_type.ops"]),

  R("rec.current_vs_desired",
    [/(?:difference|differ).*current.*desired/i, /current vs desired/i, /what.*current state/i, /what.*desired state/i],
    "'Current state' is what exists today (Tab 'Current state'). 'Desired state' is the target after the engagement (Tab 'Desired state'). Desired instances can carry an originId linking to their current predecessor — that's how the app expresses 'this PowerStore replaces this Unity'. Gaps are the typed bridges between the two.",
    ["workflow.document_current_state", "workflow.document_desired_state"],
    ["instance_state.current", "instance_state.desired", "relationship.originId"]),

  R("rec.workload_vs_compute",
    [/workload vs compute/i, /workload.*not compute/i, /difference.*workload.*compute/i],
    "A workload (layerId='workload') is the customer's BUSINESS APP (e.g., EMR, PACS, Patient Portal). Compute (layerId='compute') is the underlying servers/HCI/cloud-compute the workload runs on. Workloads carry mappedAssetIds linking to the specific compute/storage/dataProtection instances they consume — possibly cross-environment.",
    ["workflow.document_current_state"],
    ["layer.workload", "layer.compute", "relationship.workload", "relationship.mappedAssetIds"]),

  R("rec.configure_ai",
    [/how (?:do I |to )?(?:configure|set up|setup|add).*(?:AI|provider|API key|claude|gemini|openai)/i, /where.*api key/i, /provider settings/i],
    "Click the gear icon top-right → Providers section. Pick a provider pill (Local / Anthropic / Gemini / Dell Sales Chat), fill model + API key, click Test connection, then Save. The chat header chip will flip from 'Configure provider' (amber) to 'Connected to <provider>' (green). See workflow.configure_ai_provider.",
    ["workflow.configure_ai_provider"],
    []),

  R("rec.save_or_load",
    [/how (?:do I |to )?(?:save|export|download)/i, /how (?:do I |to )?(?:open|load|import).*\.canvas/i],
    "Save: footer → Save to file (downloads a .canvas JSON envelope). Open: footer → Open file (older files auto-migrate via the SPEC §S9 migrator). See workflow.save_engagement_to_file + workflow.open_engagement_from_file.",
    ["workflow.save_engagement_to_file", "workflow.open_engagement_from_file"],
    ["entity.engagement"]),

  R("rec.start_fresh",
    [/start (?:over|fresh|new)/i, /clear (?:everything|the canvas|all)/i, /new session/i],
    "Footer → New session. Confirms before clearing (cannot be undone). Save your work first if you want to keep it. AI provider config + saved skills are preserved.",
    ["workflow.start_a_new_engagement"],
    ["entity.engagement"]),

  R("rec.run_dell_mapping",
    [/(?:dell mapping|map.*dell|recommend dell)/i, /which dell.*for.*gap/i],
    "Two paths: (1) ask the chat assistant directly — 'For the [gap] gap, what Dell products would you recommend?' — the assistant cites the driver + uses the dataContract's DELL_PRODUCT_TAXONOMY catalog; (2) click-to-run the seed 'Dell mapping' skill on a gap (Use AI button on the gap → pick Dell mapping). See workflow.map_gap_to_dell_solutions_with_ai.",
    ["workflow.map_gap_to_dell_solutions_with_ai"],
    ["entity.gap", "skill.click_to_run"]),

  R("rec.executive_summary",
    [/(?:executive|customer-facing) summary/i, /summary.*executive/i, /generate.*report/i],
    "Three options: (1) Reporting tab → Executive Summary panel (built-in deterministic narrative); (2) ask Canvas Chat 'Summarize this engagement for an executive audience'; (3) invoke the 'Executive summary' seed skill (session-wide). See workflow.generate_executive_summary.",
    ["workflow.generate_executive_summary"],
    ["entity.engagement", "skill.session_wide"]),

  R("rec.vendor_mix",
    [/(?:dell density|vendor mix|how dell are we)/i, /(?:non.?dell|3rd.?party).*footprint/i],
    "Reporting tab → Vendor mix shows the 'how Dell are we' story with global + per-layer + per-environment breakdowns. Or ask Canvas Chat 'What's our Dell density?' / 'Which environments have the most non-Dell instances?' — multi-round tool chaining lets the assistant cross-reference matrix view + vendor mix automatically.",
    ["workflow.review_vendor_mix"],
    ["vendor_group.dell", "vendor_group.nonDell"]),

  R("rec.gap_phasing",
    [/(?:roadmap|phase|now.*next.*later)/i, /what.*delivery.*timeline/i, /gap.*kanban/i],
    "Reporting tab → Gaps Kanban groups gaps by phase (now / next / later) and status. Or ask Canvas Chat 'Show me the gap roadmap' / 'What's in the now phase?'. See workflow.review_gaps_kanban.",
    ["workflow.review_gaps_kanban"],
    ["entity.gap", "phase.now", "phase.next", "phase.later"]),

  R("rec.author_skill",
    [/(?:author|create|build).*(?:skill|agent)/i, /skill builder/i, /(?:reusable|custom) (?:AI |LLM )?(?:prompt|workflow)/i],
    "Settings → Skills builder. Pick scope (click-to-run for entity-specific, session-wide for engagement-level). Author the prompt template using {{path}} bindings from the chip palette. Validate + test against the active real LLM provider. Save → it shows up as a one-click shortcut in the chat right-rail. See workflow.author_a_skill.",
    ["workflow.author_a_skill"],
    ["skill.skill", "skill.click_to_run", "skill.session_wide"]),

  R("rec.cross_env_workload",
    [/workload.*spread.*environment/i, /cross.environment/i, /mappedAssetIds/i],
    "A workload's mappedAssetIds[] can reference compute/storage/dataProtection instances in DIFFERENT environments — e.g., the EMR workload at Riyadh Core DC has mappedAssetIds pointing to compute in Riyadh + DR compute in Jeddah + a cloud component. The Workload Mapping view + selectLinkedComposition tool surface this cross-cut.",
    ["workflow.document_current_state"],
    ["layer.workload", "relationship.workload", "relationship.mappedAssetIds"]),

  R("rec.ransomware_compliance",
    [/(?:ransomware|cyber.?recovery|NIS2|DORA|NIST CSF)/i, /immutable.*backup/i, /air.gap/i],
    "Cyber resilience driver covers this. Typical Dell solution: PowerProtect Data Manager + PowerProtect Cyber Recovery vault + CyberSense ML detection + PowerProtect DD storage tier. The vault is air-gapped + immutable; CyberSense scans backup streams for ransomware indicators. See driver.cyber_resilience for the full body via selectConcept.",
    ["workflow.identify_gaps", "workflow.map_gap_to_dell_solutions_with_ai"],
    ["driver.cyber_resilience"]),

  R("rec.ai_modernization",
    [/(?:AI modernization|AI infra|AI platform|GPU compute|inference)/i, /modern.*data/i],
    "AI & Data driver covers this. Typical Dell solution: PowerScale F710 (NVMe scale-out unstructured tier — AI inference data path), PowerEdge XE9680 (8x H100 GPU compute), Dell AI Factory (curated stack), CloudIQ + APEX AIOps. See driver.ai_data for the full body via selectConcept.",
    ["workflow.identify_gaps", "workflow.map_gap_to_dell_solutions_with_ai"],
    ["driver.ai_data"]),

  R("rec.sovereign_cloud",
    [/(?:sovereign|PDNS|data residency|residency)/i, /(?:UAE|KSA|EU).*cloud/i],
    "Compliance & Sovereignty driver covers this. Typical Dell solution: APEX Cloud Services on the sovereign cloud landing zone (me-central-1 / EU PDNS), PowerProtect Cyber Recovery vault for sovereign-region backups, immutable archive tier. See driver.compliance_sovereignty for the full body.",
    ["workflow.identify_gaps", "workflow.map_gap_to_dell_solutions_with_ai"],
    ["driver.compliance_sovereignty", "env.sovereignCloud"]),

  R("rec.replace_old_kit",
    [/(?:end.of.warranty|EOL|aging|legacy|refresh)/i, /replace.*old/i],
    "Modernize Aging Infrastructure driver. Typical Dell solution: PowerEdge R760 (refresh from R740 + Cisco UCS — vendor reduction + power savings), PowerStore (Unity refresh), PowerScale (NetApp refresh), VxRail (HCI refresh).",
    ["workflow.identify_gaps", "workflow.document_desired_state"],
    ["driver.modernize_infra", "gap_type.replace", "gap_type.consolidate"]),

  R("rec.executive_audience",
    [/(?:CXO|CEO|CTO|CIO|executive).*(?:talk|present|meeting)/i, /board (?:slide|deck)/i],
    "For executive-audience output: (1) the Reporting tab's Executive Summary is a clean copy-paste source; (2) ask Canvas Chat 'Summarize this engagement for an executive audience in 3 paragraphs.' Tip: drivers are the narrative anchor — start every executive summary with the 1-3 strategic outcomes.",
    ["workflow.generate_executive_summary"],
    ["entity.engagement", "entity.driver"])
];

// ─────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────

const _W_BY_ID = {};
WORKFLOWS.forEach(function(w) { _W_BY_ID[w.id] = w; });

const _R_BY_ID = {};
RECOMMENDATIONS.forEach(function(r) { _R_BY_ID[r.id] = r; });

// Single workflow by id, or null.
export function getWorkflow(id) {
  return _W_BY_ID[id] || null;
}

// TOC: [{id, name, intent, app_surface}]. Intent is the cheap inline
// form; the full body is fetched via selectWorkflow.
export function getWorkflowTOC() {
  return WORKFLOWS.map(function(w) {
    return { id: w.id, name: w.name, intent: w.intent, app_surface: w.appSurface };
  });
}

// All recommendations as a small inline table. Triggers are kept as
// stringified regex source so they're inlineable.
export function getRecommendationsTable() {
  return RECOMMENDATIONS.map(function(r) {
    return {
      id: r.id,
      triggers: r.triggers.map(function(re) { return re.source; }),
      answer: r.answer,
      relatedWorkflowIds: r.relatedWorkflowIds,
      relatedConceptIds: r.relatedConceptIds
    };
  });
}

// Match a user question against the recommendation regexes; return the
// first matching entry, or null if none match.
export function matchRecommendation(question) {
  if (typeof question !== "string" || question.length === 0) return null;
  for (var i = 0; i < RECOMMENDATIONS.length; i++) {
    var r = RECOMMENDATIONS[i];
    for (var j = 0; j < r.triggers.length; j++) {
      if (r.triggers[j].test(question)) return r;
    }
  }
  return null;
}
