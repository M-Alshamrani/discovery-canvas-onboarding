// ui/views/SummaryVendorView.js — vendor & platform mix analytics

import { LAYERS, getEnvLabel } from "../../core/config.js";
// Centralized layer-label resolver, aliased to avoid local shadowing.
import { layerLabel as layerLabelResolver } from "../../core/labelResolvers.js";
import { computeMixByLayer, computeMixByEnv, computeVendorTableData } from "../../services/vendorMixService.js";
import { helpButton } from "./HelpModal.js";
// Session shape is projected from the active engagement (no v2 session store).
import { getEngagementAsSession, getVisibleEnvsFromEngagement } from "../../state/projection.js";
import { renderDemoBanner } from "../components/DemoBanner.js";
import * as fState from "../../state/filterState.js";

// Dimension picker for the headline 100%-stacked bar: the user splits it
// by vendor group (default), by layer, or by environment. Each dimension
// uses a deterministic color palette so legends stay stable across
// renders.
var BAR_DIMENSIONS = [
  { id: "vendorGroup", label: "Vendor",      filterKey: null }, // doesn't cross-filter
  { id: "layer",       label: "Layer",       filterKey: "layer" },
  { id: "environment", label: "Environment", filterKey: null }   // env dim isn't yet in DIMS
];
var SEGMENT_PALETTE = {
  vendorGroup: {
    dell:    { color: "var(--dell-blue, #0076CE)",  label: "Dell Technologies" },
    nonDell: { color: "var(--ink-mute, #6b7280)",   label: "Other vendors" },
    custom:  { color: "var(--amber, #f59e0b)",      label: "Custom / in-house" }
  },
  layer: {
    workload:       { color: "#0076CE", label: "Workloads & Apps" },
    compute:        { color: "#5B8DEF", label: "Compute" },
    storage:        { color: "#7B61FF", label: "Storage" },
    dataProtection: { color: "#C8102E", label: "Data Protection" },
    virtualization: { color: "#00843D", label: "Virtualization" },
    infrastructure: { color: "#B27400", label: "Infrastructure" }
  }
  // environment palette is computed dynamically per session.
};

