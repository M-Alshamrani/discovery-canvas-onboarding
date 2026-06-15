// ui/views/WorkshopNotesOverlay.js — Workshop Notes overlay UI.
//
// Dual-pane layout:
//   - Lower pane: the engineer's raw bullets (auto-bullet editor,
//     append-only, auto-saved to localStorage under workshopNotesDraft_v1)
//   - Upper pane: AI-structured markdown notes plus per-mapping
//     suggestion rows tinted by HIGH / MEDIUM / LOW confidence
//
// From the upper pane the engineer can push notes to the AI, re-evaluate
// all, and [Import to canvas] — which feeds the structured mappings into
// the importer pipeline.
//
// USAGE:
//   import { openWorkshopNotesOverlay } from "/ui/views/WorkshopNotesOverlay.js";
//   openWorkshopNotesOverlay();   // reads engagement + provider from globals
//
// The overlay is mounted via openOverlay (ui/components/Overlay.js) so it
// inherits ESC handling, backdrop click, and stack-aware side-panel
// behavior. The dual-pane DOM is built by buildWorkshopNotesBody and
// passed as opts.body to openOverlay.

import { openOverlay, closeOverlay } from "../components/Overlay.js";
import { pushNotesToAi } from "../../services/workshopNotesService.js";
import { transformOverlayToImportPayload } from "../../services/workshopNotesImportAdapter.js";
import { parseImportResponse } from "../../services/importResponseParser.js";
import { checkImportDrift } from "../../services/importDriftCheck.js";
import { applyImportItems } from "../../services/importApplier.js";
import { renderImportPreview } from "../components/ImportPreviewModal.js";
import { getActiveEngagement, setActiveEngagement } from "../../state/engagementStore.js";
import { notifyInfo, notifySuccess } from "../components/Notify.js";

// notifyError MUST NOT be called from inside this overlay. notifyError
// calls openOverlay({kind:"notify-error"}), which is a SINGLETON: it
// closes the workshop overlay before opening the error modal, and the
// engineer loses their typed bullets + processed notes + mappings.
// Use showOverlayError instead — an inline, in-overlay banner that keeps
// the overlay open so the error is seen in context and the work is
// preserved on screen and in localStorage. The toast paths
// (notifyInfo / notifySuccess) are safe: they create per-instance DOM
// nodes in #notify-toast-host and never touch the openOverlay singleton.

const LOCAL_STORAGE_DRAFT_KEY = "workshopNotesDraft_v1";

// In-memory state for the open overlay (singleton per session — only
// one Workshop Notes overlay open at a time).
let overlayState = null;

// Restore draft from localStorage. Returns null when no draft or when
// JSON parsing fails (defensive).
function loadDraft() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      // rawTextareaText is the source of truth for the lower pane;
      // bullets[] (parsed) and lastBulletsText (push tracking) are
      // derived. Older drafts that lack rawTextareaText fall back to
      // reconstructing from bullets[] (lossy on indentation, but readable).
      rawTextareaText:   typeof parsed.rawTextareaText === "string" ? parsed.rawTextareaText : "",
      bullets:           Array.isArray(parsed.bullets) ? parsed.bullets : [],
      lastBulletsText:   typeof parsed.lastBulletsText === "string" ? parsed.lastBulletsText : "",
      processedMarkdown: typeof parsed.processedMarkdown === "string" ? parsed.processedMarkdown : "",
      mappings:          Array.isArray(parsed.mappings) ? parsed.mappings : [],
      savedAt:           typeof parsed.savedAt === "string" ? parsed.savedAt : null
    };
  } catch (_e) { return null; }
}

function saveDraft() {
  if (!overlayState) return;
  // rawTextareaText captures the exact current textarea value (indentation,
  // blank lines, partial bullets — everything) so resume restores it
  // verbatim.
  const liveTextarea = overlayState.lowerTextareaEl;
  const rawTextareaText = liveTextarea ? liveTextarea.value : "";
  try {
    localStorage.setItem(LOCAL_STORAGE_DRAFT_KEY, JSON.stringify({
      rawTextareaText:   rawTextareaText,
      bullets:           overlayState.bullets,
      lastBulletsText:   overlayState.lastBulletsText,
      processedMarkdown: overlayState.processedMarkdown,
      mappings:          overlayState.mappings,
      savedAt:           new Date().toISOString()
    }));
  } catch (e) {
    console.warn("[WorkshopNotesOverlay] localStorage save failed: " + (e.message || e));
  }
}

