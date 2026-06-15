// ui/views/SettingsModal.js — gear-icon settings panel.
//
// Built on the shared Overlay.js component (centered modal, sticky head +
// scrollable body + sticky footer, backdrop blur, Escape + backdrop close).
// Two top-level sections: AI Providers + Skills. The Skills section runs
// the Skill Builder inside the wider overlay so there's room to author +
// edit comfortably; this is the single entry point for skill authoring,
// and the chat-rail "+ Author new skill" affordance routes here via
// skillBuilderOpener.js.

import { loadAiConfig, saveAiConfig, PROVIDERS } from "../../core/aiConfig.js";
import { testConnection } from "../../services/aiService.js";
import { renderSkillBuilder } from "./SkillBuilder.js";
import { openOverlay, closeOverlay } from "../components/Overlay.js";

// Provider hint copy. Drives the placeholder + helper text per provider
// so the user knows what shape goes in each field.
var PROVIDER_HINTS = {
  // Local A + Local B point at the self-hosted GB10 LLM box. Canonical setup:
  //   - Local A = Code LLM on http://<GB10_IP>:8000/v1
  //   - Local B = VLM       on http://<GB10_IP>:8001/v1
  // The container's nginx proxy paths (/api/llm/local/v1, /api/llm/
  // local-b/v1) work as relative defaults when the LLM_HOST env var
  // points at the GB10; absolute URLs bypass the proxy entirely.
  local: {
    urlReadOnly:  false,
    urlHelp:      "Local A = Code LLM (port 8000 per LLMs on GB10.docx). Recommended: paste the absolute URL 'http://<GB10_IP>:8000/v1'. Default '/api/llm/local/v1' uses the container's nginx proxy (set LLM_HOST env var to your GB10 IP).",
    urlPlaceholder: "http://<GB10_IP>:8000/v1",
    modelPlaceholder: "code-llm",
    keyPlaceholder: "(blank — vLLM is unauth'd)",
    keyLabel:     "API key (optional, vLLM is unauth'd)",
    fbPlaceholder: "(optional)"
  },
  localB: {
    urlReadOnly:  false,
    urlHelp:      "Local B = VLM (port 8001 per LLMs on GB10.docx). Recommended: paste the absolute URL 'http://<GB10_IP>:8001/v1'. Default '/api/llm/local-b/v1' uses the container's nginx proxy (set LLM_HOST + LLM_LOCAL_B_PORT env vars).",
    urlPlaceholder: "http://<GB10_IP>:8001/v1",
    modelPlaceholder: "vision-vlm",
    keyPlaceholder: "(blank — vLLM is unauth'd)",
    keyLabel:     "API key (optional, vLLM is unauth'd)",
    fbPlaceholder: "(optional)"
  },
  anthropic: {
    urlReadOnly:  true,
    urlHelp:      "Routed through the container's nginx proxy. Read-only because direct browser calls would be blocked by CORS.",
    keyPlaceholder: "sk-ant-...",
    keyLabel:     "API key",
    fbPlaceholder: "claude-sonnet-4-5"
  },
  gemini: {
    urlReadOnly:  true,
    urlHelp:      "Routed through the container's nginx proxy. Read-only because direct browser calls would be blocked by CORS.",
    keyPlaceholder: "AIza...",
    keyLabel:     "API key",
    fbPlaceholder: "gemini-2.0-flash, gemini-1.5-flash"
  },
  dellSalesChat: {
    urlReadOnly:  false,
    urlHelp:      "Paste your Dell Sales Chat endpoint URL. OpenAI-compatible shape; the same chatCompletion path that drives the local LLM dispatches the call.",
    keyPlaceholder: "Dell Sales Chat token",
    keyLabel:     "API key",
    fbPlaceholder: "(optional)"
  }
};

export function openSettingsModal(opts) {
  var initialSection = (opts && opts.section) || "providers";
  // When chat is open, opening Settings as a side-panel keeps the chat
  // mounted instead of replacing it. Defaults to false (centered modal).
  var sidePanel = !!(opts && opts.sidePanel);

  var body   = buildSettingsBody(initialSection);
  var footer = buildSettingsFooter(initialSection);

  openOverlay({
    title:   "Settings",
    lede:    "Configure where AI skills run + manage the deployed skill library.",
    body:    body,
    footer:  footer,
    kind:    "settings",
    size:    "wide",
    persist: false,
    transparent: false,
    sidePanel: sidePanel
  });

  injectSectionPills(initialSection);
}