export function renderSummaryVendorView(left, right, sessionArg) {
  // Derive session-shape from the active engagement at render time.
  var liveSession = sessionArg || getEngagementAsSession();
  let stateFilter    = "combined";
  let activeLayerIds = new Set(LAYERS.map(l => l.id));
  let stackBy        = "vendorGroup"; // dimension the headline bar splits on

  if (liveSession && liveSession.isDemo) renderDemoBanner(left);

  const overview = mk("div", "card");
  overview.innerHTML = `
    <div class="card-title-row"><div class="card-title">Vendor and platform mix</div></div>
    <div class="card-hint">Understand where Dell, non-Dell, and custom platforms are concentrated — and how the target architecture shifts that balance.</div>
    <div class="filter-row">
      <span class="filter-label">View:</span>
      <div class="segmented-ctrl" id="vm-toggle">
        <button class="seg-btn" data-val="current">Current</button>
        <button class="seg-btn" data-val="desired">Desired</button>
        <button class="seg-btn active" data-val="combined">Combined</button>
      </div>
      <div class="legend-row">
        <span class="legend-swatch swatch-dell"></span>Dell
        <span class="legend-swatch swatch-nondell"></span>Non-Dell
        <span class="legend-swatch swatch-custom"></span>Custom
      </div>
    </div>
    <div class="filter-row" style="margin-top:8px">
      <span class="filter-label">Layers:</span>
      <div class="chips-row" id="vm-layers"></div>
    </div>
    <div class="chips-row" id="vm-chips" style="margin-top:8px"></div>`;
  overview.querySelector(".card-title-row").appendChild(helpButton("reporting_vendor"));
  left.appendChild(overview);

  // wire toggle
  overview.querySelector("#vm-toggle").querySelectorAll(".seg-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      overview.querySelectorAll(".seg-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      stateFilter = btn.dataset.val;
      renderAll();
    });
  });

  // layer chips
  const lc = overview.querySelector("#vm-layers");
  LAYERS.forEach(layer => {
    const chip = mk("div", "chip-filter active");
    chip.textContent = layer.label;
    chip.addEventListener("click", () => {
      chip.classList.toggle("active");
      if (chip.classList.contains("active")) activeLayerIds.add(layer.id);
      else                                    activeLayerIds.delete(layer.id);
      if (!activeLayerIds.size) {
        LAYERS.forEach(l => activeLayerIds.add(l.id));
        lc.querySelectorAll(".chip-filter").forEach(c => c.classList.add("active"));
      }
      renderAll();
    });
    lc.appendChild(chip);
  });

  // Segmented-bar overview for Combined / Current / Desired. Per-layer +
  // per-env detail bars remain below.
  const overviewCard = mk("div", "card");
  overviewCard.innerHTML = `<div class="card-title">Mix overview</div>
    <div class="card-hint">A 100% stacked bar that splits the estate by your chosen dimension. Click any segment to filter the rest of the page; use the View toggle to switch between Combined / Current / Desired.</div>
    <div class="vm-stack-by-row">
      <span class="vm-stack-by-label">Stack by</span>
      <div class="vm-stack-by-chips"></div>
    </div>
    <div class="vm-overview-bars"></div>
    <div class="vm-overview-legend"></div>`;
  left.appendChild(overviewCard);
  // Hold direct refs; document.getElementById won't see these elements
  // until the parent card is attached to the document.
  const overviewBarsHost = overviewCard.querySelector(".vm-overview-bars");
  const overviewLegendHost = overviewCard.querySelector(".vm-overview-legend");
  const stackByHost = overviewCard.querySelector(".vm-stack-by-chips");

  // Stack-by dimension chips (Vendor / Layer / Environment).
  BAR_DIMENSIONS.forEach(function(dim) {
    var chip = mk("button", "tag vm-stack-chip");
    chip.type = "button";
    chip.setAttribute("data-t", dim.id === stackBy ? "app" : "tech");
    chip.setAttribute("data-stack-by", dim.id);
    chip.textContent = dim.label;
    chip.addEventListener("click", function() {
      stackBy = dim.id;
      stackByHost.querySelectorAll(".vm-stack-chip").forEach(function(c) {
        var isActive = c.getAttribute("data-stack-by") === stackBy;
        c.setAttribute("data-t", isActive ? "app" : "tech");
        c.classList.toggle("is-active", isActive);
      });
      renderAll();
    });
    if (dim.id === stackBy) chip.classList.add("is-active");
    stackByHost.appendChild(chip);
  });

  // Three KPI tiles (Dell density / Most diverse layer / Top non-Dell
  // concentration) carry the headline insight in place of standing
  // per-layer + per-env bars; click any KPI tile or bar segment to drill
  // the detail into the right panel.
  const kpiCard = mk("div", "card vm-kpi-card");
  kpiCard.innerHTML = `<div class="card-title">Headline insights</div>
    <div class="vm-kpi-grid"></div>`;
  left.appendChild(kpiCard);
  const kpiGridHost = kpiCard.querySelector(".vm-kpi-grid");

  // Vendor detail table is kept but collapsible -- power users still
  // get the raw breakdown without it dominating the canvas.
  const tableCard = mk("div", "card vm-table-card");
  tableCard.innerHTML = `
    <button type="button" class="card-title vm-table-toggle" data-table-open="false">
      <span class="vm-table-caret">▸</span> All instances by vendor
    </button>
    <div class="vm-table-wrap" style="display:none">
      <div class="table-scroll"><table class="vendor-table" id="vm-table"></table></div>
    </div>`;
  left.appendChild(tableCard);
  const tableToggle = tableCard.querySelector(".vm-table-toggle");
  const tableWrap   = tableCard.querySelector(".vm-table-wrap");
  tableToggle.addEventListener("click", function() {
    var open = tableToggle.getAttribute("data-table-open") === "true";
    var next = !open;
    tableToggle.setAttribute("data-table-open", next ? "true" : "false");
    tableWrap.style.display = next ? "" : "none";
    var caret = tableToggle.querySelector(".vm-table-caret");
    if (caret) caret.textContent = next ? "▾" : "▸";
  });

  // Right-panel detail: click any vendor row → instance breakdown here.
  renderVendorRight(null);

  function ids() { return [...activeLayerIds]; }

  function renderAll() {
    // summary chips
    const rows = computeVendorTableData({ layerIds: ids() });
    const d = rows.reduce((s,r) => s + (r.vendorGroup==="dell"    ? r.total : 0), 0);
    const n = rows.reduce((s,r) => s + (r.vendorGroup==="nonDell" ? r.total : 0), 0);
    const c = rows.reduce((s,r) => s + (r.vendorGroup==="custom"  ? r.total : 0), 0);
    const chips = document.getElementById("vm-chips");
    if (chips) chips.innerHTML = `
      <span class="chip-stat chip-dell">Dell: ${d}</span>
      <span class="chip-stat">Non-Dell: ${n}</span>
      <span class="chip-stat">Custom: ${c}</span>`;

    // Headline 100%-stacked bar driven by the chosen dimension (vendor /
    // layer / environment). Segments map to the dimension's palette and
    // are click-to-filter, so users can drill from the chart into the
    // rest of the page.
    var visibleEnvs = getVisibleEnvsFromEngagement();
    var stackData = computeStackData(stackBy, stateFilter, ids(), visibleEnvs);
    var stateLabel = stateFilter === "current"  ? "Current state"
                  : stateFilter === "desired"   ? "Desired state"
                  :                                "Combined (current + desired)";
    renderHeadlineBar(overviewBarsHost, stateLabel, stackData);
    renderHeadlineLegend(overviewLegendHost, stackData);

    // Three KPI insights derived from the (layer, env, vendor) cube
    // without rendering more bars.
    renderKpis(kpiGridHost, stateFilter, ids(), visibleEnvs);

    renderTable(rows);
  }

  // Compute the stacked-bar data for an arbitrary dimension. Reads counts
  // directly from `liveSession.instances` so it works when the view is
  // mounted with an explicit session (vendorMixService would otherwise
  // read its own module-scoped session and miss that data).
  function computeStackData(dim, stateFilter, layerIdList, visibleEnvs) {
    var instances = (liveSession && Array.isArray(liveSession.instances)) ? liveSession.instances : [];
    var layerSet = {};
    layerIdList.forEach(function(id) { layerSet[id] = true; });
    var filtered = instances.filter(function(i) {
      if (stateFilter === "current" && i.state !== "current") return false;
      if (stateFilter === "desired" && i.state !== "desired") return false;
      if (layerIdList.length && !layerSet[i.layerId])         return false;
      return true;
    });

    if (dim === "vendorGroup") {
      var totals = { dell: 0, nonDell: 0, custom: 0, total: 0 };
      filtered.forEach(function(i) {
        var g = i.vendorGroup === "dell" ? "dell"
              : i.vendorGroup === "nonDell" ? "nonDell"
              : "custom";
        totals[g]++;
        totals.total++;
      });
      var seg = ["dell", "nonDell", "custom"].map(function(g) {
        return {
          id: g,
          label: SEGMENT_PALETTE.vendorGroup[g].label,
          count: totals[g] || 0,
          color: SEGMENT_PALETTE.vendorGroup[g].color,
          dataAttr: "vendor-group",
          filterDim: null
        };
      });
      return { dim: dim, total: totals.total, segments: seg };
    }
    if (dim === "layer") {
      var byLayerMap = {};
      LAYERS.forEach(function(L) { byLayerMap[L.id] = 0; });
      filtered.forEach(function(i) {
        if (typeof byLayerMap[i.layerId] === "number") byLayerMap[i.layerId]++;
      });
      var total = 0;
      var segs = LAYERS.map(function(L) {
        var c = byLayerMap[L.id] || 0;
        total += c;
        return {
          id: L.id,
          label: SEGMENT_PALETTE.layer[L.id].label,
          count: c,
          color: SEGMENT_PALETTE.layer[L.id].color,
          dataAttr: "layer",
          filterDim: "layer"
        };
      });
      return { dim: dim, total: total, segments: segs };
    }
    // environment
    var byEnvMap = {};
    visibleEnvs.forEach(function(env) { byEnvMap[env.id] = 0; });
    filtered.forEach(function(i) {
      if (typeof byEnvMap[i.environmentId] === "number") byEnvMap[i.environmentId]++;
    });
    var totalE = 0;
    var ENV_PALETTE = ["#0076CE", "#5B8DEF", "#7B61FF", "#00843D", "#B27400", "#C8102E", "#3E4C62", "#9AA5B8"];
    var segsE = visibleEnvs.map(function(env, idx) {
      var c = byEnvMap[env.id] || 0;
      totalE += c;
      return {
        id: env.id,
        label: getEnvLabel(env.id, liveSession),
        count: c,
        color: ENV_PALETTE[idx % ENV_PALETTE.length],
        dataAttr: "env",
        filterDim: null
      };
    });
    return { dim: dim, total: totalE, segments: segsE };
  }

  function renderHeadlineBar(c, stateLabel, stack) {
    if (!c) return;
    c.innerHTML = "";
    var total = stack.total || 1;

    var grp = mk("div", "vendor-bar-group vendor-bar-overview");
    var lbl = mk("div", "vendor-bar-label metric");
    lbl.textContent = stateLabel + " · " + stack.total + " " +
      (stack.total === 1 ? "instance" : "instances");
    grp.appendChild(lbl);

    var bar = mk("div", "vendor-bar vendor-bar-large vendor-bar-shimmer");
    var widths = stack.segments.map(function(s) { return pct(s.count, total); });
    // Round-robin correction: ensure widths sum to 100 (avoid floating-
    // point fuzz).
    var sum = widths.reduce(function(a, b) { return a + b; }, 0);
    if (sum > 0 && sum !== 100 && widths.length > 0) {
      // Adjust the largest segment by the delta.
      var largestIdx = 0;
      widths.forEach(function(w, i) { if (w > widths[largestIdx]) largestIdx = i; });
      widths[largestIdx] += (100 - sum);
    }
    stack.segments.forEach(function(s, i) {
      var w = widths[i] || 0;
      var seg = mk("div", "vendor-bar-segment");
      seg.style.width = w + "%";
      seg.style.background = s.color;
      seg.setAttribute("data-" + s.dataAttr, s.id);
      seg.title = s.label + ": " + s.count + " (" + w + "%)";
      if (w >= 6) seg.textContent = w + "%";
      // Click any segment -> set body[data-filter-<dim>] for the
      // relevant filter dimension (currently layer is the only one
      // wired through filterState).
      if (s.filterDim) {
        seg.classList.add("is-clickable");
        seg.addEventListener("click", function() {
          fState.toggleValue(s.filterDim, s.id);
        });
      }
      bar.appendChild(seg);
    });
    grp.appendChild(bar);
    c.appendChild(grp);
  }

  // Three KPI insights that replace the per-layer and per-env standing
  // cards. Each tile is click-to-drill, rendering the underlying detail
  // in the right panel.
  function renderKpis(host, stateFilter, layerIdList, visibleEnvs) {
    if (!host) return;
    host.innerHTML = "";
    var instances = (liveSession && Array.isArray(liveSession.instances)) ? liveSession.instances : [];
    var layerSet = {};
    layerIdList.forEach(function(id) { layerSet[id] = true; });
    var filtered = instances.filter(function(i) {
      if (stateFilter === "current" && i.state !== "current") return false;
      if (stateFilter === "desired" && i.state !== "desired") return false;
      if (layerIdList.length && !layerSet[i.layerId])         return false;
      return true;
    });
    var totalCount = filtered.length;

    // KPI 1 — Dell density (% of estate that is Dell, plus the current →
    // desired delta when the combined view is active).
    var dellCount = filtered.filter(function(i) { return i.vendorGroup === "dell"; }).length;
    var dellPct = totalCount > 0 ? Math.round((dellCount / totalCount) * 100) : 0;
    var deltaText = "";
    if (stateFilter === "combined" && totalCount > 0) {
      var curInst = filtered.filter(function(i) { return i.state === "current"; });
      var desInst = filtered.filter(function(i) { return i.state === "desired"; });
      if (curInst.length > 0 && desInst.length > 0) {
        var curPct = Math.round((curInst.filter(function(i) { return i.vendorGroup === "dell"; }).length / curInst.length) * 100);
        var desPct = Math.round((desInst.filter(function(i) { return i.vendorGroup === "dell"; }).length / desInst.length) * 100);
        var delta = desPct - curPct;
        deltaText = (delta >= 0 ? "+" : "") + delta + "pp current → desired";
      }
    }
    host.appendChild(buildKpi({
      eyebrow: "Dell density",
      value: dellPct + "%",
      hint: dellCount + " of " + totalCount + " instances",
      tag: { t: "data", text: deltaText || "share of estate" },
      onClick: function() { renderVendorRight("__dell"); }
    }));

    // KPI 2 — Most diverse layer, by Shannon entropy across vendor
    // groups. The richer the spread, the higher the diversity score.
    var byLayer = {};
    LAYERS.forEach(function(L) { byLayer[L.id] = { dell: 0, nonDell: 0, custom: 0, total: 0 }; });
    filtered.forEach(function(i) {
      var b = byLayer[i.layerId];
      if (!b) return;
      var g = i.vendorGroup === "dell" ? "dell"
            : i.vendorGroup === "nonDell" ? "nonDell"
            : "custom";
      b[g]++;
      b.total++;
    });
    var diverseLayer = null;
    var diverseScore = -1;
    LAYERS.forEach(function(L) {
      var b = byLayer[L.id];
      if (!b || b.total === 0) return;
      var score = 0;
      ["dell", "nonDell", "custom"].forEach(function(g) {
        var p = b[g] / b.total;
        if (p > 0) score -= p * Math.log2(p);
      });
      if (score > diverseScore) { diverseScore = score; diverseLayer = L; }
    });
    var diverseSpark = diverseLayer ? buildSpark(byLayer[diverseLayer.id]) : null;
    host.appendChild(buildKpi({
      eyebrow: "Most diverse layer",
      value: diverseLayer ? diverseLayer.label : "—",
      hint: diverseLayer ? "spread across all 3 vendor groups" : "no diverse layer",
      tag: diverseLayer ? { t: "tech", text: byLayer[diverseLayer.id].total + " instances" } : null,
      sparkEl: diverseSpark,
      onClick: function() {
        if (diverseLayer) renderVendorRight("__layer:" + diverseLayer.id);
      }
    }));

    // KPI 3 — Top non-Dell concentration (the env or layer with the
    // highest non-Dell share).
    var topNonDell = null;
    var topShare = -1;
    LAYERS.forEach(function(L) {
      var b = byLayer[L.id];
      if (!b || b.total === 0) return;
      var share = (b.nonDell + b.custom) / b.total;
      if (share > topShare) { topShare = share; topNonDell = { kind: "layer", id: L.id, label: L.label, share: share, total: b.total }; }
    });
    visibleEnvs.forEach(function(env) {
      var byEnv = filtered.filter(function(i) { return i.environmentId === env.id; });
      if (byEnv.length === 0) return;
      var nd = byEnv.filter(function(i) { return i.vendorGroup !== "dell"; }).length;
      var share = nd / byEnv.length;
      if (share > topShare) { topShare = share; topNonDell = { kind: "env", id: env.id, label: getEnvLabel(env.id, liveSession), share: share, total: byEnv.length }; }
    });
    host.appendChild(buildKpi({
      eyebrow: "Top non-Dell concentration",
      value: topNonDell ? topNonDell.label : "—",
      hint: topNonDell ? Math.round(topNonDell.share * 100) + "% non-Dell · " + topNonDell.total + " inst." : "no data",
      tag: topNonDell ? { t: "sec", text: Math.round(topNonDell.share * 100) + "% non-Dell" } : null,
      onClick: function() {
        if (topNonDell) renderVendorRight("__" + topNonDell.kind + ":" + topNonDell.id);
      }
    }));
  }

  function buildKpi(opts) {
    var tile = mk("button", "vm-kpi-tile");
    tile.type = "button";
    var eb = mk("div", "vm-kpi-eyebrow");
    eb.textContent = opts.eyebrow || "";
    tile.appendChild(eb);
    var val = mk("div", "vm-kpi-value");
    val.textContent = opts.value || "—";
    tile.appendChild(val);
    if (opts.sparkEl) tile.appendChild(opts.sparkEl);
    if (opts.hint) {
      var h = mk("div", "vm-kpi-hint");
      h.textContent = opts.hint;
      tile.appendChild(h);
    }
    if (opts.tag && opts.tag.text) {
      var t = mk("span", "tag vm-kpi-tag");
      t.setAttribute("data-t", opts.tag.t || "tech");
      t.textContent = opts.tag.text;
      tile.appendChild(t);
    }
    if (typeof opts.onClick === "function") {
      tile.addEventListener("click", opts.onClick);
    }
    return tile;
  }

  function buildSpark(b) {
    var spark = mk("div", "vm-kpi-spark");
    var total = (b && b.total) || 1;
    [["dell", "var(--dell-blue, #0076CE)"], ["nonDell", "var(--ink-mute, #6b7280)"], ["custom", "var(--amber, #f59e0b)"]].forEach(function(pair) {
      var w = pct(b[pair[0]] || 0, total);
      var seg = mk("div", "vm-kpi-spark-seg");
      seg.style.width = w + "%";
      seg.style.background = pair[1];
      spark.appendChild(seg);
    });
    return spark;
  }

  function renderHeadlineLegend(c, stack) {
    if (!c) return;
    c.innerHTML = "";
    stack.segments.forEach(function(s) {
      var item = mk("div", "vendor-legend-item");
      var sw = mk("span", "vendor-legend-swatch");
      sw.style.background = s.color;
      item.appendChild(sw);
      var lbl = mk("span", "vendor-legend-label");
      lbl.textContent = s.label;
      item.appendChild(lbl);
      var cnt = mk("span", "vendor-legend-count metric");
      cnt.textContent = s.count;
      item.appendChild(cnt);
      c.appendChild(item);
    });
  }

  // Per-layer / per-env bars emit .vendor-bar alongside the legacy
  // .bar-track class so the same CSS rules and selectors apply across the
  // overview and breakdown sections.
  function renderBars(c, mix, items) {
    if (!c) return; c.innerHTML = "";
    items.forEach(item => {
      const counts = mix[item.id] || { dell:0, nonDell:0, custom:0, total:0 };
      const total  = counts.total || 1;
      const dp = pct(counts.dell,   total);
      const np = pct(counts.nonDell,total);
      let   cp = 100 - dp - np;
      if (cp < 0) cp = 0;

      const grp = mk("div", "bar-group");
      const lbl = mk("div", "bar-label"); lbl.textContent = item.label; grp.appendChild(lbl);
      const bar = mk("div", "bar-track vendor-bar vendor-bar-mini");
      [["dell", dp, "bar-dell"], ["nonDell", np, "bar-nondell"], ["custom", cp, "bar-custom"]].forEach(([group, w, legacyCls]) => {
        const seg = mk("div", legacyCls + " vendor-bar-segment vendor-bar-segment-" + group);
        seg.setAttribute("data-vendor-group", group);
        seg.style.width = w + "%";
        seg.title = group + ": " + w + "%";
        if (w >= 6) seg.textContent = w + "%";
        bar.appendChild(seg);
      });
      grp.appendChild(bar);
      const meta = mk("div", "bar-meta");
      meta.textContent = `Dell: ${counts.dell}  ·  Non-Dell: ${counts.nonDell}  ·  Custom: ${counts.custom}`;
      grp.appendChild(meta);
      c.appendChild(grp);
    });
  }

  function renderTable(rows) {
    const t = document.getElementById("vm-table"); if (!t) return;
    t.innerHTML = `<thead><tr>${["Vendor","Group","Current","Desired","Total"].map(h=>`<th>${h}</th>`).join("")}</tr></thead>`;
    const tbody = document.createElement("tbody");
    rows.forEach(r => {
      const tr = document.createElement("tr");
      tr.className = "vm-row";
      tr.setAttribute("data-vendor", r.vendor);
      const groupLabel = r.vendorGroup === "dell" ? "Dell" : r.vendorGroup === "nonDell" ? "Non-Dell" : "Custom";
      tr.innerHTML = `<td>${r.vendor}</td><td><span class="vg-badge vg-${r.vendorGroup}">${groupLabel}</span></td><td>${r.current}</td><td>${r.desired}</td><td><strong>${r.total}</strong></td>`;
      // Click → vendor detail on the right panel.
      tr.addEventListener("click", () => renderVendorRight(r.vendor));
      tbody.appendChild(tr);
    });
    t.appendChild(tbody);
  }

  // Right-panel detail for a selected vendor.
  function renderVendorRight(vendorName) {
    right.innerHTML = "";
    if (!vendorName) {
      const ph = mk("div", "detail-placeholder");
      ph.innerHTML = `
        <div class="detail-ph-title">Drill into a slice</div>
        <div class="detail-ph-hint">Click a KPI tile, a bar segment, or a row in the table below to break that slice down by layer, environment, and state.</div>`;
      right.appendChild(ph);
      return;
    }

    // Slice keys for KPI-tile drill, routed here so the right panel
    // always renders the same shape regardless of where the click came
    // from.
    if (typeof vendorName === "string" && vendorName.indexOf("__") === 0) {
      const sliceKey = vendorName.slice(2);
      let title = sliceKey, matching = [];
      if (sliceKey === "dell") {
        title = "Dell Technologies estate";
        matching = (liveSession.instances || []).filter(i => i.vendorGroup === "dell");
      } else if (sliceKey.indexOf("layer:") === 0) {
        const layerId = sliceKey.slice(6);
        // Centralized resolver returns an "(unknown layer)" placeholder
        // when the LAYERS catalog lookup misses, instead of leaking the id.
        title = layerLabelResolver(layerId) + " . layer slice";
        matching = (liveSession.instances || []).filter(i => i.layerId === layerId);
      } else if (sliceKey.indexOf("env:") === 0) {
        const envId = sliceKey.slice(4);
        title = getEnvLabel(envId, liveSession) + " . environment slice";
        matching = (liveSession.instances || []).filter(i => i.environmentId === envId);
      }
      renderSlicePanel(title, matching);
      return;
    }

    const matching = (liveSession.instances || []).filter(i => (i.vendor || "") === vendorName);
    const panel = mk("div", "detail-panel");
    const title = mk("div", "detail-title"); title.textContent = vendorName;
    const sub   = mk("div", "detail-sub");   sub.textContent = `${matching.length} instance${matching.length===1?"":"s"} in session`;
    panel.appendChild(title); panel.appendChild(sub);

    if (matching.length === 0) {
      const note = mk("div", "detail-text");
      note.textContent = "No instances recorded for this vendor in the current session.";
      panel.appendChild(note);
      right.appendChild(panel);
      return;
    }

    // Breakdown by layer
    const byLayer = {};
    matching.forEach(i => {
      const key = i.layerId || "?";
      byLayer[key] = (byLayer[key] || 0) + 1;
    });
    const layerSep = mk("div", "detail-sep"); layerSep.textContent = "By layer"; panel.appendChild(layerSep);
    Object.keys(byLayer).forEach(lid => {
      const label = LAYERS.find(l => l.id === lid)?.label || lid;
      const row = mk("div", "detail-row");
      row.innerHTML = `<strong>${label}:</strong> ${byLayer[lid]}`;
      panel.appendChild(row);
    });

    // Current vs Desired
    const curCount = matching.filter(i => i.state === "current").length;
    const desCount = matching.filter(i => i.state === "desired").length;
    const stateSep = mk("div", "detail-sep"); stateSep.textContent = "State"; panel.appendChild(stateSep);
    const stateRow = mk("div", "detail-row");
    stateRow.innerHTML = `<strong>Current:</strong> ${curCount}  ·  <strong>Desired:</strong> ${desCount}`;
    panel.appendChild(stateRow);

    // Instance list
    const instSep = mk("div", "detail-sep"); instSep.textContent = "Instances"; panel.appendChild(instSep);
    matching.forEach(inst => {
      const envLabel = (getVisibleEnvsFromEngagement().find(e => e.id === inst.environmentId) || {}).label || inst.environmentId;
      const row = mk("div", "detail-row");
      row.innerHTML = `<span class="vg-badge vg-${inst.vendorGroup||'custom'}">${inst.state}</span> ${inst.label} — ${envLabel}`;
      panel.appendChild(row);
    });

    right.appendChild(panel);
  }

  // Shared slice-panel renderer used by KPI-tile and bar-segment clicks.
  // Reads any `matching` instance list and emits the same right-panel
  // shape (title, vendor split, state split, instance list).
  function renderSlicePanel(title, matching) {
    const panel = mk("div", "detail-panel");
    panel.appendChild(mkt("div", "detail-eyebrow", "Slice"));
    panel.appendChild(mkt("div", "detail-title", title));
    panel.appendChild(mkt("div", "detail-sub",
      matching.length + " instance" + (matching.length === 1 ? "" : "s")));
    if (matching.length === 0) {
      panel.appendChild(mkt("div", "detail-text",
        "No instances in this slice yet."));
      right.appendChild(panel);
      return;
    }
    // Vendor split tag row.
    const vendCount = { dell: 0, nonDell: 0, custom: 0 };
    matching.forEach(function(i) {
      vendCount[i.vendorGroup === "dell" ? "dell" : i.vendorGroup === "nonDell" ? "nonDell" : "custom"]++;
    });
    const vRow = mk("div", "vm-slice-tags");
    [["dell", "Dell", "app"], ["nonDell", "Other", "tech"], ["custom", "Custom", "data"]].forEach(function(p) {
      const tag = mkt("span", "tag", p[1] + " " + vendCount[p[0]]);
      tag.setAttribute("data-t", p[2]);
      vRow.appendChild(tag);
    });
    panel.appendChild(vRow);
    // State split.
    const cur = matching.filter(i => i.state === "current").length;
    const des = matching.filter(i => i.state === "desired").length;
    const sRow = mk("div", "vm-slice-tags");
    const tCur = mkt("span", "tag", "Current " + cur);
    tCur.setAttribute("data-t", "biz");
    sRow.appendChild(tCur);
    const tDes = mkt("span", "tag", "Desired " + des);
    tDes.setAttribute("data-t", "biz");
    sRow.appendChild(tDes);
    panel.appendChild(sRow);
    // Instance list (top 12; expand if needed).
    const instSep = mk("div", "detail-sep"); instSep.textContent = "Instances"; panel.appendChild(instSep);
    matching.slice(0, 12).forEach(function(inst) {
      const envLabel = (getVisibleEnvsFromEngagement().find(e => e.id === inst.environmentId) || {}).label || inst.environmentId;
      const row = mk("div", "detail-row");
      row.innerHTML = '<span class="vg-badge vg-' + (inst.vendorGroup || 'custom') +
        '">' + inst.state + '</span> ' + (inst.label || "(unnamed)") + ' . ' + envLabel;
      panel.appendChild(row);
    });
    if (matching.length > 12) {
      panel.appendChild(mkt("div", "detail-text muted",
        "+ " + (matching.length - 12) + " more . expand the All instances table for the full list."));
    }
    right.appendChild(panel);
  }

  function pct(v, t) { return Math.round((v / t) * 100); }
  renderAll();
}

function mk(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
