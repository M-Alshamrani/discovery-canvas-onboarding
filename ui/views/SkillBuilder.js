// ui/views/SkillBuilder.js — Skills authoring surface (Settings → Skills).
//
// The edit form has these fields, each tagged with a data-* attribute:
//   1. Label                    [data-skill-label]            <input text>
//   2. Description              [data-skill-description]      <input text>
//   3. Seed prompt              [data-skill-seed]             <textarea>
//   4. Data points              [data-skill-data-points]      selector + toggle
//      Standard/Insights/Advanced [data-skill-data-toggle]   pills
//   5. Improved prompt          [data-skill-improved]         <textarea readonly>
//      Improve / Edit / Re-improve [data-skill-improve*]      buttons
//   6. Parameters[]             rows of {name, type, desc, required, accepts}
//   7. Output format            [data-skill-output-format]    4 radios
//                               (text / dimensional / json-array / scalar)
//   8. Mutation policy          [data-skill-mutation-policy]  2 radios
//                               (ask / auto-tag) — shown only when
//                               outputFormat ∈ {json-array, scalar}
//
// Improve folds the seed prompt + selected data points into a
// CARE-structured prompt via a real LLM call (chatCompletion); on failure
// it shows an inline error chip + Retry. Save persists through
// v3SkillStore. Test runs the draft's improved prompt through the active
// provider.

import {
  saveV3Skill, loadV3Skills, loadV3SkillById, deleteV3Skill
}                                          from "../../state/v3SkillStore.js";
import { generateManifest }                from "../../services/manifestGenerator.js";
import { loadAiConfig }                    from "../../core/aiConfig.js";
import { chatCompletion }                  from "../../services/aiService.js";
import {
  getStandardMutableDataPoints,
  getAllMutableDataPoints,
  PICKER_METADATA,
  getPickerEntries,
  INSIGHTS_PATHS,
  RELATIONSHIPS_METADATA,
  getMandatorySetFor
}                                          from "../../core/dataContract.js";
import { resolveTemplate }                 from "../../services/pathResolver.js";
import { getActiveEngagement }             from "../../state/engagementStore.js";
import { _buildSkillRunCtx }               from "./CanvasChatOverlay.js";

// Output-format options offered in the form.
const OUTPUT_FORMATS = [
  { id: "text",        label: "Text reporting",           hint: "Free-form prose into a chat bubble." },
  { id: "dimensional", label: "Dimensional report",       hint: "Rows × columns into a heatmap / matrix (renderer stub at MVP)." },
  { id: "json-array",  label: "JSON-array mutation",      hint: "List of changes the engagement applies." },
  { id: "scalar",      label: "Scalar mutation",          hint: "Single-value mutation of one data point." }
];

// Mutation-policy options, shown only for mutating output formats.
const MUTATION_POLICIES = [
  { id: "ask",      label: "Always ask before mutate", hint: "Approval modal lists every change before commit." },
  { id: "auto-tag", label: "Mutate directly + tag as AI", hint: "Apply immediately + 'Done by AI' badge for review." }
];

// Parameter types a skill author can choose for a run-time input.
const PARAMETER_TYPES = [
  { id: "string",   label: "string" },
  { id: "number",   label: "number" },
  { id: "boolean",  label: "boolean" },
  { id: "entityId", label: "entityId (gap / driver / instance / environment)" },
  { id: "file",     label: "file (uploaded at run-time)" }
];

// ─── Public entry ────────────────────────────────────────────────────

export function renderSkillBuilder(container, onChange) {
  container.innerHTML = "";
  var root = mk("div", "skill-admin");

  var header = mk("div", "skill-admin-header");
  var title  = mkt("div", "skill-admin-title", "Skills builder");
  var addBtn = mkt("button", "btn-primary", "+ New skill");
  addBtn.addEventListener("click", function() {
    renderEditForm(root, list, null /* new skill */, onChange);
  });
  header.appendChild(title);
  header.appendChild(addBtn);
  root.appendChild(header);

  root.appendChild(mkt("div", "settings-help",
    "Author skills as Seed prompt + Data points; click Improve to fold them " +
    "into a CARE-structured prompt via the active LLM. Pick output format + " +
    "mutation policy. Save here; users run skills from Canvas Chat → Skills tab."));

  var list = mk("div", "skill-admin-list");
  renderList(list, onChange);
  root.appendChild(list);

  container.appendChild(root);

  // Auto-mount a new-skill draft form so the authoring surface is visible
  // on first open, even before any skill exists.
  renderEditForm(root, list, null, onChange);
}

// ─── List rendering ─────────────────────────────────────────────────

function renderList(list, onChange) {
  list.innerHTML = "";
  // loadV3Skills() returns an object map { skillId: skill }, not an array.
  // Convert to array for iteration.
  var skills = [];
  try { skills = Object.values(loadV3Skills() || {}); } catch (_e) { skills = []; }
  if (skills.length === 0) {
    list.appendChild(mkt("div", "settings-help-inline",
      "No skills yet — author your first below, then click Save."));
    return;
  }
  list.appendChild(mkt("div", "skill-admin-list-head", "Saved skills (" + skills.length + ")"));
  skills.forEach(function(s) {
    list.appendChild(renderRow(s, list, onChange));
  });
}

function renderRow(skill, list, onChange) {
  var row = mk("div", "skill-admin-row");
  var info = mk("div", "skill-admin-row-info");
  info.appendChild(mkt("div", "skill-admin-row-label", skill.label || skill.skillId));
  if (skill.description) info.appendChild(mkt("div", "skill-admin-row-desc", skill.description));
  var meta = mk("div", "skill-admin-row-meta");
  if (skill.outputFormat) meta.appendChild(mkt("span", "tag", skill.outputFormat));
  if (skill.mutationPolicy) meta.appendChild(mkt("span", "tag", "policy: " + skill.mutationPolicy));
  if (Array.isArray(skill.parameters) && skill.parameters.length > 0) {
    meta.appendChild(mkt("span", "tag", skill.parameters.length + " param(s)"));
  }
  info.appendChild(meta);

  var actions = mk("div", "skill-admin-row-actions");
  var editBtn = mkt("button", "btn-secondary", "Edit");
  editBtn.addEventListener("click", function() {
    var fresh = loadV3SkillById(skill.skillId) || skill;
    var adminRoot = list.parentElement;
    if (adminRoot) renderEditForm(adminRoot, list, fresh, onChange);
  });
  var delBtn = mkt("button", "btn-danger", "Delete");
  delBtn.addEventListener("click", function() {
    if (!confirm("Delete skill '" + (skill.label || skill.skillId) + "'? This cannot be undone.")) return;
    try { deleteV3Skill(skill.skillId); } catch (_e) {}
    renderList(list, onChange);
    if (onChange) onChange();
  });
  actions.appendChild(editBtn);
  actions.appendChild(delBtn);

  row.appendChild(info);
  row.appendChild(actions);
  return row;
}

// ─── Edit form ──────────────────────────────────────────────────────