// In-overlay error banner. Renders above the upper pane (and sets the
// status chip) WITHOUT calling notifyError / openOverlay, which would
// close the workshop overlay. The engineer sees the error in context,
// their typed bullets stay on screen, the localStorage draft is
// preserved, and they can dismiss the banner and retry or fix the
// underlying issue (e.g. configure a provider in Settings) without
// losing work.
function showOverlayError(title, body) {
  if (!overlayState || !overlayState.processedEl) {
    // Fall back to a console log when the overlay isn't fully mounted yet.
    console.error("[WorkshopNotesOverlay] error: " + title + " · " + body);
    return;
  }
  setStatus("Error · see banner", "error");
  const banner = document.createElement("div");
  banner.className = "workshop-notes-error-banner";
  banner.setAttribute("role", "alert");
  banner.setAttribute("aria-live", "assertive");
  const titleEl = document.createElement("div");
  titleEl.className = "workshop-notes-error-banner-title";
  titleEl.textContent = title || "Error";
  banner.appendChild(titleEl);
  if (body) {
    const bodyEl = document.createElement("div");
    bodyEl.className = "workshop-notes-error-banner-body";
    bodyEl.textContent = body;
    banner.appendChild(bodyEl);
  }
  const dismissBtn = document.createElement("button");
  dismissBtn.type = "button";
  dismissBtn.className = "workshop-notes-error-banner-dismiss";
  dismissBtn.textContent = "Dismiss";
  dismissBtn.addEventListener("click", function() {
    if (banner.parentNode) banner.parentNode.removeChild(banner);
    setStatus("Ready", "info");
  });
  banner.appendChild(dismissBtn);

  // Remove any previously-rendered error banner so we never stack.
  const existing = overlayState.processedEl.parentNode.querySelector(".workshop-notes-error-banner");
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

  // Insert ABOVE the processed-notes pane (after the toolbar · before
  // the markdown body) so it is immediately visible.
  overlayState.processedEl.parentNode.insertBefore(banner, overlayState.processedEl);
}

function clearDraft() {
  try { localStorage.removeItem(LOCAL_STORAGE_DRAFT_KEY); }
  catch (_e) { /* ignore */ }
}

// Very small markdown-to-HTML renderer for the upper pane. Scope:
// headings (#, ##, ###), bullets (-, *), bold (**), italic (*), line
// breaks. Avoids pulling in a full markdown lib for v1.
function renderMarkdownToHtml(md) {
  if (typeof md !== "string" || md.length === 0) return "";
  const escaped = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const lines = escaped.split("\n");
  const out = [];
  let inList = false;
  function closeListIfOpen() {
    if (inList) { out.push("</ul>"); inList = false; }
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "") {
      closeListIfOpen();
      continue;
    }
    if (trimmed.startsWith("### ")) {
      closeListIfOpen();
      out.push("<h4>" + renderInlineMd(trimmed.slice(4)) + "</h4>");
      continue;
    }
    if (trimmed.startsWith("## ")) {
      closeListIfOpen();
      out.push("<h3>" + renderInlineMd(trimmed.slice(3)) + "</h3>");
      continue;
    }
    if (trimmed.startsWith("# ")) {
      closeListIfOpen();
      out.push("<h2>" + renderInlineMd(trimmed.slice(2)) + "</h2>");
      continue;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push("<li>" + renderInlineMd(trimmed.replace(/^[-*]\s+/, "")) + "</li>");
      continue;
    }
    closeListIfOpen();
    out.push("<p>" + renderInlineMd(trimmed) + "</p>");
  }
  closeListIfOpen();
  return out.join("\n");
}

function renderInlineMd(text) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

// Render the per-mapping suggestion list under the markdown body.
// Each row: kind chip + label + confidence pill + rationale.
function renderMappingsList(mappings) {
  if (!Array.isArray(mappings) || mappings.length === 0) {
    return '<p class="workshop-notes-mappings-empty">No canvas mappings emitted yet. Type more workshop bullets and push again.</p>';
  }
  const html = ['<div class="workshop-notes-mappings-list">',
    '<div class="workshop-notes-mappings-head">Canvas mappings (' + mappings.length + ')</div>'];
  mappings.forEach((m, idx) => {
    const conf = (m.confidence || "MEDIUM").toUpperCase();
    const confClass = "workshop-notes-conf-" + conf.toLowerCase();
    const kindLabel = describeMappingKind(m);
    html.push('<div class="workshop-notes-mapping-row" data-workshop-mapping-idx="' + idx + '">');
    html.push('  <span class="workshop-notes-mapping-kind">' + escapeHtml(kindLabel) + '</span>');
    html.push('  <span class="workshop-notes-mapping-conf ' + confClass + '">' + escapeHtml(conf) + '</span>');
    html.push('  <span class="workshop-notes-mapping-rationale">' + escapeHtml(m.rationale || "") + '</span>');
    html.push('</div>');
  });
  html.push('</div>');
  return html.join("\n");
}

