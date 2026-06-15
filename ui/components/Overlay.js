// ui/components/Overlay.js
//
// Centered modal component, sister to ui/components/Drawer.js. Used for
// flows that need more workspace than the 560px right drawer:
//   - Canvas AI Assistant (top-bar AI Assist click)
//   - Settings (gear button) — incl. Skills builder pill
//   - "+ Add tile / + Add gap / + Add driver" flows
//
// Default size: ~min(720px, 90vw) wide x ~min(640px, 80vh) tall, centered
// with backdrop blur. Close paths: backdrop click + Escape + close button
// (unless persist:true).
//
// Stack-aware: openOverlay({ ...opts, sidePanel: true }) while another
// overlay is open pushes onto a stack instead of replacing the singleton.
// The base layer shrinks to a 50vw left pane; the new layer renders as a
// 50vw right pane. The backdrop is shared. closeOverlay() pops the top
// only; if the stack is now 1, the survivor expands to full layout. ESC
// closes the top-most layer.
//
// API:
//   openOverlay({ title, lede, body, footer, kind, size, persist,
//                 transparent, sidePanel })
//     sidePanel   boolean (default false). When true AND another overlay
//                 is already open, push onto the stack with side-panel
//                 layout. When false OR the stack is empty, behaves like a
//                 single full-layout centered overlay.
//
//   closeOverlay()         pops top of stack (or full close if last).
//                          Idempotent. Programmatic; ignores persist.
//   setTransparent(bool)   toggles transparency on the top layer
//   isOpen()               boolean — any layer mounted
//   _resetForTests()       wipes the entire stack

// Stack-aware state. Each entry is { panel, options }.
var _stack       = [];        // bottom (full) → top (side-panel)
var backdropEl   = null;       // shared single backdrop
var keydownBound = null;       // single ESC handler; targets top-most

export function openOverlay(opts) {
  opts = opts || {};
  var sidePanel = !!opts.sidePanel;

  // Stack-push only when sidePanel:true AND the stack is already
  // non-empty. Otherwise behave like a singleton — close any existing
  // overlay first, then mount fresh full-layout.
  var willStack = sidePanel && _stack.length > 0;

  if (!willStack) {
    closeOverlay({ _allLayers: true });
  }

  var title       = opts.title || "";
  var lede        = opts.lede || "";
  var body        = opts.body || null;
  var footer      = opts.footer || null;
  var kind        = opts.kind || "default";
  var size        = opts.size || "default";
  var persist     = !!opts.persist;
  var transparent = !!opts.transparent;

  // Backdrop element. Lazy-create only if no existing backdrop (the
  // stack reuses ONE backdrop across both layers — single visual dim).
  if (!backdropEl) {
    backdropEl = document.createElement("div");
    backdropEl.className = "overlay-backdrop";
    backdropEl.addEventListener("click", function(e) {
      if (e.target !== backdropEl) return;
      // Backdrop click closes top-most layer only (unless persist).
      var top = _stack[_stack.length - 1];
      if (top && top.options && top.options.persist) return;
      closeOverlay();
    });
    document.body.appendChild(backdropEl);
  }

  // Panel itself. Triple-section: head (sticky) + body (scrollable) +
  // footer (sticky, optional).
  var panel = document.createElement("div");
  panel.className = "overlay open";
  panel.setAttribute("data-kind", kind);
  panel.setAttribute("data-size", size);
  if (persist)     panel.setAttribute("data-persist", "true");
  if (transparent) panel.classList.add("is-transparent");

  // The stack-position attribute drives the CSS layout mode.
  // - "full"  : centered single-layer behavior
  // - "left"  : 50vw on the left (used when this layer becomes the base
  //             of a 2-layer stack)
  // - "right" : 50vw on the right (used for the side-panel top layer)
  if (willStack) {
    // Re-position the EXISTING base layer to "left".
    var basePrev = _stack[_stack.length - 1];
    if (basePrev && basePrev.panel) basePrev.panel.setAttribute("data-stack-pos", "left");
    panel.setAttribute("data-stack-pos", "right");
  } else {
    panel.setAttribute("data-stack-pos", "full");
  }

  // Head
  var head = document.createElement("div");
  head.className = "overlay-head";

  var headLeft = document.createElement("div");
  headLeft.className = "overlay-head-left";
  if (title) {
    var h3 = document.createElement("h3");
    h3.className = "overlay-title";
    h3.textContent = title;
    headLeft.appendChild(h3);
  }
  if (lede) {
    var ledeEl = document.createElement("div");
    ledeEl.className = "overlay-lede";
    ledeEl.textContent = lede;
    headLeft.appendChild(ledeEl);
  }
  head.appendChild(headLeft);

  // Slot for caller-provided head extras (e.g., AI Assist scope toggle
  // chip). Caller can find it via panel.querySelector(".overlay-head-extras").
  var headExtras = document.createElement("div");
  headExtras.className = "overlay-head-extras";
  head.appendChild(headExtras);

  // Persist-mode hint: a small lock icon inside the close button when
  // persist=true, with a native tooltip.
  var closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "overlay-close";
  closeBtn.setAttribute("aria-label", "Close");
  if (persist) {
    closeBtn.setAttribute("title",
      "Click-outside is locked for this dialog. Use Esc or this button to close.");
    var lock = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    lock.setAttribute("class", "overlay-close-lock");
    lock.setAttribute("width", "11");
    lock.setAttribute("height", "11");
    lock.setAttribute("viewBox", "0 0 24 24");
    lock.setAttribute("fill", "none");
    lock.setAttribute("stroke", "currentColor");
    lock.setAttribute("stroke-width", "2");
    lock.setAttribute("stroke-linecap", "round");
    lock.setAttribute("stroke-linejoin", "round");
    lock.setAttribute("aria-hidden", "true");
    [
      "M7 11V7a5 5 0 0 1 10 0v4",
      "M5 11h14v10H5z"
    ].forEach(function(d) {
      var p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", d);
      lock.appendChild(p);
    });
    closeBtn.appendChild(lock);
  }
  var x = document.createElement("span");
  x.className = "overlay-close-x";
  x.setAttribute("aria-hidden", "true");
  x.textContent = "✕";
  closeBtn.appendChild(x);
  closeBtn.addEventListener("click", function() { closeOverlay(); });
  head.appendChild(closeBtn);

  panel.appendChild(head);

  // Body
  var bodyWrap = document.createElement("div");
  bodyWrap.className = "overlay-body";
  if (body) bodyWrap.appendChild(body);
  panel.appendChild(bodyWrap);

  // Footer (optional)
  if (footer) {
    var footWrap = document.createElement("div");
    footWrap.className = "overlay-footer";
    footWrap.appendChild(footer);
    panel.appendChild(footWrap);
  }

  // Mount
  document.body.appendChild(panel);
  _stack.push({ panel: panel, options: opts });

  // ESC handler. Single shared listener that targets the top-most layer.
  // Capture-phase + stopImmediatePropagation defends against other global
  // ESC handlers (e.g. HelpModal, AiAssistOverlay's pick-mode cancel)
  // double-firing on the same Escape keystroke. Without stop-propagation a
  // single ESC could fire 2-3 listeners → 2-3 closeOverlay calls → the
  // stack popped too aggressively.
  if (!keydownBound) {
    keydownBound = function(e) {
      if (e.key !== "Escape" && e.keyCode !== 27) return;
      // Only act if we have a layer to close. If the stack is empty
      // (race with concurrent close), let other handlers have the event.
      if (_stack.length === 0) return;
      e.stopImmediatePropagation();
      closeOverlay();
    };
    // Capture phase (third arg true) so we run BEFORE other listeners.
    document.addEventListener("keydown", keydownBound, true);
  }

  // Focus management. Move focus into the new (top-most) overlay.
  setTimeout(function() {
    var firstFocusable = panel.querySelector(
      "input, select, textarea, button:not(.overlay-close), [tabindex]:not([tabindex='-1'])"
    );
    if (firstFocusable && typeof firstFocusable.focus === "function") {
      try { firstFocusable.focus(); } catch (e) { /* swallow */ }
    } else {
      try { closeBtn.focus(); } catch (e) { /* swallow */ }
    }
  }, 50);

  return panel;
}