function renderEditForm(adminRoot, list, existing, onChange) {
  var old = adminRoot.querySelector(".skill-form");
  if (old) old.remove();

  var form = mk("div", "skill-form");
  form.appendChild(mkt("div", "skill-form-title",
    existing ? ("Edit skill: " + (existing.label || existing.skillId)) : "Author new skill"));

  // ─── Field 1 · Label ────────────────────────────────────────────
  var labelGroup = mk("div", "skill-form-field");
  labelGroup.appendChild(mkt("label", "skill-form-label", "Label *"));
  labelGroup.appendChild(mkt("div", "settings-help-inline",
    "Short user-visible name shown in the Skills launcher tab."));
  var labelInput = mk("input", "settings-input");
  labelInput.type = "text";
  labelInput.value = existing && existing.label ? existing.label : "";
  labelInput.placeholder = "e.g. Trace environment to drivers";
  labelInput.setAttribute("data-skill-label", "");
  labelGroup.appendChild(labelInput);
  form.appendChild(labelGroup);

  // ─── Field 2 · Description ──────────────────────────────────────
  var descGroup = mk("div", "skill-form-field");
  descGroup.appendChild(mkt("label", "skill-form-label", "Description *"));
  descGroup.appendChild(mkt("div", "settings-help-inline",
    "One-line summary shown in the launcher's description-confirm before run."));
  var descInput = mk("input", "settings-input");
  descInput.type = "text";
  descInput.value = existing && existing.description ? existing.description : "";
  descInput.placeholder = "e.g. For one environment, trace each instance back to its strategic driver via gaps.";
  descInput.setAttribute("data-skill-description", "");
  descGroup.appendChild(descInput);
  form.appendChild(descGroup);

  // ─── Field 3 · Seed prompt ──────────────────────────────────────
  var seedGroup = mk("div", "skill-form-field");
  seedGroup.appendChild(mkt("label", "skill-form-label", "Seed prompt *"));
  seedGroup.appendChild(mkt("div", "settings-help-inline",
    "Your raw idea in plain English. The Improve button folds this with " +
    "the selected data points into a CARE-structured Anthropic-XML prompt."));
  var seedArea = mk("textarea", "settings-input skills-builder-textarea");
  seedArea.rows = 4;
  seedArea.value = existing && existing.seedPrompt ? existing.seedPrompt : "";
  seedArea.placeholder = "e.g. Summarize the gaps under cyber resilience as 3-5 exec bullets ordered by urgency.";
  seedArea.setAttribute("data-skill-seed", "");
  seedGroup.appendChild(seedArea);
  form.appendChild(seedGroup);

  // ─── Field 4 · Data points (two-pane picker) ────────────────────
  // Left list grouped by category + entity; the right pane shows the
  // selected datapoint's label, description, type, live sample value, and
  // Add-to-skill affordance. Sourced from core/dataContract.js
  // PICKER_METADATA.
  var dataGroup = mk("div", "skill-form-field");
  dataGroup.appendChild(mkt("label", "skill-form-label", "Data points"));
  dataGroup.appendChild(mkt("div", "settings-help-inline",
    "Pick from Standard (canvas-authored fields), Insights (derived counts + " +
    "scores from Tab 5), or Advanced (raw FK ids + workflow metadata). Click " +
    "any row to preview its meaning + a live sample on the right; press [+] to add."));

  // Standard / Insights / Advanced toggle.
  var toggleWrap = mk("div", "skill-form-data-toggle");
  toggleWrap.style.display = "flex";
  toggleWrap.style.gap = "6px";
  toggleWrap.style.marginBottom = "8px";
  var toggleStdBtn = mkt("button", "btn-secondary skill-form-data-toggle-btn is-active", "Standard");
  toggleStdBtn.type = "button";
  toggleStdBtn.setAttribute("data-skill-data-toggle", "standard");
  var toggleInsBtn = mkt("button", "btn-secondary skill-form-data-toggle-btn", "Insights");
  toggleInsBtn.type = "button";
  toggleInsBtn.setAttribute("data-skill-data-toggle", "insights");
  var toggleAdvBtn = mkt("button", "btn-secondary skill-form-data-toggle-btn", "Advanced");
  toggleAdvBtn.type = "button";
  toggleAdvBtn.setAttribute("data-skill-data-toggle", "advanced");
  toggleWrap.appendChild(toggleStdBtn);
  toggleWrap.appendChild(toggleInsBtn);
  toggleWrap.appendChild(toggleAdvBtn);
  dataGroup.appendChild(toggleWrap);

  // Search input.
  var searchInput = mk("input", "settings-input skill-form-data-search");
  searchInput.type = "text";
  searchInput.placeholder = "Filter by path or label…";
  searchInput.setAttribute("data-skill-data-search", "");
  searchInput.style.marginBottom = "8px";
  dataGroup.appendChild(searchInput);

  // Two-pane shell.
  var dataSelector = mk("div", "skill-form-data-points");
  dataSelector.setAttribute("data-skill-data-points", "");
  dataSelector.style.display = "grid";
  dataSelector.style.gridTemplateColumns = "minmax(0, 1fr) minmax(0, 1.2fr)";
  dataSelector.style.gap = "12px";
  dataSelector.style.border = "1px solid var(--ink-border, #e5e7eb)";
  dataSelector.style.borderRadius = "6px";
  dataSelector.style.overflow = "hidden";
  dataSelector.style.minHeight = "340px";

  var dataLeftPane = mk("div", "skill-form-data-left");
  dataLeftPane.style.borderRight = "1px solid var(--ink-border, #e5e7eb)";
  dataLeftPane.style.overflow = "auto";
  dataLeftPane.style.maxHeight = "440px";
  dataLeftPane.style.padding = "8px 0";

  var dataRightPane = mk("div", "skill-form-data-right");
  dataRightPane.style.padding = "12px 14px";
  dataRightPane.style.overflow = "auto";
  dataRightPane.style.maxHeight = "440px";

  dataSelector.appendChild(dataLeftPane);
  dataSelector.appendChild(dataRightPane);
  dataGroup.appendChild(dataSelector);

  // Selected-paths chip cluster (below the panes).
  var selectedChipsWrap = mk("div", "skill-form-data-selected");
  selectedChipsWrap.style.marginTop = "10px";
  selectedChipsWrap.style.padding = "8px 0";
  selectedChipsWrap.style.borderTop = "1px dashed var(--ink-border, #e5e7eb)";
  dataGroup.appendChild(selectedChipsWrap);

  form.appendChild(dataGroup);

  // ─── Field 5 · Improve button + Improved prompt ─────────────────
  var improveRow = mk("div", "skill-form-improve-row");
  var improveBtn = mkt("button", "btn-primary", "✨ Improve");
  improveBtn.type = "button";
  improveBtn.setAttribute("data-skill-improve", "");
  improveBtn.title = "Fold the seed prompt + selected data points into a CARE-structured prompt via the active LLM provider (real call; no mocks).";
  improveRow.appendChild(improveBtn);
  var improveStatus = mkt("span", "skill-form-improve-status", "");
  improveRow.appendChild(improveStatus);
  form.appendChild(improveRow);
  // Inline error chip (only rendered on failure)
  var improveError = mk("div", "skill-form-improve-error");
  improveError.style.display = "none";
  form.appendChild(improveError);
  // Improved prompt readonly textarea
  var improvedGroup = mk("div", "skill-form-field");
  improvedGroup.appendChild(mkt("label", "skill-form-label", "Improved prompt"));
  improvedGroup.appendChild(mkt("div", "settings-help-inline",
    "LLM-generated CARE-structured prompt. Readonly by default — click Edit to hand-tune; click Re-improve to regenerate from scratch."));
  var improvedArea = mk("textarea", "settings-input skills-builder-textarea");
  improvedArea.rows = 8;
  improvedArea.value = existing && existing.improvedPrompt ? existing.improvedPrompt : "";
  improvedArea.placeholder = "(empty — click Improve above to generate a CARE-structured prompt from the seed + data points)";
  improvedArea.setAttribute("data-skill-improved", "");
  improvedArea.setAttribute("readonly", "");
  improvedGroup.appendChild(improvedArea);
  // Edit + Re-improve buttons (rendered always; Edit toggles readonly)
  var improvedBtnRow = mk("div", "skill-form-improved-btn-row");
  var editBtn = mkt("button", "btn-secondary", "Edit");
  editBtn.type = "button";
  editBtn.setAttribute("data-skill-improve-edit", "");
  editBtn.title = "Unfreeze the Improved prompt for hand-editing.";
  var redoBtn = mkt("button", "btn-secondary", "Re-improve");
  redoBtn.type = "button";
  redoBtn.setAttribute("data-skill-improve-redo", "");
  redoBtn.title = "Re-run Improve with the current seed + data points (overwrites the Improved prompt).";
  improvedBtnRow.appendChild(editBtn);
  improvedBtnRow.appendChild(redoBtn);
  improvedGroup.appendChild(improvedBtnRow);
  form.appendChild(improvedGroup);

  // ─── Field 6 · Parameters[] ─────────────────────────────────────
  var paramsGroup = mk("div", "skill-form-field");
  paramsGroup.appendChild(mkt("label", "skill-form-label", "Parameters (user-supplied at run-time)"));
  paramsGroup.appendChild(mkt("div", "settings-help-inline",
    "Zero or more parameters the user fills when running the skill. " +
    "Use the file type for run-time uploads (e.g. RFP / install-base CSV)."));
  var paramsWrap = mk("div", "skill-form-parameters");
  paramsGroup.appendChild(paramsWrap);
  // The visible "Add parameter" affordance lives inside the picker's left
  // pane (see renderParameters). This hidden no-op button is retained at
  // form scope so a `.skill-form-add-param` lookup still resolves here.
  var addParamBtn = mkt("button", "btn-outline skill-form-add-param", "+ Add parameter");
  addParamBtn.type = "button";
  addParamBtn.style.display = "none";
  paramsGroup.appendChild(addParamBtn);
  form.appendChild(paramsGroup);

  // ─── Field 7 · Output format ────────────────────────────────────
  var outputGroup = mk("div", "skill-form-field");
  outputGroup.appendChild(mkt("label", "skill-form-label", "Output format *"));
  outputGroup.appendChild(mkt("div", "settings-help-inline",
    "How the run output renders. Mutation formats (json-array / scalar) reveal the Mutation policy choice."));
  var outputWrap = mk("div", "skill-form-output-format");
  outputGroup.appendChild(outputWrap);
  form.appendChild(outputGroup);

  // ─── Field 8 · Mutation policy (conditional) ────────────────────
  var policyGroup = mk("div", "skill-form-field");
  policyGroup.appendChild(mkt("label", "skill-form-label", "Mutation policy *"));
  policyGroup.appendChild(mkt("div", "settings-help-inline",
    "Per-skill author setting. Saved with the skill; users running it get this behavior."));
  var policyWrap = mk("div", "skill-form-mutation-policy");
  policyGroup.appendChild(policyWrap);
  // Hide until output format is mutating
  policyGroup.style.display = "none";
  form.appendChild(policyGroup);

  // ─── Form-local state ───────────────────────────────────────────
  var state = {
    parameters:     existing && Array.isArray(existing.parameters) ? existing.parameters.slice() : [],
    outputFormat:   existing && existing.outputFormat ? existing.outputFormat : "text",
    mutationPolicy: existing && existing.mutationPolicy ? existing.mutationPolicy : "ask",
    dataView:       "standard",  // "standard" | "advanced"
    dataPoints:     existing && Array.isArray(existing.dataPoints) ? existing.dataPoints.slice() : []
  };

  // ─── Renderers ──────────────────────────────────────────────────

  // ─── Two-pane Data Points picker ────────────────────────────────
  // Left list: grouped by entity, with a [+] / [●] add affordance.
  // Right pane: structure / description / type / live sample / Add button.
  // Sourced from getPickerEntries(scope) + PICKER_METADATA in
  // core/dataContract.js.

  // Which path's detail is currently shown in the right pane.
  var dataPickerSelectedPath = null;

  // Resolve a live sample value for a path against the active engagement,
  // for display in the right pane.
  function _resolveSamplePathLive(path) {
    try {
      var eng = getActiveEngagement();
      if (!eng) return null;
      var ctx = _buildSkillRunCtx(eng);
      var rendered = resolveTemplate("{{" + path + "}}", ctx, { skillId: "picker-sample" });
      if (rendered === "[?]" || rendered === "" || rendered == null) return null;
      return rendered;
    } catch (_e) { return null; }
  }

  function renderDataPoints() {
    dataLeftPane.innerHTML = "";
    // Resolve entries for the active category + apply search filter.
    var entries = getPickerEntries(state.dataView);
    var q = (searchInput.value || "").toLowerCase().trim();
    if (q.length > 0) {
      entries = entries.filter(function(e) {
        return e.path.toLowerCase().indexOf(q) >= 0 ||
               (e.label || "").toLowerCase().indexOf(q) >= 0;
      });
    }
    var selectedPaths = new Set(state.dataPoints.map(function(d) { return d.path; }));

    // Group by entity (preserving the sort order from getPickerEntries).
    var groups = {};
    var groupOrder = [];
    entries.forEach(function(e) {
      if (!groups[e.entity]) { groups[e.entity] = []; groupOrder.push(e.entity); }
      groups[e.entity].push(e);
    });

    if (groupOrder.length === 0) {
      var empty = mkt("div", "settings-help-inline",
        q ? "No data points match '" + q + "'." : "No data points in this category yet.");
      empty.style.padding = "12px 16px";
      dataLeftPane.appendChild(empty);
    }

    groupOrder.forEach(function(entityKind) {
      var head = mkt("div", "skill-form-data-group-head",
        entityKind + " (" + groups[entityKind].length + ")");
      head.style.padding = "8px 14px 4px 14px";
      head.style.fontSize = "11px";
      head.style.fontWeight = "600";
      head.style.textTransform = "uppercase";
      head.style.color = "var(--ink-mute, #6b7280)";
      head.style.letterSpacing = "0.04em";
      dataLeftPane.appendChild(head);

      var groupWrap = mk("div", "skill-form-data-group");
      groups[entityKind].forEach(function(dp) {
        var row = mk("div", "skill-form-data-row");
        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.padding = "6px 14px";
        row.style.cursor = "pointer";
        row.style.borderLeft = "2px solid transparent";
        row.setAttribute("data-skill-data-path", dp.path);

        if (dp.path === dataPickerSelectedPath) {
          row.style.background = "var(--bg-soft, #f3f4f6)";
          row.style.borderLeftColor = "var(--dell-blue, #0076CE)";
        }
        row.addEventListener("mouseenter", function() {
          if (dp.path !== dataPickerSelectedPath) row.style.background = "var(--bg-soft, #f9fafb)";
        });
        row.addEventListener("mouseleave", function() {
          if (dp.path !== dataPickerSelectedPath) row.style.background = "";
        });

        // Row content: label + (added-indicator OR add bubble).
        var labelCol = mk("div", "skill-form-data-row-label");
        labelCol.style.flex = "1 1 auto";
        labelCol.style.minWidth = "0";
        var labelText = mkt("div", "", dp.label);
        labelText.style.fontSize = "13px";
        labelText.style.color = "var(--ink, #111827)";
        labelText.style.lineHeight = "1.25";
        labelCol.appendChild(labelText);
        var pathText = mkt("div", "", dp.path);
        pathText.style.fontSize = "11px";
        pathText.style.fontFamily = "var(--font-mono, monospace)";
        pathText.style.color = "var(--ink-mute, #6b7280)";
        pathText.style.marginTop = "1px";
        pathText.style.overflow = "hidden";
        pathText.style.textOverflow = "ellipsis";
        pathText.style.whiteSpace = "nowrap";
        labelCol.appendChild(pathText);
        row.appendChild(labelCol);

        // Add / Added bubble.
        var addBubble = mk("button", "skill-form-data-add-bubble");
        addBubble.type = "button";
        addBubble.style.marginLeft = "8px";
        addBubble.style.width = "26px";
        addBubble.style.height = "26px";
        addBubble.style.borderRadius = "50%";
        addBubble.style.border = "1px solid var(--ink-border, #d1d5db)";
        addBubble.style.background = selectedPaths.has(dp.path) ? "var(--dell-blue, #0076CE)" : "var(--bg, #ffffff)";
        addBubble.style.color = selectedPaths.has(dp.path) ? "#fff" : "var(--ink-mute, #6b7280)";
        addBubble.style.cursor = "pointer";
        addBubble.style.fontSize = "14px";
        addBubble.style.lineHeight = "1";
        addBubble.textContent = selectedPaths.has(dp.path) ? "✓" : "+";
        addBubble.title = selectedPaths.has(dp.path) ? "Remove from skill" : "Add to skill";
        addBubble.setAttribute("data-skill-data-add", dp.path);
        addBubble.addEventListener("click", function(ev) {
          ev.stopPropagation();
          if (selectedPaths.has(dp.path)) {
            state.dataPoints = state.dataPoints.filter(function(d) { return d.path !== dp.path; });
          } else {
            state.dataPoints.push({ path: dp.path, scope: dp.category });
          }
          renderDataPoints();
          renderSelectedChips();
        });
        row.appendChild(addBubble);

        // Row click → preview in right pane.
        row.addEventListener("click", function() {
          dataPickerSelectedPath = dp.path;
          renderDataPoints();
          renderDataPointDetail(dp.path);
        });

        groupWrap.appendChild(row);
      });
      dataLeftPane.appendChild(groupWrap);
    });

    // If no path was previously selected, default to the first one for context.
    if (!dataPickerSelectedPath && entries.length > 0) {
      dataPickerSelectedPath = entries[0].path;
    }
    if (dataPickerSelectedPath) {
      renderDataPointDetail(dataPickerSelectedPath);
    } else {
      dataRightPane.innerHTML = "";
      var ph = mkt("div", "settings-help-inline",
        "Click any data point on the left to preview its meaning + a live sample value.");
      ph.style.fontStyle = "italic";
      dataRightPane.appendChild(ph);
    }
  }

  function renderDataPointDetail(path) {
    dataRightPane.innerHTML = "";
    var meta = PICKER_METADATA[path];
    if (!meta) {
      dataRightPane.appendChild(mkt("div", "settings-help-inline",
        "No metadata available for '" + path + "'."));
      return;
    }

    // Big label.
    var bigLabel = mkt("div", "", meta.label);
    bigLabel.style.fontSize = "16px";
    bigLabel.style.fontWeight = "600";
    bigLabel.style.color = "var(--ink, #111827)";
    bigLabel.style.marginBottom = "4px";
    dataRightPane.appendChild(bigLabel);

    // Path (mono).
    var pathLine = mkt("div", "", path);
    pathLine.style.fontFamily = "var(--font-mono, monospace)";
    pathLine.style.fontSize = "12px";
    pathLine.style.color = "var(--ink-mute, #6b7280)";
    pathLine.style.marginBottom = "10px";
    dataRightPane.appendChild(pathLine);

    // Category + entity chips.
    var chipsRow = mk("div");
    chipsRow.style.display = "flex";
    chipsRow.style.gap = "6px";
    chipsRow.style.marginBottom = "12px";
    var catChip = mkt("span", "tag", meta.category);
    catChip.style.fontSize = "10px";
    chipsRow.appendChild(catChip);
    var entityChip = mkt("span", "tag", meta.entity);
    entityChip.style.fontSize = "10px";
    chipsRow.appendChild(entityChip);
    dataRightPane.appendChild(chipsRow);

    // Description.
    var descLabel = mkt("div", "", "WHAT IT MEANS");
    descLabel.style.fontSize = "10px";
    descLabel.style.fontWeight = "600";
    descLabel.style.textTransform = "uppercase";
    descLabel.style.color = "var(--ink-mute, #6b7280)";
    descLabel.style.letterSpacing = "0.05em";
    descLabel.style.marginBottom = "4px";
    dataRightPane.appendChild(descLabel);
    var descBody = mkt("div", "", meta.description);
    descBody.style.fontSize = "13px";
    descBody.style.lineHeight = "1.5";
    descBody.style.color = "var(--ink, #111827)";
    descBody.style.marginBottom = "12px";
    dataRightPane.appendChild(descBody);

    // Sample value (live → fallback to sampleHint).
    var sampleLabel = mkt("div", "", "SAMPLE");
    sampleLabel.style.fontSize = "10px";
    sampleLabel.style.fontWeight = "600";
    sampleLabel.style.textTransform = "uppercase";
    sampleLabel.style.color = "var(--ink-mute, #6b7280)";
    sampleLabel.style.letterSpacing = "0.05em";
    sampleLabel.style.marginBottom = "4px";
    dataRightPane.appendChild(sampleLabel);
    var liveSample = _resolveSamplePathLive(path);
    var sampleSource = liveSample ? "live engagement" : "hint";
    var sampleText = liveSample || meta.sampleHint || "(no value)";
    var sampleBox = mkt("pre", "", sampleText);
    sampleBox.style.background = "var(--bg-soft, #f3f4f6)";
    sampleBox.style.border = "1px solid var(--ink-border, #e5e7eb)";
    sampleBox.style.borderRadius = "4px";
    sampleBox.style.padding = "8px 10px";
    sampleBox.style.fontSize = "12px";
    sampleBox.style.fontFamily = "var(--font-mono, monospace)";
    sampleBox.style.whiteSpace = "pre-wrap";
    sampleBox.style.margin = "0 0 4px 0";
    sampleBox.style.maxHeight = "120px";
    sampleBox.style.overflow = "auto";
    dataRightPane.appendChild(sampleBox);
    var sampleHint = mkt("div", "", "(sourced from: " + sampleSource + ")");
    sampleHint.style.fontSize = "10px";
    sampleHint.style.color = "var(--ink-mute, #6b7280)";
    sampleHint.style.marginBottom = "12px";
    dataRightPane.appendChild(sampleHint);

    // ─── RELATIONSHIPS section ──────────────────────────────────────
    // Renders the picker-side view of RELATIONSHIPS_METADATA for the
    // selected path: FK pair, multi-hop chain diagram, state-conditional
    // warning, derived-from source, cross-cutting flag, provenance flag.
    var rel = RELATIONSHIPS_METADATA[path];
    if (rel) {
      _renderRelationshipsSection(dataRightPane, path, rel);
      _renderMandatoryPairingsSection(dataRightPane, path, rel);
      _renderOrderingSection(dataRightPane, rel);
    }

    // Add / Remove button.
    var isAdded = state.dataPoints.some(function(d) { return d.path === path; });
    var addBtn = mkt("button",
      isAdded ? "btn-secondary" : "btn-primary",
      isAdded ? "✓ Remove from skill" : "+ Add to skill");
    addBtn.type = "button";
    addBtn.setAttribute("data-skill-data-add-detail", path);
    addBtn.addEventListener("click", function() {
      if (isAdded) {
        state.dataPoints = state.dataPoints.filter(function(d) { return d.path !== path; });
      } else {
        state.dataPoints.push({ path: path, scope: meta.category });
      }
      renderDataPoints();
      renderSelectedChips();
    });
    dataRightPane.appendChild(addBtn);
  }

  // ─── Right-pane helpers · RELATIONSHIPS metadata ────────────────

  function _sectionEyebrow(text) {
    var el = mkt("div", "", text);
    el.style.fontSize = "10px";
    el.style.fontWeight = "600";
    el.style.textTransform = "uppercase";
    el.style.color = "var(--ink-mute, #6b7280)";
    el.style.letterSpacing = "0.05em";
    el.style.marginBottom = "4px";
    el.style.marginTop = "12px";
    return el;
  }

  // RELATIONSHIPS section — FK pair, multi-hop chain diagram,
  // state-conditional warning, derived-from source, cross-cutting,
  // provenance flag. Hidden entirely when the path has no relationships
  // to surface.
  function _renderRelationshipsSection(host, path, rel) {
    var hasContent = rel.fkPair || rel.multiHop || rel.stateConditional ||
                     rel.derivedFrom || rel.crossCutting || rel.provenance;
    if (!hasContent) return;

    host.appendChild(_sectionEyebrow("RELATIONSHIPS"));

    // FK pair (one-click swap link).
    if (rel.fkPair) {
      var fkRow = mk("div");
      fkRow.style.fontSize = "12px";
      fkRow.style.marginBottom = "6px";
      fkRow.style.color = "var(--ink, #111827)";
      fkRow.setAttribute("data-rel-fk-pair", rel.fkPair);
      var diamond = mkt("span", "", "◆ ");
      diamond.style.color = "var(--dell-blue, #0076CE)";
      fkRow.appendChild(diamond);
      fkRow.appendChild(document.createTextNode("FK pair: "));
      var swapLink = mkt("button", "", rel.fkPair);
      swapLink.type = "button";
      swapLink.style.background = "none";
      swapLink.style.border = "none";
      swapLink.style.padding = "0";
      swapLink.style.cursor = "pointer";
      swapLink.style.color = "var(--dell-blue, #0076CE)";
      swapLink.style.textDecoration = "underline";
      swapLink.style.fontFamily = "var(--font-mono, monospace)";
      swapLink.style.fontSize = "12px";
      swapLink.title = "Switch to the FK counterpart";
      swapLink.addEventListener("click", function() {
        dataPickerSelectedPath = rel.fkPair;
        renderDataPoints();
      });
      fkRow.appendChild(swapLink);
      host.appendChild(fkRow);
    }

    // Multi-hop chain diagram. Renders as a horizontal flow with arrows
    // between nodes. For gap.driverName: gap.driverId → driver record →
    // BUSINESS_DRIVERS → .label.
    if (Array.isArray(rel.multiHop) && rel.multiHop.length > 0) {
      var mhWrap = mk("div");
      mhWrap.style.marginBottom = "8px";
      mhWrap.setAttribute("data-rel-multihop", "true");
      var mhEyebrow = mk("div");
      mhEyebrow.style.fontSize = "12px";
      mhEyebrow.style.color = "var(--ink, #111827)";
      mhEyebrow.style.marginBottom = "4px";
      var mhDiamond = mkt("span", "", "◆ ");
      mhDiamond.style.color = "var(--dell-blue, #0076CE)";
      mhEyebrow.appendChild(mhDiamond);
      mhEyebrow.appendChild(document.createTextNode(
        rel.multiHop.length > 2 ? "Multi-hop catalog join:" : "Catalog join:"));
      mhWrap.appendChild(mhEyebrow);

      var diagramRow = mk("div");
      diagramRow.style.display = "flex";
      diagramRow.style.flexWrap = "wrap";
      diagramRow.style.alignItems = "center";
      diagramRow.style.gap = "6px";
      diagramRow.style.padding = "8px 10px";
      diagramRow.style.background = "var(--bg-soft, #f9fafb)";
      diagramRow.style.border = "1px solid var(--ink-border, #e5e7eb)";
      diagramRow.style.borderRadius = "4px";
      diagramRow.style.fontSize = "11px";
      diagramRow.style.fontFamily = "var(--font-mono, monospace)";

      rel.multiHop.forEach(function(node, idx) {
        if (idx > 0) {
          var arrow = mkt("span", "", "→");
          arrow.style.color = "var(--ink-mute, #6b7280)";
          arrow.style.fontSize = "14px";
          arrow.style.fontFamily = "var(--font-sans, sans-serif)";
          diagramRow.appendChild(arrow);
        }
        var nodePill = mk("span");
        nodePill.style.padding = "3px 7px";
        nodePill.style.borderRadius = "3px";
        nodePill.style.background = (node.kind === "catalog") ? "var(--dell-blue-light, #DBEAFE)"
                                  : (node.kind === "result")  ? "var(--success-light, #DCFCE7)"
                                  :                              "var(--bg, #ffffff)";
        nodePill.style.border = "1px solid var(--ink-border, #d1d5db)";
        nodePill.style.color = "var(--ink, #111827)";
        nodePill.textContent = node.label || node.path || node.catalogId || node.field || "?";
        nodePill.title = node.kind + (node.path ? " · " + node.path : "");
        diagramRow.appendChild(nodePill);
      });
      mhWrap.appendChild(diagramRow);
      host.appendChild(mhWrap);
    }

    // State-conditional warning.
    if (rel.stateConditional) {
      var scRow = mk("div");
      scRow.style.fontSize = "12px";
      scRow.style.color = "var(--ink, #111827)";
      scRow.style.marginBottom = "6px";
      scRow.style.padding = "6px 10px";
      scRow.style.background = "var(--bg-warn-soft, #FEF9C3)";
      scRow.style.border = "1px solid var(--warn-border, #FDE68A)";
      scRow.style.borderRadius = "4px";
      scRow.setAttribute("data-rel-state-conditional", rel.stateConditional.onField);
      var scIcon = mkt("strong", "", "⚠ Conditional: ");
      scIcon.style.color = "var(--warn, #B45309)";
      scRow.appendChild(scIcon);
      scRow.appendChild(document.createTextNode(rel.stateConditional.description || ""));
      host.appendChild(scRow);
    }

    // Derived-from source.
    if (rel.derivedFrom) {
      var dfRow = mk("div");
      dfRow.style.fontSize = "12px";
      dfRow.style.color = "var(--ink, #111827)";
      dfRow.style.marginBottom = "6px";
      dfRow.setAttribute("data-rel-derived-from", "true");
      var dfDiamond = mkt("span", "", "◆ ");
      dfDiamond.style.color = "var(--dell-blue, #0076CE)";
      dfRow.appendChild(dfDiamond);
      dfRow.appendChild(document.createTextNode("Derived from "));
      var dfSrc = mkt("code", "", rel.derivedFrom.selector || "");
      dfSrc.style.fontFamily = "var(--font-mono, monospace)";
      dfSrc.style.fontSize = "11px";
      dfRow.appendChild(dfSrc);
      var dfDesc = mkt("div", "", rel.derivedFrom.description || "");
      dfDesc.style.fontSize = "11px";
      dfDesc.style.color = "var(--ink-mute, #6b7280)";
      dfDesc.style.marginTop = "2px";
      dfDesc.style.paddingLeft = "14px";
      host.appendChild(dfRow);
      host.appendChild(dfDesc);
    }

    // Cross-cutting flag.
    if (rel.crossCutting) {
      var ccRow = mk("div");
      ccRow.style.fontSize = "12px";
      ccRow.style.color = "var(--ink, #111827)";
      ccRow.style.marginBottom = "6px";
      ccRow.setAttribute("data-rel-cross-cutting", "true");
      var ccDiamond = mkt("span", "", "◆ ");
      ccDiamond.style.color = "var(--dell-blue, #0076CE)";
      ccRow.appendChild(ccDiamond);
      ccRow.appendChild(mkt("strong", "", "Cross-cutting: "));
      ccRow.appendChild(document.createTextNode(
        "one record spans multiple categories. Skills must NOT duplicate the record per category."));
      host.appendChild(ccRow);
    }

    // Provenance flag.
    if (rel.provenance) {
      var pvRow = mk("div");
      pvRow.style.fontSize = "12px";
      pvRow.style.color = "var(--ink, #111827)";
      pvRow.style.marginBottom = "6px";
      pvRow.setAttribute("data-rel-provenance", rel.provenance);
      var pvDiamond = mkt("span", "", "◆ ");
      pvDiamond.style.color = "var(--dell-blue, #0076CE)";
      pvRow.appendChild(pvDiamond);
      pvRow.appendChild(mkt("strong", "", "Provenance: "));
      pvRow.appendChild(document.createTextNode(
        rel.provenance === "system"
          ? "system-set, not authored. Read for auditing."
          : rel.provenance === "ai"
            ? "AI-set, cleared on next engineer save."
            : String(rel.provenance)));
      host.appendChild(pvRow);
    }
  }

  // MANDATORY PAIRINGS section — soft warning + one-click "Add suggested
  // set" button. The set is computed via getMandatorySetFor (recursive)
  // and minus what's already in state.dataPoints.
  function _renderMandatoryPairingsSection(host, path, rel) {
    var pairings = Array.isArray(rel.mandatoryWith) ? rel.mandatoryWith : [];
    if (pairings.length === 0) return;

    host.appendChild(_sectionEyebrow("MANDATORY PAIRINGS"));
    var mpRow = mk("div");
    mpRow.style.fontSize = "12px";
    mpRow.style.marginBottom = "6px";
    mpRow.setAttribute("data-rel-mandatory-with", pairings.join(","));

    var lede = mkt("div", "", "Pick these alongside for the LLM to anchor each row correctly:");
    lede.style.color = "var(--ink, #111827)";
    lede.style.marginBottom = "6px";
    mpRow.appendChild(lede);

    var list = mk("ul");
    list.style.margin = "0";
    list.style.paddingLeft = "16px";
    list.style.fontSize = "12px";
    pairings.forEach(function(p) {
      var li = mk("li");
      li.style.marginBottom = "2px";
      var added = state.dataPoints.some(function(d) { return d.path === p; });
      var dot = mkt("span", "", added ? "✓ " : "○ ");
      dot.style.color = added ? "var(--success, #16A34A)" : "var(--ink-mute, #9ca3af)";
      li.appendChild(dot);
      var meta = PICKER_METADATA[p];
      li.appendChild(document.createTextNode((meta ? meta.label : p) + " "));
      var pathCode = mkt("code", "", "(" + p + ")");
      pathCode.style.fontFamily = "var(--font-mono, monospace)";
      pathCode.style.fontSize = "11px";
      pathCode.style.color = "var(--ink-mute, #6b7280)";
      li.appendChild(pathCode);
      list.appendChild(li);
    });
    mpRow.appendChild(list);
    host.appendChild(mpRow);

    // "Add suggested set" button (only when at least one pairing isn't already added).
    var missing = pairings.filter(function(p) {
      return !state.dataPoints.some(function(d) { return d.path === p; });
    });
    if (missing.length > 0) {
      var addSetBtn = mkt("button", "btn-secondary", "+ Add suggested set (" + missing.length + ")");
      addSetBtn.type = "button";
      addSetBtn.style.marginTop = "8px";
      addSetBtn.style.fontSize = "12px";
      addSetBtn.setAttribute("data-rel-add-suggested-set", "true");
      addSetBtn.addEventListener("click", function() {
        missing.forEach(function(p) {
          var m = PICKER_METADATA[p] || {};
          state.dataPoints.push({ path: p, scope: m.category || "standard" });
        });
        renderDataPoints();
        renderSelectedChips();
      });
      host.appendChild(addSetBtn);
    }
  }

  // ORDERING section — the locked glossary (level vs phase vs categorical
  // vs free-text vs numeric vs boolean). Critical for prompt authoring.
  function _renderOrderingSection(host, rel) {
    if (!rel.ordering || !rel.ordering.kind) return;
    host.appendChild(_sectionEyebrow("ORDERING"));
    var ordRow = mk("div");
    ordRow.style.fontSize = "12px";
    ordRow.style.color = "var(--ink, #111827)";
    ordRow.style.marginBottom = "6px";
    ordRow.setAttribute("data-rel-ordering-kind", rel.ordering.kind);
    var kindChip = mkt("span", "tag", rel.ordering.kind);
    kindChip.style.fontSize = "10px";
    kindChip.style.padding = "2px 6px";
    kindChip.style.marginRight = "6px";
    // Color-code: level (yellow warning) / phase (blue ordered) / other (neutral).
    if (rel.ordering.kind === "level") {
      kindChip.style.background = "var(--bg-warn-soft, #FEF9C3)";
      kindChip.style.color = "var(--warn, #B45309)";
    } else if (rel.ordering.kind === "phase") {
      kindChip.style.background = "var(--dell-blue-light, #DBEAFE)";
      kindChip.style.color = "var(--dell-blue, #0076CE)";
    }
    ordRow.appendChild(kindChip);
    ordRow.appendChild(document.createTextNode(rel.ordering.note || ""));
    host.appendChild(ordRow);
  }

  function renderSelectedChips() {
    selectedChipsWrap.innerHTML = "";
    if (state.dataPoints.length === 0) {
      var empty = mkt("div", "settings-help-inline",
        "No data points added yet. Pick from the list above.");
      empty.style.fontStyle = "italic";
      selectedChipsWrap.appendChild(empty);
      return;
    }
    var header = mkt("div", "", "Selected (" + state.dataPoints.length + "):");
    header.style.fontSize = "11px";
    header.style.fontWeight = "600";
    header.style.textTransform = "uppercase";
    header.style.color = "var(--ink-mute, #6b7280)";
    header.style.marginBottom = "6px";
    header.style.letterSpacing = "0.04em";
    selectedChipsWrap.appendChild(header);
    var chipsRow = mk("div");
    chipsRow.style.display = "flex";
    chipsRow.style.flexWrap = "wrap";
    chipsRow.style.gap = "6px";
    state.dataPoints.forEach(function(d) {
      var meta = PICKER_METADATA[d.path] || { label: d.path };
      var chip = mk("span", "tag");
      chip.style.display = "inline-flex";
      chip.style.alignItems = "center";
      chip.style.gap = "6px";
      chip.style.padding = "4px 8px";
      chip.style.fontSize = "12px";
      var chipLabel = document.createTextNode(meta.label);
      chip.appendChild(chipLabel);
      var rm = mkt("button", "", "✕");
      rm.type = "button";
      rm.style.background = "transparent";
      rm.style.border = "none";
      rm.style.cursor = "pointer";
      rm.style.color = "var(--ink-mute, #6b7280)";
      rm.style.padding = "0";
      rm.style.fontSize = "12px";
      rm.title = "Remove " + meta.label;
      rm.setAttribute("data-skill-data-chip-remove", d.path);
      rm.addEventListener("click", function() {
        state.dataPoints = state.dataPoints.filter(function(p) { return p.path !== d.path; });
        renderDataPoints();
        renderSelectedChips();
      });
      chip.appendChild(rm);
      chipsRow.appendChild(chip);
    });
    selectedChipsWrap.appendChild(chipsRow);
  }

  // Re-render the list as the user types in the search box.
  searchInput.addEventListener("input", function() { renderDataPoints(); });

  // ─── Two-pane Output Format picker ──────────────────────────────
  // Left: 4 format cards. Right: when-to-use guidance + example output.
  // The per-format example metadata below is the single source for both
  // the picker right-pane and the LLM training prompt.
  var OUTPUT_FORMAT_EXAMPLES = {
    "text": {
      whenToUse: "Use for narrative answers — account plans, summaries, briefs, anything the human reads as prose.",
      example: "The customer is Northstar Health Network, a Healthcare organization with North America operations. Their three High-priority drivers are: Cyber Resilience, Modernize Aging Infrastructure, and AI & Data Platforms. The current state has 42 instances across 4 environments; the desired state proposes 38 changes via 17 gaps (5 of which are High urgency)."
    },
    "dimensional": {
      whenToUse: "Use when the answer is a 2-D table (rows × columns) — heatmap-style outputs, comparison grids.",
      example: "{ rows: ['Compute','Storage','Workload'], columns: ['Primary DC','DR','Public Cloud'], cells: [[3,1,0],[5,2,1],[8,3,2]] }"
    },
    "json-array": {
      whenToUse: "Use when the answer is a LIST OF CHANGES the engagement applies — bulk-mutate instances, batch-update gap urgencies, etc. Reveals the Mutation policy picker below.",
      example: "[\n  { instanceId: 'i-1a2b3c', patch: { criticality: 'High' } },\n  { instanceId: 'i-4d5e6f', patch: { criticality: 'Medium', notes: 'EOL Q3' } }\n]"
    },
    "scalar": {
      whenToUse: "Use when the answer is a SINGLE-VALUE mutation of one data point. Reveals the Mutation policy picker below.",
      example: "{ instanceId: 'i-1a2b3c', field: 'criticality', value: 'High' }"
    }
  };

  function renderOutputFormat() {
    outputWrap.innerHTML = "";
    outputWrap.style.display = "grid";
    outputWrap.style.gridTemplateColumns = "minmax(0, 0.7fr) minmax(0, 1.3fr)";
    outputWrap.style.gap = "12px";
    outputWrap.style.border = "1px solid var(--ink-border, #e5e7eb)";
    outputWrap.style.borderRadius = "6px";
    outputWrap.style.overflow = "hidden";

    var leftPane = mk("div");
    leftPane.style.borderRight = "1px solid var(--ink-border, #e5e7eb)";
    leftPane.style.padding = "8px 0";

    var rightPane = mk("div");
    rightPane.style.padding = "12px 14px";

    OUTPUT_FORMATS.forEach(function(opt) {
      var row = mk("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.padding = "10px 14px";
      row.style.cursor = "pointer";
      row.style.borderLeft = "3px solid transparent";
      var isSelected = (state.outputFormat === opt.id);
      if (isSelected) {
        row.style.background = "var(--bg-soft, #f3f4f6)";
        row.style.borderLeftColor = "var(--dell-blue, #0076CE)";
      }

      // Hidden radio that carries the data-* selection attributes.
      var radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "skill-output-format";
      radio.value = opt.id;
      radio.checked = isSelected;
      radio.setAttribute("data-skill-output-format", "");
      radio.setAttribute("data-output-format-value", opt.id);
      radio.style.display = "none";
      row.appendChild(radio);

      var labelCol = mk("div");
      labelCol.style.flex = "1 1 auto";
      var labelText = mkt("div", "skill-form-output-format-label", opt.label);
      labelText.style.fontSize = "13px";
      labelText.style.fontWeight = isSelected ? "600" : "500";
      labelText.style.color = "var(--ink, #111827)";
      labelCol.appendChild(labelText);
      var hintText = mkt("div", "skill-form-output-format-hint", opt.hint);
      hintText.style.fontSize = "11px";
      hintText.style.color = "var(--ink-mute, #6b7280)";
      hintText.style.marginTop = "2px";
      labelCol.appendChild(hintText);
      row.appendChild(labelCol);

      row.addEventListener("click", function() {
        state.outputFormat = opt.id;
        radio.checked = true;
        radio.dispatchEvent(new Event("change", { bubbles: true }));
        // Conditional mutation-policy visibility — RENDER iff mutating.
        var isMutating = (opt.id === "json-array" || opt.id === "scalar");
        policyGroup.style.display = isMutating ? "" : "none";
        if (isMutating) renderMutationPolicy();
        else policyWrap.innerHTML = "";
        renderOutputFormat();
      });

      leftPane.appendChild(row);
    });

    // Right pane: when-to-use + example output for the currently-selected format.
    var meta = OUTPUT_FORMAT_EXAMPLES[state.outputFormat] || {};
    var selectedFormatLabel = (OUTPUT_FORMATS.find(function(o) { return o.id === state.outputFormat; }) || {}).label || state.outputFormat;

    var bigLabel = mkt("div", "", selectedFormatLabel);
    bigLabel.style.fontSize = "16px";
    bigLabel.style.fontWeight = "600";
    bigLabel.style.color = "var(--ink, #111827)";
    bigLabel.style.marginBottom = "8px";
    rightPane.appendChild(bigLabel);

    var wtuLabel = mkt("div", "", "WHEN TO USE");
    wtuLabel.style.fontSize = "10px";
    wtuLabel.style.fontWeight = "600";
    wtuLabel.style.textTransform = "uppercase";
    wtuLabel.style.color = "var(--ink-mute, #6b7280)";
    wtuLabel.style.letterSpacing = "0.05em";
    wtuLabel.style.marginBottom = "4px";
    rightPane.appendChild(wtuLabel);
    var wtuBody = mkt("div", "", meta.whenToUse || "(no guidance available)");
    wtuBody.style.fontSize = "13px";
    wtuBody.style.lineHeight = "1.5";
    wtuBody.style.color = "var(--ink, #111827)";
    wtuBody.style.marginBottom = "14px";
    rightPane.appendChild(wtuBody);

    var exLabel = mkt("div", "", "EXAMPLE OUTPUT");
    exLabel.style.fontSize = "10px";
    exLabel.style.fontWeight = "600";
    exLabel.style.textTransform = "uppercase";
    exLabel.style.color = "var(--ink-mute, #6b7280)";
    exLabel.style.letterSpacing = "0.05em";
    exLabel.style.marginBottom = "4px";
    rightPane.appendChild(exLabel);
    var exBox = mkt("pre", "", meta.example || "(no example)");
    exBox.style.background = "var(--bg-soft, #f3f4f6)";
    exBox.style.border = "1px solid var(--ink-border, #e5e7eb)";
    exBox.style.borderRadius = "4px";
    exBox.style.padding = "10px 12px";
    exBox.style.fontSize = "12px";
    exBox.style.fontFamily = "var(--font-mono, monospace)";
    exBox.style.whiteSpace = "pre-wrap";
    exBox.style.margin = "0";
    exBox.style.maxHeight = "200px";
    exBox.style.overflow = "auto";
    rightPane.appendChild(exBox);

    outputWrap.appendChild(leftPane);
    outputWrap.appendChild(rightPane);

    // Set initial conditional visibility — group hidden + radios NOT rendered
    // when output is text (the default).
    var isMutating = (state.outputFormat === "json-array" || state.outputFormat === "scalar");
    policyGroup.style.display = isMutating ? "" : "none";
    if (isMutating) renderMutationPolicy();
    else policyWrap.innerHTML = "";
  }

  function renderMutationPolicy() {
    policyWrap.innerHTML = "";
    MUTATION_POLICIES.forEach(function(opt) {
      var optRow = mk("label", "skill-form-mutation-policy-row");
      var radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "skill-mutation-policy";
      radio.value = opt.id;
      radio.checked = (state.mutationPolicy === opt.id);
      radio.setAttribute("data-skill-mutation-policy", "");
      radio.setAttribute("data-policy-value", opt.id);
      radio.addEventListener("change", function() { state.mutationPolicy = opt.id; });
      optRow.appendChild(radio);
      var labelText = mk("span", "skill-form-mutation-policy-label");
      labelText.textContent = opt.label;
      optRow.appendChild(labelText);
      var hintText = mk("span", "skill-form-mutation-policy-hint");
      hintText.textContent = opt.hint;
      optRow.appendChild(hintText);
      policyWrap.appendChild(optRow);
    });
  }

  // ─── Two-pane Parameters editor ─────────────────────────────────
  // Left: list of parameters with name + type chip + edit pencil, plus an
  // Add-parameter button at the bottom. Right: edit form for the
  // currently-selected parameter (one at a time).

  var paramPickerSelectedIdx = null;

  function renderParameters() {
    paramsWrap.innerHTML = "";
    paramsWrap.style.display = "grid";
    paramsWrap.style.gridTemplateColumns = "minmax(0, 0.6fr) minmax(0, 1.4fr)";
    paramsWrap.style.gap = "12px";
    paramsWrap.style.border = "1px solid var(--ink-border, #e5e7eb)";
    paramsWrap.style.borderRadius = "6px";
    paramsWrap.style.overflow = "hidden";
    paramsWrap.style.minHeight = "180px";

    var leftPane = mk("div", "skill-form-params-left");
    leftPane.style.borderRight = "1px solid var(--ink-border, #e5e7eb)";
    leftPane.style.padding = "8px 0";

    var rightPane = mk("div", "skill-form-params-right");
    rightPane.style.padding = "12px 14px";

    if (state.parameters.length === 0) {
      var empty = mkt("div", "settings-help-inline skill-param-empty",
        "No parameters yet. Click + Add parameter on the left to create one.");
      empty.style.padding = "12px 14px";
      empty.style.fontStyle = "italic";
      leftPane.appendChild(empty);
    } else {
      // If no row is selected yet, default to the first.
      if (paramPickerSelectedIdx == null || paramPickerSelectedIdx >= state.parameters.length) {
        paramPickerSelectedIdx = 0;
      }
      state.parameters.forEach(function(p, idx) {
        var row = mk("div", "skill-param-row-compact");
        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.padding = "8px 14px";
        row.style.cursor = "pointer";
        row.style.borderLeft = "3px solid transparent";
        if (idx === paramPickerSelectedIdx) {
          row.style.background = "var(--bg-soft, #f3f4f6)";
          row.style.borderLeftColor = "var(--dell-blue, #0076CE)";
        }
        var labelCol = mk("div");
        labelCol.style.flex = "1 1 auto";
        labelCol.style.minWidth = "0";
        var nameDisplay = mkt("div", "", p.name || "(unnamed)");
        nameDisplay.style.fontSize = "13px";
        nameDisplay.style.fontWeight = "500";
        nameDisplay.style.color = "var(--ink, #111827)";
        labelCol.appendChild(nameDisplay);
        var metaLine = mkt("div", "", (p.type || "string") + (p.required ? " · required" : ""));
        metaLine.style.fontSize = "11px";
        metaLine.style.color = "var(--ink-mute, #6b7280)";
        metaLine.style.marginTop = "1px";
        labelCol.appendChild(metaLine);
        row.appendChild(labelCol);

        var editPencil = mkt("span", "", "✎");
        editPencil.style.marginLeft = "8px";
        editPencil.style.color = "var(--ink-mute, #9ca3af)";
        editPencil.style.fontSize = "13px";
        row.appendChild(editPencil);

        row.addEventListener("click", function() {
          paramPickerSelectedIdx = idx;
          renderParameters();
        });

        leftPane.appendChild(row);
      });
    }

    // + Add parameter row at the bottom of the left pane.
    var addRow = mk("div");
    addRow.style.padding = "10px 14px";
    addRow.style.borderTop = "1px dashed var(--ink-border, #e5e7eb)";
    var addBtn = mkt("button", "btn-outline skill-form-add-param-inline", "+ Add parameter");
    addBtn.type = "button";
    addBtn.style.width = "100%";
    addBtn.addEventListener("click", function() {
      state.parameters.push({ name: "", type: "string", description: "", required: false });
      paramPickerSelectedIdx = state.parameters.length - 1;
      renderParameters();
    });
    addRow.appendChild(addBtn);
    leftPane.appendChild(addRow);

    // Right pane: editor for the currently-selected parameter (or placeholder).
    if (paramPickerSelectedIdx != null && state.parameters[paramPickerSelectedIdx]) {
      _renderParameterEditor(rightPane, paramPickerSelectedIdx);
    } else {
      var ph = mkt("div", "settings-help-inline",
        "Click + Add parameter to define run-time inputs for this skill.");
      ph.style.fontStyle = "italic";
      rightPane.appendChild(ph);
    }

    paramsWrap.appendChild(leftPane);
    paramsWrap.appendChild(rightPane);
  }

  function _renderParameterEditor(rightPane, idx) {
    rightPane.innerHTML = "";
    var p = state.parameters[idx];
    if (!p) return;

    var title = mkt("div", "", "Parameter " + (idx + 1));
    title.style.fontSize = "14px";
    title.style.fontWeight = "600";
    title.style.marginBottom = "12px";
    title.style.color = "var(--ink, #111827)";
    rightPane.appendChild(title);

    // Name
    var nameG = mk("div", "skill-param-cell");
    nameG.style.marginBottom = "10px";
    nameG.appendChild(mkt("label", "skill-form-label", "Name *"));
    var nameI = mk("input", "settings-input");
    nameI.type = "text"; nameI.value = p.name || "";
    nameI.placeholder = "e.g. rfpBody";
    nameI.style.width = "100%";
    nameI.addEventListener("input", function() {
      state.parameters[idx].name = nameI.value;
      // Update state on input; the full re-render is deferred to blur
      // (below) so focus stays in this field while typing.
      var leftRows = paramsWrap.querySelectorAll(".skill-param-row-compact div div");
    });
    nameI.addEventListener("blur", function() { renderParameters(); });
    nameG.appendChild(nameI);
    rightPane.appendChild(nameG);

    // Type
    var typeG = mk("div", "skill-param-cell");
    typeG.style.marginBottom = "10px";
    typeG.appendChild(mkt("label", "skill-form-label", "Type"));
    var typeS = mk("select", "settings-input");
    typeS.style.width = "100%";
    PARAMETER_TYPES.forEach(function(t) {
      var o = document.createElement("option");
      o.value = t.id; o.textContent = t.label;
      if (t.id === p.type) o.selected = true;
      typeS.appendChild(o);
    });
    typeS.addEventListener("change", function() {
      state.parameters[idx].type = typeS.value;
      renderParameters();
    });
    typeG.appendChild(typeS);
    rightPane.appendChild(typeG);

    // Description
    var descG = mk("div", "skill-param-cell");
    descG.style.marginBottom = "10px";
    descG.appendChild(mkt("label", "skill-form-label", "Description"));
    var descI = mk("input", "settings-input");
    descI.type = "text"; descI.value = p.description || "";
    descI.placeholder = "e.g. Customer install-base CSV";
    descI.style.width = "100%";
    descI.addEventListener("input", function() { state.parameters[idx].description = descI.value; });
    descG.appendChild(descI);
    rightPane.appendChild(descG);

    // Accepts (file type only)
    if (p.type === "file") {
      var accG = mk("div", "skill-param-cell");
      accG.style.marginBottom = "10px";
      accG.appendChild(mkt("label", "skill-form-label", "Accepts"));
      var accI = mk("input", "settings-input");
      accI.type = "text"; accI.value = p.accepts || ".xlsx,.csv,.txt,.pdf";
      accI.placeholder = ".xlsx,.csv,.txt,.pdf";
      accI.style.width = "100%";
      accI.addEventListener("input", function() { state.parameters[idx].accepts = accI.value; });
      accG.appendChild(accI);
      rightPane.appendChild(accG);
    }

    // Required
    var reqG = mk("div", "skill-param-cell skill-param-required");
    reqG.style.marginBottom = "14px";
    var reqL = mkt("label", "skill-param-required-label");
    reqL.style.display = "flex";
    reqL.style.alignItems = "center";
    reqL.style.gap = "6px";
    var reqI = document.createElement("input");
    reqI.type = "checkbox"; reqI.checked = !!p.required;
    reqI.addEventListener("change", function() {
      state.parameters[idx].required = reqI.checked;
      renderParameters();
    });
    reqL.appendChild(reqI);
    var reqText = document.createTextNode("Required (user must supply at run-time)");
    reqL.appendChild(reqText);
    reqG.appendChild(reqL);
    rightPane.appendChild(reqG);

    // Delete
    var rmBtn = mkt("button", "btn-danger skill-param-remove", "Delete parameter");
    rmBtn.type = "button";
    rmBtn.addEventListener("click", function() {
      state.parameters.splice(idx, 1);
      paramPickerSelectedIdx = state.parameters.length > 0 ? Math.max(0, idx - 1) : null;
      renderParameters();
    });
    rightPane.appendChild(rmBtn);
  }

  // ─── Wire toggles + buttons ─────────────────────────────────────

  function _setActiveToggle(active) {
    toggleStdBtn.classList.toggle("is-active", active === "standard");
    toggleInsBtn.classList.toggle("is-active", active === "insights");
    toggleAdvBtn.classList.toggle("is-active", active === "advanced");
  }
  toggleStdBtn.addEventListener("click", function() {
    state.dataView = "standard";
    dataPickerSelectedPath = null;
    _setActiveToggle("standard");
    renderDataPoints();
  });
  toggleInsBtn.addEventListener("click", function() {
    state.dataView = "insights";
    dataPickerSelectedPath = null;
    _setActiveToggle("insights");
    renderDataPoints();
  });
  toggleAdvBtn.addEventListener("click", function() {
    state.dataView = "advanced";
    dataPickerSelectedPath = null;
    _setActiveToggle("advanced");
    renderDataPoints();
  });

  addParamBtn.addEventListener("click", function() {
    state.parameters.push({ name: "", type: "string", description: "", required: false });
    renderParameters();
  });

  // Improve button — real LLM call via chatCompletion.
  improveBtn.addEventListener("click", async function() {
    var seed = (seedArea.value || "").trim();
    var hasDataPoints = state.dataPoints.length > 0;
    // Pre-flight: require a non-empty seed and at least one data point.
    if (!seed || !hasDataPoints) {
      improveError.style.display = "block";
      improveError.className = "skill-form-improve-error err";
      improveError.textContent = "Add a seed prompt and select at least one data point first.";
      return;
    }
    improveError.style.display = "none";
    improveError.textContent = "";
    improveBtn.disabled = true;
    improveStatus.textContent = " · improving via " + (loadAiConfig().activeProvider || "AI") + "…";
    try {
      var cfg = loadAiConfig();
      var active = cfg.providers[cfg.activeProvider];
      var dataPointDescriptions = state.dataPoints.map(function(d) { return d.path; }).join(", ");
      // Meta-skill prompt for the Improve call. The strict rules below
      // force grounded CARE templates: engagement data is embedded in
      // <context> via {{path}} placeholders (never in <format>), and
      // examples use obviously-fake names so the run-time LLM never
      // mistakes them for real data.
      var systemPrompt =
        "You are a prompt-engineering assistant for a presales discovery tool. " +
        "Rewrite the user's seed prompt into a CARE-structured prompt with " +
        "Anthropic XML wire tags. Use exactly four sections: <context>, " +
        "<task>, <format>, <examples>. The result will be sent to an LLM " +
        "at run-time with engagement data substituted into {{path}} " +
        "placeholders, plus a separate <engagement-data> block prepended " +
        "with actual values from the user's engagement." +
        "\n\nSTRICT RULES:\n" +
        "  1. <context> MUST embed the user's selected data points as " +
        "CONCRETE DATA, using {{path}} placeholders that resolve to real " +
        "engagement values at run-time. Example: 'The customer is " +
        "{{customer.name}} in vertical {{customer.vertical}}.' NEVER " +
        "write generic 'You are an AI assistant' framing. NEVER describe " +
        "the assistant's role; describe the engagement data directly.\n" +
        "  2. <task> MUST be a single imperative sentence the LLM " +
        "executes (e.g. 'Identify the customer name from the context " +
        "above.' or 'Summarize the gaps under cyber resilience as 3-5 " +
        "exec bullets.'). NEVER ask the LLM to 'extract from a " +
        "conversation' unless the seed prompt is specifically about " +
        "parsing conversational input — the engagement data is the " +
        "context, not a conversation.\n" +
        "  3. <format> MUST describe ONLY the OUTPUT SHAPE (e.g. " +
        "'single line of plain text', 'JSON array of {x, y, z} objects'). " +
        "NEVER include the expected answer value as a target reference. " +
        "NEVER write 'The desired output should directly correspond to " +
        "<value>' or anything similar — that's data, not format. Data " +
        "belongs in <context>.\n" +
        "  4. <examples> MUST use 1-2 hypothetical input/output pairs. " +
        "Use OBVIOUSLY FAKE placeholder names like 'Example Corp', " +
        "'Sample Co.', or 'XYZ Inc.' — never use names that could be " +
        "real customers ('ACME Corporation', 'Global Solutions Inc.', " +
        "etc.) since the LLM may confuse them with actual data.\n" +
        "  5. Output ONLY the four XML blocks (in order: <context>, " +
        "<task>, <format>, <examples>). No preamble, no postscript, no " +
        "code fences, no explanation.\n\n" +
        // Relationship-rule priming, sourced from RELATIONSHIPS_METADATA.
        // The generated prompt must honor these constraints or the
        // run-time engagement-data block produces relationally-broken
        // output.
        "RELATIONSHIP RULES (derived from core/dataContract.js " +
        "RELATIONSHIPS_METADATA):\n" +
        "  R1 · ANCHOR BINDING. Every collection-entity reference MUST " +
        "include the entity's anchor field so each row has an " +
        "identifying subject. Anchors: driver.name (drivers), " +
        "environment.name (environments), instance.label (instances), " +
        "gap.description (gaps), customer.name (customer singleton). " +
        "NEVER write 'the disposition is X' without 'the disposition of " +
        "<instance.label> is X'.\n" +
        "  R2 · LEVEL vs PHASE. driver.priority, instance.criticality, " +
        "and gap.urgency are High/Medium/Low LEVELS — NOT ranks. " +
        "Multiple records can simultaneously be 'High'. Use 'list the " +
        "High-priority drivers' or 'the drivers and their priority " +
        "levels'; NEVER 'the top-priority driver' or 'rank drivers by " +
        "priority'. instance.priority (Now/Next/Later) and gap.phase " +
        "(now/next/later) ARE ordered phase-of-life sequences — those " +
        "you may rank.\n" +
        "  R3 · STATE-CONDITIONAL FIELDS. instance.disposition + " +
        ".dispositionLabel + .priority + .originId are DESIRED-state " +
        "ONLY; current-state instances have null values. " +
        "instance.mappedAssetIds[] is WORKLOAD-LAYER-only. When " +
        "referencing these fields, qualify with instance.state " +
        "(or instance.layerId for the workload case) so the LLM " +
        "answer doesn't mislead about null rows.\n" +
        "  R4 · LABEL vs RAW FK. Use the label-resolved paths " +
        "(driver.name, gap.gapTypeLabel, instance.layerLabel, " +
        "customer.verticalLabel, etc.) in narrative output — NEVER the " +
        "raw FK id form (driver.businessDriverId, gap.gapType, " +
        "instance.layerId, customer.vertical). Raw ids are for " +
        "id-matching skills only.\n" +
        "  R5 · CROSS-CUTTING CARDINALITY. gap.affectedEnvironments[] / " +
        "gap.affectedLayers[] / instance.mappedAssetIds[] are arrays " +
        "where ONE record spans multiple categories. A gap that touches " +
        "Primary DC + DR is ONE gap, not two. NEVER duplicate the record " +
        "per category in the prompt's narration.\n" +
        "  R6 · DERIVED FIELDS. gap.urgency (when urgencyOverride=false) " +
        "is derived from the linked current's criticality; gap.gapType " +
        "(when origin='autoDraft') is derived from the source " +
        "disposition. All insights.* paths are derived from §S5 " +
        "selectors. NEVER frame these as author-editable in the prompt.\n" +
        "  R7 · MULTI-HOP LABELS. gap.driverName is a 3-hop join (gap → " +
        "driver record → BUSINESS_DRIVERS.label). The runtime resolves " +
        "this; the generated prompt should reference gap.driverName " +
        "directly, NEVER walk through gap.driverId in the prompt body.\n";
      var res = await chatCompletion({
        providerKey: cfg.activeProvider,
        baseUrl:     active.baseUrl,
        model:       active.model,
        apiKey:      active.apiKey,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content:
              "Seed prompt:\n---\n" + seed + "\n---\n\n" +
              "Selected data points (schema-keyed paths):\n" + dataPointDescriptions
          }
        ]
      });
      improvedArea.value = (res && res.text) || "";
      improvedArea.setAttribute("readonly", "");
      improveStatus.textContent = "";
    } catch (e) {
      // On failure show an inline error chip + Retry button; the Improved
      // field is left intact.
      improveError.style.display = "block";
      improveError.className = "skill-form-improve-error err";
      improveError.innerHTML = "";
      var msg = mkt("span", "skill-form-improve-error-msg",
        "Improve failed: " + (e.message || String(e)) + ". Try again, or check Settings → LLM providers.");
      improveError.appendChild(msg);
      var retryBtn = mkt("button", "btn-secondary skill-form-improve-retry", "Retry");
      retryBtn.type = "button";
      retryBtn.addEventListener("click", function() { improveBtn.click(); });
      improveError.appendChild(retryBtn);
      improveStatus.textContent = "";
    } finally {
      improveBtn.disabled = false;
    }
  });

  // Edit button — unfreezes the Improved textarea for hand-edits
  editBtn.addEventListener("click", function() {
    improvedArea.removeAttribute("readonly");
    improvedArea.focus();
  });

  // Re-improve button — re-locks + re-runs Improve
  redoBtn.addEventListener("click", function() {
    improvedArea.setAttribute("readonly", "");
    improveBtn.click();
  });

  // ─── Test button ────────────────────────────────────────────────
  // Runs the current draft's improvedPrompt through the active LLM
  // provider via chatCompletion (the same transport as Improve and the
  // Canvas Chat skill runtime). {{paramName}} placeholders are NOT
  // substituted here at the author surface — they pass through verbatim;
  // full parameter substitution happens when the skill is saved and run
  // via Canvas Chat → Skills tab.
  //
  // The Test button is appended to the action bar below (Cancel / Test /
  // Save), but its output (testOut) renders above the bar so the result
  // is visible without scrolling past the buttons.
  var testBtn = mkt("button", "btn-secondary", "Test skill now");
  testBtn.type = "button";
  testBtn.setAttribute("data-skill-test", "");
  var testOut = mk("div", "ai-skill-result skill-form-test-out");
  testOut.style.display = "none";
  form.appendChild(testOut);
  testBtn.addEventListener("click", async function() {
    var draft = (improvedArea.value || "").trim();
    testOut.style.display = "block";
    if (!draft) {
      testOut.className = "ai-skill-result skill-form-test-out err";
      testOut.textContent = "Improved prompt is empty. Click Improve first, or hand-edit the Improved prompt textarea, then Test.";
      return;
    }
    testBtn.disabled = true;
    var origLabel = testBtn.textContent;
    testBtn.textContent = "Running...";
    testOut.className = "ai-skill-result skill-form-test-out running";
    testOut.textContent = "Running with " + (loadAiConfig().activeProvider || "active provider") + "...";
    try {
      var cfg = loadAiConfig();
      var active = cfg.providers[cfg.activeProvider];
      if (!active) {
        testOut.className = "ai-skill-result skill-form-test-out err";
        testOut.textContent = "No active LLM provider configured. Open Settings → AI Providers to set one up.";
        return;
      }
      // Resolve schema-keyed data paths against the active engagement
      // BEFORE sending to the LLM. Without this, {{customer.name}} etc.
      // pass through verbatim and the LLM echoes the CARE template back.
      // Parameter placeholders ({{paramName}}) still pass through verbatim
      // at the author surface; run-time substitution happens via the
      // Skills launcher flow.
      //
      // pathResolver walks ctx.<path> directly (not ctx.engagement.<path>),
      // so build a flat ctx with customer + engagementMeta + collection
      // arrays exposed at the top level for paths like {{customer.name}}.
      var engagement = getActiveEngagement();
      var collFlat = function(coll) {
        if (!coll || !Array.isArray(coll.allIds) || !coll.byId) return [];
        return coll.allIds.map(function(id) { return coll.byId[id]; }).filter(Boolean);
      };
      var skillCtx = engagement ? {
        engagement:     engagement,
        customer:       engagement.customer || {},
        engagementMeta: engagement.meta || {},
        drivers:        collFlat(engagement.drivers),
        environments:   collFlat(engagement.environments),
        instances:      collFlat(engagement.instances),
        gaps:           collFlat(engagement.gaps)
      } : {};
      var resolvedDraft = resolveTemplate(draft, skillCtx,
        { skillId: existing && existing.skillId || "skl-draft" });
      var res = await chatCompletion({
        providerKey: cfg.activeProvider,
        baseUrl:     active.baseUrl,
        model:       active.model,
        apiKey:      active.apiKey,
        messages: [
          // Hardened system prompt that stops the LLM echoing the CARE
          // XML template back. CanvasChatOverlay.runSkill uses a matching
          // contract.
          { role: "system", content:
              "You are executing a saved skill DRAFT (author preview; this is a Test run, not a final " +
              "save). The user message below contains a CARE-structured prompt (<context>, <task>, " +
              "<format>, <examples>) with engagement data already inlined. Your job is to EXECUTE the " +
              "<task> using the <context> data, producing ONLY the final answer in the shape the <format> " +
              "section specifies. " +
              "\n\nSTRICT RULES:\n" +
              "  1. DO NOT echo the prompt template back. DO NOT include <context>, <task>, <format>, or " +
              "<examples> XML tags in your response.\n" +
              "  2. DO NOT explain your reasoning, restate the task, or include preamble.\n" +
              "  3. DO NOT generate hypothetical or example values. Only emit values derived from the " +
              "<context> data provided.\n" +
              "  4. If the <context> data is missing required information, output exactly: " +
              "'[insufficient data: <what is missing>]' and nothing else.\n" +
              "  5. Match the <format> exactly.\n" +
              "  6. {{paramName}} placeholders (parameters) may still appear in the prompt verbatim " +
              "(author surface skips parameter substitution); treat them as literal '[parameter value]' " +
              "placeholders when reasoning — full parameter substitution happens at run-time via the " +
              "Skills launcher flow."
          },
          { role: "user",   content: resolvedDraft }
        ]
      });
      testOut.innerHTML = "";
      testOut.className = "ai-skill-result skill-form-test-out ok";
      var head = mk("div", "ai-skill-result-head");
      head.textContent = "Test output · " + (cfg.activeProvider || "?") + " (draft — not saved)";
      testOut.appendChild(head);
      var body = mk("pre", "ai-skill-result-body");
      body.textContent = (res && res.text) || "(empty response)";
      testOut.appendChild(body);
    } catch (e) {
      testOut.className = "ai-skill-result skill-form-test-out err";
      testOut.textContent = "Test failed: " + (e && e.message || String(e)) +
        ". Try again, or check Settings → AI Providers.";
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = origLabel;
    }
  });

  // ─── Action bar · Cancel | Test | Save ──────────────────────────
  // Order: Cancel (exit without saving), Test (validate the prompt), Save
  // (commit). The save-hint span surfaces gating reasons next to Save
  // when relevant.
  var actions = mk("div", "form-actions");
  var cancelBtn = mkt("button", "btn-secondary", "Cancel");
  cancelBtn.type = "button";
  cancelBtn.addEventListener("click", function() { form.remove(); });
  var saveBtn = mkt("button", "btn-primary", existing ? "Save changes" : "Create skill");
  saveBtn.type = "button";
  saveBtn.setAttribute("data-skill-save", "");
  var saveHint = mkt("span", "save-gate-hint", "");
  actions.appendChild(cancelBtn);
  actions.appendChild(testBtn);     // BUG-060 · Test joins the action bar
  actions.appendChild(saveBtn);
  actions.appendChild(saveHint);
  form.appendChild(actions);

  saveBtn.addEventListener("click", function() {
    var label = (labelInput.value || "").trim();
    var description = (descInput.value || "").trim();
    var seedPrompt = (seedArea.value || "").trim();
    var improvedPrompt = (improvedArea.value || "").trim();
    if (!label) { alert("Label is required."); return; }
    if (!description) { alert("Description is required."); return; }
    if (!seedPrompt) { alert("Seed prompt is required."); return; }
    if (state.outputFormat === "json-array" || state.outputFormat === "scalar") {
      if (!state.mutationPolicy) { alert("Pick a mutation policy (output format is mutating)."); return; }
    }
    var skillId = existing && existing.skillId
      ? existing.skillId
      : ("skl-" + label.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24) + "-" + Math.floor(Math.random() * 1000));
    var draft = {
      skillId:        skillId,
      label:          label,
      description:    description,
      seedPrompt:     seedPrompt,
      dataPoints:     state.dataPoints.slice(),
      improvedPrompt: improvedPrompt,
      outputFormat:   state.outputFormat,
      mutationPolicy: (state.outputFormat === "json-array" || state.outputFormat === "scalar")
                        ? state.mutationPolicy
                        : null,
      parameters:     state.parameters.slice()
    };
    var manifest = generateManifest();
    var result;
    try { result = saveV3Skill(draft, { manifest: manifest }); }
    catch (e) {
      // Surface a save/validation error inline rather than swallowing it.
      alert("Save failed (schema not yet extended for the new shape — lands at R4): " + (e && e.message || e));
      return;
    }
    if (!result || !result.ok) {
      alert("Save failed: " + ((result && result.errors) || []).map(function(e) { return e.message || e; }).join("; "));
      return;
    }
    form.remove();
    renderList(list, onChange);
    if (onChange) onChange();
  });

  adminRoot.appendChild(form);

  // Initial paints — renderOutputFormat() handles conditional mutation
  // policy rendering based on state.outputFormat (default "text" → no
  // policy radios in DOM at first paint).
  renderDataPoints();
  renderSelectedChips();
  renderOutputFormat();
  renderParameters();
  labelInput.focus();
}

// ─── Tiny DOM helpers ──────────────────────────────────────────────
function mk(tag, cls)        { var el = document.createElement(tag); if (cls) el.className = cls; return el; }
function mkt(tag, cls, txt)  { var el = mk(tag, cls); if (txt != null) el.textContent = txt; return el; }
