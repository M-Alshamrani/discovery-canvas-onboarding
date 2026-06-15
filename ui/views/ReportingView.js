// ui/views/ReportingView.js
// Top-level reporting overview shown when the "5 - Reporting" step is first entered.
// Shows: account health score, executive summary, and navigates to sub-tabs.

// Reads project the engagement to the legacy session shape via
// state/projection.js, since the reporting services still take a session
// argument.
import { getEngagementAsSession, getVisibleEnvsFromEngagement } from "../../state/projection.js";
// Shared empty-environments UX.
import { renderEmptyEnvsCenterCard, visibleEnvCount } from "../components/NoEnvsCard.js";
import { generateExecutiveSummary, generateSessionBrief, buildProjects,
         computeDiscoveryCoverage, computeRiskPosture } from "../../services/roadmapService.js";
import { getHealthSummary } from "../../services/healthMetrics.js";
import { LAYERS, ENVIRONMENTS, BUSINESS_DRIVERS } from "../../core/config.js";
import { helpButton } from "./HelpModal.js";
import { renderDemoBanner } from "../components/DemoBanner.js";

export function renderReportingOverview(left, right) {
  // Derive the session shape from the active engagement at render time.
  var session = getEngagementAsSession();
  if (session && session.isDemo) renderDemoBanner(left);

  // Empty-environments empty-state. Tab 5 is normally stepper-disabled
  // when there are no visible environments; this body path is reached
  // only on a direct deep-link / programmatic mount, so the guard stays.
  if (getVisibleEnvsFromEngagement().length === 0) {
    renderEmptyEnvsCenterCard(left, "reporting", {});
    return;
  }

  var coverage = computeDiscoveryCoverage(session);
  var risk     = computeRiskPosture(session);
  var summary  = getHealthSummary(session, LAYERS, ENVIRONMENTS);
  var projResult = buildProjects(session, {});
  var projects = projResult.projects;

  // ---- Overview header with help icon ----
  var overviewHeader = mk("div", "card");
  var headTitleRow = mk("div", "card-title-row");
  headTitleRow.appendChild(mkt("div", "card-title", "Reporting overview"));
  headTitleRow.appendChild(helpButton("reporting_overview"));
  overviewHeader.appendChild(headTitleRow);
  overviewHeader.appendChild(mkt("div", "card-hint",
    "Two health panels summarise discovery and risk. The sub-tabs drill deeper."));
  left.appendChild(overviewHeader);

  // ---- Two-panel health (coverage + risk) ----
  var healthRow = mk("div", "health-row");

  // Coverage panel
  var covCard = mk("div", "card coverage-panel");
  covCard.appendChild(mkt("div", "panel-eyebrow", "Discovery Coverage"));
  var covBig = mk("div", "coverage-percent");
  covBig.textContent = coverage.percent + "%";
  covCard.appendChild(covBig);
  var covBar = mk("div", "coverage-bar");
  var covFill = mk("div", "coverage-bar-fill");
  covFill.style.width = Math.max(2, coverage.percent) + "%";
  covBar.appendChild(covFill);
  covCard.appendChild(covBar);
  var covHintList = mk("ul", "coverage-hint-list");
  (coverage.actions.length ? coverage.actions : ["Coverage complete , nice work."]).forEach(function(a) {
    covHintList.appendChild(mkt("li", "", "• " + a));
  });
  covCard.appendChild(covHintList);
  healthRow.appendChild(covCard);

  // Risk panel
  var riskCard = mk("div", "card risk-panel");
  riskCard.appendChild(mkt("div", "panel-eyebrow", "Risk Posture"));
  var pill = mk("div", "risk-level-pill risk-" + risk.level.toLowerCase());
  pill.textContent = risk.level;
  riskCard.appendChild(pill);
  var riskHintList = mk("ul", "risk-hint-list");
  (risk.actions.length ? risk.actions : ["Posture looks stable."]).forEach(function(a) {
    riskHintList.appendChild(mkt("li", "", "• " + a));
  });
  riskCard.appendChild(riskHintList);
  healthRow.appendChild(riskCard);

  left.appendChild(healthRow);

  // Secondary stats strip , keeps the raw-count context.
  var statsRow = mk("div", "health-stats-row");
  var stats = [
    [summary.totalCurrent,  "Current technologies"],
    [summary.totalDesired,  "Desired technologies"],
    [summary.totalGaps,     "Total gaps"],
    [summary.highRiskGaps,  "High-urgency gaps"]
  ];
  stats.forEach(function(s) {
    var stat = mk("div", "health-stat");
    stat.appendChild(mkt("div", "health-stat-num", String(s[0])));
    stat.appendChild(mkt("div", "health-stat-label", s[1]));
    statsRow.appendChild(stat);
  });
  left.appendChild(statsRow);

  // ---- Session Brief: structured bullets rather than narrative prose ----
  // Each row is a factual roll-up of current session state.
  var execCard = mk("div", "card");
  var execHead = mk("div", "exec-summary-head");
  execHead.appendChild(mkt("div", "card-title", "Session brief"));
  var refreshBtn = mk("button", "btn-ghost exec-regen-btn");
  refreshBtn.textContent = "↻ Refresh";
  refreshBtn.title = "Re-read current session state and re-roll the brief.";
  execHead.appendChild(refreshBtn);
  execCard.appendChild(execHead);
  execCard.appendChild(mkt("div", "card-hint",
    "Scannable roll-up of current state. Re-derives from Coverage, Risk, drivers, pipeline, and linked Dell solutions."));

  // .exec-summary-text is kept as a marker class so callers that query
  // for it still find a populated element; the structured brief renders inside.
  var briefWrap = mk("div", "exec-summary-text session-brief");
  renderBrief(briefWrap, generateSessionBrief(session));
  execCard.appendChild(briefWrap);

  refreshBtn.addEventListener("click", function() {
    renderBrief(briefWrap, generateSessionBrief(session));
    refreshBtn.textContent = "↻ Refreshed";
    setTimeout(function() { refreshBtn.textContent = "↻ Refresh"; }, 1000);
  });
  // appended to right panel below (after trim block)

  // ---- Driver chips , mirror back the strategic drivers from Tab 1 ----
  var drivers = (session.customer.drivers || []);
  if (drivers.length) {
    var driversCard = mk("div", "card");
    driversCard.appendChild(mkt("div", "card-title", "Strategic Drivers"));
    driversCard.appendChild(mkt("div", "card-hint",
      "Lifted from Tab 1. These anchor the Roadmap swimlanes."));
    var chipsRow = mk("div", "reporting-drivers-row");
    drivers.forEach(function(d) {
      var meta = BUSINESS_DRIVERS.find(function(bd) { return bd.id === d.id; });
      var chip = mk("div", "reporting-driver-chip");
      chip.appendChild(mkt("span", "reporting-driver-name", meta ? meta.label : d.id));
      chip.appendChild(mkt("span", "priority-chip priority-" + (d.priority || "Medium").toLowerCase(), d.priority || "Medium"));
      chipsRow.appendChild(chip);
    });
    driversCard.appendChild(chipsRow);
    left.appendChild(driversCard);
  }

  // ---- Project pipeline ----
  var pipeCard = mk("div", "card");
  pipeCard.appendChild(mkt("div", "card-title", "Initiative pipeline at a glance"));
  if (projects.length === 0) {
    pipeCard.appendChild(mkt("div", "card-hint", "No gaps defined yet. Complete the Gaps step to see the pipeline."));
  } else {
    var phases = [["now","Now"],["next","Next"],["later","Later"]];
    var pipeRow = mk("div", "pipeline-row");
    phases.forEach(function(ph) {
      var phProjects = projects.filter(function(p) { return p.phase === ph[0]; });
      var col = mk("div", "pipeline-col");
      col.appendChild(mkt("div", "pipeline-col-label", ph[1]));
      var countInits = 0;
      phProjects.forEach(function(p) { countInits += p.initiatives.length; });
      col.appendChild(mkt("div", "pipeline-col-count", countInits + " initiative" + (countInits !== 1 ? "s" : "")));
      col.appendChild(mkt("div", "pipeline-col-projects", phProjects.length + " project group" + (phProjects.length !== 1 ? "s" : "")));
      phProjects.forEach(function(p) {
        var chip = mk("div", "pipeline-project-chip " + p.color);
        chip.textContent = p.label + " (" + p.initiatives.length + ")";
        col.appendChild(chip);
      });
      pipeRow.appendChild(col);
    });
    pipeCard.appendChild(pipeRow);
  }
  left.appendChild(pipeCard);

  // ---- Right panel: Executive Summary ----
  // Narrative belongs on the right; dashboards belong on the left.
  right.innerHTML = "";
  right.appendChild(execCard);
}

function mk(tag,cls)       { var e=document.createElement(tag); if(cls)e.className=cls; return e; }
function mkt(tag,cls,text) { var e=mk(tag,cls); e.textContent=text; return e; }

function renderBrief(container, rows) {
  container.innerHTML = "";
  rows.forEach(function(r) {
    var row = mk("div", "brief-row");
    row.appendChild(mkt("div", "brief-label", r.label));
    row.appendChild(mkt("div", "brief-text",  r.text));
    container.appendChild(row);
  });
}

// The empty-environments UX lives in the shared ui/components/NoEnvsCard.js.
