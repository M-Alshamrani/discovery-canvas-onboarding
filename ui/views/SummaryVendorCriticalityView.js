// ui/views/SummaryVendorCriticalityView.js — vendor criticality packed bubble chart
//
// Connects the three facts already on every current-state instance —
// layerId (workload/service), vendor, and criticality — into one view:
// a packed bubble per vendor, sized/coloured by how much critical exposure
// it carries. Criticality is only ever independently edited on current
// instances elsewhere in the app (see MatrixView's detail form), so this
// tab scopes to current-state instances only rather than inventing
// desired-state editing semantics.
//
// The bubbles are laid out with a circle-packing algorithm (the front-chain
// method from Wang et al. / d3-hierarchy packSiblings) and rendered as SVG,
// so colours/sizes live in inline attributes — robust to stale CSS caches.

import { LAYERS, getEnvLabel } from "../../core/config.js";
import { layerLabel } from "../../core/labelResolvers.js";
import { helpButton } from "./HelpModal.js";
import { getEngagementAsSession, getVisibleEnvsFromEngagement } from "../../state/projection.js";
import { renderDemoBanner } from "../components/DemoBanner.js";
import { commitInstanceSetCriticality } from "../../state/adapter.js";

// Same weight scale the Heatmap tab uses (services/healthMetrics.js) so a
// "vendor criticality score" reads consistently with the rest of the app.
var CRIT_WEIGHT = { High: 2, Medium: 1, Low: 0.5 };

// Hex values mirror the --crit-* / --*-strip CSS variables (styles.css).
// Used inline on the SVG so the chart looks right even before CSS loads.
var COLORS = {
  high: "#d93025", medium: "#f59e0b", low: "#16a34a",
  dell: "#0076ce", nonDell: "#9ca3af", custom: "#f59e0b"
};
// Label colour chosen for contrast against each fill.
var TEXT_ON = {
  high: "#ffffff", medium: "#3a2a00", low: "#ffffff",
  dell: "#ffffff", nonDell: "#1f2937", custom: "#3a2a00"
};

var SIZE_OPTIONS  = [{ id: "score", label: "Criticality score" }, { id: "count", label: "Workload count" }];
var COLOR_OPTIONS = [{ id: "criticality", label: "Criticality" }, { id: "vendorGroup", label: "Vendor type" }];

var MAX_R = 96; // design-px radius of the largest bubble
var MIN_R = 18; // floor so tiny vendors stay legible & clickable

