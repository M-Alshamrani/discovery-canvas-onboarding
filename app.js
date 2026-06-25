// app.js -- main router. Wires the topbar, stepper, footer actions, and
// keyboard shortcuts, and renders the active tab against the engagement store.

import { createEmptyEngagement } from "./schema/engagement.js";
import { clearTranscript } from "./state/chatMemory.js";
import { openSettingsModal }         from "./ui/views/SettingsModal.js";
import * as aiUndoStack              from "./state/aiUndoStack.js";
import { getActiveEngagement, setActiveEngagement, subscribeActiveEngagement } from "./state/engagementStore.js";
import { visibleEnvCount } from "./ui/components/NoEnvsCard.js";
import { APP_VERSION }               from "./core/version.js";
import { loadAiConfig, saveAiConfig } from "./core/aiConfig.js";
import { loadSkills, saveSkills }    from "./core/skillStore.js";
import { getStatus as getSaveStatus, onStatusChange as onSaveStatusChange } from "./core/saveStatus.js";
// Eagerly load filterState so its module-init applyToBody() restores the
// user's saved body[data-filter-<dim>] attributes on boot, before they
// navigate to a tab that uses FilterBar.
import "./state/filterState.js";
import { confirmAction, notifyError, notifyInfo, notifySuccess } from "./ui/components/Notify.js";
// Import data modal (Dell internal LLM workflow).
import { openImportDataModal } from "./ui/components/ImportDataModal.js";
import { buildSaveEnvelope, parseFileEnvelope, loadCanvas, suggestFilename, FILE_MIME } from "./services/canvasFile.js";
import { renderContextView }         from "./ui/views/ContextView.js";
import { renderMatrixView, stopCurrentStateCountdownTimer } from "./ui/views/MatrixView.js";
import { renderGapsEditView }        from "./ui/views/GapsEditView.js";
import { renderReportingOverview }   from "./ui/views/ReportingView.js";
import { renderSummaryHealthView }   from "./ui/views/SummaryHealthView.js";
import { renderSummaryGapsView }     from "./ui/views/SummaryGapsView.js";
import { renderSummaryVendorView }   from "./ui/views/SummaryVendorView.js";
import { renderSummaryVendorCriticalityView } from "./ui/views/SummaryVendorCriticalityView.js";
import { renderSummaryRoadmapView }  from "./ui/views/SummaryRoadmapView.js";
import { renderExportReportView }    from "./ui/views/ExportReportView.js";

// Stepper steps render with a mono leading-zero pattern (01 Context,
// 02 Current state, ...). The label is just the readable name;
// renderStepper builds two-span markup so the leading number can be
// styled independently of the sentence-case label.
var STEPS = [
  { id: "context",   num: "01", label: "Context"       },
  { id: "current",   num: "02", label: "Current state" },
  { id: "desired",   num: "03", label: "Desired state" },
  { id: "gaps",      num: "04", label: "Gaps"          },
  { id: "reporting", num: "05", label: "Reporting"     }
];

// Reporting sub-tabs. There is intentionally no standalone "Services scope"
// tab: per-gap and per-project services info already lives on the gap drawer
// body, the Roadmap project-card chip row, and the Tab 4 multi-chip selector.
var REPORTING_TABS = [
  { id: "overview", label: "Overview"      },
  { id: "health",   label: "Heatmap"       },
  { id: "gaps",     label: "Gaps board"    },
  { id: "vendor",   label: "Vendor mix"    },
  { id: "vendorCrit", label: "Vendor criticality" },
  { id: "roadmap",  label: "Roadmap"       },
  { id: "export",   label: "Export report" }
];

var currentStep         = "context";
var currentReportingTab = "overview";

window.renderStepperForTests = renderStepper;

