// ui/views/SummaryVendorCriticalityView.js — vendor × workload criticality
//
// Workloads (business apps) are the base of the estate: everything in the
// other layers exists to RUN a workload. So this view is workload-centric —
// a server is not a workload, it is a server running one. The unit here is
// the current-state business workload, banded by ITS criticality (the only
// criticality that matters for the business). A vendor "relates to" a
// workload either by being the workload's own application vendor, or by
// supplying one of the underlying technologies the workload is mapped to
// (instance.mappedAssetIds → the compute/storage/etc. it runs on). That is
// the vendor's exposure to that workload's criticality.
//
// The Y axis is three equal criticality bands (Critical top, Low bottom).
// Each band is a 100%-wide bar split by vendor (share of vendor↔workload
// links at that criticality). The right panel ranks vendors by how many
// workloads they touch; drilling in lists those workloads with the
// workload's own criticality editable (commits via commitInstanceSetCriticality).

import { LAYERS, getEnvLabel } from "../../core/config.js";
import { layerLabel } from "../../core/labelResolvers.js";
import { helpButton } from "./HelpModal.js";
import { getEngagementAsSession, getVisibleEnvsFromEngagement } from "../../state/projection.js";
import { renderDemoBanner } from "../components/DemoBanner.js";
import { commitInstanceSetCriticality } from "../../state/adapter.js";

var PALETTE = [
  "#0076CE", "#00843D", "#7B61FF", "#C8102E", "#F59E0B", "#0EA5E9",
  "#DB2777", "#65A30D", "#9333EA", "#EA580C", "#0891B2", "#A16207"
];
var OTHER_COLOR = "#9CA3AF";

var BANDS = [
  { key: "High",   label: "Critical", crit: "high" },
  { key: "Medium", label: "Medium",   crit: "medium" },
  { key: "Low",    label: "Low",      crit: "low" }
];

// The workload layer is the base, not a peer "layer" — relabel it so the
// exposure-source filter reads as "the workload's own app vendor".
function exposureLabel(layerId) {
  return layerId === "workload" ? "Business app" : layerLabel(layerId);
}