// Swap body + footer + head-extras in place so switching between the
// Providers and Skills sections doesn't close + reopen the overlay (which
// would blink). The overlay panel stays mounted; only its inner regions
// rebuild.
function swapSection(nextSection) {
  var panel = document.querySelector(".overlay.open[data-kind='settings']");
  if (!panel) return;

  var oldBody   = panel.querySelector(".overlay-body");
  var oldFooter = panel.querySelector(".overlay-footer");

  var newBody   = buildSettingsBody(nextSection);
  newBody.classList.add("overlay-body");

  if (oldBody) {
    // Cross-fade: dim the old body, swap, fade in the new.
    oldBody.classList.add("settings-body-leaving");
    setTimeout(function() {
      if (oldBody.parentNode) oldBody.parentNode.replaceChild(newBody, oldBody);
      requestAnimationFrame(function() {
        newBody.classList.add("settings-body-entering");
      });
    }, 90);
  } else {
    panel.appendChild(newBody);
  }

  // Footer rebuilds on every section change since the CTAs differ.
  var newFooterContent = buildSettingsFooter(nextSection);
  if (oldFooter) {
    oldFooter.innerHTML = "";
    oldFooter.appendChild(newFooterContent);
  }

  injectSectionPills(nextSection);
}

function injectSectionPills(activeSection) {
  var slot = document.querySelector(".overlay[data-kind='settings'] .overlay-head-extras");
  if (!slot) return;
  slot.innerHTML = "";

  var seg = document.createElement("div");
  seg.className = "settings-section-seg";

  [
    { val: "providers", label: "AI Providers" },
    { val: "skills",    label: "Skills builder" }
  ].forEach(function(opt) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "settings-section-seg-btn" + (activeSection === opt.val ? " is-active" : "");
    btn.setAttribute("aria-pressed", activeSection === opt.val ? "true" : "false");
    btn.textContent = opt.label;
    btn.addEventListener("click", function() {
      if (activeSection === opt.val) return;
      swapSection(opt.val);
    });
    seg.appendChild(btn);
  });
  slot.appendChild(seg);
}