function describeMappingKind(m) {
  if (!m) return "?";
  switch (m.kind) {
    case "add-driver":           return "+Driver: " + (m.payload && m.payload.businessDriverId ? m.payload.businessDriverId : "?");
    case "add-instance-current": return "+Current: " + (m.payload && m.payload.label ? m.payload.label : "?") + (m.payload && m.payload.layerId ? " · " + m.payload.layerId : "");
    case "add-instance-desired": return "+Desired: " + (m.payload && m.payload.label ? m.payload.label : "?") + (m.payload && m.payload.layerId ? " · " + m.payload.layerId : "");
    case "close-gap":            return "Close gap: " + (m.payload && m.payload.gapId ? m.payload.gapId.slice(0, 8) + "…" : "?");
    default:                     return m.kind || "?";
  }
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Build the dual-pane DOM body. Returns the body container element +
// references to the live nodes (upperPane, lowerTextarea, toolbar
// buttons) so the open-overlay caller can wire handlers.
function buildWorkshopNotesBody() {
  const body = document.createElement("div");
  body.className = "workshop-notes-body";
  body.innerHTML = [
    '<div class="workshop-notes-pane workshop-notes-upper-pane" data-workshop-upper-pane="">',
    '  <div class="workshop-notes-toolbar">',
    '    <button type="button" class="workshop-notes-btn workshop-notes-btn-push" data-workshop-action="push">Push notes to AI</button>',
    '    <button type="button" class="workshop-notes-btn workshop-notes-btn-reeval" data-workshop-action="reeval">Re-evaluate all</button>',
    '    <button type="button" class="workshop-notes-btn workshop-notes-btn-import" data-workshop-action="import-to-canvas">Import to canvas</button>',
    '    <button type="button" class="workshop-notes-btn workshop-notes-btn-pdf" data-workshop-action="export-pdf">Export PDF</button>',
    '    <button type="button" class="workshop-notes-btn workshop-notes-btn-json" data-workshop-action="export-json">Export JSON</button>',
    '    <span class="workshop-notes-toolbar-spacer"></span>',
    '    <span class="workshop-notes-status" data-workshop-status="">Ready</span>',
    '  </div>',
    '  <div class="workshop-notes-processed-notes" data-workshop-processed="">',
    '    <p class="workshop-notes-empty-hint">Workshop bullets go in the lower pane.<br>Click <strong>Push notes to AI</strong> to structure them here.</p>',
    '  </div>',
    '  <div class="workshop-notes-divider workshop-notes-divider-inner" data-workshop-divider-inner="" aria-hidden="true"></div>',
    '  <div class="workshop-notes-mappings" data-workshop-mappings=""></div>',
    '</div>',
    '<div class="workshop-notes-divider" aria-hidden="true"></div>',
    '<div class="workshop-notes-pane workshop-notes-lower-pane" data-workshop-lower-pane="">',
    '  <label class="workshop-notes-lower-label" for="workshop-notes-bullets">Raw bullets · workshop notes (auto-saved)</label>',
    '  <textarea id="workshop-notes-bullets" class="workshop-notes-textarea" placeholder="- Customer wants stronger backup posture&#10;- HIPAA + Texas data residency&#10;- DR site is HPE 3PAR, plans to retire&#10;- ..." spellcheck="false"></textarea>',
    '  <div class="workshop-notes-lower-hint">Enter adds a new bullet · Tab indents · Cmd+Enter pushes notes to AI · Esc closes (auto-saves)</div>',
    '</div>'
  ].join("\n");
  return body;
}

// Keep the latest typed line within the visible viewport. A native
// <textarea> auto-scrolls to follow the caret when the user types on the
// keyboard, but programmatic `textarea.value = ...` updates (the
// Enter/Tab/Shift+Tab handlers below) don't trigger that, so the caret
// can end up below the visible area. This computes the caret line index,
// multiplies by line-height, and adjusts scrollTop so the caret stays in
// view with 2-line padding.
function scrollTextareaToCaret(textarea) {
  if (!textarea) return;
  const text = textarea.value;
  const caret = textarea.selectionStart;
  const lineIndex = text.slice(0, caret).split("\n").length - 1;
  const cs = window.getComputedStyle(textarea);
  const lineHeight = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) * 1.55) || 20;
  const visibleHeight = textarea.clientHeight;
  const visibleLines = Math.max(1, Math.floor(visibleHeight / lineHeight));
  // Caret pixel position (top of line) within scrollable content.
  const caretTop = lineIndex * lineHeight;
  // Maintain 2-line padding above + below the caret line within the
  // visible viewport. If the caret is below the visible bottom, scroll
  // down. If above the visible top, scroll up.
  const PADDING_LINES = 2;
  const scrollTopMin = Math.max(0, caretTop - (PADDING_LINES * lineHeight));
  const scrollTopMax = Math.max(0, caretTop - (visibleLines - PADDING_LINES - 1) * lineHeight);
  if (textarea.scrollTop > scrollTopMin) {
    textarea.scrollTop = scrollTopMin;
  } else if (textarea.scrollTop < scrollTopMax) {
    textarea.scrollTop = scrollTopMax;
  }
}