export function renderSummaryVendorCriticalityView(left, right, sessionArg) {
  var liveSession = sessionArg || getEngagementAsSession();
  // Exposure sources: which layers attribute a vendor to a workload.
  // "workload" = the app's own vendor; the rest = mapped underlying tech.
  var activeLayerIds = new Set(LAYERS.map(function(l) { return l.id; }));

  var rightMode = "breakdown";  // "breakdown" | "vendor"
  var currentVendor = null;

  if (liveSession && liveSession.isDemo) renderDemoBanner(left);

  var overview = mk("div", "card");
  var titleRow = mk("div", "card-title-row");
  titleRow.appendChild(mkt("div", "card-title", "Vendor criticality map"));
  titleRow.appendChild(helpButton("reporting_vendor_criticality"));
  overview.appendChild(titleRow);
  overview.appendChild(mkt("div", "card-hint",
    "Business workloads banded by their criticality. Each band is split by the vendors exposed to those workloads — the app's own vendor plus the vendors of the technology it runs on. Click a segment or a vendor to retriage the workloads behind it."));
  var coverageHint = mkt("div", "card-hint vc-coverage", "");
  overview.appendChild(coverageHint);

  var filterRow = mk("div", "filter-row");
  filterRow.appendChild(mkt("span", "filter-label", "Vendor exposure from:"));
  var chipsHost = mk("div", "chips-row");
  filterRow.appendChild(chipsHost);
  overview.appendChild(filterRow);
  left.appendChild(overview);

  LAYERS.forEach(function(layer) {
    var chip = mk("div", "chip-filter active");
    chip.textContent = exposureLabel(layer.id);
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

  var chartCard = mk("div", "card");
  var chartTitleRow = mk("div", "card-title-row");
  chartTitleRow.appendChild(mkt("div", "card-title", "Workloads by criticality"));
  var totalChip = mkt("span", "chip-stat", "");
  chartTitleRow.appendChild(totalChip);
  chartCard.appendChild(chartTitleRow);
  var chartHost = mk("div", "vc-band-chart");
  chartCard.appendChild(chartHost);
  left.appendChild(chartCard);

  // ─── data ──────────────────────────────────────────────────────────────
  function ids() { return [...activeLayerIds]; }

  function allCurrentById() {
    var map = new Map();
    (liveSession && Array.isArray(liveSession.instances) ? liveSession.instances : [])
      .forEach(function(i) { if (i.state === "current") map.set(i.id, i); });
    return map;
  }

  function currentWorkloads() {
    return (liveSession && Array.isArray(liveSession.instances) ? liveSession.instances : [])
      .filter(function(i) { return i.state === "current" && i.layerId === "workload"; });
  }

  // For one workload, the vendors exposed to it (per the active sources) and
  // the role(s) each plays. Each vendor counts once for the workload.
  function exposedVendors(W, byId) {
    var map = new Map(); // vendorName -> { vendor, vendorGroup, roles:[] }
    function add(vendor, vendorGroup, role) {
      if (!vendor) vendor = "(unlabeled vendor)";
      if (!map.has(vendor)) map.set(vendor, { vendor: vendor, vendorGroup: vendorGroup || "custom", roles: [] });
      if (role) map.get(vendor).roles.push(role);
    }
    if (activeLayerIds.has("workload")) add(W.vendor, W.vendorGroup, "Business app");
    (W.mappedAssetIds || []).forEach(function(aid) {
      var A = byId.get(aid);
      if (!A) return;
      if (!activeLayerIds.has(A.layerId)) return;
      add(A.vendor, A.vendorGroup, layerLabel(A.layerId) + ": " + (A.label || "asset"));
    });
    return map;
  }

  function computeModel() {
    var byId = allCurrentById();
    var workloads = currentWorkloads();
    var mappedCount = workloads.filter(function(w) { return (w.mappedAssetIds || []).length > 0; }).length;

    var vendors = new Map(); // name -> aggregate
    var bandWorkloadIds = { High: new Set(), Medium: new Set(), Low: new Set() };

    workloads.forEach(function(W) {
      var crit = W.criticality || "Low"; // criticality is required-non-null; default-safe
      var exposed = exposedVendors(W, byId);
      exposed.forEach(function(info, name) {
        if (!vendors.has(name)) {
          vendors.set(name, { vendor: name, vendorGroup: info.vendorGroup, counts: { High: 0, Medium: 0, Low: 0 }, total: 0, rels: [], wlSet: new Set() });
        }
        var v = vendors.get(name);
        if (v.counts[crit] !== undefined) v.counts[crit]++;
        if (!v.wlSet.has(W.id)) { v.wlSet.add(W.id); v.total++; }
        v.rels.push({ wl: W, crit: crit, roles: info.roles });
        bandWorkloadIds[crit].add(W.id);
      });
    });

    var list = [...vendors.values()].sort(function(a, b) {
      return b.total - a.total || a.vendor.localeCompare(b.vendor);
    });
    list.forEach(function(v, idx) {
      v.rank = idx;
      v.color = idx < PALETTE.length ? PALETTE[idx] : OTHER_COLOR;
      v.isOther = idx >= PALETTE.length;
    });

    return {
      list: list,
      byName: vendors,
      workloadsTotal: workloads.length,
      mappedCount: mappedCount,
      bandWorkloadIds: bandWorkloadIds
    };
  }

  // ─── render ────────────────────────────────────────────────────────────
  function renderAll() {
    var model = computeModel();
    totalChip.textContent = model.workloadsTotal + " workload" + (model.workloadsTotal === 1 ? "" : "s") +
      " · " + model.list.length + " vendor" + (model.list.length === 1 ? "" : "s");
    var unmapped = model.workloadsTotal - model.mappedCount;
    coverageHint.textContent = unmapped > 0
      ? model.mappedCount + " of " + model.workloadsTotal + " workloads are mapped to their underlying technology — map the rest in Current State to expose full vendor lock-in."
      : "All " + model.workloadsTotal + " workloads are mapped to their underlying technology.";
    renderChart(model);
    renderRight(model);
  }

  function renderChart(model) {
    chartHost.innerHTML = "";
    if (model.workloadsTotal === 0) {
      chartHost.appendChild(mkt("div", "vc-empty", "No current-state business workloads yet. Add workloads in Current State (the 'Workloads & Business Apps' layer)."));
      return;
    }

    BANDS.forEach(function(band) {
      var levelVendors = model.list
        .filter(function(v) { return v.counts[band.key] > 0; })
        .sort(function(a, b) { return a.rank - b.rank; });
      var levelTotal = levelVendors.reduce(function(s, v) { return s + v.counts[band.key]; }, 0);
      var wlCount = model.bandWorkloadIds[band.key].size;

      var bandEl = mk("div", "vc-band vc-band-" + band.crit);

      var axis = mk("div", "vc-band-axis");
      axis.appendChild(mk("span", "vc-band-tick crit-shape-" + band.crit));
      axis.appendChild(mkt("span", "vc-band-name", band.label));
      axis.appendChild(mkt("span", "vc-band-count", wlCount + (wlCount === 1 ? " workload" : " workloads")));
      bandEl.appendChild(axis);

      var barWrap = mk("div", "vc-band-barwrap");
      if (levelTotal === 0) {
        barWrap.appendChild(mkt("div", "vc-band-empty", "No " + band.label.toLowerCase() + "-criticality workloads"));
      } else {
        var bar = mk("div", "vc-band-bar");
        var segs = [];
        var otherCount = 0;
        levelVendors.forEach(function(v) {
          if (v.isOther) otherCount += v.counts[band.key];
          else segs.push({ vendor: v.vendor, count: v.counts[band.key], color: v.color, clickable: true });
        });
        if (otherCount > 0) segs.push({ vendor: "Other", count: otherCount, color: OTHER_COLOR, clickable: false });

        segs.forEach(function(s) {
          var frac = s.count / levelTotal;
          var seg = mk("div", "vc-seg");
          seg.style.flex = s.count + " 1 0";
          seg.style.background = s.color;
          seg.style.color = textOn(s.color);
          seg.title = s.vendor + " · exposed to " + s.count + " " + band.label.toLowerCase() +
            "-criticality workload" + (s.count === 1 ? "" : "s") + " (" + Math.round(frac * 100) + "%)";
          if (frac >= 0.11) {
            var lbl = mk("div", "vc-seg-label");
            lbl.appendChild(mkt("span", "vc-seg-name", s.vendor));
            lbl.appendChild(mkt("span", "vc-seg-count", String(s.count)));
            seg.appendChild(lbl);
          }
          if (s.clickable) {
            seg.classList.add("is-clickable");
            seg.addEventListener("click", function() { openVendor(s.vendor); });
          }
          bar.appendChild(seg);
        });
        barWrap.appendChild(bar);
      }
      bandEl.appendChild(barWrap);
      chartHost.appendChild(bandEl);
    });
  }

  function openVendor(name) {
    rightMode = "vendor";
    currentVendor = name;
    renderRight(computeModel());
  }

  function renderRight(model) {
    right.innerHTML = "";
    if (model.workloadsTotal === 0 || model.list.length === 0) {
      var ph = mk("div", "detail-placeholder");
      ph.appendChild(mkt("div", "detail-ph-title", "No workload vendors"));
      ph.appendChild(mkt("div", "detail-ph-hint", "Add business workloads (and map their underlying technology) to see vendor exposure here."));
      right.appendChild(ph);
      return;
    }
    if (rightMode === "vendor" && currentVendor) {
      var v = model.byName.get(currentVendor);
      if (v) { renderVendorPanel(v, model); return; }
      rightMode = "breakdown";
    }
    renderBreakdownPanel(model);
  }

  function renderBreakdownPanel(model) {
    var panel = mk("div", "detail-panel");
    panel.appendChild(mkt("div", "detail-title", "Vendors"));
    panel.appendChild(mkt("div", "detail-sub",
      model.list.length + " vendor" + (model.list.length === 1 ? "" : "s") + " across " + model.workloadsTotal + " workloads"));
    panel.appendChild(mkSep("Workloads each vendor is exposed to"));

    model.list.forEach(function(v) {
      var rowEl = mk("button", "vc-vendor-row");
      rowEl.type = "button";
      var sw = mk("span", "vc-swatch");
      sw.style.background = v.color;
      rowEl.appendChild(sw);

      var mid = mk("div", "vc-vendor-mid");
      mid.appendChild(mkt("div", "vc-vendor-name", v.vendor));
      var bd = mk("div", "vc-vendor-breakdown");
      [["High", "high"], ["Medium", "medium"], ["Low", "low"]].forEach(function(p) {
        if (v.counts[p[0]] > 0) {
          var tag = mk("span", "vc-mini crit-shape-" + p[1]);
          tag.appendChild(mkt("span", "vc-mini-n", String(v.counts[p[0]])));
          bd.appendChild(tag);
        }
      });
      mid.appendChild(bd);
      rowEl.appendChild(mid);

      var pct = model.workloadsTotal ? Math.round((v.total / model.workloadsTotal) * 100) : 0;
      var right2 = mk("div", "vc-vendor-right");
      right2.appendChild(mkt("div", "vc-vendor-total", String(v.total)));
      right2.appendChild(mkt("div", "vc-vendor-pct", pct + "%"));
      rowEl.appendChild(right2);

      rowEl.addEventListener("click", function() { openVendor(v.vendor); });
      panel.appendChild(rowEl);
    });
    right.appendChild(panel);
  }

  function renderVendorPanel(v, model) {
    var panel = mk("div", "detail-panel");
    var back = mkt("button", "vc-back-link", "← All vendors");
    back.type = "button";
    back.addEventListener("click", function() { rightMode = "breakdown"; currentVendor = null; renderRight(computeModel()); });
    panel.appendChild(back);

    var head = mk("div", "vc-vendor-head");
    var sw = mk("span", "vc-swatch");
    sw.style.background = v.color;
    head.appendChild(sw);
    head.appendChild(mkt("div", "detail-title", v.vendor));
    panel.appendChild(head);

    var pct = model.workloadsTotal ? Math.round((v.total / model.workloadsTotal) * 100) : 0;
    panel.appendChild(mkt("div", "detail-sub",
      "Exposed to " + v.total + " of " + model.workloadsTotal + " workload" + (model.workloadsTotal === 1 ? "" : "s") +
      " · " + pct + "% · " + v.counts.High + " High / " + v.counts.Medium + " Med / " + v.counts.Low + " Low"));

    panel.appendChild(mkSep("Workloads"));
    var order = { High: 0, Medium: 1, Low: 2 };
    // One row per workload this vendor touches (dedupe rels by workload).
    var seen = {};
    var rels = v.rels.filter(function(r) { if (seen[r.wl.id]) return false; seen[r.wl.id] = true; return true; });
    // Merge roles across the (now-deduped) workloads.
    var rolesByWl = {};
    v.rels.forEach(function(r) {
      (rolesByWl[r.wl.id] = rolesByWl[r.wl.id] || []).push.apply(rolesByWl[r.wl.id], r.roles);
    });
    rels.sort(function(a, b) { return (order[a.crit] || 0) - (order[b.crit] || 0); })
      .forEach(function(r) {
        panel.appendChild(renderWorkloadRow(r.wl, rolesByWl[r.wl.id] || []));
      });
    right.appendChild(panel);
  }

  function envLabelFor(inst) {
    var envs = getVisibleEnvsFromEngagement();
    var match = envs.find(function(e) { return e.id === inst.environmentId; });
    return match ? getEnvLabel(match.id, liveSession) : inst.environmentId;
  }

  // Workload row with its own editable criticality. Editing commits the
  // WORKLOAD's criticality (the criticality that matters) and reflows.
  function renderWorkloadRow(W, roles) {
    var rowEl = mk("div", "vc-inst-row");
    var label = mk("div", "vc-inst-label");
    label.appendChild(mk("span", "crit-shape-" + (W.criticality || "Low").toLowerCase()));
    label.appendChild(document.createTextNode(" " + (W.label || "(unnamed)")));
    var meta = roles.length ? roles.join(" · ") : envLabelFor(W);
    label.appendChild(mkt("span", "vc-inst-meta", meta));
    rowEl.appendChild(label);

    var sel = mk("select", "form-select vc-crit-select");
    ["Low", "Medium", "High"].forEach(function(opt) {
      var o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      if (opt === W.criticality) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("change", function() {
      commitInstanceSetCriticality(W.id, sel.value);
      if (!sessionArg) liveSession = getEngagementAsSession();
      renderAll();
    });
    rowEl.appendChild(sel);
    return rowEl;
  }

  renderAll();
}

// ─── helpers ─────────────────────────────────────────────────────────────
function mk(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
function mkt(tag, cls, text) { var e = mk(tag, cls); e.textContent = text; return e; }
function mkSep(text) { return mkt("div", "detail-sep", text); }

function textOn(hex) {
  var c = hex.replace("#", "");
  if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
  var r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? "#1f2937" : "#ffffff";
}