function buildSettingsBody(section) {
  var body = document.createElement("div");
  body.className = "settings-body settings-body-" + section;

  if (section === "skills") {
    renderSkillBuilder(body);
    return body;
  }

  // Providers section
  var help = document.createElement("div");
  help.className = "settings-help";
  help.textContent = "Configure where AI skills run. The active provider is used by every skill you've built and deployed via the Skills tab.";
  body.appendChild(help);

  var config = loadAiConfig();

  // Provider selector pills
  var sel = document.createElement("div");
  sel.className = "settings-provider-row";
  PROVIDERS.forEach(function(pkey) {
    var p = config.providers[pkey];
    var pill = document.createElement("button");
    pill.type = "button";
    pill.className = "settings-provider-pill" + (config.activeProvider === pkey ? " active" : "");
    pill.textContent = p.label;
    pill.addEventListener("click", function() {
      // Before switching providers, commit any in-progress edits on the
      // CURRENT provider form to the config object. Without this, typed-
      // but-not-saved input values would be discarded when swapSection
      // rebuilds the form for the new provider. urlInput / modelInput /
      // fbInput / keyInput are var-hoisted in buildSettingsBody; at click
      // time they exist and reflect the live DOM.
      try {
        if (urlInput && config.providers[activeKey]) {
          config.providers[activeKey].baseUrl        = urlInput.value.trim();
          config.providers[activeKey].model          = modelInput.value.trim();
          config.providers[activeKey].apiKey         = keyInput.value;
          config.providers[activeKey].fallbackModels = parseFallbackModels(fbInput.value);
        }
      } catch (_e) { /* defensive — first pill click before form mounts */ }
      config.activeProvider = pkey;
      saveAiConfig(config);
      // Swap in place rather than close+reopen so the overlay doesn't
      // blink when the user picks a different provider.
      swapSection("providers");
    });
    sel.appendChild(pill);
  });
  body.appendChild(sel);

  var activeKey = config.activeProvider;
  var active    = config.providers[activeKey];
  var hint      = PROVIDER_HINTS[activeKey] || PROVIDER_HINTS.local;

  // Form
  var form = document.createElement("div");
  form.className = "settings-form";
  body.appendChild(form);

  // URL field
  var urlGroup = mkField("Endpoint URL");
  var urlInput = mk("input", "settings-input");
  urlInput.type = "text";
  urlInput.value = active.baseUrl;
  if (hint.urlPlaceholder) urlInput.placeholder = hint.urlPlaceholder;
  if (hint.urlReadOnly) {
    urlInput.readOnly = true;
    urlInput.title = "Locked , routed through nginx proxy.";
  }
  urlGroup.appendChild(mkt("div", "settings-help-inline", hint.urlHelp));
  urlGroup.appendChild(urlInput);
  form.appendChild(urlGroup);

  // Model
  var modelGroup = mkField("Model");
  var modelInput = mk("input", "settings-input");
  modelInput.type = "text";
  modelInput.value = active.model;
  if (hint.modelPlaceholder) modelInput.placeholder = hint.modelPlaceholder;
  modelGroup.appendChild(modelInput);
  form.appendChild(modelGroup);

  // Fallback chain
  var fbGroup = mkField("Fallback models (comma-separated)");
  var fbInput = mk("input", "settings-input");
  fbInput.type = "text";
  fbInput.value = (active.fallbackModels || []).join(", ");
  fbInput.placeholder = hint.fbPlaceholder;
  fbGroup.appendChild(fbInput);
  fbGroup.appendChild(mkt("div", "settings-help-inline",
    "Tried in order if the primary 429/503s after retries. Leave empty to disable."));
  form.appendChild(fbGroup);

  // API key
  var keyGroup = mkField(hint.keyLabel);
  var keyInput = mk("input", "settings-input");
  keyInput.type = "password";
  keyInput.value = active.apiKey;
  keyInput.placeholder = hint.keyPlaceholder;
  keyGroup.appendChild(keyInput);
  keyGroup.appendChild(mkt("div", "settings-help-inline",
    "Stored in browser localStorage. Visible in DevTools. Acceptable for personal use; multi-user deployments will move keys server-side."));
  form.appendChild(keyGroup);

  // Test-connection probe. Renders an animated indeterminate progress
  // bar while the upstream call is in flight; fills + flips to a check
  // icon on success, or to an X on failure.
  var probeRow = mk("div", "settings-probe-row");
  var probeBtn = mkt("button", "btn-secondary", "Test connection");
  probeBtn.type = "button";
  var probeOut = mk("div", "settings-probe-out");
  probeBtn.addEventListener("click", async function() {
    probeOut.className = "settings-probe-out probing";
    probeOut.innerHTML =
      '<div class="probe-bar"><div class="probe-bar-fill"></div></div>' +
      '<div class="probe-msg">Reaching ' + activeKey + '...</div>';
    var result = await testConnection({
      providerKey:    activeKey,
      baseUrl:        urlInput.value.trim(),
      model:          modelInput.value.trim(),
      fallbackModels: parseFallbackModels(fbInput.value),
      apiKey:         keyInput.value
    });
    if (result.ok) {
      probeOut.className = "settings-probe-out ok";
      var usedNote = result.modelUsed && result.modelUsed !== modelInput.value.trim()
        ? " (fell back to " + result.modelUsed + ")" : "";
      probeOut.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8l3 3 7-7"/></svg>' +
        '<span class="probe-msg">OK' + escapeHtml(usedNote) + ' . sample: ' + escapeHtml(result.sample || "(empty)") + '</span>';
    } else {
      probeOut.className = "settings-probe-out err";
      probeOut.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l8 8 M12 4l-8 8"/></svg>' +
        '<span class="probe-msg">Failed: ' + escapeHtml(result.error || "Unknown error") + '</span>';
    }
  });
  probeRow.appendChild(probeBtn);
  probeRow.appendChild(probeOut);
  body.appendChild(probeRow);

  // Stash refs on the body so the footer's Save handler can read them.
  body._settings = { config: config, activeKey: activeKey, urlInput: urlInput, modelInput: modelInput, fbInput: fbInput, keyInput: keyInput };

  return body;
}