document.addEventListener("DOMContentLoaded", function() {
  // Boot-seed the engagement store. The store rehydrates from localStorage
  // at module load and either restores a persisted engagement or leaves it
  // null; on a cold boot we seed an empty engagement here so views render
  // against a stable shape (never null) from the first paint. The seed is
  // persisted, so subsequent reloads skip this branch.
  if (!getActiveEngagement()) {
    setActiveEngagement(createEmptyEngagement());
  }
  renderHeaderMeta();
  renderStepper();
  renderStage();
  wireFooter();
  wireSettingsBtn();
  wireUndoBtn();
  wireTopbarAiBtn();
  wireAiAssistShortcut();
  wireTopbarAiNotesBtn();
  wireAiNotesShortcut();
  wireTopbarLabBtn();
  // Repaint the secondary line whenever the save-status bus emits, so
  // "Saving..." -> "Saved just now" without a full re-render. The 30s
  // interval keeps the relative "Saved 2m ago" label incrementing.
  onSaveStatusChange(renderSessionStripStatus);
  onSaveStatusChange(updateTabTitle);
  setInterval(renderSessionStripStatus, 30 * 1000);
  updateTabTitle();
  // Shell-repaint listener. The engagement store is the source of truth:
  // every committed action and every setActiveEngagement (demo loader,
  // new session, file-open, AI undo) notifies subscribers. Repainting the
  // header, stepper, and current tab here keeps the shell in sync on any
  // engagement mutation -- including the stepper's Tab 4/5 disabled state,
  // which tracks the visible-environment count. Views are designed to
  // re-mount on engagement change.
  window.__shellRenderSubscriber = function() {
    renderHeaderMeta();
    renderStepper();
    renderStage();
  };
  subscribeActiveEngagement(window.__shellRenderSubscriber);

  // Cross-tab navigation event. GapsEditView dispatches
  // this when the user clicks a linked-instance row in a gap's detail
  // panel. We switch to the right tab (current → Tab 2, desired → Tab 3)
  // and scroll the matching tile into view with a brief highlight.
  document.addEventListener("dell-canvas:navigate-to-tile", function(ev) {
    var d = ev.detail || {};
    if (!d.state || !d.instanceId) return;
    currentStep = (d.state === "current") ? "current" : "desired";
    renderStepper();
    renderStage();
    // After render, scroll + highlight on the next tick.
    setTimeout(function() {
      var sel = '[data-instance-id="' + d.instanceId + '"]';
      var node = document.querySelector(sel);
      if (node) {
        node.scrollIntoView({ block: "center", behavior: "smooth" });
        node.classList.add("nav-highlight");
        setTimeout(function() { node.classList.remove("nav-highlight"); }, 1800);
      }
    }, 50);
  });
  // If the user installed Canvas as a PWA and double-clicked a .canvas
  // file, Chromium's launchQueue delivers the file handle here. We reuse
  // the same openFileInput-change pipeline by routing through a synthetic
  // File → handleOpenedFile (set up in wireFooter).
  if ("launchQueue" in window && "files" in window.LaunchParams.prototype) {
    window.launchQueue.setConsumer(async function(launchParams) {
      if (!launchParams.files || !launchParams.files.length) return;
      for (var i = 0; i < launchParams.files.length; i++) {
        try {
          var handle = launchParams.files[i];
          var file = await handle.getFile();
          // Reuse footer's handler via a dispatched change event on
          // the hidden input. Keeps one code path for file loading.
          var input = document.getElementById("openFileInput");
          if (!input) return;
          // File input .files is read-only in HTML; use DataTransfer
          // to construct a FileList.
          var dt = new DataTransfer();
          dt.items.add(file);
          input.files = dt.files;
          input.dispatchEvent(new Event("change", { bubbles: true }));
        } catch (e) {
          console.error("[launchQueue] failed to open file:", e);
        }
      }
    });
  }
});

function wireSettingsBtn() {
  var btn = document.getElementById("settingsBtn");
  if (btn) btn.addEventListener("click", openSettingsModal);
}

// Skill Builder is opened from a "+ Author new skill" affordance inside
// the Canvas Chat right-rail; the shared entry point lives here.
import { openSkillBuilderOverlay } from "./ui/skillBuilderOpener.js";

// Topbar wiring is null-safe: some of these buttons are not present in
// index.html, so the wire functions no-op when the element is missing.
function wireTopbarLabBtn() {
  var btn = document.getElementById("topbarLabBtn");
  if (!btn) return;
  btn.addEventListener("click", openSkillBuilderOverlay);
}

// Global "AI Assist" button click handler. Opens Canvas Chat -- the
// unified chat surface with the right-rail saved-skill cards and the
// "+ Author new skill" affordance.
function wireTopbarAiBtn() {
  var btn = document.getElementById("topbarAiBtn");
  if (!btn) return;
  btn.addEventListener("click", async function() {
    try {
      var mod = await import("./ui/views/CanvasChatOverlay.js");
      mod.openCanvasChat();
    } catch (e) {
      console.error("[CanvasChat] failed to open from AI Assist button:", e);
    }
  });
}

// Cmd+K / Ctrl+K shortcut (command-palette pattern). Registered
// unconditionally and opens Canvas Chat -- the same surface as the topbar
// AI Assist button -- so both entry points stay consistent.
function wireAiAssistShortcut() {
  document.addEventListener("keydown", async function(e) {
    var isMod = e.metaKey || e.ctrlKey;
    if (!isMod || (e.key !== "k" && e.key !== "K")) return;
    // Prevent the browser's default Cmd+K handling so the shortcut is
    // reliable regardless of focus.
    e.preventDefault();
    try {
      var mod = await import("./ui/views/CanvasChatOverlay.js");
      mod.openCanvasChat();
    } catch (err) {
      console.error("[CanvasChat] failed to open from Cmd+K:", err);
    }
  });
}

