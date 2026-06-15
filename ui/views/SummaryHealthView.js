// ui/views/SummaryHealthView.js — architecture risk heatmap

import { LAYERS, ENVIRONMENTS, getEnvLabel } from "../../core/config.js";
// Session shape is projected from the active engagement (no v2 session store).
import { getEngagementAsSession, getVisibleEnvsFromEngagement } from "../../state/projection.js";
import { getHealthSummary, computeBucketMetrics, scoreToRiskLabel, scoreToClass } from "../../services/healthMetrics.js";
import { helpButton } from "./HelpModal.js";
import { renderDemoBanner } from "../components/DemoBanner.js";
// Derived Dell-solutions resolver: walks a gap's linked desired tiles
// filtered by vendorGroup="dell". Used everywhere on the canvas instead
// of reading any single stored field.
import { effectiveDellSolutions } from "../../services/programsService.js";

export function renderSummaryHealthView(left, right, sessionArg) {
  // Derive session-shape from the active engagement at render time;
  // sessionArg lets a caller pass an explicit session instead.
  var session = sessionArg || getEngagementAsSession();
  if (session && session.isDemo) renderDemoBanner(left);
  // Reporting renders ONLY visible (non-hidden) envs. Hidden envs stay in
  // session.environments (and the saved file) but never appear in the
  // heatmap, vendor mix, gaps board or roadmap. visibleEnvs is derived
  // from `session` so a hidden flag is honored; catalog labels are looked
  // up by id for display.
  var visibleEnvs = (Array.isArray(session.environments) && session.environments.length > 0)
    ? session.environments.filter(function(e) { return !e.hidden; })
        .map(function(e) {
          var cat = ENVIRONMENTS.find(function(c) { return c.id === e.id; });
          return Object.assign({}, e, { label: cat ? cat.label : e.id });
        })
    : getVisibleEnvsFromEngagement();
  var s = getHealthSummary(session, LAYERS, visibleEnvs);

  // Overview chips
  var overview = mk("div", "card");
  var titleRow = mk("div", "card-title-row");
  titleRow.appendChild(mkt("div", "card-title", "Architecture heatmap"));
  titleRow.appendChild(helpButton("reporting_health"));
  overview.appendChild(titleRow);
  overview.appendChild(mkt("div", "card-hint",
    "Risk derived from current technology criticality and open gap urgency. Bold numbers = risk score. Click any cell for details."));

  var chipsRow = mk("div", "chips-row");
  var stats = [
    [s.totalBuckets,   "buckets (layers x envs)"],
    [s.totalCurrent,   "current technologies"],
    [s.totalDesired,   "desired technologies"],
    [s.totalGaps,      "total gaps"],
    [s.highRiskGaps,   "High-urgency gaps"]
  ];
  stats.forEach(function(st) {
    var cls = (st[1].indexOf("High") >= 0 && st[0] > 0) ? "chip-stat chip-danger" : "chip-stat";
    chipsRow.appendChild(mkt("span", cls, st[0] + " " + st[1]));
  });
  overview.appendChild(chipsRow);

  // Legend
  var legend = mk("div", "heatmap-legend");
  legend.style.marginTop = "10px";
  [
    ["#DCFCE7","1-3: Minor"],
    ["#FEF9C3","4-6: Moderate"],
    ["#FEE2E2","7+: High risk"],
    ["#F3F4F6","No data"]
  ].forEach(function(l) {
    var item = mk("div", "heatmap-legend-item");
    var sw = mk("div", "heatmap-legend-swatch");
    sw.style.background = l[0];
    item.appendChild(sw);
    item.appendChild(mkt("span", "", l[1]));
    legend.appendChild(item);
  });
  overview.appendChild(legend);
  left.appendChild(overview);

  // Heatmap grid
  var heatCard = mk("div", "card");
  var wrap = mk("div", "matrix-scroll-wrap");
  var grid = mk("div", "heatmap-grid");
  grid.style.gridTemplateColumns = "160px repeat(" + visibleEnvs.length + ", 1fr)";

  // Header row. Env headers use the E.0X code + name idiom from
  // MatrixView so the heatmap and the matrix read as one consistent
  // visual language across tabs.
  grid.appendChild(mk("div", "hm-corner"));
  visibleEnvs.forEach(function(env, eIdx) {
    var h = mk("div", "hm-env-header matrix-env-head heatmap-env-head");
    h.setAttribute("data-env-id", env.id);
    h.setAttribute("data-env",    env.id);
    var code = mk("span", "matrix-env-code");
    code.textContent = "E." + ("0" + (eIdx + 1)).slice(-2);
    var name = mk("span", "matrix-env-name");
    name.textContent = getEnvLabel(env.id, session);
    h.appendChild(code);
    h.appendChild(name);
    grid.appendChild(h);
  });

  var selectedLayer = null;
  var selectedEnv   = null;

  // Layer labels match the MatrixView treatment (L.0X mono code + name +
  // 2px hue bar).
  LAYERS.forEach(function(layer, lIdx) {
    var hdrCell = mk("div", "hm-layer-label matrix-layer-header");
    hdrCell.setAttribute("data-layer-id", layer.id);
    var bar = mk("div", "matrix-layer-bar");
    bar.setAttribute("data-layer-id", layer.id);
    hdrCell.appendChild(bar);
    var code = mk("span", "matrix-layer-code");
    code.textContent = "L." + ("0" + (lIdx + 1)).slice(-2);
    hdrCell.appendChild(code);
    var name = mk("span", "matrix-layer-name");
    name.textContent = layer.label;
    hdrCell.appendChild(name);
    grid.appendChild(hdrCell);
    visibleEnvs.forEach(function(env) {
      var m = computeBucketMetrics(layer.id, env.id, session);
      var cell = mk("div", "hm-cell " + scoreToClass(m.totalScore, m.hasData));
      cell.setAttribute("data-layer-id", layer.id);
      cell.setAttribute("data-env-id",   env.id);

      // Score number (primary visual)
      var scoreEl = mk("div", "hm-score");
      scoreEl.textContent = m.hasData && m.totalScore > 0 ? Math.round(m.totalScore) : "-";
      cell.appendChild(scoreEl);

      // Risk label
      cell.appendChild(mkt("div", "hm-label", scoreToRiskLabel(m.totalScore, m.hasData)));

      // Footer pills
      if (m.hasData) {
        var footer = mk("div", "hm-cell-footer");
        if (m.current.length > 0) {
          footer.appendChild(mkt("span", "hm-pill hm-pill-tech", m.current.length + " tech"));
        }
        if (m.gaps.length > 0) {
          footer.appendChild(mkt("span", "hm-pill hm-pill-gap", m.gaps.length + " gap" + (m.gaps.length > 1 ? "s" : "")));
        }
        cell.appendChild(footer);
      }

      cell.addEventListener("click", function() {
        selectedLayer = layer.id;
        selectedEnv   = env.id;
        grid.querySelectorAll(".hm-cell").forEach(function(c) {
          c.classList.toggle("selected",
            c.getAttribute("data-layer-id") === layer.id &&
            c.getAttribute("data-env-id")   === env.id);
        });
        renderDetail(right, layer.id, env.id, session);
      });
      grid.appendChild(cell);
    });
  });

  wrap.appendChild(grid);
  heatCard.appendChild(wrap);
  left.appendChild(heatCard);

  // Right panel default
  right.innerHTML = "";
  right.appendChild(buildPlaceholder());

  // Auto-select first non-empty cell
  for (var li = 0; li < LAYERS.length; li++) {
    for (var ei = 0; ei < visibleEnvs.length; ei++) {
      var m2 = computeBucketMetrics(LAYERS[li].id, visibleEnvs[ei].id, session);
      if (m2.hasData) {
        selectedLayer = LAYERS[li].id;
        selectedEnv   = visibleEnvs[ei].id;
        var firstCell = grid.querySelector("[data-layer-id='" + LAYERS[li].id + "'][data-env-id='" + visibleEnvs[ei].id + "']");
        if (firstCell) firstCell.classList.add("selected");
        renderDetail(right, LAYERS[li].id, visibleEnvs[ei].id, session);
        return;
      }
    }
  }
}