export function renderSummaryVendorCriticalityView(left, right, sessionArg) {
  var liveSession = sessionArg || getEngagementAsSession();
  var activeLayerIds = new Set(LAYERS.map(function(l) { return l.id; }));
  var sizeBy  = "score";
  var colorBy = "criticality";

  if (liveSession && liveSession.isDemo) renderDemoBanner(left);

  var overview = mk("div", "card");
  var titleRow = mk("div", "card-title-row");
  titleRow.appendChild(mkt("div", "card-title", "Vendor criticality map"));
  titleRow.appendChild(helpButton("reporting_vendor_criticality"));
  overview.appendChild(titleRow);
  overview.appendChild(mkt("div", "card-hint",
    "Each bubble is a vendor. Size and colour are configurable below. Click a bubble to see its current workloads and retriage their criticality."));

  var filterRow = mk("div", "filter-row");
  filterRow.appendChild(mkt("span", "filter-label", "Layers:"));
  var chipsHost = mk("div", "chips-row");
  filterRow.appendChild(chipsHost);
  overview.appendChild(filterRow);

  var configRow = mk("div", "vc-config-row");
  configRow.appendChild(buildConfigGroup("Size by", SIZE_OPTIONS, sizeBy, function(val) { sizeBy = val; renderAll(); }));
  configRow.appendChild(buildConfigGroup("Colour by", COLOR_OPTIONS, colorBy, function(val) { colorBy = val; renderAll(); }));
  overview.appendChild(configRow);

  var legend = mk("div", "vc-legend");
  overview.appendChild(legend);
  left.appendChild(overview);

  LAYERS.forEach(function(layer) {
    var chip = mk("div", "chip-filter active");
    chip.textContent = layer.label;
    chip.addEventListener("click", function() {
      chip.classList.toggle("active");
      if (chip.classList.contains("active")) activeLayerIds.add(layer.id);
      else                                    activeLayerIds.delete(layer.id);
      if (!activeLayerIds.size) {
        LAYERS.forEach(function(l) { activeLayerIds.add(l.id); });
        chipsHost.querySelectorAll(".chip-filter").forEach(function(c) { c.classList.add("active"); });
      }
      renderAll();
    });
    chipsHost.appendChild(chip);
  });

  var boardCard = mk("div", "card");
  boardCard.appendChild(mkt("div", "card-title", "Vendor map"));
  var board = mk("div", "vc-chart-host");
  boardCard.appendChild(board);
  left.appendChild(boardCard);

  showPlaceholder();

  function buildConfigGroup(label, options, activeId, onPick) {
    var el = mk("div", "vc-config-group");
    el.appendChild(mkt("span", "vc-config-label", label + ":"));
    var chipsEl = mk("div", "vc-config-chips");
    options.forEach(function(opt) {
      var chip = mkt("button", "vc-config-chip" + (opt.id === activeId ? " active" : ""), opt.label);
      chip.type = "button";
      chip.addEventListener("click", function() {
        chipsEl.querySelectorAll(".vc-config-chip").forEach(function(c) { c.classList.remove("active"); });
        chip.classList.add("active");
        onPick(opt.id);
      });
      chipsEl.appendChild(chip);
    });
    el.appendChild(chipsEl);
    return el;
  }

  function renderLegend() {
    legend.innerHTML = "";
    var keys = colorBy === "criticality"
      ? [["high", "High"], ["medium", "Medium"], ["low", "Low"]]
      : [["dell", "Dell"], ["nonDell", "Non-Dell"], ["custom", "Custom"]];
    keys.forEach(function(p) {
      var item = mk("span", "vc-legend-item");
      var dot = mk("span", "vc-legend-dot");
      dot.style.background = COLORS[p[0]];
      item.appendChild(dot);
      item.appendChild(document.createTextNode(" " + p[1]));
      legend.appendChild(item);
    });
  }

  function ids() { return [...activeLayerIds]; }

  function currentInstances() {
    var all = (liveSession && Array.isArray(liveSession.instances)) ? liveSession.instances : [];
    var layerSet = {};
    ids().forEach(function(id) { layerSet[id] = true; });
    return all.filter(function(i) { return i.state === "current" && layerSet[i.layerId]; });
  }

  function computeVendorRows() {
    var byVendor = new Map();
    currentInstances().forEach(function(i) {
      var key = i.vendor || "(unlabeled vendor)";
      if (!byVendor.has(key)) {
        byVendor.set(key, { vendor: key, vendorGroup: i.vendorGroup || "custom", instances: [], score: 0, counts: { High: 0, Medium: 0, Low: 0 } });
      }
      var row = byVendor.get(key);
      row.instances.push(i);
      var w = CRIT_WEIGHT[i.criticality] || 0;
      row.score += w;
      if (row.counts[i.criticality] !== undefined) row.counts[i.criticality]++;
    });
    return [...byVendor.values()].sort(function(a, b) { return b.score - a.score; });
  }

  function dominantCriticality(row) {
    if (row.counts.High   > 0) return "high";
    if (row.counts.Medium > 0) return "medium";
    return "low";
  }

  function sizeValueOf(row) { return sizeBy === "count" ? row.instances.length : row.score; }

  function renderAll() {
    renderLegend();
    var rows = computeVendorRows();
    board.innerHTML = "";
    if (rows.length === 0) {
      board.appendChild(mkt("div", "vc-empty", "No current-state workloads or services match the active layer filter."));
      showPlaceholder();
      return;
    }

    var maxV = Math.max.apply(null, rows.map(sizeValueOf)) || 1;
    // Area ∝ value → radius ∝ sqrt(value); floor keeps small vendors usable.
    var circles = rows.map(function(row) {
      return { r: Math.max(Math.sqrt(sizeValueOf(row) / maxV) * MAX_R, MIN_R), row: row, x: 0, y: 0 };
    });
    // Pack largest-first for a tight, centered cluster.
    packCircles(circles.slice().sort(function(a, b) { return b.r - a.r; }));

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    circles.forEach(function(c) {
      minX = Math.min(minX, c.x - c.r); maxX = Math.max(maxX, c.x + c.r);
      minY = Math.min(minY, c.y - c.r); maxY = Math.max(maxY, c.y + c.r);
    });
    var pad = 8;
    var root = svgEl("svg", {
      class: "vc-svg",
      viewBox: (minX - pad) + " " + (minY - pad) + " " + ((maxX - minX) + pad * 2) + " " + ((maxY - minY) + pad * 2),
      preserveAspectRatio: "xMidYMid meet"
    });
    // Draw largest first so smaller bubbles layer cleanly on top.
    circles.slice().sort(function(a, b) { return b.r - a.r; }).forEach(function(c) {
      root.appendChild(buildBubble(c));
    });
    board.appendChild(root);
  }

  function buildBubble(c) {
    var row = c.row;
    var key = colorBy === "criticality" ? dominantCriticality(row) : row.vendorGroup;
    var fill = COLORS[key] || COLORS.custom;
    var textColor = TEXT_ON[key] || "#ffffff";
    var r = c.r;

    var g = svgEl("g", { class: "vc-bubble-g", transform: "translate(" + c.x + "," + c.y + ")", role: "button", tabindex: "0" });
    g.style.cursor = "pointer";

    var circle = svgEl("circle", { r: r, fill: fill, stroke: "#ffffff", "stroke-width": 2 });
    g.appendChild(circle);

    var n = row.instances.length;
    var valueText = sizeBy === "count" ? n + (n === 1 ? " workload" : " workloads") : "Score " + trimScore(row.score);

    var title = svgEl("title", {});
    title.textContent = row.vendor + " · score " + trimScore(row.score) + " · " + n +
      (n === 1 ? " workload" : " workloads") + " · " +
      row.counts.High + " High / " + row.counts.Medium + " Med / " + row.counts.Low + " Low";
    g.appendChild(title);

    if (r >= 38) {
      var nameFont = Math.min(r * 0.40, 22);
      var valueFont = Math.min(r * 0.30, 15);
      var name = fitName(row.vendor, r, nameFont);
      g.appendChild(svgText(name, { y: -valueFont * 0.55, "font-size": nameFont, "font-weight": 700, fill: textColor }));
      g.appendChild(svgText(valueText, { y: nameFont * 0.62, "font-size": valueFont, "font-weight": 500, fill: textColor, opacity: 0.92 }));
    } else if (r >= 24) {
      var f = Math.min(r * 0.42, 14);
      g.appendChild(svgText(sizeBy === "count" ? String(n) : trimScore(row.score), { y: 0, "font-size": f, "font-weight": 700, fill: textColor }));
    }

    g.addEventListener("click", function() { renderVendorDetail(row); });
    g.addEventListener("keydown", function(e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); renderVendorDetail(row); }
    });
    return g;
  }

  // Truncate a vendor name to roughly fit inside a bubble of radius r.
  function fitName(name, r, font) {
    var charW = font * 0.56;
    var maxChars = Math.floor((r * 1.7) / charW);
    if (maxChars < 1) return "";
    if (name.length <= maxChars) return name;
    if (maxChars <= 1) return name.slice(0, 1);
    return name.slice(0, maxChars - 1) + "…";
  }

  function trimScore(num) {
    return (Math.round(num * 10) / 10).toString();
  }

  function showPlaceholder() {
    right.innerHTML = "";
    var ph = mk("div", "detail-placeholder");
    ph.appendChild(mkt("div", "detail-ph-title", "Drill into a vendor"));
    ph.appendChild(mkt("div", "detail-ph-hint",
      "Click a bubble to see all of that vendor's current workloads and retriage their criticality."));
    right.appendChild(ph);
  }

  function envLabelFor(inst) {
    var envs = getVisibleEnvsFromEngagement();
    var match = envs.find(function(e) { return e.id === inst.environmentId; });
    return match ? getEnvLabel(match.id, liveSession) : inst.environmentId;
  }

  function renderVendorDetail(row) {
    right.innerHTML = "";
    var panel = mk("div", "detail-panel");
    panel.appendChild(mkt("div", "detail-title", row.vendor));
    panel.appendChild(mkt("div", "detail-sub",
      row.instances.length + " current instance" + (row.instances.length === 1 ? "" : "s") +
      " · score " + trimScore(row.score)));
    panel.appendChild(mkSep("Workloads & services"));
    row.instances.forEach(function(inst) {
      panel.appendChild(renderInstanceRow(inst, row));
    });
    right.appendChild(panel);
  }

  // Instance row with an editable criticality select; commits immediately
  // and re-renders both the bubble chart (size/colour may shift) and the
  // open vendor detail panel.
  function renderInstanceRow(inst, row) {
    var rowEl = mk("div", "vc-inst-row");
    var label = mk("div", "vc-inst-label");
    label.appendChild(mkt("span", "crit-shape-" + (inst.criticality || "Low").toLowerCase(), ""));
    label.appendChild(document.createTextNode(" " + (inst.label || "(unnamed)")));
    label.appendChild(mkt("span", "vc-inst-meta", layerLabel(inst.layerId) + " · " + envLabelFor(inst)));
    rowEl.appendChild(label);

    var sel = mk("select", "form-select vc-crit-select");
    ["Low", "Medium", "High"].forEach(function(opt) {
      var o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      if (opt === inst.criticality) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("change", function() {
      commitInstanceSetCriticality(inst.id, sel.value);
      // Reporting tabs read a snapshot of the engagement (state/projection.js);
      // re-derive it so the just-committed change is visible, unless an
      // explicit sessionArg was supplied (caller owns that snapshot).
      if (!sessionArg) liveSession = getEngagementAsSession();
      renderAll();
      var freshRow = computeVendorRows().find(function(r) { return r.vendor === row.vendor; });
      if (freshRow) renderVendorDetail(freshRow);
      else showPlaceholder();
    });
    rowEl.appendChild(sel);

    return rowEl;
  }

  renderAll();
}

// ─── DOM helpers ─────────────────────────────────────────────────────────
function mk(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
function mkt(tag, cls, text) { var e = mk(tag, cls); e.textContent = text; return e; }
function mkSep(text) { return mkt("div", "detail-sep", text); }

var SVG_NS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs) {
  var e = document.createElementNS(SVG_NS, tag);
  if (attrs) Object.keys(attrs).forEach(function(k) { e.setAttribute(k, attrs[k]); });
  return e;
}
function svgText(text, attrs) {
  var t = svgEl("text", Object.assign({ x: 0, "text-anchor": "middle", "dominant-baseline": "central",
    "font-family": "Inter, system-ui, sans-serif" }, attrs || {}));
  t.textContent = text;
  return t;
}

// ─── Circle packing (front-chain, after Wang et al. / d3-hierarchy) ──────
// Mutates each circle to add {x, y}. Centering is left to the caller's
// bounding-box viewBox. Input should be sorted largest-first for a tight
// cluster.
function _Node(c) { this._ = c; this.next = null; this.prev = null; }

function _place(b, a, c) {
  var dx = b.x - a.x, x, a2,
      dy = b.y - a.y, y, b2,
      d2 = dx * dx + dy * dy;
  if (d2) {
    a2 = a.r + c.r; a2 *= a2;
    b2 = b.r + c.r; b2 *= b2;
    if (a2 > b2) {
      x = (d2 + b2 - a2) / (2 * d2);
      y = Math.sqrt(Math.max(0, b2 / d2 - x * x));
      c.x = b.x - x * dx - y * dy;
      c.y = b.y - x * dy + y * dx;
    } else {
      x = (d2 + a2 - b2) / (2 * d2);
      y = Math.sqrt(Math.max(0, a2 / d2 - x * x));
      c.x = a.x + x * dx - y * dy;
      c.y = a.y + x * dy + y * dx;
    }
  } else {
    c.x = a.x + c.r;
    c.y = a.y;
  }
}

function _intersects(a, b) {
  var dr = a.r + b.r - 1e-6, dx = b.x - a.x, dy = b.y - a.y;
  return dr > 0 && dr * dr > dx * dx + dy * dy;
}

function _score(node) {
  var a = node._, b = node.next._,
      ab = a.r + b.r,
      dx = (a.x * b.r + b.x * a.r) / ab,
      dy = (a.y * b.r + b.y * a.r) / ab;
  return dx * dx + dy * dy;
}

function packCircles(circles) {
  var n = circles.length;
  if (n === 0) return;

  var a = circles[0]; a.x = 0; a.y = 0;
  if (n === 1) return;

  var b = circles[1]; a.x = -b.r; b.x = a.r; b.y = 0;
  if (n === 2) return;

  var c = circles[2]; _place(b, a, c);

  a = new _Node(a); b = new _Node(b); c = new _Node(c);
  a.next = c.prev = b; b.next = a.prev = c; c.next = b.prev = a;

  pack: for (var i = 3; i < n; ++i) {
    _place(a._, b._, circles[i]); c = new _Node(circles[i]);
    var j = b.next, k = a.prev, sj = b._.r, sk = a._.r;
    do {
      if (sj <= sk) {
        if (_intersects(j._, c._)) { b = j; a.next = b; b.prev = a; --i; continue pack; }
        sj += j._.r; j = j.next;
      } else {
        if (_intersects(k._, c._)) { a = k; a.next = b; b.prev = a; --i; continue pack; }
        sk += k._.r; k = k.prev;
      }
    } while (j !== k.next);

    c.prev = a; c.next = b; a.next = b.prev = b = c;
    var aa = _score(a);
    while ((c = c.next) !== b) {
      var ca = _score(c);
      if (ca < aa) { a = c; aa = ca; }
    }
    b = a.next;
  }
}