// Second topbar AI affordance. Opens the Workshop Notes overlay. Paired
// with the AI Assist button: AI Assist is conversational (Cmd+K); AI Notes
// is workshop-time batched (Cmd+Shift+N).
function wireTopbarAiNotesBtn() {
  var btn = document.getElementById("topbarAiNotesBtn");
  if (!btn) return;
  btn.addEventListener("click", async function() {
    try {
      var mod = await import("./ui/views/WorkshopNotesOverlay.js");
      mod.openWorkshopNotesOverlay();
    } catch (e) {
      console.error("[WorkshopNotes] failed to open from AI Notes button:", e);
    }
  });
}

// Cmd+Shift+N / Ctrl+Shift+N keyboard shortcut. Opens the same Workshop
// Notes overlay as the topbar AI Notes button. Registered unconditionally.
function wireAiNotesShortcut() {
  document.addEventListener("keydown", async function(e) {
    var isMod = e.metaKey || e.ctrlKey;
    if (!isMod || !e.shiftKey) return;
    if (e.key !== "n" && e.key !== "N") return;
    e.preventDefault();
    try {
      var mod = await import("./ui/views/WorkshopNotesOverlay.js");
      mod.openWorkshopNotesOverlay();
    } catch (err) {
      console.error("[WorkshopNotes] failed to open from Cmd+Shift+N:", err);
    }
  });
}

function wireUndoBtn() {
  var btn      = document.getElementById("undoBtn");
  var allBtn   = document.getElementById("undoAllBtn");
  var countEl  = document.getElementById("undoCountBadge");
  if (!btn) return;

  function refresh() {
    var depth = aiUndoStack.depth();
    if (depth === 0) {
      btn.style.display = "none";
      if (allBtn) allBtn.style.display = "none";
      return;
    }
    btn.style.display = "";
    // Tooltip lists what will be reverted, in order.
    var labels = aiUndoStack.recentLabels(5);
    var tooltipLines = ["Undo last (" + depth + " AI change" + (depth === 1 ? "" : "s") + " tracked):"];
    labels.forEach(function(l, i) { tooltipLines.push((i + 1) + ". " + l); });
    if (depth > labels.length) tooltipLines.push("… + " + (depth - labels.length) + " older");
    btn.title = tooltipLines.join("\n");
    if (countEl) countEl.textContent = String(depth);

    if (allBtn) {
      if (depth >= 2) {
        allBtn.style.display = "";
        allBtn.title = "Revert ALL " + depth + " tracked AI change" + (depth === 1 ? "" : "s");
      } else {
        allBtn.style.display = "none";
      }
    }
  }

  btn.addEventListener("click", function() {
    var entry = aiUndoStack.undoLast();
    if (!entry) return;
    // The engagement-store subscriber re-renders; no direct render call needed.
  });

  if (allBtn) {
    allBtn.addEventListener("click", function() {
      if (aiUndoStack.depth() < 2) return;
      var depth = aiUndoStack.depth();
      confirmAction({
        title: "Revert all AI changes?",
        body: "This rolls back " + depth + " tracked AI mutation" + (depth === 1 ? "" : "s") +
              ". The undo stack itself can't be reversed.",
        confirmLabel: "Revert " + depth,
        danger: true
      }).then(function(yes) { if (yes) aiUndoStack.undoAll(); });
    });
  }

  aiUndoStack.onUndoChange(refresh);
  refresh();
}

