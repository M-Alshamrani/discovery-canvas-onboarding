// ui/views/SummaryRoadmapView.js — the strategic-driver roadmap board
//
// Hierarchy:
//   Programs (swimlanes) = business drivers (from session.customer.drivers[])
//   Projects (cards)     = auto-derived by (envId, layerId, gapType) in buildProjects()
//   Phases (columns)     = Now / Next / Later
//
// Layout: portfolio pulse bar above a swimlane × phase grid; projects placed by
// (driverId, phase). Unassigned projects land in a subdued row at the bottom.

import { LAYERS, ENVIRONMENTS, BUSINESS_DRIVERS } from "../../core/config.js";
// Session shape is projected from the active engagement (no v2 session store).
import { getEngagementAsSession } from "../../state/projection.js";
import { buildProjects } from "../../services/roadmapService.js";
import { groupProjectsByProgram, driverLabel as driverLabelFor } from "../../services/programsService.js";
import { helpButton } from "./HelpModal.js";
import { serviceLabel } from "../../core/services.js";
import { renderDemoBanner } from "../components/DemoBanner.js";

var PHASES = [
  { id: "now",   label: "Now",   subtitle: "0-12 months"  },
  { id: "next",  label: "Next",  subtitle: "12-24 months" },
  { id: "later", label: "Later", subtitle: "> 24 months"  }
];

export function renderSummaryRoadmapView(left, right, sess) {
  // Derive session-shape from the active engagement at render time.
  var session = sess || getEngagementAsSession();
  if (session && session.isDemo) renderDemoBanner(left);
  // Do NOT clear left/right here — the Reporting tab bar (#summary-tabs)
  // lives in `left` and the caller appended it before calling us. Sibling
  // sub-tab views (Health, Gaps, Vendor) also only append; clearing here
  // would make the sub-tab bar disappear when Roadmap is selected.

  // Header card
  var header = mk("div", "card");
  var titleRow = mk("div", "card-title-row");
  titleRow.appendChild(mkt("div", "card-title", "Roadmap"));
  titleRow.appendChild(helpButton("reporting_roadmap"));
  header.appendChild(titleRow);
  header.appendChild(mkt("div", "card-hint",
    "Strategic Drivers (rows) × Phases (Now / Next / Later). Each card is an auto-derived project bundling related gaps. Read-only , edit gaps in Tab 4 to change this view."));
  left.appendChild(header);

  var gapsCount = (session.gaps || []).length;
  if (gapsCount === 0) {
    var empty = mk("div", "card empty-state-card");
    empty.appendChild(mkt("div", "empty-state-title", "No gaps yet"));
    empty.appendChild(mkt("div", "empty-state-hint",
      "Start in Tab 3 (Desired State) by setting a disposition on a current instance. Auto-drafted gaps will flow into this roadmap."));
    left.appendChild(empty);
    return;
  }

  var projects = buildProjects(session, {}).projects;
  var grouped  = groupProjectsByProgram(projects, session);

  // ── Portfolio pulse bar ─────────────────────────────────
  left.appendChild(buildPulseBar(projects, session));

  // ── Swimlane × phase grid ───────────────────────────────
  var grid = mk("div", "roadmap-grid");

  // Header row: blank corner + phase labels
  var corner = mk("div", "roadmap-corner");
  corner.textContent = "Strategic Drivers";
  grid.appendChild(corner);
  PHASES.forEach(function(ph) {
    var hdr = mk("div", "roadmap-phase-head");
    hdr.appendChild(mkt("div", "roadmap-phase-title", ph.label));
    hdr.appendChild(mkt("div", "roadmap-phase-sub", ph.subtitle));
    grid.appendChild(hdr);
  });

  // Stash the right panel + session for project-card click routing.
  _currentRight = right;
  _currentSession = session;

  // Driver swimlanes, in session order.
  var drivers = (session.customer.drivers || []);
  drivers.forEach(function(d) {
    var meta = BUSINESS_DRIVERS.find(function(bd) { return bd.id === d.id; });
    appendSwimlane(grid, {
      id:       d.id,
      label:    meta ? meta.label : d.id,
      priority: d.priority || "Medium",
      projects: grouped[d.id] || [],
      driverEntry: d,
      driverMeta:  meta,
      onClick: function() { renderDriverDetail(right, session, d, grouped[d.id] || []); }
    });
  });

  // Unassigned swimlane (always rendered, subdued)
  appendSwimlane(grid, {
    id:       "unassigned",
    label:    "Unassigned",
    priority: null,
    subdued:  true,
    projects: grouped.unassigned || [],
    onClick:  function() { renderUnassignedDetail(right, grouped.unassigned || []); }
  });

  left.appendChild(grid);

  // Right panel placeholder
  renderHint(right);
}