// Auto-bullet helper for the lower textarea. On Enter without modifier:
// inserts "- " at the new line if the previous line wasn't blank.
function setupAutoBullet(textarea) {
  textarea.addEventListener("keydown", function(e) {
    // Cmd+Enter or Ctrl+Enter triggers push-to-AI (delegated via the
    // overlay container's keyboard listener).
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      const value = textarea.value;
      const selStart = textarea.selectionStart;
      // Find the start of the current line.
      const lineStart = value.lastIndexOf("\n", selStart - 1) + 1;
      const currentLine = value.slice(lineStart, selStart);
      // If current line begins with "- " or "* ", continue the list.
      const m = currentLine.match(/^(\s*)([-*])\s+/);
      if (m) {
        if (currentLine.replace(/^(\s*)([-*])\s+/, "").trim() === "") {
          // Empty bullet → break out of list.
          e.preventDefault();
          const before = value.slice(0, lineStart);
          const after  = value.slice(selStart);
          textarea.value = before + after;
          textarea.selectionStart = textarea.selectionEnd = lineStart;
        } else {
          e.preventDefault();
          const insertion = "\n" + m[1] + m[2] + " ";
          const before = value.slice(0, selStart);
          const after  = value.slice(selStart);
          textarea.value = before + insertion + after;
          textarea.selectionStart = textarea.selectionEnd = selStart + insertion.length;
        }
      } else {
        // No current bullet — insert "- " at the start of the new line.
        e.preventDefault();
        const insertion = "\n- ";
        const before = value.slice(0, selStart);
        const after  = value.slice(selStart);
        textarea.value = before + insertion + after;
        textarea.selectionStart = textarea.selectionEnd = selStart + insertion.length;
      }
      onBulletsChanged();
      // Keep the new caret line in view after the programmatic value
      // update (native auto-scroll doesn't fire for value=...).
      scrollTextareaToCaret(textarea);
      return;
    }
    // Tab to indent · Shift+Tab to outdent
    if (e.key === "Tab" && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      const value = textarea.value;
      const selStart = textarea.selectionStart;
      const lineStart = value.lastIndexOf("\n", selStart - 1) + 1;
      if (e.shiftKey) {
        // Outdent: remove 2 leading spaces if present.
        if (value.slice(lineStart, lineStart + 2) === "  ") {
          textarea.value = value.slice(0, lineStart) + value.slice(lineStart + 2);
          textarea.selectionStart = textarea.selectionEnd = Math.max(lineStart, selStart - 2);
          onBulletsChanged();
          scrollTextareaToCaret(textarea);
        }
      } else {
        // Indent: insert 2 spaces at line start.
        textarea.value = value.slice(0, lineStart) + "  " + value.slice(lineStart);
        textarea.selectionStart = textarea.selectionEnd = selStart + 2;
        onBulletsChanged();
        scrollTextareaToCaret(textarea);
      }
    }
  });
  textarea.addEventListener("input", function() {
    onBulletsChanged();
    // Most typing triggers native auto-scroll, but paste, drag-drop, and
    // IME composition don't always; calling here is safe — the helper is a
    // no-op when the caret is already visible.
    scrollTextareaToCaret(textarea);
  });
}

// Parse the lower-pane textarea into a bullets[] array. Splits by line,
// strips leading "- " / "* " / whitespace, drops empties.
function parseBullets(text) {
  return text.split("\n")
    .map(line => line.replace(/^\s*[-*]\s+/, "").trim())
    .filter(line => line.length > 0);
}

// Compute the delta (new bullets since last push). The state tracks
// lastBulletsText (the textarea value at last push); delta = bullets
// present now that weren't present before.
function computeDelta(currentBullets, lastBulletsText) {
  const lastBullets = parseBullets(lastBulletsText);
  const lastSet = new Set(lastBullets);
  return currentBullets.filter(b => !lastSet.has(b));
}

function onBulletsChanged() {
  if (!overlayState) return;
  const textarea = overlayState.lowerTextareaEl;
  if (!textarea) return;
  overlayState.bullets = parseBullets(textarea.value);
  saveDraft();
}

function setStatus(text, kind) {
  if (!overlayState || !overlayState.statusEl) return;
  overlayState.statusEl.textContent = text;
  overlayState.statusEl.setAttribute("data-workshop-status", kind || "info");
}

function repaintUpperPane() {
  if (!overlayState) return;
  const processedEl = overlayState.processedEl;
  const mappingsEl  = overlayState.mappingsEl;
  if (overlayState.processedMarkdown && overlayState.processedMarkdown.trim().length > 0) {
    processedEl.innerHTML = renderMarkdownToHtml(overlayState.processedMarkdown);
  } else {
    processedEl.innerHTML = '<p class="workshop-notes-empty-hint">Workshop bullets go in the lower pane.<br>Click <strong>Push notes to AI</strong> to structure them here.</p>';
  }
  mappingsEl.innerHTML = renderMappingsList(overlayState.mappings || []);
}