function renderHeaderMeta() {
  // Session strip is a single horizontal line with a vertical divider
  // between the customer identity and the save status:
  //   [icon] [customer name]  |  [dot] Saved 2m ago
  var el = document.getElementById("sessionMetaHeader");
  if (!el) {
    var verEl = document.getElementById("appVersionChip");
    if (verEl) verEl.textContent = "Canvas v" + APP_VERSION;
    return;
  }
  // Read identity from the active engagement: customer.name + meta.isDemo.
  var _engHdr = getActiveEngagement();
  var customerName = (_engHdr && _engHdr.customer && _engHdr.customer.name) || "";
  var hasName      = !!customerName.trim();
  var isDemo       = !!(_engHdr && _engHdr.meta && _engHdr.meta.isDemo);

  el.innerHTML = "";
  el.setAttribute("data-empty", hasName || isDemo ? "false" : "true");

  // Lucide building-2 (corporate office tower) icon.
  var iconNS = "http://www.w3.org/2000/svg";
  var icon = document.createElementNS(iconNS, "svg");
  icon.setAttribute("class", "session-strip-icon");
  icon.setAttribute("width", "14");
  icon.setAttribute("height", "14");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "1.6");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.setAttribute("aria-hidden", "true");
  [
    "M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z",
    "M6 12H4a2 2 0 0 0-2 2v8h4",
    "M18 9h2a2 2 0 0 1 2 2v11h-4",
    "M10 6h4",
    "M10 10h4",
    "M10 14h4",
    "M10 18h4"
  ].forEach(function(d) {
    var p = document.createElementNS(iconNS, "path");
    p.setAttribute("d", d);
    icon.appendChild(p);
  });
  el.appendChild(icon);

  // Name
  var nameEl = document.createElement("span");
  nameEl.className = "session-strip-name";
  nameEl.textContent = hasName
    ? customerName
    : (isDemo ? "Demo session" : "New session");
  el.appendChild(nameEl);

  // Vertical divider
  var divider = document.createElement("span");
  divider.className = "session-strip-divider";
  divider.setAttribute("aria-hidden", "true");
  el.appendChild(divider);

  // Status (dot + text inline)
  var statusLine = document.createElement("span");
  statusLine.className = "session-strip-status";
  var dot = document.createElement("span");
  dot.className = "session-strip-dot";
  dot.setAttribute("aria-hidden", "true");
  statusLine.appendChild(dot);
  var statusText = document.createElement("span");
  statusText.className = "session-strip-status-text";
  statusLine.appendChild(statusText);
  el.appendChild(statusLine);

  // "Updated HH:MM" segment after the save indicator. Populated by
  // renderSessionStripStatus once the session has a savedAt.
  var divider2 = document.createElement("span");
  divider2.className = "session-strip-divider session-strip-divider-2";
  divider2.setAttribute("aria-hidden", "true");
  el.appendChild(divider2);
  var updatedEl = document.createElement("span");
  updatedEl.className = "session-strip-updated";
  updatedEl.setAttribute("data-empty", "true");
  el.appendChild(updatedEl);

  renderSessionStripStatus();

  var verEl2 = document.getElementById("appVersionChip");
  if (verEl2) verEl2.textContent = "Canvas v" + APP_VERSION;
}

// Repaint just the secondary line. Called on every save-status emit and on
// a 30s interval so "Saved 2m ago" keeps incrementing.
//
// State priority (highest first):
//   isDemo=true                 -> "Demo session" / Dell-blue dot
//   status=saving (transient)   -> "Saving..."   / amber
//   status=saved + savedAt      -> "Saved Xs ago" / green
//   has customer name           -> "Not yet saved" / gray
//   nothing yet                 -> "Empty canvas" / gray
//
// isDemo precedes saving because demo state is stable (you're viewing
// example data); flipping a demo session to "Saving... -> Saved" on
// every emit would be misleading. Once the user types into Tab 1 the
// applyContextSave flips isDemo=false and the indicator normalizes.
function renderSessionStripStatus() {
  var statusLine = document.querySelector(".session-strip-status");
  if (!statusLine) return;
  var dot  = statusLine.querySelector(".session-strip-dot");
  var text = statusLine.querySelector(".session-strip-status-text");
  if (!dot || !text) return;

  var snap = getSaveStatus();
  var _engStr = getActiveEngagement();
  var hasName = !!(_engStr && _engStr.customer && _engStr.customer.name && _engStr.customer.name.trim());
  var isDemo  = !!(_engStr && _engStr.meta && _engStr.meta.isDemo);
  var state   = "idle";
  var label   = "Empty canvas";

  if (isDemo) {
    state = "demo"; label = "Demo session";
  } else if (snap.status === "saving") {
    state = "saving"; label = "Saving...";
  } else if (snap.status === "saved" && snap.savedAt) {
    state = "saved"; label = "Saved " + relativeSavedAgo(snap.savedAt);
  } else if (hasName) {
    state = "saved"; label = "Not yet saved";
  } else {
    state = "idle"; label = "Empty canvas";
  }

  dot.setAttribute("data-state", state);
  text.textContent = label;

  // "Updated HH:MM" segment after the save indicator. Hidden when there's
  // no savedAt (idle / fresh canvas).
  var updatedEl = document.querySelector(".session-strip-updated");
  if (updatedEl) {
    if (snap.savedAt) {
      // Compact eyebrow + value pattern matches the rest of the topbar
      // capsule (mono caps for the meta label, regular weight for value).
      updatedEl.innerHTML = "";
      var lbl = document.createElement("span");
      lbl.className = "session-strip-updated-label";
      lbl.textContent = "Updated";
      var val = document.createElement("span");
      val.className = "session-strip-updated-value";
      val.textContent = formatUpdatedAt(snap.savedAt);
      updatedEl.appendChild(lbl);
      updatedEl.appendChild(val);
      updatedEl.setAttribute("title", "Last saved " + formatUpdatedAtFull(snap.savedAt));
      updatedEl.setAttribute("data-empty", "false");
    } else {
      updatedEl.textContent = "";
      updatedEl.removeAttribute("title");
      updatedEl.setAttribute("data-empty", "true");
    }
  }
}