function buildPulseBar(projects, session) {
  var counts = { now: 0, next: 0, later: 0 };
  projects.forEach(function(p) { counts[p.phase] = (counts[p.phase] || 0) + 1; });
  // Count of gaps awaiting approval.
  var unreviewedCount = (session.gaps || []).filter(function(g) {
    return g.reviewed === false;
  }).length;

  var bar = mk("div", "card pulse-bar");
  var row = mk("div", "pulse-bar-row");
  row.appendChild(pulseStat(projects.length, "projects"));
  row.appendChild(pulseStat(counts.now,   "Now"));
  row.appendChild(pulseStat(counts.next,  "Next"));
  row.appendChild(pulseStat(counts.later, "Later"));
  row.appendChild(pulseStat(unreviewedCount, "unreviewed gaps",
    "Auto-drafted gaps still awaiting approval , review in Tab 4."));
  bar.appendChild(row);
  return bar;
}

function pulseStat(num, label, title) {
  var w = mk("div", "pulse-stat");
  var n = mkt("div", "pulse-stat-num",   String(num));
  var l = mkt("div", "pulse-stat-label", label);
  if (title) w.setAttribute("title", title);
  w.appendChild(n);
  // Text-node separators so .textContent reads "N projects " with
  // whitespace on either side of the label, which keeps \b-boundary
  // regexes correct when stats concatenate.
  w.appendChild(document.createTextNode(" "));
  w.appendChild(l);
  w.appendChild(document.createTextNode(" "));
  return w;
}

// Swimlane cells route project-card clicks into renderProjectDetail, which
// needs the right panel + session. They are stashed here while building.
var _currentRight = null;
var _currentSession = null;

function appendSwimlane(grid, lane) {
  var head = mk("div", "swimlane-head" + (lane.subdued ? " swimlane-subdued" : ""));
  if (lane.onClick) {
    head.classList.add("swimlane-clickable");
    head.setAttribute("role", "button");
    head.setAttribute("tabindex", "0");
    head.setAttribute("title", "Click to see strategic driver detail");
    head.addEventListener("click", lane.onClick);
  }
  head.appendChild(mkt("div", "swimlane-label", lane.label));
  var meta = mk("div", "swimlane-meta");
  if (lane.priority) {
    var prioChip = mkt("span", "priority-chip priority-" + lane.priority.toLowerCase(), lane.priority);
    meta.appendChild(prioChip);
  }
  // Aggregate urgency shape for the swimlane
  var maxUrg = "Low";
  lane.projects.forEach(function(p) {
    if (p.urgency === "High") maxUrg = "High";
    else if (p.urgency === "Medium" && maxUrg !== "High") maxUrg = "Medium";
  });
  if (lane.projects.length) {
    meta.appendChild(mk("span", "crit-shape-" + maxUrg.toLowerCase()));
  }
  meta.appendChild(mkt("span", "swimlane-count", lane.projects.length + " project" + (lane.projects.length === 1 ? "" : "s")));
  head.appendChild(meta);
  grid.appendChild(head);

  // One cell per phase
  PHASES.forEach(function(ph) {
    var cell = mk("div", "swimlane-cell" + (lane.subdued ? " swimlane-subdued" : ""));
    var cellProjects = lane.projects.filter(function(p) { return p.phase === ph.id; });
    // Sort: urgency desc, then gap count desc
    cellProjects.sort(function(a, b) {
      var ua = urgencyRank(a.urgency);
      var ub = urgencyRank(b.urgency);
      if (ub !== ua) return ub - ua;
      return b.gapCount - a.gapCount;
    });
    if (cellProjects.length === 0) {
      cell.appendChild(mkt("div", "swimlane-empty", ","));
    } else {
      cellProjects.forEach(function(p) { cell.appendChild(buildProjectCard(p)); });
    }
    grid.appendChild(cell);
  });
}

