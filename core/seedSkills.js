// core/seedSkills.js
//
// Pre-built AI skill library. Provides a working example skill for every
// tab so the "Use AI" dropdown has something to run on day one.
//
// Each skill targets one tab. Skills with a non-empty outputSchema use the
// json-scalars response format: the AI returns a strict JSON object and the
// UI renders an Apply/Skip row per field (applyPolicy = "confirm-per-field").
// Every declared outputSchema path must be a writable field.

function now() { return new Date().toISOString(); }

// Context tab: suggest discovery questions for the selected driver.
var DRIVER_QUESTIONS_SKILL = {
  id:           "skill-driver-questions-seed",
  name:         "Suggest discovery questions",
  description:  "Generate 3 tailored customer-discovery questions for the selected strategic driver.",
  tabId:        "context",
  systemPrompt: "You are a senior Dell Technologies presales engineer. Suggest 3 short, open-ended discovery questions a presales would ask in a 30-45 minute workshop. Each question should be 1-2 sentences.",
  promptTemplate: [
    "Customer name: {{session.customer.name}}.",
    "Customer vertical: {{session.customer.vertical}}.",
    "Strategic driver: {{context.selectedDriver.label}}.",
    "Driver hint: {{context.selectedDriver.shortHint}}.",
    "Driver priority for this customer: {{context.selectedDriver.priority}}."
  ].join("\n"),
  responseFormat: "text-brief",
  applyPolicy:    "show-only",
  outputSchema:   [],
  providerKey:    null,
  deployed:       true,
  seed:           true
};

// Context tab: writes the driver's priority + outcomes fields.
var DRIVER_TUNER_SKILL = {
  id:           "skill-context-driver-tuner-seed",
  name:         "Tune selected driver (priority + outcomes)",
  description:  "Propose a priority and a concise outcomes bullet list for the selected driver, grounded in the customer's vertical.",
  tabId:        "context",
  systemPrompt: "You are a senior Dell Technologies presales engineer. Propose a priority (High/Medium/Low) and a concise outcomes block (2-3 bullet points, each one line) for the selected strategic driver based on the customer vertical and named outcomes. Be specific and measurable; avoid generic consultancy language.",
  promptTemplate: [
    "Customer: {{session.customer.name}} ({{session.customer.vertical}}, {{session.customer.region}}).",
    "Selected driver: {{context.selectedDriver.label}}.",
    "Current priority: {{context.selectedDriver.priority}}.",
    "Current outcomes: {{context.selectedDriver.outcomes}}.",
    "Driver hint: {{context.selectedDriver.shortHint}}."
  ].join("\n"),
  responseFormat: "json-scalars",
  applyPolicy:    "confirm-per-field",
  outputSchema: [
    { path: "context.selectedDriver.priority", label: "Driver priority", kind: "scalar" },
    { path: "context.selectedDriver.outcomes", label: "Driver outcomes", kind: "scalar" }
  ],
  providerKey:    null,
  deployed:       true,
  seed:           true
};

// Current-state tab: writes the selected tile's criticality + notes.
var CURRENT_TILE_TUNER_SKILL = {
  id:           "skill-current-tile-tuner-seed",
  name:         "Review selected tile (criticality + notes)",
  description:  "Propose a criticality level and a terse ops-ready note for the selected current-state tile.",
  tabId:        "current",
  systemPrompt: "You are a senior Dell Technologies presales engineer. For the selected current-state component, propose a criticality (High/Medium/Low) grounded in the customer's vertical and drivers, and a short single-line note (<=140 characters) capturing the top operational risk or observation. Do not restate the vendor or layer.",
  promptTemplate: [
    "Customer: {{session.customer.name}} ({{session.customer.vertical}}).",
    "Drivers: {{session.customer.drivers}}.",
    "Tile: {{context.selectedInstance.label}} · vendor={{context.selectedInstance.vendor}} · layer={{context.selectedInstance.layerId}} · env={{context.selectedInstance.environmentId}}.",
    "Current criticality: {{context.selectedInstance.criticality}}.",
    "Current notes: {{context.selectedInstance.notes}}."
  ].join("\n"),
  responseFormat: "json-scalars",
  applyPolicy:    "confirm-per-field",
  outputSchema: [
    { path: "context.selectedInstance.criticality", label: "Tile criticality", kind: "scalar" },
    { path: "context.selectedInstance.notes",       label: "Tile notes",       kind: "scalar" }
  ],
  providerKey:    null,
  deployed:       true,
  seed:           true
};

