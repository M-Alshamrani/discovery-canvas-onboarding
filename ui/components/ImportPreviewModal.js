// ui/components/ImportPreviewModal.js
//
// Shared preview modal. All ingress paths render through this component
// after parseImportResponse + checkImportDrift have cleared the wire
// payload. The engineer sees one row per items[] entry, can toggle each
// row's accept/reject state, choose the modal-wide apply-scope, and commit
// via [Apply N selected].
//
// Contract:
//   - apply-scope picker is authoritative for instance rows
//   - LLM-hint disagreement indicator on instance.add rows
//   - initial scope from opts.defaultScope, defaulting to "current"
//   - "both" semantics: two independent records
//   - per-row kind chip (Instance / Driver / Gap) for visual segregation
//   - kind-aware editable cells (instance: label/vendor/etc; driver:
//     businessDriverId/priority/outcomes; gap: gapId read-only + closeReason)
//   - apply-scope picker renders only when >= 1 instance.add row is
//     present (driver + gap rows have no state semantics)
//   - duplicate-detection indicator; engineer overrides by leaving the
//     row checked
//
// DOM hooks:
//   - data-import-preview-row        (one per items[] entry)
//   - data-import-confidence         (per-row confidence chip)
//   - data-import-llm-state-hint     (per-row LLM state hint · instance only)
//   - data-import-apply-scope        (modal-wide scope picker; only when >= 1 instance row)
//   - data-import-state-disagreement (per-row warning indicator · instance only)
//   - data-import-kind               (per-row kind chip)
//   - data-import-duplicate          (per-row duplicate indicator)
//
// Usage:
//   import { renderImportPreview } from "/ui/components/ImportPreviewModal.js";
//   var ctl = renderImportPreview(document.body, parsedResponse, {
//     defaultScope: "desired",
//     drift:        driftResult,        // optional
//     onApply:      function(selectedItems, scope) { ... },
//     onCancel:     function() { ... }
//   });

const SCOPE_VALUES = ["current", "desired", "both"];
const CONFIDENCE_LABELS = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" };

// Per-kind chip labels (visible in the row chip + helper text).
const KIND_CHIP_LABELS = {
  "instance.add": "Instance",
  "driver.add":   "Driver",
  "gap.close":    "Close gap"
};

// Build the row state used to drive per-row checkbox + editable cells.
// Mutated in-place as the engineer toggles UI controls.
function initRowState(items, driftResult) {
  // Build a duplicate-set keyed by itemIndex for fast lookup.
  const dupIndexSet = new Set();
  if (driftResult && Array.isArray(driftResult.duplicates)) {
    driftResult.duplicates.forEach(d => { if (typeof d.itemIndex === "number") dupIndexSet.add(d.itemIndex); });
  }
  return items.map(function(item, idx) {
    // parseImportResponse normalizes older payloads that lack an explicit
    // `kind` to "instance.add", so this fallback is defensive and should be
    // reached only by payloads that bypass the parser.
    const kind = item.kind || "instance.add";
    return {
      kind:           kind,
      accepted:       true,
      data:           Object.assign({}, item.data),
      confidence:     item.confidence,
      rationale:      item.rationale || "",
      llmHintedState: (kind === "instance.add" && item.data) ? (item.data.state || null) : null,
      isDuplicate:    dupIndexSet.has(idx)
    };
  });
}