// Formats a timestamp for the session strip's "Updated …" segment.
// Same-day saves show only the time so the line stays compact; older
// saves spell out the date. The hover title always shows the full
// date + time for precise reference.
function formatUpdatedAt(ts) {
  var d = new Date(ts);
  var now = new Date();
  var sameDay = d.getFullYear() === now.getFullYear() &&
                d.getMonth()    === now.getMonth() &&
                d.getDate()     === now.getDate();
  var hh = String(d.getHours()).padStart(2, "0");
  var mm = String(d.getMinutes()).padStart(2, "0");
  var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  if (sameDay) return "Today " + hh + ":" + mm;
  var thisYear = d.getFullYear() === now.getFullYear();
  if (thisYear) return months[d.getMonth()] + " " + d.getDate() + " · " + hh + ":" + mm;
  return months[d.getMonth()] + " " + d.getDate() + " " + d.getFullYear() + " · " + hh + ":" + mm;
}

function formatUpdatedAtFull(ts) {
  var d = new Date(ts);
  var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  var hh = String(d.getHours()).padStart(2, "0");
  var mm = String(d.getMinutes()).padStart(2, "0");
  return months[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear() + " at " + hh + ":" + mm;
}

// The browser tab title carries a `•` prefix while the canvas is in an
// unsaved/saving state, reverting to the plain title once saved. Pairs
// with the topbar session strip so users juggling browser tabs can spot
// which canvas needs attention.
function updateTabTitle() {
  var snap = getSaveStatus();
  var base = "Dell Discovery Canvas";
  var prefix = "";
  var _engTab = getActiveEngagement();
  if (snap.status === "saving") prefix = "• ";
  else if (snap.status === "idle" && _engTab && _engTab.customer && _engTab.customer.name && _engTab.customer.name.trim()) {
    prefix = "• ";
  }
  document.title = prefix + base;
}

function relativeSavedAgo(ts) {
  var deltaMs = Date.now() - ts;
  if (deltaMs < 0) deltaMs = 0;
  var sec = Math.floor(deltaMs / 1000);
  if (sec < 5)   return "just now";
  if (sec < 60)  return sec + "s ago";
  var min = Math.floor(sec / 60);
  if (min < 60)  return min + "m ago";
  var hr  = Math.floor(min / 60);
  if (hr  < 24)  return hr + "h ago";
  var day = Math.floor(hr / 24);
  return day + "d ago";
}

function renderStepper() {
  var stepper = document.getElementById("stepper");
  if (!stepper) return;
  stepper.innerHTML = "";
  // Tabs 4 (gaps) and 5 (reporting) are disabled when the engagement has
  // zero visible environments. Tabs 2 and 3 (current/desired) stay active
  // because they show a center info-card pointing back to Tab 1.
  var visibleEnvs = visibleEnvCount(getActiveEngagement());
  var DISABLED_WHEN_NO_ENVS = { gaps: true, reporting: true };
  STEPS.forEach(function(step) {
    var div = document.createElement("div");
    var isDisabled = visibleEnvs === 0 && DISABLED_WHEN_NO_ENVS[step.id] === true;
    div.className = "step"
      + (step.id === currentStep ? " active" : "")
      + (isDisabled ? " step-disabled" : "");
    if (isDisabled) {
      div.setAttribute("aria-disabled", "true");
      div.setAttribute("title", "Add at least one environment in Tab 1 (Context) first.");
    }
    // Mono leading-zero number + sans sentence-case label.
    var num = document.createElement("span");
    num.className = "step-num";
    num.textContent = step.num;
    var lbl = document.createElement("span");
    lbl.className = "step-label";
    lbl.textContent = step.label;
    div.appendChild(num);
    div.appendChild(lbl);
    div.addEventListener("click", function() {
      // Disabled steps are non-interactive.
      if (isDisabled) return;
      currentStep = step.id;
      renderStepper();
      renderStage();
    });
    stepper.appendChild(div);
  });
}
export { renderStepper };

function renderStage() {
  var left  = document.getElementById("main-left");
  var right = document.getElementById("main-right");
  if (!left || !right) return;
  stopCurrentStateCountdownTimer();
  left.innerHTML  = "";
  right.innerHTML = "";

  // View renderers take (left, right, _legacySession); the third argument
  // is unused (every read goes through getActiveEngagement), so pass null.
  switch (currentStep) {
    case "context":   renderContextView(left, right, null);                          break;
    case "current":   renderMatrixView(left, right, null, { stateFilter:"current"}); break;
    case "desired":   renderMatrixView(left, right, null, { stateFilter:"desired"}); break;
    case "gaps":      renderGapsEditView(left, right, null);                         break;
    case "reporting": renderReportingStep(left, right);                              break;
  }
}

function renderReportingStep(left, right) {
  // Sub-tab bar
  var tabBar = document.createElement("div");
  tabBar.id = "summary-tabs";

  REPORTING_TABS.forEach(function(tab) {
    var btn = document.createElement("div");
    btn.className = "summary-tab" + (tab.id === currentReportingTab ? " active" : "");
    btn.textContent = tab.label;
    btn.addEventListener("click", function() {
      currentReportingTab = tab.id;
      left.innerHTML  = "";
      right.innerHTML = "";
      left.appendChild(tabBar);
      tabBar.querySelectorAll(".summary-tab").forEach(function(b) {
        b.classList.toggle("active", b.textContent === tab.label);
      });
      renderReportingTab(left, right);
    });
    tabBar.appendChild(btn);
  });

  left.appendChild(tabBar);
  renderReportingTab(left, right);
}

function renderReportingTab(left, right) {
  switch (currentReportingTab) {
    case "overview": renderReportingOverview(left, right);  break;
    case "health":   renderSummaryHealthView(left, right);  break;
    case "gaps":     renderSummaryGapsView(left, right);    break;
    case "vendor":   renderSummaryVendorView(left, right);  break;
    case "vendorCrit": renderSummaryVendorCriticalityView(left, right); break;
    case "roadmap":  renderSummaryRoadmapView(left, right); break;
    case "export":   renderExportReportView(left, right);   break;
  }
}

function wireFooter() {
  var exportBtn    = document.getElementById("exportBtn");
  var openFileBtn  = document.getElementById("openFileBtn");
  var openFileIn   = document.getElementById("openFileInput");
  var importDataBtn= document.getElementById("importDataBtn");
  var demoBtn      = document.getElementById("demoBtn");
  var newSessionBtn= document.getElementById("newSessionBtn");
  var clearAllBtn  = document.getElementById("clearAllBtn");

  // Import data button (Dell internal LLM workflow). Clicking opens the
  // 2-step modal (generate instructions + import the JSON response); the
  // modal owns the downstream pipeline and we just hand it the engagement
  // getter/setter.
  wireImportDataBtn(importDataBtn);

  // "Save to file" bundles the session, skills, and provider config (keys
  // opt-in) into a single .canvas file the user can re-open later, back up,
  // or hand to a colleague.
  if (exportBtn) {
    exportBtn.addEventListener("click", function() {
      openSaveDialog();
    });
  }

  // "Open file": the user selects a .canvas file; the parser and migrator
  // apply the envelope and the engagement store re-renders the app.
  if (openFileBtn && openFileIn) {
    openFileBtn.addEventListener("click", function() { openFileIn.click(); });
    openFileIn.addEventListener("change", function(ev) {
      var file = ev.target.files && ev.target.files[0];
      if (!file) return;
      openFileIn.value = ""; // allow re-selecting the same file later
      handleOpenedFile(file);
    });
  }

  if (demoBtn) {
    demoBtn.addEventListener("click", function() {
      confirmAction({
        title: "Load demo session?",
        body: "This replaces the current canvas with the Meridian Heritage Development Authority (MHDA) / Site 1 + Site 2 + Azure demo. Anything you've typed is lost (use Save to file first if you want to keep it).",
        confirmLabel: "Load demo",
        danger: true
      }).then(async function(yes) {
        if (!yes) return;
        // The demo engagement (core/demoEngagement.js) is the single
        // source of truth; setActiveEngagement is the authoritative write
        // and persistence is handled by the store.
        try {
          var demoMod    = await import("./core/demoEngagement.js");
          var storeMod   = await import("./state/engagementStore.js");
          var v3eng    = demoMod.loadDemo();
          storeMod.setActiveEngagement(v3eng);
        } catch (e) {
          console.error("[demo] v3-native demo failed to load:", e);
        }
        currentStep = "reporting"; currentReportingTab = "overview";
        renderHeaderMeta(); renderStepper(); renderStage();
      });
    });
  }

  if (newSessionBtn) {
    newSessionBtn.addEventListener("click", function() {
      confirmAction({
        title: "Start fresh?",
        body: "This wipes the canvas and starts a brand-new session. Anything you've typed is lost (use Save to file first to keep it).",
        confirmLabel: "Start fresh",
        danger: true
      }).then(function(yes) {
        if (!yes) return;
        // Session reset. Order matters: clear chat memory FIRST while we
        // still have the prior engagementId, THEN swap the engagement,
        // THEN clear AI undo, so subscribers see a fully coherent
        // post-reset state.
        try {
          var _priorEng = getActiveEngagement();
          var _priorEngId = _priorEng && _priorEng.meta && _priorEng.meta.engagementId;
          if (_priorEngId) {
            try { clearTranscript(_priorEngId); }
            catch (_e) { console.warn("[reset] clearTranscript failed:", _e && _e.message); }
          }
        } catch (_e) { /* defensive -- never let chat-memory cleanup block reset */ }
        setActiveEngagement(createEmptyEngagement());
        try { aiUndoStack.clear(); } catch (_e) { /* AI undo not loaded -- harmless */ }
        currentStep = "context"; currentReportingTab = "overview";
        renderHeaderMeta(); renderStepper(); renderStage();
      });
    });
  }

  // "Clear all data" wipes every dell_discovery_* and ai_* localStorage
  // key and reloads the page. This is distinct from "+ New session": that
  // only empties the current session, whereas Clear-all also discards the
  // AI skills library, provider config, and undo history. It is the
  // deliberate "treat me like a brand-new user" escape hatch.

  // Save dialog, with an opt-in checkbox for API keys.
  function openSaveDialog() {
    document.getElementById("save-dialog")?.remove();
    var overlay = document.createElement("div");
    overlay.id = "save-dialog";
    overlay.className = "dialog-overlay";
    var box = document.createElement("div");
    box.className = "dialog-box";
    box.innerHTML =
      '<div class="dialog-title">Save to file</div>' +
      '<p class="dialog-body">Saves your session, AI skills library, and provider settings to a <code>.canvas</code> file. Re-open it later, back it up, or share with a colleague.</p>' +
      '<label class="save-dialog-check"><input id="saveInclKeysChk" type="checkbox" /> ' +
      'Also include my AI provider API keys in the file' +
      '<span class="save-dialog-note">Default: off (keys stay on your machine). Tick only if you want the recipient to use your exact AI setup , anyone with the file can use your keys.</span>' +
      '</label>' +
      '<div class="form-actions">' +
      '<button id="saveDialogCancel" class="btn-secondary">Cancel</button>' +
      '<button id="saveDialogOk" class="btn-primary">↓ Save to file</button>' +
      '</div>';
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    overlay.addEventListener("click", function(e) { if (e.target === overlay) overlay.remove(); });
    document.getElementById("saveDialogCancel").addEventListener("click", function() { overlay.remove(); });
    document.getElementById("saveDialogOk").addEventListener("click", function() {
      var includeApiKeys = document.getElementById("saveInclKeysChk").checked;
      // Save the engagement in its native shape, bundled with the skills
      // library and provider settings. The engagement is validated here; on
      // failure we surface the reason rather than write an invalid file.
      var result = buildSaveEnvelope(getActiveEngagement(), {
        skills:         loadSkills(),
        providerConfig: loadAiConfig(),
        includeApiKeys: includeApiKeys
      });
      if (!result.ok) {
        notifyError({ title: "Couldn't save", body: (result.errors || ["The session could not be validated."]).join(" ") });
        return;
      }
      var blob = new Blob([JSON.stringify(result.envelope, null, 2)], { type: FILE_MIME });
      var url  = URL.createObjectURL(blob);
      var a    = document.createElement("a");
      a.href = url;
      a.download = suggestFilename(getActiveEngagement());
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      overlay.remove();
    });
  }

  // Open-file flow. Reads the blob, parses it, optionally prompts the user
  // to apply API keys (only if the file carried them), migrates the
  // session, and writes the result to the engagement store to refresh the UI.
  function handleOpenedFile(file) {
    var reader = new FileReader();
    reader.onerror = function() {
      notifyError({ title: "Couldn't read the file", body: "The file may not be readable. Try downloading it again." });
    };
    reader.onload = function() {
      var env;
      try { env = parseFileEnvelope(String(reader.result || "")); }
      catch (e) {
        notifyError({ title: "Can't open this file", body: e.message || String(e) });
        return;
      }

      var hasKeys = env.providerKeys && Object.keys(env.providerKeys).length > 0;
      function continueOpen(applyKeys) {
        // Load the engagement in its native shape (validated against the
        // schema). Files from an older app version are rejected with a clear
        // message rather than silently mangled.
        loadCanvas(env, { applyApiKeys: applyKeys }).then(function(res) {
          if (!res.ok) {
            if (res.error && res.error.code === "FILE_FROM_PREVIOUS_VERSION") {
              notifyError({ title: "This file is from a previous version", body: "It was saved by an older build of Canvas and can't be opened here. Start a fresh session." });
            } else {
              notifyError({ title: "Can't open this file", body: (res.error && res.error.message) || "The file could not be loaded." });
            }
            return;
          }
          setActiveEngagement(res.engagement);
          saveSkills(res.skills);
          if (res.providerConfig) saveAiConfig(res.providerConfig);
          var body = "Saved by Canvas v" + res.savedAppVersion +
            (res.savedAt ? " at " + res.savedAt : "");
          if (res.warnings && res.warnings.length) body += " · " + res.warnings.length + " note" + (res.warnings.length === 1 ? "" : "s");
          notifySuccess({ title: "Opened " + (file.name || "file"), body: body });
        });
      }
      if (hasKeys) {
        confirmAction({
          title: "Apply included API keys?",
          body: "This file includes AI provider API keys. Confirm to replace your current keys with the file's. Cancel to keep your own (the file's keys are ignored).",
          confirmLabel: "Apply file's keys",
          cancelLabel:  "Keep my keys"
        }).then(function(yes) { continueOpen(!!yes); });
      } else {
        continueOpen(false);
      }
    };
    reader.readAsText(file);
  }

  if (clearAllBtn) {
    clearAllBtn.addEventListener("click", function() {
      confirmAction({
        title: "Clear ALL app data?",
        body: "This wipes the session (customer, drivers, instances, gaps), the AI skills library, AI provider config and API keys, and the undo history. Cannot be undone. Save to file first if you want a backup.",
        confirmLabel: "Clear everything",
        danger: true
      }).then(function(yes) {
        if (!yes) return;
        try { localStorage.clear(); } catch (e) { /* private mode , ignore */ }
        window.location.href = window.location.pathname + "?cleared=" + Date.now();
      });
    });
  }
}

// Import data button wiring. Opens the 2-step modal that drives the Dell
// internal-LLM workflow (generate context-aware instructions + import the
// JSON response). The modal owns the full downstream pipeline; this wrapper
// just bridges the engagement getter/setter.
function wireImportDataBtn(importDataBtn) {
  if (!importDataBtn) return;
  importDataBtn.addEventListener("click", function() {
    openImportDataModal({
      host:                document.body,
      getActiveEngagement: getActiveEngagement,
      // commitImport receives the full applier result
      // ({ engagement, addedInstanceIds, errors }) so partial failures
      // (e.g. a row that failed schema validation at addInstance) surface
      // to the engineer instead of being silently dropped behind a success
      // notification. Never claim success on partial failure.
      commitImport:        function(applierResult) {
        var engagement = applierResult && applierResult.engagement;
        var addedIds   = (applierResult && applierResult.addedInstanceIds) || [];
        var errors     = (applierResult && applierResult.errors) || null;
        if (engagement) {
          // Commit the post-applier engagement; the store subscriber
          // re-renders the matrix view with the new instances and their
          // iLLM badges.
          setActiveEngagement(engagement);
        }
        if (errors && errors.length > 0) {
          // Partial-failure path: some rows landed, some didn't. Notify
          // with the count of each.
          var failedDetail = errors.slice(0, 3).map(function(e) {
            var firstMsg = (e.errors && e.errors[0] && e.errors[0].message) || "validation error";
            return "row " + (e.itemIndex + 1) + ": " + firstMsg;
          }).join("; ");
          if (errors.length > 3) failedDetail += " (+ " + (errors.length - 3) + " more)";
          notifyError({
            title: "Partial import: " + addedIds.length + " applied, " + errors.length + " failed",
            body:  failedDetail
          });
        } else {
          notifySuccess({
            title: "Imported " + addedIds.length + " instance" + (addedIds.length === 1 ? "" : "s"),
            body:  "Click any tile to edit or save to lock in the engineer-confirmed values (the iLLM badge auto-clears on save)."
          });
        }
      },
      // Default to "current": most workshops start by capturing what the
      // customer has today before mapping the future state.
      defaultScope: "current"
    });
  });
}