function buildProjectCard(proj) {
  var card = mk("div", "project-card crit-" + (proj.urgency || "low").toLowerCase());

  var head = mk("div", "project-card-head");
  var name = mkt("div", "project-card-name", proj.name);
  head.appendChild(name);

  var badges = mk("div", "project-card-badges");
  var urgBadge = mkt("span", "urgency-badge urg-" + (proj.urgency || "low").toLowerCase(), proj.urgency);
  badges.appendChild(urgBadge);
  badges.appendChild(mk("span", "crit-shape-" + (proj.urgency || "low").toLowerCase()));
  badges.appendChild(mkt("span", "link-badge", proj.gapCount + " gap" + (proj.gapCount === 1 ? "" : "s")));
  head.appendChild(badges);
  card.appendChild(head);

  // Dell solutions chips
  if (proj.dellSolutions && proj.dellSolutions.length) {
    var solutionsRow = mk("div", "project-card-solutions");
    proj.dellSolutions.forEach(function(s) {
      solutionsRow.appendChild(mkt("span", "solutions-chip", s));
    });
    card.appendChild(solutionsRow);
  } else {
    card.appendChild(mkt("div", "project-card-unmapped", "No Dell solutions mapped yet , see Tab 4."));
  }

  // "Services needed" chip row — the union of the constituent gaps' services.
  if (proj.services && proj.services.length) {
    var servicesRow = mk("div", "project-card-services");
    servicesRow.appendChild(mkt("span", "project-card-services-eyebrow", "SERVICES NEEDED"));
    proj.services.forEach(function(sid) {
      servicesRow.appendChild(mkt("span", "services-chip", serviceLabel(sid) || sid));
    });
    card.appendChild(servicesRow);
  }

  // Click the project card → right-panel detail (consistent with the
  // swimlane-head, vendor-row, and heatmap-cell patterns).
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");
  card.title = "Click to see project detail on the right";
  card.addEventListener("click", function() {
    if (_currentRight && _currentSession) renderProjectDetail(_currentRight, _currentSession, proj);
  });

  return card;
}