async function handlePushToAi(mode) {
  if (!overlayState) return;
  const textareaText = overlayState.lowerTextareaEl.value;
  const allBullets   = parseBullets(textareaText);
  if (allBullets.length === 0) {
    notifyInfo({ title: "Nothing to push", body: "Type some workshop bullets in the lower pane first." });
    return;
  }

  let bulletsForLlm;
  if (mode === "full") {
    bulletsForLlm = allBullets;
  } else {
    const delta = computeDelta(allBullets, overlayState.lastBulletsText);
    if (delta.length === 0) {
      notifyInfo({ title: "Nothing new to push", body: "All bullets have already been processed. Use [Re-evaluate all] to regenerate from scratch." });
      return;
    }
    bulletsForLlm = delta;
  }

  setStatus("Pushing to AI…", "busy");
  // Disable buttons during call to prevent double-push.
  overlayState.toolbarButtons.forEach(b => { b.disabled = true; });

  let res;
  try {
    res = await pushNotesToAi({
      engagement:        getActiveEngagement(),
      bullets:           bulletsForLlm,
      previousProcessed: overlayState.processedMarkdown,
      mode:              mode
    });
  } catch (e) {
    res = { ok: false, error: e.message || String(e) };
  }

  overlayState.toolbarButtons.forEach(b => { b.disabled = false; });

  if (!res.ok) {
    // Inline error banner instead of notifyError, which would close the
    // overlay and lose the typed bullets.
    showOverlayError("Push to AI failed", res.error || "Unknown error");
    return;
  }

  // Merge processed markdown.
  if (mode === "full") {
    overlayState.processedMarkdown = res.processedMarkdown || "";
    overlayState.mappings = res.mappings || [];
  } else {
    // Delta: append (separated by blank line for readability).
    const prev = (overlayState.processedMarkdown || "").trim();
    const addition = (res.processedMarkdown || "").trim();
    overlayState.processedMarkdown = prev.length > 0 ? prev + "\n\n" + addition : addition;
    // Append new mappings.
    overlayState.mappings = (overlayState.mappings || []).concat(res.mappings || []);
  }
  overlayState.lastBulletsText = textareaText;
  // Track lastPushedAt + lastDroppedCount so handleImportToCanvas can
  // discriminate the three zero-mapping states (never-pushed vs
  // pushed-but-zero-emitted vs pushed-but-all-dropped).
  overlayState.lastPushedAt    = new Date().toISOString();
  overlayState.lastDroppedCount = res.droppedCount || 0;
  // Carry the runId from the LLM call so subsequent [Import to canvas]
  // and JSON exports reference the same provenance instant.
  if (res.runId) overlayState.lastRunId = res.runId;
  saveDraft();
  repaintUpperPane();

  const droppedSuffix = res.droppedCount > 0 ? " · " + res.droppedCount + " malformed dropped" : "";
  setStatus("Pushed · " + (res.mappings || []).length + " mapping" + ((res.mappings || []).length === 1 ? "" : "s") + droppedSuffix, "ok");
}