// Desired-state tab: writes the selected tile's disposition + phase + notes.
var DESIRED_TILE_TUNER_SKILL = {
  id:           "skill-desired-tile-tuner-seed",
  name:         "Shape desired disposition (action + phase + note)",
  description:  "Propose a disposition, a phase (Now/Next/Later), and a short note for the selected desired-state tile.",
  tabId:        "desired",
  systemPrompt: "You are a senior Dell Technologies presales engineer. For the selected desired-state tile, propose an Action (one of: keep, enhance, replace, consolidate, retire, introduce, ops), a phase (Now/Next/Later), and a short single-line note (<=140 characters) that justifies the Action. Align with the customer's top drivers.",
  promptTemplate: [
    "Customer: {{session.customer.name}} ({{session.customer.vertical}}).",
    "Drivers: {{session.customer.drivers}}.",
    "Desired tile: {{context.selectedInstance.label}} · vendor={{context.selectedInstance.vendor}} · layer={{context.selectedInstance.layerId}} · env={{context.selectedInstance.environmentId}}.",
    "Current disposition: {{context.selectedInstance.disposition}}.",
    "Current phase: {{context.selectedInstance.priority}}.",
    "Current notes: {{context.selectedInstance.notes}}.",
    "Origin current tile id: {{context.selectedInstance.originId}}."
  ].join("\n"),
  responseFormat: "json-scalars",
  applyPolicy:    "confirm-per-field",
  outputSchema: [
    { path: "context.selectedInstance.disposition", label: "Tile disposition", kind: "scalar" },
    { path: "context.selectedInstance.priority",    label: "Tile phase (Now/Next/Later)", kind: "scalar" },
    { path: "context.selectedInstance.notes",       label: "Tile notes",       kind: "scalar" }
  ],
  providerKey:    null,
  deployed:       true,
  seed:           true
};

// Gaps tab: rewrites the selected gap's description + urgency + notes.
var GAP_REWRITER_SKILL = {
  id:           "skill-gap-rewriter-seed",
  name:         "Rewrite selected gap (description + urgency + note)",
  description:  "Rewrite the selected gap's description in CxO language, re-classify urgency if warranted, and propose a one-line rationale note.",
  tabId:        "gaps",
  systemPrompt: "You are a senior Dell Technologies presales engineer. Rewrite the selected gap in CxO-friendly language (one sentence, <=24 words, names the business impact , not the technology). Re-classify urgency (High/Medium/Low) based on the customer's top drivers and outcomes. Propose a concise rationale note (<=140 characters).",
  promptTemplate: [
    "Customer: {{session.customer.name}} ({{session.customer.vertical}}).",
    "Drivers: {{session.customer.drivers}}.",
    "Gap description: {{context.selectedGap.description}}.",
    "Gap type: {{context.selectedGap.gapType}}.",
    "Gap urgency: {{context.selectedGap.urgency}}.",
    "Gap phase: {{context.selectedGap.phase}}.",
    "Gap notes: {{context.selectedGap.notes}}.",
    "Gap primary layer: {{context.selectedGap.layerId}}."
  ].join("\n"),
  responseFormat: "json-scalars",
  applyPolicy:    "confirm-per-field",
  outputSchema: [
    { path: "context.selectedGap.description", label: "Gap description", kind: "scalar" },
    { path: "context.selectedGap.urgency",     label: "Gap urgency",     kind: "scalar" },
    { path: "context.selectedGap.notes",       label: "Gap notes",       kind: "scalar" }
  ],
  providerKey:    null,
  deployed:       true,
  seed:           true
};