function renderDetail(right, layerId, envId, session) {
  // session is passed in so the detail panel can use a caller-supplied
  // session; it falls back to the module-scoped one when omitted.
  if (!session) session = moduleSession;
  right.innerHTML = "";
  var layer   = LAYERS.find(function(l) { return l.id === layerId; });
  var m       = computeBucketMetrics(layerId, envId, session);
  var desired = (session.instances || []).filter(function(i) {
    return i.state === "desired" && i.layerId === layerId && i.environmentId === envId;
  });

  var panel = mk("div", "detail-panel");

  // Header with risk badge
  panel.appendChild(mkt("div", "detail-title", (layer && layer.label) || layerId));
  panel.appendChild(mkt("div", "detail-sub",   getEnvLabel(envId, session)));

  if (m.hasData) {
    var riskBadge = mk("span", "urgency-badge " + riskBadgeClass(m.totalScore));
    riskBadge.textContent = scoreToRiskLabel(m.totalScore, m.hasData) + " (score: " + Math.round(m.totalScore) + ")";
    panel.appendChild(riskBadge);
  }

  // Score breakdown
  if (m.hasData) {
    var breakdown = mk("div", "score-breakdown");
    breakdown.innerHTML = "Criticality score: <strong>" + m.currentScore.toFixed(1) + "</strong>  |  Gap urgency score: <strong>" + m.gapScore.toFixed(1) + "</strong>";
    panel.appendChild(breakdown);
  }

  sep(panel, "Current technologies");
  if (!m.current.length) {
    note(panel, "None mapped.");
  } else {
    var sorted = m.current.slice().sort(function(a,b) {
      var order = {High:0, Medium:1, Low:2};
      return (order[a.criticality||"Low"]||2) - (order[b.criticality||"Low"]||2);
    });
    sorted.forEach(function(i) {
      var row = mk("div", "detail-row");
      var dot = mk("span", "tile-dot " + (i.vendorGroup || "custom")); row.appendChild(dot);
      row.appendChild(mkt("span", "detail-row-label", i.label));
      if (i.criticality) {
        row.appendChild(mkt("span", "urgency-badge " + critClass(i.criticality), i.criticality));
      }
      if (i.notes) row.appendChild(mkt("div", "detail-note", i.notes));
      panel.appendChild(row);
    });
  }

  sep(panel, "Active gaps");
  if (!m.gaps.length) {
    note(panel, "No gaps for this area.");
  } else {
    m.gaps.forEach(function(g) {
      var row = mk("div", "detail-row");
      row.appendChild(mkt("span", "urgency-badge " + urgClass(g.urgency), g.urgency));
      row.appendChild(mkt("span", "detail-row-label", g.description));
      // Dell solutions are derived via effectiveDellSolutions, matching
      // every other surface on the canvas.
      var derivedSols = effectiveDellSolutions(g, session);
      if (derivedSols && derivedSols.length > 0) {
        row.appendChild(mkt("div", "detail-solutions", "Dell: " + derivedSols.join(", ")));
      }
      panel.appendChild(row);
    });
  }

  sep(panel, "Desired state");
  if (!desired.length) {
    note(panel, "None mapped yet.");
  } else {
    desired.forEach(function(i) {
      var row = mk("div", "detail-row");
      var dot = mk("span", "tile-dot " + (i.vendorGroup || "custom")); row.appendChild(dot);
      row.appendChild(mkt("span", "detail-row-label", i.label));
      if (i.disposition) {
        row.appendChild(mkt("span", "disposition-badge badge-" + i.disposition, i.disposition));
      } else if (i.priority) {
        row.appendChild(mkt("span", "priority-badge priority-" + i.priority.toLowerCase(), i.priority));
      }
      panel.appendChild(row);
    });
  }

  right.appendChild(panel);
}

function buildPlaceholder() {
  var ph = mk("div", "detail-placeholder");
  ph.appendChild(mkt("div", "detail-ph-icon", "[]"));
  ph.appendChild(mkt("div", "detail-ph-title", "Select a cell"));
  ph.appendChild(mkt("div", "detail-ph-hint", "Click any coloured cell to see current technologies, active gaps, and the desired state for that layer and environment."));
  return ph;
}

function mk(tag,cls)        { var e=document.createElement(tag); if(cls)e.className=cls; return e; }
function mkt(tag,cls,text)  { var e=mk(tag,cls); e.textContent=text; return e; }
function sep(p,t)           { p.appendChild(mkt("div","detail-sep",t)); }
function note(p,t)          { p.appendChild(mkt("div","detail-note muted",t)); }
function urgClass(u)        { return u==="High"?"urg-high":u==="Low"?"urg-low":"urg-med"; }
function critClass(c)       { return c==="High"?"urg-high":c==="Low"?"urg-low":"urg-med"; }
function riskBadgeClass(sc) { return sc>6?"urg-high":sc>3?"urg-med":"urg-low"; }