// [Import to canvas] click handler. End-to-end flow:
//   1. transformOverlayToImportPayload converts overlay mappings → the
//      import wire payload (each item carries a `kind` discriminator)
//   2. parseImportResponse validates the payload shape
//   3. checkImportDrift validates per-kind FK membership against the live
//      engagement (env ids for instance.add, gapIds for gap.close,
//      businessDriverId catalog for driver.add)
//   4. renderImportPreview opens the modal; the engineer reviews each row
//      and selects which to apply
//   5. applyImportItems dispatches per kind to the right commit function
//      (addInstance / addDriver / updateGap) and stamps the provenance
//      envelope (aiTag.kind = "discovery-note")
//   6. setActiveEngagement commits the new state to the store, which
//      re-renders the matrix
function handleImportToCanvas() {
  if (!overlayState) return;
  const mappings = overlayState.mappings || [];
  // Three-state discrimination when there are zero mappings:
  //   A · never pushed (lastPushedAt null) → "Push notes to AI first"
  //   B · pushed but 0 mappings emitted (lastPushedAt set, 0 dropped) →
  //       the AI returned no actionable mappings
  //   C · pushed but all emitted mappings failed validation
  //       (lastPushedAt set, droppedCount > 0)
  // States B and C use showOverlayError (a persistent in-overlay banner)
  // rather than notifyInfo (a toast that vanishes).
  if (mappings.length === 0) {
    const neverPushed = !overlayState.lastPushedAt;
    const droppedCount = overlayState.lastDroppedCount || 0;
    if (neverPushed) {
      // State A · the truly never-pushed case · toast is fine here.
      notifyInfo({ title: "Nothing to import", body: "Push notes to AI first to generate canvas mappings." });
      return;
    }
    if (droppedCount > 0) {
      // State C · LLM emitted N mappings but all failed Zod validation.
      showOverlayError(
        "Import unavailable · all " + droppedCount + " mapping(s) failed validation",
        "AI emitted " + droppedCount + " mapping(s) but all failed ActionProposalSchema validation (wrong shape · invalid catalog refs · etc). Check browser console for per-mapping errors. Try [Re-evaluate all] OR rephrase your bullets · the upper pane prose is preserved."
      );
      return;
    }
    // State B · LLM produced markdown but emitted zero actionable mappings.
    showOverlayError(
      "Import unavailable · AI returned 0 actionable mappings",
      "Push succeeded · the structured notes are in the upper pane. But the AI did not emit any canonical action mappings (add-driver / add-instance-current / add-instance-desired / close-gap). Your bullets may describe context (customer name · environments · drivers) rather than actions. Try [Re-evaluate all] with action-form bullets like 'add VMware vSphere to DR site' or 'we need cybersecurity driver'."
    );
    return;
  }

  const runId = overlayState.lastRunId || ("wn-" + Date.now().toString(36));
  const mutatedAt = new Date().toISOString();

  // Step 1: transform overlay mappings → the import wire payload.
  const payload = transformOverlayToImportPayload({
    mappings:  mappings,
    runId:     runId,
    mutatedAt: mutatedAt
  });

  if (!payload.items || payload.items.length === 0) {
    showOverlayError("No valid mappings", "All " + mappings.length + " mappings were dropped by the adapter (validation failed). Check console for details.");
    return;
  }

  // Step 2: parse + validate the payload. The adapter already validates,
  // but the parser is the canonical gate.
  const parseResult = parseImportResponse(payload);
  if (!parseResult.ok) {
    const firstError = parseResult.errors && parseResult.errors[0];
    showOverlayError(
      "Import payload rejected",
      firstError ? firstError.path + ": " + firstError.message : "Unknown parse error"
    );
    return;
  }

  // Step 3: drift-check (per-kind FK membership).
  const live = getActiveEngagement();
  const drift = checkImportDrift(parseResult.parsed, live);
  if (!drift.ok) {
    const segments = [];
    if (drift.missingEnvIds.length > 0)         segments.push(drift.missingEnvIds.length + " env(s)");
    if (drift.missingGapIds.length > 0)         segments.push(drift.missingGapIds.length + " gap(s)");
    if (drift.invalidBusinessDriverIds.length > 0) segments.push(drift.invalidBusinessDriverIds.length + " driver(s)");
    showOverlayError(
      "Import rejected: drift detected",
      "Response references " + segments.join(" · ") + " not in this engagement. Re-issue notes or update the engagement first."
    );
    return;
  }

  // Step 4: open the preview modal for per-row review.
  renderImportPreview(document.body, parseResult.parsed, {
    defaultScope: "desired",
    drift:        drift,
    onApply: function(selectedItems, finalScope) {
      // Step 5: dispatch through the kind-aware applier.
      const res = applyImportItems(live, selectedItems, {
        scope:      finalScope,
        provenance: {
          kind:      "discovery-note",                  // A20 · per SPEC §S47.9.1b
          source:    "workshop-notes-overlay",          // A20 · per SPEC §S47.9.5
          runId:     runId,
          mutatedAt: mutatedAt
        }
      });
      // Step 6: commit to v3 store + notify.
      if (res.engagement) setActiveEngagement(res.engagement);

      const appliedCount = (res.addedInstanceIds || []).length + (res.addedDriverIds || []).length + (res.closedGapIds || []).length;
      const errorCount = (res.errors || []).length;
      if (errorCount > 0) {
        const failedDetail = res.errors.slice(0, 3).map(function(e) {
          const firstMsg = (e.errors && e.errors[0] && e.errors[0].message) || "validation error";
          return "row " + (e.itemIndex + 1) + " (" + e.kind + "): " + firstMsg;
        }).join("; ");
        showOverlayError(
          "Partial import: " + appliedCount + " applied, " + errorCount + " failed",
          failedDetail + (res.errors.length > 3 ? " (+ " + (res.errors.length - 3) + " more)" : "")
        );
      } else {
        const breakdown = [];
        if (res.addedInstanceIds.length > 0) breakdown.push(res.addedInstanceIds.length + " instance" + (res.addedInstanceIds.length === 1 ? "" : "s"));
        if (res.addedDriverIds.length > 0)   breakdown.push(res.addedDriverIds.length + " driver" + (res.addedDriverIds.length === 1 ? "" : "s"));
        if (res.closedGapIds.length > 0)     breakdown.push(res.closedGapIds.length + " gap closure" + (res.closedGapIds.length === 1 ? "" : "s"));
        notifySuccess({
          title: "Imported " + appliedCount + " item" + (appliedCount === 1 ? "" : "s"),
          body:  breakdown.join(" · ") + " · 'Note' chip auto-clears on engineer save."
        });
      }
    },
    onCancel: function() {
      // Preview cancelled · overlay stays open · engineer can re-push or re-import.
      setStatus("Import cancelled", "info");
    }
  });
}