function buildSettingsFooter(section) {
  var foot = document.createElement("div");
  foot.className = "settings-footer";

  if (section === "skills") {
    var doneBtn = mkt("button", "btn-primary", "Done");
    doneBtn.type = "button";
    doneBtn.addEventListener("click", function() { closeOverlay(); });
    foot.appendChild(doneBtn);
    return foot;
  }

  // Providers section
  var cancelBtn = mkt("button", "btn-secondary", "Close");
  cancelBtn.type = "button";
  cancelBtn.addEventListener("click", function() { closeOverlay(); });

  // Save with visible feedback. Resolves the form refs from the live DOM,
  // surfaces a clear error if they can't be found, and uses the standard
  // btn-feedback states.
  var saveBtn = mkt("button", "btn-primary btn-with-feedback", "Save");
  saveBtn.type = "button";
  saveBtn.addEventListener("click", function() {
    if (saveBtn.disabled) return;
    saveBtn.classList.add("is-loading");
    saveBtn.disabled = true;
    // Resolve the form refs by scanning .settings-body, which always
    // carries the _settings stash regardless of whether the overlay was
    // just opened (Overlay.js wraps the body) or section-swapped
    // (swapSection replaces it). During a section cross-fade two bodies
    // briefly coexist, so prefer the one that is NOT mid-leaving and fall
    // back to any body with _settings.
    var settingsPanel = document.querySelector(".overlay.open[data-kind='settings']");
    var refs = null;
    if (settingsPanel) {
      var candidateBodies = settingsPanel.querySelectorAll(".settings-body");
      // Prefer the body that is NOT mid-leaving.
      for (var i = 0; i < candidateBodies.length; i++) {
        var b = candidateBodies[i];
        if (b._settings && !b.classList.contains("settings-body-leaving")) {
          refs = b._settings;
          break;
        }
      }
      // Fallback: any settings body that carries _settings.
      if (!refs) {
        for (var j = 0; j < candidateBodies.length; j++) {
          if (candidateBodies[j]._settings) { refs = candidateBodies[j]._settings; break; }
        }
      }
    }
    if (!refs || !refs.config || !refs.activeKey ||
        !refs.config.providers || !refs.config.providers[refs.activeKey]) {
      saveBtn.classList.remove("is-loading");
      saveBtn.classList.add("is-error");
      saveBtn.textContent = "Couldn't save — reopen Settings";
      setTimeout(function() {
        saveBtn.classList.remove("is-error");
        saveBtn.textContent = "Save";
        saveBtn.disabled = false;
      }, 2000);
      return;
    }
    try {
      // Read current input values from the live DOM (not a stale closure-
      // captured object) for robustness across swap timing.
      refs.config.providers[refs.activeKey].baseUrl        = refs.urlInput.value.trim();
      refs.config.providers[refs.activeKey].model          = refs.modelInput.value.trim();
      refs.config.providers[refs.activeKey].apiKey         = refs.keyInput.value;
      refs.config.providers[refs.activeKey].fallbackModels = parseFallbackModels(refs.fbInput.value);
      saveAiConfig(refs.config);
      saveBtn.classList.remove("is-loading");
      saveBtn.classList.add("is-success");
      saveBtn.textContent = "✓ Saved";
      setTimeout(function() {
        saveBtn.classList.remove("is-success");
        saveBtn.textContent = "Save";
        saveBtn.disabled = false;
      }, 1500);
    } catch (e) {
      saveBtn.classList.remove("is-loading");
      saveBtn.classList.add("is-error");
      saveBtn.textContent = "Save failed — see console";
      console.error("[SettingsModal] saveAiConfig failed:", e);
      setTimeout(function() {
        saveBtn.classList.remove("is-error");
        saveBtn.textContent = "Save";
        saveBtn.disabled = false;
      }, 2000);
    }
  });

  foot.appendChild(cancelBtn);
  foot.appendChild(saveBtn);
  return foot;
}

// Parse a comma-separated fallback-model string into a trimmed, deduped
// array. Exported for tests.
export function parseFallbackModels(s) {
  if (typeof s !== "string") return [];
  var seen = {};
  return s.split(",")
    .map(function(m) { return m.trim(); })
    .filter(function(m) {
      if (!m || seen[m]) return false;
      seen[m] = true;
      return true;
    });
}

// Helpers
function mk(tag, cls)        { var el = document.createElement(tag); if (cls) el.className = cls; return el; }
function mkt(tag, cls, txt)  { var el = mk(tag, cls); if (txt != null) el.textContent = txt; return el; }
function mkField(labelText) {
  var f = mk("div", "settings-field");
  f.appendChild(mkt("label", "settings-label", labelText));
  return f;
}
function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