function renderProjectDetail(right, session, proj) {
  right.innerHTML = "";
  var panel = mk("div", "detail-panel");

  var title = mk("div", "detail-title"); title.textContent = proj.name;
  panel.appendChild(title);
  var sub = mk("div", "detail-sub");
  sub.textContent = proj.gapCount + " gap" + (proj.gapCount === 1 ? "" : "s") +
    " · phase " + (proj.phase || "now");
  panel.appendChild(sub);

  var badges = mk("div", "detail-badges");
  badges.innerHTML =
    '<span class="urgency-badge urg-' + (proj.urgency || "low").toLowerCase() + '">' + proj.urgency + '</span>' +
    '<span class="crit-shape-' + (proj.urgency || "low").toLowerCase() + '"></span>';
  panel.appendChild(badges);

  // "Also affects" environments. A project's primary env may be e.g.
  // coreDc while its constituent gaps span coreDc + drDc + publicCloud.
  // Surface all the unique envs across the gaps' affectedEnvironments
  // arrays (deduped, primary first) so the full scope is visible without
  // splitting the project.
  var envIds = new Set();
  if (proj.envId) envIds.add(proj.envId);
  proj.gaps.forEach(function(g) {
    (g.affectedEnvironments || []).forEach(function(e) { envIds.add(e); });
  });
  envIds.delete("crossCutting");   // not user-meaningful
  if (envIds.size > 1) {
    var envSep = mk("div", "detail-sep"); envSep.textContent = "Also affects"; panel.appendChild(envSep);
    var envChipRow = mk("div", "detail-chip-row");
    Array.from(envIds).forEach(function(eid) {
      if (eid === proj.envId) return;   // primary already in the project name
      var em = ENVIRONMENTS.find(function(e) { return e.id === eid; });
      envChipRow.appendChild(mkt("span", "env-also-chip", em ? em.label : eid));
    });
    panel.appendChild(envChipRow);
  }

  // Dell solutions
  var solSep = mk("div", "detail-sep"); solSep.textContent = "Dell solutions mapped"; panel.appendChild(solSep);
  var solText = mk("div", "detail-text");
  solText.textContent = (proj.dellSolutions && proj.dellSolutions.length)
    ? proj.dellSolutions.join(", ")
    : "None yet , link Dell desired tiles to constituent gaps in Tab 4.";
  panel.appendChild(solText);

  // Gaps
  var gapSep = mk("div", "detail-sep"); gapSep.textContent = "Constituent gaps"; panel.appendChild(gapSep);
  proj.gaps.forEach(function(g) {
    var row = mk("div", "detail-row");
    row.innerHTML =
      '<span class="crit-shape-' + (g.urgency || "low").toLowerCase() + '"></span> ' +
      '<strong>' + (g.urgency || "") + '</strong> · ' +
      (g.description || "(untitled)") +
      (g.status && g.status !== "open" ? ' <span class="status-badge">' + g.status + '</span>' : '');
    panel.appendChild(row);
  });

  // Linked-instance count: count UNIQUE instance ids across the project's
  // gaps. The same instance can appear in two gaps' relatedXxx arrays, so
  // summing lengths would double-count and inflate the project's apparent
  // technology footprint.
  var uniqueInstanceIds = new Set();
  proj.gaps.forEach(function(g) {
    (g.relatedCurrentInstanceIds || []).forEach(function(id) { uniqueInstanceIds.add(id); });
    (g.relatedDesiredInstanceIds || []).forEach(function(id) { uniqueInstanceIds.add(id); });
  });
  var linkCount = uniqueInstanceIds.size;
  var linkSep = mk("div", "detail-sep"); linkSep.textContent = "Linked technologies"; panel.appendChild(linkSep);
  var linkRow = mk("div", "detail-text");
  linkRow.textContent = linkCount + " unique technolog" + (linkCount === 1 ? "y" : "ies") +
    " across " + proj.gapCount + " gap" + (proj.gapCount === 1 ? "" : "s") +
    ". Open in Tab 4 to edit links.";
  panel.appendChild(linkRow);

  right.appendChild(panel);
}

function urgencyRank(u) {
  return u === "High" ? 3 : u === "Medium" ? 2 : u === "Low" ? 1 : 0;
}

function renderHint(right) {
  right.innerHTML = "";
  var ph = mk("div", "detail-placeholder");
  ph.appendChild(mkt("div", "detail-ph-title", "Roadmap overview"));
  ph.appendChild(mkt("div", "detail-ph-hint",
    "Click any strategic-driver swimlane header to see program detail on this panel. Or expand a project card inline on the left."));
  right.appendChild(ph);
}