function handleExportJson() {
  if (!overlayState) return;
  const data = {
    exportedAt:        new Date().toISOString(),
    bullets:           overlayState.bullets,
    processedMarkdown: overlayState.processedMarkdown,
    mappings:          overlayState.mappings,
    runId:             overlayState.lastRunId
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const today = new Date().toISOString().slice(0, 10);
  a.download = "workshop-notes-" + today + ".json";
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  setStatus("Exported JSON", "ok");
}

function handleExportPdf() {
  // PDF export defers to the browser's print dialog with the upper pane
  // visible.
  setStatus("PDF export: use browser Print → Save as PDF", "info");
  notifyInfo({ title: "PDF export", body: "Use your browser's Print dialog (Cmd+P / Ctrl+P) and choose 'Save as PDF'. A polished PDF export is queued for v1.5." });
}

function handleEsc() {
  // Save the draft and close; the draft persists so the next open offers
  // a resume prompt.
  saveDraft();
  closeOverlay();
  overlayState = null;
}

// openWorkshopNotesOverlay · main exported entry point.
//
// Reads the draft from localStorage; if present, prompts the engineer to
// Resume or Start fresh. On Resume, restores bullets + processedMarkdown
// + mappings. On Start fresh, clears the draft.
//
// Mounts the dual-pane DOM inside the shared Overlay component and wires
// the toolbar buttons, auto-bullet behavior, and Cmd+Enter shortcut.
//
// The overlay has two drag handles — inner (structured notes <-> canvas
// mappings, inside the upper pane) and main (upper <-> lower raw bullets)
// — plus a vertically resizable shell (drag the overlay's bottom edge to
// grow the whole modal). wireVerticalSplit is the shared pointer-drag
// logic; each split and the overlay height persist per browser. Every
// zone scrolls internally so content stays reachable at any size.

// wireVerticalSplit: make `divider` drag the boundary between paneA (above) and
// paneB (below), both flex children of the same column. The drag percent is
// measured across paneA.top..paneB.bottom so it is correct whether or not a
// fixed sibling (e.g. the toolbar) sits above paneA. Persists to storageKey;
// keyboard-accessible (Arrow Up/Down nudge 3%).
function wireVerticalSplit(divider, paneA, paneB, storageKey, minPct, maxPct) {
  if (!divider || !paneA || !paneB) return;
  const MIN = minPct, MAX = maxPct;
  const bodyEl = paneA.closest(".workshop-notes-body");
  const applyPct = (pct) => {
    const p = Math.max(MIN, Math.min(MAX, pct));
    paneA.style.flexBasis = p + "%";
    paneB.style.flexBasis = (100 - p) + "%";
    return p;
  };
  let saved = NaN;
  try { saved = parseFloat(localStorage.getItem(storageKey)); } catch (_e) {}
  if (!isNaN(saved)) applyPct(saved);

  divider.setAttribute("role", "separator");
  divider.setAttribute("aria-orientation", "horizontal");
  divider.setAttribute("aria-label", "Resize panes (drag, or Arrow Up/Down)");
  divider.removeAttribute("aria-hidden");
  divider.tabIndex = 0;

  let dragging = false;
  const persist = () => {
    const pct = parseFloat(paneA.style.flexBasis);
    if (!isNaN(pct)) { try { localStorage.setItem(storageKey, String(Math.round(pct))); } catch (_e) {} }
  };
  const pctAt = (clientY) => {
    const aTop = paneA.getBoundingClientRect().top;
    const bBot = paneB.getBoundingClientRect().bottom;
    const span = bBot - aTop;
    if (span <= 0) return null;
    return ((clientY - aTop) / span) * 100;
  };
  divider.addEventListener("pointerdown", (e) => {
    dragging = true;
    try { divider.setPointerCapture(e.pointerId); } catch (_e) {}
    if (bodyEl) bodyEl.classList.add("workshop-notes-resizing");
    e.preventDefault();
  });
  divider.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const pct = pctAt(e.clientY);
    if (pct != null) applyPct(pct);
  });
  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    try { divider.releasePointerCapture(e.pointerId); } catch (_e) {}
    if (bodyEl) bodyEl.classList.remove("workshop-notes-resizing");
    persist();
  };
  divider.addEventListener("pointerup", endDrag);
  divider.addEventListener("pointercancel", endDrag);
  divider.addEventListener("keydown", (e) => {
    const cur = parseFloat(paneA.style.flexBasis) || ((MIN + MAX) / 2);
    if (e.key === "ArrowUp")        { applyPct(cur - 3); persist(); e.preventDefault(); }
    else if (e.key === "ArrowDown") { applyPct(cur + 3); persist(); e.preventDefault(); }
  });
}

// wireOverlayResize: the overlay shell is resize:vertical (CSS). Restore the
// engineer's last height on open + persist it on resize-end (mouseup). Capped
// to 96vh so it can never exceed the viewport.
function wireOverlayResize(body) {
  const panel = body.closest(".overlay");
  if (!panel) return;
  let saved = NaN;
  try { saved = parseFloat(localStorage.getItem("workshopNotesOverlayH_v1")); } catch (_e) {}
  if (!isNaN(saved) && saved >= 400) {
    panel.style.height = Math.min(saved, Math.round(window.innerHeight * 0.96)) + "px";
  }
  const persistH = () => {
    const h = panel.offsetHeight;
    if (h >= 400) { try { localStorage.setItem("workshopNotesOverlayH_v1", String(h)); } catch (_e) {} }
  };
  panel.addEventListener("mouseup", persistH);
  panel.addEventListener("pointerup", persistH);
}

// Orchestrator (wired in openWorkshopNotesOverlay after mount): both dividers
// (inner notes<->mappings + main upper<->lower) + the resizable shell.
function wireWorkshopDivider(body) {
  const main  = body.querySelector(".workshop-notes-divider:not(.workshop-notes-divider-inner)");
  const inner = body.querySelector(".workshop-notes-divider-inner");
  const upper = body.querySelector(".workshop-notes-upper-pane");
  const lower = body.querySelector(".workshop-notes-lower-pane");
  const notes = body.querySelector(".workshop-notes-processed-notes");
  const maps  = body.querySelector(".workshop-notes-mappings");
  wireVerticalSplit(main,  upper, lower, "workshopNotesSplit_v1",    18, 82);
  wireVerticalSplit(inner, notes, maps,  "workshopNotesMapSplit_v1", 28, 85);
  wireOverlayResize(body);
}

