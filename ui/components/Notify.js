// ui/components/Notify.js
//
// One vocabulary for every confirmation, error message, and "info"
// pulse across the app. Replaces scattered native confirm() / alert()
// calls, which look jarring against the Dell-blue overlay theme.
//
// API:
//   confirmAction(opts) -> Promise<boolean>
//     opts: { title, body, confirmLabel?, cancelLabel?, danger?, lede? }
//     Opens an Overlay-based modal matching the env-hide pattern.
//     Resolves true when the user confirms, false on Cancel/Esc/backdrop.
//
//   notifyError(opts)
//     opts: { title, body }
//     Opens a centered Overlay-modal with red sec-color tag + an OK button.
//
//   notifyInfo(opts)
//     opts: { title, body, dismissAfter? = 3500 }
//     Renders a small top-right toast that auto-dismisses. No backdrop.
//     Returns a function to dismiss programmatically.
//
//   notifySuccess(opts)  same as notifyInfo but with the green check tone.
//
// All three use the GPLC tag vocabulary + .btn-with-feedback button
// states so the visual language is consistent everywhere a "system
// message" surfaces.

import { openOverlay, closeOverlay } from "./Overlay.js";

// ---- confirmAction --------------------------------------------------
export function confirmAction(opts) {
  opts = opts || {};
  return new Promise(function(resolve) {
    var resolved = false;
    function settle(v) {
      if (resolved) return;
      resolved = true;
      closeOverlay();
      resolve(!!v);
    }

    var body = document.createElement("div");
    body.className = "notify-body";
    if (opts.body) {
      var p = document.createElement("p");
      p.className = "notify-lede";
      p.textContent = opts.body;
      body.appendChild(p);
    }

    var cancel = mkBtn(opts.cancelLabel || "Cancel", "btn-link btn-cancel", function() { settle(false); });
    var confirm = mkBtn(opts.confirmLabel || "Confirm",
      "btn-with-feedback " + (opts.danger ? "btn-danger" : "btn-primary"),
      function() {
        confirm.classList.add("is-loading");
        settle(true);
      });

    var foot = document.createElement("div");
    foot.className = "overlay-actions";
    foot.appendChild(cancel);
    foot.appendChild(confirm);

    openOverlay({
      title:  opts.title || "Confirm",
      lede:   opts.lede || "",
      body:   body,
      footer: foot,
      kind:   "confirm-action",
      size:   "default"
    });
    var panel = document.querySelector(".overlay.open");
    if (panel) {
      panel.classList.add("notify-modal");
      if (opts.danger) panel.classList.add("notify-danger");
    }

    // Listen for Escape + backdrop close so the promise resolves false
    // when the user dismisses without picking either button.
    var watcher = setInterval(function() {
      if (!document.querySelector(".overlay.open.notify-modal")) {
        clearInterval(watcher);
        if (!resolved) settle(false);
      }
    }, 80);
  });
}

// ---- notifyError ----------------------------------------------------
export function notifyError(opts) {
  opts = opts || {};
  var body = document.createElement("div");
  body.className = "notify-body notify-error-body";
  var icon = makeIcon("alert-triangle", 18);
  icon.classList.add("notify-error-icon");
  body.appendChild(icon);
  if (opts.body) {
    var p = document.createElement("p");
    p.className = "notify-lede";
    p.textContent = opts.body;
    body.appendChild(p);
  }

  var ok = mkBtn("Got it", "btn-with-feedback btn-primary", function() { closeOverlay(); });

  var foot = document.createElement("div");
  foot.className = "overlay-actions";
  foot.appendChild(ok);

  openOverlay({
    title:  opts.title || "Something went wrong",
    lede:   opts.lede || "",
    body:   body,
    footer: foot,
    kind:   "notify-error",
    size:   "default"
  });
  var panel = document.querySelector(".overlay.open");
  if (panel) {
    panel.classList.add("notify-modal");
    panel.classList.add("notify-error");
  }
}

// ---- toast: notifyInfo / notifySuccess ------------------------------
var TOAST_HOST_ID = "notify-toast-host";
function ensureToastHost() {
  var host = document.getElementById(TOAST_HOST_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = TOAST_HOST_ID;
    host.className = "notify-toast-host";
    document.body.appendChild(host);
  }
  return host;
}

function makeToast(opts, kind) {
  opts = opts || {};
  var host = ensureToastHost();
  var toast = document.createElement("div");
  toast.className = "notify-toast notify-toast-" + kind;
  if (opts.title) {
    var t = document.createElement("div");
    t.className = "notify-toast-title";
    t.textContent = opts.title;
    toast.appendChild(t);
  }
  if (opts.body) {
    var b = document.createElement("div");
    b.className = "notify-toast-body";
    b.textContent = opts.body;
    toast.appendChild(b);
  }
  host.appendChild(toast);
  // Trigger entry animation.
  requestAnimationFrame(function() { toast.classList.add("is-visible"); });
  var ms = (typeof opts.dismissAfter === "number") ? opts.dismissAfter : 3500;
  var timer = setTimeout(dismiss, ms);
  function dismiss() {
    clearTimeout(timer);
    toast.classList.remove("is-visible");
    setTimeout(function() {
      if (toast && toast.parentNode) toast.parentNode.removeChild(toast);
    }, 320);
  }
  return dismiss;
}

export function notifyInfo(opts)    { return makeToast(opts, "info"); }
export function notifySuccess(opts) { return makeToast(opts, "success"); }

// ---- helpers --------------------------------------------------------
function mkBtn(text, klass, onClick) {
  var b = document.createElement("button");
  b.type = "button";
  b.className = klass || "";
  b.textContent = text;
  if (typeof onClick === "function") b.addEventListener("click", onClick);
  return b;
}

function makeIcon(name, size) {
  var s = size || 14;
  var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(s));
  svg.setAttribute("height", String(s));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  var paths = ICONS[name] || [];
  paths.forEach(function(d) {
    if (typeof d === "string") {
      var p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", d);
      svg.appendChild(p);
    } else if (d && d.tag) {
      var el = document.createElementNS("http://www.w3.org/2000/svg", d.tag);
      Object.keys(d).forEach(function(k) { if (k !== "tag") el.setAttribute(k, d[k]); });
      svg.appendChild(el);
    }
  });
  return svg;
}

var ICONS = {
  "alert-triangle": [
    "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z",
    { tag: "line", x1: "12", x2: "12", y1: "9",  y2: "13" },
    { tag: "line", x1: "12", x2: "12.01", y1: "17", y2: "17" }
  ]
};