// Strategic-driver detail panel (swimlane-header click).
function renderDriverDetail(right, session, driverEntry, projects) {
  right.innerHTML = "";
  var meta = BUSINESS_DRIVERS.find(function(bd) { return bd.id === driverEntry.id; });

  var panel = mk("div", "detail-panel");
  var title = mk("div", "detail-title");
  title.textContent = meta ? meta.label : driverEntry.id;
  panel.appendChild(title);
  if (meta) {
    var sub = mk("div", "detail-sub");
    sub.textContent = meta.shortHint;
    panel.appendChild(sub);
  }

  var badges = mk("div", "detail-badges");
  badges.innerHTML =
    '<span class="priority-chip priority-' + (driverEntry.priority || "Medium").toLowerCase() + '">' + (driverEntry.priority || "Medium") + '</span>' +
    '<span class="link-badge">' + projects.length + ' project' + (projects.length === 1 ? '' : 's') + '</span>';
  panel.appendChild(badges);

  // Outcomes
  var outSep = mk("div", "detail-sep"); outSep.textContent = "Business outcomes"; panel.appendChild(outSep);
  var out = mk("div", "detail-text");
  out.textContent = (driverEntry.outcomes || "").trim() || "No outcomes captured yet , add them in Tab 1.";
  out.style.whiteSpace = "pre-wrap";
  panel.appendChild(out);

  // Aggregate urgency
  var maxUrg = "Low";
  projects.forEach(function(p) {
    if (p.urgency === "High") maxUrg = "High";
    else if (p.urgency === "Medium" && maxUrg !== "High") maxUrg = "Medium";
  });
  var mappedProjects = projects.filter(function(p) { return p.dellSolutions && p.dellSolutions.length > 0; }).length;
  var pctMapped = projects.length ? Math.round(100 * mappedProjects / projects.length) : 0;

  var statsSep = mk("div", "detail-sep"); statsSep.textContent = "Program snapshot"; panel.appendChild(statsSep);
  var stats = mk("div", "detail-text");
  stats.innerHTML =
    "<strong>Aggregate urgency:</strong> " + maxUrg + "<br>" +
    "<strong>% with Dell solutions mapped:</strong> " + pctMapped + "%";
  panel.appendChild(stats);

  // Projects list
  if (projects.length) {
    var projSep = mk("div", "detail-sep"); projSep.textContent = "Projects in this program"; panel.appendChild(projSep);
    projects.forEach(function(p) {
      var row = mk("div", "detail-row");
      row.innerHTML = '<span class="crit-shape-' + (p.urgency || "low").toLowerCase() + '"></span> ' +
                      p.name + ' <span class="link-badge">' + p.gapCount + ' gap' + (p.gapCount === 1 ? '' : 's') + '</span>';
      panel.appendChild(row);
    });
  }

  right.appendChild(panel);
}

// Unassigned swimlane detail.
function renderUnassignedDetail(right, projects) {
  right.innerHTML = "";
  var panel = mk("div", "detail-panel");
  var title = mk("div", "detail-title"); title.textContent = "Unassigned projects";
  panel.appendChild(title);
  var sub = mk("div", "detail-sub");
  sub.textContent = projects.length + " project" + (projects.length === 1 ? "" : "s") + " without a strategic driver";
  panel.appendChild(sub);

  if (!projects.length) {
    var empty = mk("div", "detail-text");
    empty.textContent = "Every project has been assigned to a strategic driver. Good.";
    panel.appendChild(empty);
    right.appendChild(panel);
    return;
  }

  var hint = mk("div", "detail-text");
  hint.textContent = "Assign each gap in this list to a strategic driver in Tab 4 to fold them into the right program.";
  panel.appendChild(hint);

  var sep = mk("div", "detail-sep"); sep.textContent = "Projects"; panel.appendChild(sep);
  projects.forEach(function(p) {
    var row = mk("div", "detail-row");
    row.textContent = p.name + " (" + p.gapCount + " gap" + (p.gapCount === 1 ? "" : "s") + ")";
    panel.appendChild(row);
  });

  right.appendChild(panel);
}

function mk(tag, cls)         { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
function mkt(tag, cls, text)  { var e = mk(tag, cls); e.textContent = text; return e; }