export function openWorkshopNotesOverlay(opts) {
  opts = opts || {};

  // Resume prompt. Defaults to Resume (the safe option) and only clears
  // the draft after an explicit secondary confirmation, so a single
  // mis-click can't discard the engineer's work. Restore order:
  // rawTextareaText (exact text) > lastBulletsText (push history) >
  // bullets[] reconstruction (lossy).
  const existing = loadDraft();
  let initialRawTextareaText = "";
  let initialBullets = [];
  let initialProcessedMd = "";
  let initialMappings = [];
  let initialLastBulletsText = "";
  if (existing && (existing.rawTextareaText.length > 0 || existing.bullets.length > 0 || existing.processedMarkdown.length > 0)) {
    let resumeChoice = true;  // safe default: resume
    if (!opts.skipResumePrompt) {
      const savedAt = existing.savedAt ? new Date(existing.savedAt).toLocaleString() : "earlier";
      // Primary prompt: OK resumes; Cancel offers to start fresh but
      // requires a second confirm before discarding anything.
      resumeChoice = window.confirm(
        "You have unsaved Workshop Notes from " + savedAt + ".\n\n" +
        "[OK] Resume previous notes (preserves all your work)\n" +
        "[Cancel] Start fresh (you'll be asked again before the draft is discarded)"
      );
      if (!resumeChoice) {
        // Secondary confirm before destruction.
        const reallyStartFresh = window.confirm(
          "Start fresh will PERMANENTLY DISCARD your saved Workshop Notes (" +
          (existing.rawTextareaText.length > 0 ? existing.rawTextareaText.split("\n").length + " line(s) of bullets" : existing.bullets.length + " bullet(s)") +
          ").\n\n[OK] Yes, discard and start fresh\n[Cancel] No, restore my work"
        );
        if (!reallyStartFresh) {
          // User changed their mind · restore work.
          resumeChoice = true;
        } else {
          clearDraft();
        }
      }
    }
    if (resumeChoice || opts.skipResumePrompt) {
      initialRawTextareaText = existing.rawTextareaText || (existing.lastBulletsText || existing.bullets.map(b => "- " + b).join("\n"));
      initialBullets = existing.bullets;
      initialProcessedMd = existing.processedMarkdown;
      initialMappings = existing.mappings;
      initialLastBulletsText = existing.lastBulletsText || initialRawTextareaText;
    }
  }

  const body = buildWorkshopNotesBody();

  openOverlay({
    title:       "AI Notes · Workshop Notes",
    lede:        "Type customer-workshop bullets in the lower pane. Push to AI structures them + suggests canvas mappings. Click [Import to canvas] to feed mappings into the importer.",
    body:        body,
    kind:        "workshop-notes",
    size:        "large"
  });

  // Wire references AFTER mount so DOM is live.
  const textarea  = body.querySelector("[data-workshop-lower-pane] textarea");
  const processed = body.querySelector("[data-workshop-processed]");
  const mappings  = body.querySelector("[data-workshop-mappings]");
  const status    = body.querySelector("[data-workshop-status]");
  const buttons   = Array.from(body.querySelectorAll("[data-workshop-action]"));

  overlayState = {
    lowerTextareaEl: textarea,
    processedEl:     processed,
    mappingsEl:      mappings,
    statusEl:        status,
    toolbarButtons:  buttons,
    bullets:         initialBullets,
    processedMarkdown: initialProcessedMd,
    mappings:        initialMappings,
    lastBulletsText: initialLastBulletsText,
    lastRunId:       null,
    // lastPushedAt + lastDroppedCount are set by handlePushToAi after
    // every successful push, and used by handleImportToCanvas to
    // discriminate the three zero-mapping states. They stay null on
    // resume-from-draft, since mapping counts are only meaningful after a
    // fresh push.
    lastPushedAt:    null,
    lastDroppedCount: 0
  };

  // Seed the textarea from rawTextareaText (exact restore) first, then
  // lastBulletsText (lossy on partial bullets), then bullets[]
  // reconstruction (most lossy). The 3-tier fallback preserves work even
  // when an older draft lacks rawTextareaText.
  if (initialRawTextareaText) {
    textarea.value = initialRawTextareaText;
  } else if (initialLastBulletsText) {
    textarea.value = initialLastBulletsText;
  } else if (initialBullets.length > 0) {
    textarea.value = initialBullets.map(b => "- " + b).join("\n");
  }

  setupAutoBullet(textarea);
  wireWorkshopDivider(body);
  textarea.focus();

  repaintUpperPane();

  // Toolbar button handlers.
  buttons.forEach(btn => {
    btn.addEventListener("click", function() {
      const action = btn.getAttribute("data-workshop-action");
      if (action === "push")               { handlePushToAi("delta"); }
      else if (action === "reeval")         { handlePushToAi("full"); }
      else if (action === "import-to-canvas") { handleImportToCanvas(); }
      else if (action === "export-json")    { handleExportJson(); }
      else if (action === "export-pdf")     { handleExportPdf(); }
    });
  });

  // Cmd+Enter / Ctrl+Enter inside the textarea triggers push-to-AI.
  textarea.addEventListener("keydown", function(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handlePushToAi("delta");
    }
  });
}