// renderImportPreview(host, parsedResponse, opts) -> { applySelected, cancel }
//   host           - DOM element to mount the modal overlay into (typically document.body)
//   parsedResponse - the validated import-subset JSON object (from parseImportResponse)
//   opts.defaultScope - "current" | "desired" | "both" (default "current")
//   opts.drift        - optional drift result (drives per-row duplicate indicators)
//   opts.onApply(selectedItems, scope) - fired when the engineer clicks [Apply N selected]
//   opts.onCancel()                    - fired on X, Esc, or overlay click
export function renderImportPreview(host, parsedResponse, opts) {
  opts = opts || {};
  var defaultScope = opts.defaultScope && SCOPE_VALUES.indexOf(opts.defaultScope) >= 0
    ? opts.defaultScope
    : "current";
  var driftResult = opts.drift || null;
  var onApply  = typeof opts.onApply  === "function" ? opts.onApply  : function() {};
  var onCancel = typeof opts.onCancel === "function" ? opts.onCancel : function() {};

  var items = (parsedResponse && Array.isArray(parsedResponse.items)) ? parsedResponse.items : [];
  var rows  = initRowState(items, driftResult);
  var scope = defaultScope;

  // Count instance.add rows; the apply-scope picker renders only when at
  // least one is present.
  var hasInstanceRows = rows.some(function(r) { return r.kind === "instance.add"; });

  // Build overlay
  var overlay = document.createElement("div");
  overlay.id = "import-preview-modal";
  overlay.className = "dialog-overlay import-preview-modal-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "import-preview-modal-title");

  var box = document.createElement("div");
  box.className = "dialog-box import-preview-modal-box";

  // Header
  var head = document.createElement("div");
  head.className = "import-preview-modal-head";
  var title = document.createElement("h2");
  title.id = "import-preview-modal-title";
  title.className = "import-preview-modal-title";
  title.textContent = "Preview import";
  head.appendChild(title);
  var closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "import-preview-modal-close";
  closeBtn.setAttribute("aria-label", "Cancel import");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", function() { cancel(); });
  head.appendChild(closeBtn);
  box.appendChild(head);

  // Top bar: apply-scope picker. Only renders when >= 1 instance row.
  if (hasInstanceRows) {
    var scopeBar = document.createElement("div");
    scopeBar.className = "import-preview-scope-bar";
    scopeBar.setAttribute("data-import-apply-scope", "");
    var scopeLabel = document.createElement("span");
    scopeLabel.className = "import-preview-scope-label";
    scopeLabel.textContent = "Apply as: ";
    scopeBar.appendChild(scopeLabel);
    SCOPE_VALUES.forEach(function(value) {
      var labelEl = document.createElement("label");
      labelEl.className = "import-preview-scope-option";
      var radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "import-apply-scope";
      radio.value = value;
      radio.checked = (value === scope);
      radio.addEventListener("change", function() {
        if (radio.checked) {
          scope = value;
          refreshRowDisagreements();
        }
      });
      labelEl.appendChild(radio);
      labelEl.appendChild(document.createTextNode(" " + value.charAt(0).toUpperCase() + value.slice(1)));
      scopeBar.appendChild(labelEl);
    });
    // Helper text when the payload is mixed (instances + non-instances).
    var nonInstanceCount = rows.filter(function(r) { return r.kind !== "instance.add"; }).length;
    if (nonInstanceCount > 0) {
      var helper = document.createElement("span");
      helper.className = "import-preview-scope-helper";
      helper.textContent = "  · applies to instance rows only (" + nonInstanceCount + " driver/gap row(s) ignore scope)";
      scopeBar.appendChild(helper);
    }
    box.appendChild(scopeBar);
  } else {
    // No instance rows: render a small lede explaining why the apply-scope
    // picker is absent.
    var noInstanceLede = document.createElement("div");
    noInstanceLede.className = "import-preview-scope-lede";
    noInstanceLede.textContent = "Driver/Gap-only import · apply-scope picker is not shown (drivers + gap closures have no current/desired distinction).";
    box.appendChild(noInstanceLede);
  }

  // Body: per-row table.
  var body = document.createElement("div");
  body.className = "import-preview-body";
  var rowEls = rows.map(function(rowState, idx) {
    var rowEl = document.createElement("div");
    rowEl.className = "import-preview-row import-preview-row-" + rowState.kind.replace(".", "-");
    rowEl.setAttribute("data-import-preview-row", String(idx));

    // Checkbox.
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = rowState.accepted;
    cb.className = "import-preview-row-accept";
    cb.addEventListener("change", function() { rowState.accepted = cb.checked; });
    rowEl.appendChild(cb);

    // Per-row kind chip.
    var kindChip = document.createElement("span");
    kindChip.className = "import-preview-kind-chip import-preview-kind-" + rowState.kind.replace(".", "-");
    kindChip.setAttribute("data-import-kind", rowState.kind);
    kindChip.textContent = KIND_CHIP_LABELS[rowState.kind] || rowState.kind;
    rowEl.appendChild(kindChip);

    // Confidence chip.
    var conf = document.createElement("span");
    conf.className = "import-preview-confidence import-preview-confidence-" + rowState.confidence;
    conf.setAttribute("data-import-confidence", rowState.confidence);
    conf.textContent = CONFIDENCE_LABELS[rowState.confidence] || rowState.confidence;
    rowEl.appendChild(conf);

    // LLM-state hint chip · only meaningful for instance.add rows.
    if (rowState.kind === "instance.add") {
      var hint = document.createElement("span");
      hint.className = "import-preview-llm-state-hint";
      hint.setAttribute("data-import-llm-state-hint", rowState.llmHintedState || "none");
      hint.textContent = rowState.llmHintedState ? "LLM: " + rowState.llmHintedState : "LLM: no hint";
      rowEl.appendChild(hint);
    }

    // Disagreement indicator - instance.add only.
    var disagree = document.createElement("span");
    disagree.className = "import-preview-state-disagreement";
    disagree.setAttribute("data-import-state-disagreement", "");
    disagree.style.display = "none";
    rowEl.appendChild(disagree);

    // Duplicate indicator; the engineer can override by leaving the row checked.
    if (rowState.isDuplicate) {
      var dup = document.createElement("span");
      dup.className = "import-preview-duplicate";
      dup.setAttribute("data-import-duplicate", "");
      dup.textContent = "⚠ already in engagement";
      dup.title = "This entity matches an existing one. Uncheck to skip, or leave checked to import anyway.";
      rowEl.appendChild(dup);
    }

    // Editable cells · kind-aware. Each kind renders the canonical
    // payload fields.
    function makeInput(field, value, opts) {
      opts = opts || {};
      var input = document.createElement("input");
      input.type = "text";
      input.value = value == null ? "" : String(value);
      input.className = "import-preview-cell import-preview-cell-" + field;
      if (opts.readOnly) { input.readOnly = true; input.title = "Read-only · this field references an existing entity"; }
      input.addEventListener("input", function() { rowState.data[field] = input.value; });
      return input;
    }
    function makeTextarea(field, value) {
      var ta = document.createElement("textarea");
      ta.value = value == null ? "" : String(value);
      ta.className = "import-preview-cell import-preview-cell-" + field + " import-preview-cell-textarea";
      ta.rows = 2;
      ta.addEventListener("input", function() { rowState.data[field] = ta.value; });
      return ta;
    }

    switch (rowState.kind) {
      case "instance.add":
        rowEl.appendChild(makeInput("label",         rowState.data.label));
        rowEl.appendChild(makeInput("vendor",        rowState.data.vendor));
        rowEl.appendChild(makeInput("vendorGroup",   rowState.data.vendorGroup));
        rowEl.appendChild(makeInput("layerId",       rowState.data.layerId));
        rowEl.appendChild(makeInput("environmentId", rowState.data.environmentId));
        rowEl.appendChild(makeInput("criticality",   rowState.data.criticality));
        rowEl.appendChild(makeInput("notes",         rowState.data.notes));
        break;
      case "driver.add":
        rowEl.appendChild(makeInput("businessDriverId", rowState.data.businessDriverId));
        rowEl.appendChild(makeInput("priority",         rowState.data.priority));
        rowEl.appendChild(makeTextarea("outcomes",      rowState.data.outcomes));
        break;
      case "gap.close":
        rowEl.appendChild(makeInput("gapId",       rowState.data.gapId, { readOnly: true }));
        rowEl.appendChild(makeTextarea("closeReason", rowState.data.closeReason));
        break;
    }

    body.appendChild(rowEl);
    return { state: rowState, el: rowEl, disagree: disagree };
  });
  box.appendChild(body);

  // Footer: row count + apply button.
  var foot = document.createElement("div");
  foot.className = "import-preview-foot";
  var countEl = document.createElement("span");
  countEl.className = "import-preview-count";
  foot.appendChild(countEl);
  var applyBtn = document.createElement("button");
  applyBtn.type = "button";
  applyBtn.className = "import-preview-apply primary-button";
  applyBtn.addEventListener("click", function() { applySelected(); });
  foot.appendChild(applyBtn);
  box.appendChild(foot);

  function refreshRowDisagreements() {
    rowEls.forEach(function(r) {
      // Only instance.add rows participate in scope-disagreement.
      if (r.state.kind !== "instance.add") return;
      var hint = r.state.llmHintedState;
      var disagrees = hint && hint !== scope && scope !== "both";
      if (disagrees) {
        r.disagree.style.display = "";
        r.disagree.textContent = "⚠ LLM hinted \"" + hint + "\"";
      } else {
        r.disagree.style.display = "none";
        r.disagree.textContent = "";
      }
    });
  }
  function refreshCount() {
    var n = rowEls.filter(function(r) { return r.state.accepted; }).length;
    // Per-kind breakdown when the selection is mixed.
    var perKind = { "instance.add": 0, "driver.add": 0, "gap.close": 0 };
    rowEls.forEach(function(r) { if (r.state.accepted) perKind[r.state.kind] = (perKind[r.state.kind] || 0) + 1; });
    var breakdown = [];
    if (perKind["instance.add"]) breakdown.push(perKind["instance.add"] + " instance" + (perKind["instance.add"] === 1 ? "" : "s"));
    if (perKind["driver.add"])   breakdown.push(perKind["driver.add"] + " driver" + (perKind["driver.add"] === 1 ? "" : "s"));
    if (perKind["gap.close"])    breakdown.push(perKind["gap.close"] + " gap close" + (perKind["gap.close"] === 1 ? "" : "s"));
    countEl.textContent = n + " of " + rowEls.length + " selected" + (breakdown.length > 0 ? " · " + breakdown.join(" · ") : "");
    applyBtn.textContent = "Apply " + n + " selected";
    applyBtn.disabled = n === 0;
  }
  rowEls.forEach(function(r) {
    r.el.querySelector(".import-preview-row-accept").addEventListener("change", refreshCount);
  });
  refreshRowDisagreements();
  refreshCount();

  // Mount.
  overlay.appendChild(box);
  (host || document.body).appendChild(overlay);

  // Overlay click + Esc handlers.
  function handleEsc(e) { if (e.key === "Escape") cancel(); }
  overlay.addEventListener("click", function(e) { if (e.target === overlay) cancel(); });
  document.addEventListener("keydown", handleEsc);

  function dismount() {
    document.removeEventListener("keydown", handleEsc);
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  function applySelected() {
    var selected = rowEls
      .filter(function(r) { return r.state.accepted; })
      .map(function(r) {
        // Include kind in the applied payload so applyImportItems can
        // dispatch on it.
        return { kind: r.state.kind, confidence: r.state.confidence, rationale: r.state.rationale, data: r.state.data };
      });
    dismount();
    onApply(selected, scope);
  }
  function cancel() {
    dismount();
    onCancel();
  }

  return { applySelected: applySelected, cancel: cancel };
}