// Gaps tab: suggests a set of professional-services ids for the selected
// gap. The AI returns a comma-separated list drawn from the SERVICE_TYPES
// catalog; the write resolver normalizes it (drops unknown ids, dedupes).
var GAP_SERVICES_SUGGESTER_SKILL = {
  id:           "skill-gap-services-suggester-seed",
  name:         "Suggest professional services for selected gap",
  description:  "Recommend the professional-services scope (migration / deployment / training / runbook / …) implied by the selected gap, based on its gapType, layer, and business context.",
  tabId:        "gaps",
  systemPrompt: "You are a senior Dell Technologies presales engineer specialising in services scoping. Based on the selected gap, propose the minimal set of professional-services categories needed to deliver it. Choose ONLY from this fixed catalog: assessment, migration, deployment, integration, training, knowledge_transfer, runbook, managed, decommissioning, custom_dev. Return your answer as a comma-separated list (e.g. \"migration, deployment, training\"). Do not invent new categories.",
  promptTemplate: [
    "Customer: {{session.customer.name}} ({{session.customer.vertical}}).",
    "Gap description: {{context.selectedGap.description}}.",
    "Gap type: {{context.selectedGap.gapType}}.",
    "Gap primary layer: {{context.selectedGap.layerId}}.",
    "Gap notes: {{context.selectedGap.notes}}.",
    "Currently selected services on this gap: {{context.selectedGap.services}}."
  ].join("\n"),
  responseFormat: "json-scalars",
  applyPolicy:    "confirm-per-field",
  outputSchema: [
    { path: "context.selectedGap.services", label: "Gap services", kind: "array" }
  ],
  providerKey:    null,
  deployed:       true,
  seed:           true
};

// Reporting tab: narrates the selected project. Show-only (no writable
// fields on this tab), so it renders its result without an Apply row.
var REPORTING_NARRATOR_SKILL = {
  id:           "skill-reporting-narrator-seed",
  name:         "Narrate selected project",
  description:  "Turn the selected roadmap project into a 3-bullet CxO-ready narrative.",
  tabId:        "reporting",
  systemPrompt: "You are a senior Dell Technologies presales engineer. Produce a 3-bullet CxO narrative for the selected project: (1) the business problem in one line, (2) the Dell-anchored proposed move, (3) the measurable outcome and timeline. Assume the reader has 30 seconds.",
  promptTemplate: [
    "Customer: {{session.customer.name}} ({{session.customer.vertical}}).",
    "Drivers: {{session.customer.drivers}}.",
    "Project: {{context.selectedProject.name}} · gaps={{context.selectedProject.gapCount}} · urgency={{context.selectedProject.urgency}} · phase={{context.selectedProject.phase}}.",
    "Dell solutions in scope: {{context.selectedProject.dellSolutions}}."
  ].join("\n"),
  responseFormat: "text-brief",
  applyPolicy:    "show-only",
  outputSchema:   [],
  providerKey:    null,
  deployed:       true,
  seed:           true
};

// Returns a fresh array each call so callers don't share mutable state.
export function seedSkills() {
  var t = now();
  return [
    DRIVER_QUESTIONS_SKILL,
    DRIVER_TUNER_SKILL,
    CURRENT_TILE_TUNER_SKILL,
    DESIRED_TILE_TUNER_SKILL,
    GAP_REWRITER_SKILL,
    GAP_SERVICES_SUGGESTER_SKILL,
    REPORTING_NARRATOR_SKILL
  ].map(function(s) {
    return Object.assign({}, s, { createdAt: t, updatedAt: t });
  });
}

// The ids of every seed skill above, in the same order.
export var SEED_SKILL_IDS = [
  "skill-driver-questions-seed",
  "skill-context-driver-tuner-seed",
  "skill-current-tile-tuner-seed",
  "skill-desired-tile-tuner-seed",
  "skill-gap-rewriter-seed",
  "skill-gap-services-suggester-seed",
  "skill-reporting-narrator-seed"
];