// closeOverlay():
//   - With no opts: pop top of stack. If the stack is now empty, tear
//     down the backdrop + ESC handler. If the stack now has 1 layer,
//     expand it to "full".
//   - With { _allLayers: true } (internal): wipe the entire stack — used
//     by openOverlay() when called WITHOUT sidePanel:true to enforce the
//     "one overlay at a time" default.
export function closeOverlay(opts) {
  opts = opts || {};
  var clearAll = !!opts._allLayers;

  if (clearAll) {
    while (_stack.length > 0) {
      var entry = _stack.pop();
      if (entry.panel && entry.panel.parentNode) {
        entry.panel.parentNode.removeChild(entry.panel);
      }
    }
  } else {
    var top = _stack.pop();
    if (top && top.panel && top.panel.parentNode) {
      top.panel.parentNode.removeChild(top.panel);
    }
    // If the stack is now 1 layer, restore it to full-layout.
    if (_stack.length === 1) {
      var survivor = _stack[0];
      if (survivor.panel) survivor.panel.setAttribute("data-stack-pos", "full");
    }
  }

  // If stack is empty, tear down the shared backdrop + ESC handler.
  if (_stack.length === 0) {
    if (keydownBound) {
      // Match the capture-phase registration in openOverlay.
      document.removeEventListener("keydown", keydownBound, true);
      keydownBound = null;
    }
    if (backdropEl && backdropEl.parentNode) {
      backdropEl.parentNode.removeChild(backdropEl);
    }
    backdropEl = null;
  }
}

export function isOpen() {
  return _stack.length > 0;
}

export function setTransparent(flag) {
  // Operate on the top-most layer.
  var top = _stack[_stack.length - 1];
  if (!top || !top.panel) return;
  if (flag) {
    top.panel.classList.add("is-transparent");
    if (backdropEl) backdropEl.classList.add("is-transparent");
  } else {
    top.panel.classList.remove("is-transparent");
    if (backdropEl) backdropEl.classList.remove("is-transparent");
  }
}

export function _resetForTests() {
  closeOverlay({ _allLayers: true });
  // Sweep any orphan .overlay or .overlay-backdrop node not tracked by the
  // in-memory stack (e.g. from a test that mounted via direct DOM
  // manipulation rather than openOverlay).
  try {
    document.querySelectorAll(".overlay, .overlay-backdrop").forEach(function(el) {
      try { el.remove(); } catch (_e) { /* best-effort */ }
    });
  } catch (_e) { /* best-effort */ }
  // Reset module-private state to defensive defaults.
  _stack = [];
  backdropEl = null;
  if (keydownBound) {
    document.removeEventListener("keydown", keydownBound, true);
    keydownBound = null;
  }
}
