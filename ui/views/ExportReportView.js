// ui/views/ExportReportView.js
// Generates a self-contained, data-driven HTML report matching the sample report
// design spec. All report sections are populated from the live engagement data model.
// The generated HTML is completely standalone (no external dependencies other than
// Google Fonts) and can be opened in any browser or printed to PDF.

import { getEngagementAsSession, getVisibleEnvsFromEngagement } from "../../state/projection.js";
import { LAYERS, BUSINESS_DRIVERS } from "../../core/config.js";
import { buildProjects, computeDiscoveryCoverage, computeRiskPosture, generateSessionBrief } from "../../services/roadmapService.js";
import { getHealthSummary, computeBucketMetrics, scoreToRiskLabel, scoreToClass, computeLifecycleRisk } from "../../services/healthMetrics.js";
import { computeTechRefresh } from "../../services/techRefreshReport.js";
import { buildArchitectureDiagramPrompt } from "../../services/architectureDiagramPrompt.js";
import { loadAiConfig, isActiveProviderReady } from "../../core/aiConfig.js";
import { chatCompletion } from "../../services/aiService.js";
import { renderDemoBanner } from "../components/DemoBanner.js";

// ── Entry point ────────────────────────────────────────────────────────────────

export function renderExportReportView(left, right) {
  var session = getEngagementAsSession();
  if (session && session.isDemo) renderDemoBanner(left);

  var visibleEnvs = getVisibleEnvsFromEngagement();

  // ── Header ──────────────────────────────────────────────────────────────────
  var headerCard = mk("div", "card");
  headerCard.innerHTML = [
    '<div class="card-title-row">',
      '<div class="card-title">Export options</div>',
    '</div>',
    '<div class="card-hint">',
      'Choose what to export. Each report is built live from this engagement\'s data and can be ',
      'opened in a new tab, saved as a standalone HTML file, or exported directly as a PDF.',
    '</div>'
  ].join("");
  left.appendChild(headerCard);

  // ── Option 1 · Full assessment report ───────────────────────────────────────
  left.appendChild(buildOptionCard({
    id:    "full",
    title: "Full Assessment Report",
    hint:  "The complete executive presentation — infrastructure assessment, vendor analytics, heatmap, risks, roadmap, and session brief.",
    sections: [
      ["Executive Header", "Customer name, KPI summary bar, date, and prepared-by metadata"],
      ["Overview Dashboard", "Vendor mix, Dell vs non-Dell by environment, category snapshot"],
      ["Site / Environment Breakdown", "Per-environment asset counts and key observations"],
      ["Full Asset Inventory", "All instances by environment, layer, vendor, and status"],
      ["Heatmap", "Layer × environment risk matrix"],
      ["Risks & Gaps", "Confirmed risks, data-quality gaps, opportunity themes"],
      ["Strategic Roadmap", "Now / Next / Later phased project cards"],
      ["Session Brief", "Scannable executive roll-up"]
    ],
    build: function() { return buildReportHTML(session, visibleEnvs); },
    filename: function() { return buildFilename(session); }
  }));

  // ── Option 2 · Tech Refresh report ───────────────────────────────────────────
  left.appendChild(buildOptionCard({
    id:    "techrefresh",
    title: "Tech Refresh Report",
    hint:  "Where the customer stands on hardware lifecycle — what is aging, what is out of support, and what must be refreshed and when.",
    sections: [
      ["Lifecycle Summary", "Support coverage, at-risk count, and refresh posture at a glance"],
      ["Refresh Roadmap", "Every asset with end-of-sale / support / service-life dates, timing, and recommended action"],
      ["Aging by Layer & Environment", "Where lifecycle risk concentrates across the estate"]
    ],
    build: function() { return buildTechRefreshHTML(session, visibleEnvs); },
    filename: function() { return buildFilename(session, "tech-refresh"); }
  }));

  // ── Option 3 · Architecture diagram prompt ───────────────────────────────────
  left.appendChild(buildArchitecturePromptCard(session, visibleEnvs));

  // ── Data snapshot (right) ────────────────────────────────────────────────────
  renderDataSnapshot(right, session, visibleEnvs);
}

// ── Reusable export-option card (HTML / PDF / open) ──────────────────────────

function buildOptionCard(opt) {
  var card = mk("div", "card er-option-card");
  card.innerHTML = [
    '<div class="card-title">' + esc(opt.title) + '</div>',
    '<div class="card-hint">' + esc(opt.hint) + '</div>',
    '<div class="er-section-list">',
      opt.sections.map(function(s, i) { return sectionItem(String(i + 1), s[0], s[1]); }).join(""),
    '</div>',
    '<div class="export-report-actions">',
      '<button class="btn-primary er-generate-btn" data-act="open">↗ Generate &amp; Open</button>',
      '<button class="btn-secondary er-download-btn" data-act="html">↓ Export HTML</button>',
      '<button class="btn-secondary er-download-btn" data-act="pdf">↓ Export PDF</button>',
    '</div>'
  ].join("");

  card.querySelector('[data-act="open"]').addEventListener("click", function() {
    openHtmlInTab(opt.build());
  });
  card.querySelector('[data-act="html"]').addEventListener("click", function() {
    downloadHtml(opt.build(), opt.filename() + ".html");
  });
  card.querySelector('[data-act="pdf"]').addEventListener("click", function(ev) {
    var btn = ev.currentTarget;
    var prev = btn.textContent;
    btn.disabled = true; btn.textContent = "Generating PDF…";
    htmlToPdf(opt.build(), opt.filename() + ".pdf")
      .catch(function(e) { window.alert("PDF export failed: " + (e && e.message ? e.message : e)); })
      .then(function() { btn.disabled = false; btn.textContent = prev; });
  });
  return card;
}

// ── Architecture-diagram prompt card ─────────────────────────────────────────

function buildArchitecturePromptCard(session, visibleEnvs) {
  var promptText = buildArchitectureDiagramPrompt(session, visibleEnvs);

  var card = mk("div", "card er-option-card");
  card.innerHTML = [
    '<div class="card-title">Generate Architecture Diagram</div>',
    '<div class="card-hint">',
      'A ready-to-use prompt describing the current-state estate as a layered architecture diagram ',
      '(layers × environments, vendor-coloured tiles, workload→asset links). Copy it into any ',
      'image-capable LLM to produce the current-state architecture picture.',
    '</div>',
    '<textarea id="er-arch-prompt" class="er-arch-prompt" rows="14" spellcheck="false"></textarea>',
    '<div class="export-report-actions">',
      '<button class="btn-primary er-generate-btn" data-act="copy">⧉ Copy Prompt</button>',
      '<button class="btn-secondary er-download-btn" data-act="refine">✨ Refine with AI</button>',
      '<button class="btn-secondary er-download-btn" data-act="reset">↺ Reset</button>',
    '</div>'
  ].join("");

  var ta = card.querySelector("#er-arch-prompt");
  ta.value = promptText;

  card.querySelector('[data-act="copy"]').addEventListener("click", function(ev) {
    var btn = ev.currentTarget; var prev = btn.textContent;
    copyText(ta.value).then(function() {
      btn.textContent = "✓ Copied"; setTimeout(function() { btn.textContent = prev; }, 1500);
    });
  });
  card.querySelector('[data-act="reset"]').addEventListener("click", function() {
    ta.value = buildArchitectureDiagramPrompt(session, visibleEnvs);
  });
  card.querySelector('[data-act="refine"]').addEventListener("click", function(ev) {
    refineArchPrompt(ev.currentTarget, ta);
  });
  return card;
}

// ─────────────────────────────────────────────────────────────────────────────
// Output helpers — open / download HTML, clipboard, PDF, AI refine
// ─────────────────────────────────────────────────────────────────────────────

function openHtmlInTab(html) {
  var blob = new Blob([html], { type: "text/html" });
  var url  = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(function() { URL.revokeObjectURL(url); }, 30000);
}

function downloadHtml(html, filename) {
  var blob = new Blob([html], { type: "text/html" });
  var a    = document.createElement("a");
  a.href   = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(function() {
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }, 1000);
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(function() { return legacyCopy(text); });
  }
  return Promise.resolve(legacyCopy(text));
}

function legacyCopy(text) {
  var ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); } catch (e) { /* noop */ }
  document.body.removeChild(ta);
}

// Lazy-load the html2pdf bundle (UMD → window.html2pdf) once. Tries the
// vendored copy first (works fully offline); if that file isn't present
// (e.g. a checkout that didn't include the large binary), falls back to a
// pinned CDN build. Either way html2pdf is attached to window.
var _html2pdfPromise = null;
var HTML2PDF_SOURCES = [
  "./vendor/html2pdf/html2pdf.bundle.min.js",
  "https://unpkg.com/html2pdf.js@0.10.3/dist/html2pdf.bundle.min.js"
];
function loadHtml2Pdf() {
  if (typeof window !== "undefined" && window.html2pdf) return Promise.resolve(window.html2pdf);
  if (_html2pdfPromise) return _html2pdfPromise;
  _html2pdfPromise = HTML2PDF_SOURCES.reduce(function(chain, src) {
    return chain.catch(function() { return loadScript(src); });
  }, Promise.reject())
    .then(function() {
      if (window.html2pdf) return window.html2pdf;
      throw new Error("html2pdf failed to initialise");
    });
  return _html2pdfPromise;
}

function loadScript(src) {
  return new Promise(function(resolve, reject) {
    var s = document.createElement("script");
    s.src = src;
    s.onload = function() { window.html2pdf ? resolve(window.html2pdf) : reject(new Error("no html2pdf on " + src)); };
    s.onerror = function() { reject(new Error("could not load " + src)); };
    document.head.appendChild(s);
  });
}

// Render a full standalone report HTML string to a downloaded PDF. The
// report documents are tab-based for screen; for PDF we mount them in an
// off-screen iframe, force every panel visible, hide the tab nav, and let
// html2pdf (html2canvas + jsPDF) paginate the continuous content.
function htmlToPdf(html, filename) {
  return loadHtml2Pdf().then(function() {
    return new Promise(function(resolve, reject) {
      var iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.left   = "-10000px";
      iframe.style.top    = "0";
      iframe.style.width  = "1180px";
      iframe.style.height = "1000px";
      iframe.style.border = "0";
      document.body.appendChild(iframe);

      var cleanup = function() { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); };
      var doc = iframe.contentDocument;
      doc.open(); doc.write(html); doc.close();

      var run = function() {
        try {
          doc.querySelectorAll(".rpt-pnl").forEach(function(p) { p.style.display = "block"; });
          var tabs = doc.querySelector(".rpt-tabs"); if (tabs) tabs.style.display = "none";

          window.html2pdf().set({
            margin:      [8, 8, 10, 8],
            filename:    filename,
            image:       { type: "jpeg", quality: 0.96 },
            html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ECF1F7", windowWidth: 1180 },
            jsPDF:       { unit: "mm", format: "a4", orientation: "portrait" },
            pagebreak:   { mode: ["css", "legacy"] }
          }).from(doc.body).save()
            .then(function() { cleanup(); resolve(); })
            .catch(function(e) { cleanup(); reject(e); });
        } catch (e) { cleanup(); reject(e); }
      };

      // Give web fonts + layout a beat before rasterising.
      if (doc.fonts && doc.fonts.ready) {
        doc.fonts.ready.then(function() { setTimeout(run, 350); });
      } else {
        setTimeout(run, 700);
      }
    });
  });
}

// Optionally polish the architecture-diagram prompt via the configured AI
// provider. Degrades gracefully when no provider is set up.
function refineArchPrompt(btn, ta) {
  var cfg = loadAiConfig();
  if (!isActiveProviderReady(cfg)) {
    window.alert("No AI provider is configured. Set one up via the gear icon → AI settings to use Refine with AI.");
    return;
  }
  var providerKey = cfg.activeProvider;
  var p = cfg.providers[providerKey] || {};
  var prev = btn.textContent;
  btn.disabled = true; btn.textContent = "Refining…";

  chatCompletion({
    providerKey:    providerKey,
    baseUrl:        p.baseUrl,
    model:          p.model,
    fallbackModels: p.fallbackModels || [],
    apiKey:         p.apiKey || "",
    maxTokens:      1500,
    messages: [
      { role: "system", content: "You refine image-generation prompts for architecture diagrams. Improve clarity, structure, and visual direction. Preserve every technology, layer, environment, and dependency exactly as given — never add or remove components. Return only the improved prompt text, no commentary." },
      { role: "user", content: ta.value }
    ]
  }).then(function(res) {
    if (res && res.text && res.text.trim()) ta.value = res.text.trim();
    btn.disabled = false; btn.textContent = prev;
  }).catch(function(e) {
    window.alert("Refine failed: " + (e && e.message ? e.message : e));
    btn.disabled = false; btn.textContent = prev;
  });
}

// ── Right-panel: data snapshot ─────────────────────────────────────────────

function renderDataSnapshot(right, session, visibleEnvs) {
  right.innerHTML = "";
  var panel = mk("div", "detail-panel");

  var coverage = computeDiscoveryCoverage(session);
  var risk     = computeRiskPosture(session);
  var summary  = getHealthSummary(session, LAYERS, visibleEnvs);

  var instances = session.instances || [];
  var dellCount    = instances.filter(function(i) { return i.vendorGroup === "dell"; }).length;
  var nonDellCount = instances.filter(function(i) { return i.vendorGroup === "nonDell"; }).length;
  var customCount  = instances.filter(function(i) { return i.vendorGroup === "custom"; }).length;
  var totalCount   = instances.length;

  panel.appendChild(mkt("div", "detail-title", "Data snapshot"));
  panel.appendChild(mkt("div", "detail-sub", "What will appear in the generated report"));

  var rows = [
    ["Customer",         (session.customer && session.customer.name) || "(unnamed)"],
    ["Vertical",         (session.customer && session.customer.vertical) || "—"],
    ["Region",           (session.customer && session.customer.region) || "—"],
    ["Environments",     visibleEnvs.length + " active"],
    ["Total instances",  totalCount],
    ["Dell instances",   dellCount + " (" + pct(dellCount, totalCount) + "%)"],
    ["Non-Dell",         nonDellCount + " (" + pct(nonDellCount, totalCount) + "%)"],
    ["Custom",           customCount],
    ["Total gaps",       summary.totalGaps],
    ["High-urgency gaps",summary.highRiskGaps],
    ["Discovery coverage",coverage.percent + "%"],
    ["Risk posture",     risk.level],
    ["Strategic drivers",(session.customer && session.customer.drivers && session.customer.drivers.length) || 0]
  ];

  rows.forEach(function(r) {
    var row = mk("div", "detail-row");
    row.innerHTML = "<strong>" + esc(String(r[0])) + ":</strong> " + esc(String(r[1]));
    panel.appendChild(row);
  });

  if (totalCount === 0) {
    var warn = mk("div", "er-warn-box");
    warn.innerHTML = "<strong>No instances found.</strong> Add current or desired technologies in Tabs 2 and 3 before generating the report.";
    panel.appendChild(warn);
  }

  right.appendChild(panel);
}

// ── HTML generation ────────────────────────────────────────────────────────

function buildReportHTML(session, visibleEnvs) {
  var cust      = session.customer || {};
  var instances = session.instances || [];
  var gaps      = session.gaps || [];
  var drivers   = (cust.drivers || []);
  var projects  = buildProjects(session, {}).projects;
  var coverage  = computeDiscoveryCoverage(session);
  var risk      = computeRiskPosture(session);
  var brief     = generateSessionBrief(session);
  var summary   = getHealthSummary(session, LAYERS, visibleEnvs);

  // ── Aggregate vendor counts ─────────────────────────────────────────────
  var dellCount    = instances.filter(function(i) { return i.vendorGroup === "dell"; }).length;
  var nonDellCount = instances.filter(function(i) { return i.vendorGroup === "nonDell"; }).length;
  var customCount  = instances.filter(function(i) { return i.vendorGroup === "custom"; }).length;
  var totalCount   = instances.length;

  // ── Vendor breakdown per environment ───────────────────────────────────
  var vendorsByEnv = buildVendorsByEnv(instances, visibleEnvs);

  // ── Unique vendor labels ────────────────────────────────────────────────
  var vendorLabels = uniqueVendors(instances);

  // ── High-risk findings ─────────────────────────────────────────────────
  var highGaps  = gaps.filter(function(g) { return g.urgency === "High"   && g.status !== "closed"; });
  var medGaps   = gaps.filter(function(g) { return g.urgency === "Medium" && g.status !== "closed"; });
  var nowHigh   = highGaps.filter(function(g)  { return g.phase === "now"; });

  // ── Phase counts ───────────────────────────────────────────────────────
  var nowCount   = projects.filter(function(p) { return p.phase === "now";   }).length;
  var nextCount  = projects.filter(function(p) { return p.phase === "next";  }).length;
  var laterCount = projects.filter(function(p) { return p.phase === "later"; }).length;

  // ── Heatmap data ───────────────────────────────────────────────────────
  var heatmapRows = buildHeatmapData(session, visibleEnvs);

  var customerName = (cust.name && cust.name.trim()) || "Customer";
  var dateStr      = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return [
    "<!DOCTYPE html>",
    "<html lang=\"en\">",
    buildHead(customerName),
    "<body>",
    buildHeader(customerName, cust, totalCount, dellCount, nonDellCount, gaps.length, dateStr),
    buildTabNav(),
    buildOverviewPanel(instances, dellCount, nonDellCount, customCount, totalCount, vendorLabels, vendorsByEnv, visibleEnvs, drivers, coverage, risk),
    buildEnvironmentsPanel(visibleEnvs, instances, gaps),
    buildAssetPanel(instances, visibleEnvs, totalCount, dellCount, nonDellCount),
    buildHeatmapPanel(heatmapRows, visibleEnvs),
    buildRisksPanel(gaps, highGaps, medGaps, nowHigh, instances, visibleEnvs),
    buildRoadmapPanel(projects, nowCount, nextCount, laterCount, drivers),
    buildBriefPanel(brief, coverage, risk, summary),
    buildScript(),
    "</body>",
    "</html>"
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML block builders
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Tech Refresh report — standalone HTML document (lifecycle / refresh story)
// ─────────────────────────────────────────────────────────────────────────────

function buildTechRefreshHTML(session, visibleEnvs) {
  var tr   = computeTechRefresh(session, visibleEnvs);
  var cust = session.customer || {};
  var customerName = (cust.name && cust.name.trim()) || "Customer";
  var dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return [
    "<!DOCTYPE html>",
    "<html lang=\"en\">",
    buildHead(customerName, "Technology Refresh Report"),
    "<body>",
    buildTechRefreshHeader(customerName, cust, tr, dateStr),
    "<div class=\"rpt-pnl on\" style=\"display:block\">",
      buildTechRefreshSummary(tr),
      buildTechRefreshRoadmap(tr),
      buildTechRefreshBreakdown(tr),
    "</div>",
    "</body>",
    "</html>"
  ].join("\n");
}

function buildTechRefreshHeader(customerName, cust, tr, dateStr) {
  var vertical = (cust.vertical && cust.vertical !== "—") ? " · " + esc(cust.vertical) : "";
  var region   = (cust.region   && cust.region   !== "—") ? " · " + esc(cust.region)   : "";
  return [
    "<header class=\"rpt-hdr\">",
      "<div class=\"rpt-hdr-inner\">",
        "<div class=\"rpt-hdr-left\">",
          "<div class=\"rpt-eyebrow\">Discovery Canvas · Technology Refresh Report</div>",
          "<h1 class=\"rpt-title\">" + esc(customerName) + "</h1>",
          "<div class=\"rpt-sub\">Prepared by Dell Technologies · " + esc(dateStr) + vertical + region + "</div>",
        "</div>",
        "<div class=\"rpt-kpis\">",
          rptKpi(tr.total,                "Current Assets",   "info"),
          rptKpi(tr.atRiskTotal,          "At Lifecycle Risk", tr.atRiskTotal > 0 ? "warn" : "ok"),
          rptKpi(tr.refreshNow.length,    "Refresh Now",       tr.refreshNow.length > 0 ? "warn" : "ok"),
          rptKpi(tr.supportCoveragePct + "%", "Support Coverage", tr.supportCoveragePct >= 60 ? "ok" : "warn"),
        "</div>",
      "</div>",
    "</header>"
  ].join("\n");
}

function buildTechRefreshSummary(tr) {
  var s = tr.bySeverity;
  var kpiGrid = [
    rptKpiCard(s.critical, "Past Service Life", "Critical — refresh immediately", "#DC2626"),
    rptKpiCard(s.high,     "Out of Support",    "High — unsupported assets",       "#EA580C"),
    rptKpiCard(s.elevated, "Support Expiring",  "Elevated — within 12 months",     "#D97706"),
    rptKpiCard(s.none,     "Within Support",    "Healthy or untracked",            "#16A34A"),
    rptKpiCard(tr.trackedCoveragePct + "%", "Lifecycle Tracked", tr.tracked + " of " + tr.total + " assets", coverageCls(tr.trackedCoveragePct))
  ].join("");

  // ── Lifecycle severity donut (every current asset carries a severity, so
  //    the four segments sum to tr.total and the ring reads as a full circle) ──
  var severityDonut = buildDonutSVG([
    { count: s.critical, color: "#DC2626", label: "Past Service Life" },
    { count: s.high,     color: "#EA580C", label: "Out of Support"    },
    { count: s.elevated, color: "#D97706", label: "Support Expiring"  },
    { count: s.none,     color: "#16A34A", label: "Within Support"    }
  ], tr.total);

  var donutLegend = [
    sevLegendRow("#DC2626", "Past Service Life", s.critical, tr.total),
    sevLegendRow("#EA580C", "Out of Support",    s.high,     tr.total),
    sevLegendRow("#D97706", "Support Expiring",  s.elevated, tr.total),
    sevLegendRow("#16A34A", "Within Support",    s.none,     tr.total)
  ].join("");

  // ── Refresh timeline: how the estate splits into now / soon / healthy ──
  var nowN     = tr.refreshNow.length;
  var soonN    = tr.refreshSoon.length;
  var healthyN = Math.max(tr.total - nowN - soonN, 0);
  var seg = function(count, color) {
    if (count === 0) return "";
    return "<div style=\"width:" + pct(count, tr.total) + "%;background:" + color + "\"></div>";
  };
  var timelineBar =
    "<div style=\"display:flex;height:14px;border-radius:7px;overflow:hidden;background:var(--bg4)\">" +
      seg(nowN, "#DC2626") + seg(soonN, "#D97706") + seg(healthyN, "#16A34A") +
    "</div>";

  var waveChart = buildColumnChart(refreshWaveBuckets(tr));

  return [
    "<div class=\"rpt-sh\">Lifecycle Summary</div>",
    "<div class=\"rpt-g5\">" + kpiGrid + "</div>",
    "<div class=\"rpt-obs-bar\">",
      tr.atRiskTotal === 0
        ? "All tracked assets are within their vendor support window. No immediate refresh action required."
        : esc(tr.refreshNow.length + " asset" + (tr.refreshNow.length !== 1 ? "s" : "") +
            " need immediate refresh (out of support or past end of service life); " +
            tr.refreshSoon.length + " more " + (tr.refreshSoon.length === 1 ? "is" : "are") +
            " approaching end of support within the next 12 months."),
    "</div>",

    "<div class=\"rpt-sh\">Lifecycle Health Mix</div>",
    "<div class=\"rpt-g2\">",

      // Severity donut card
      "<div class=\"rpt-card\">",
        "<div class=\"rpt-ct\">Estate by Lifecycle Status</div>",
        "<div class=\"rpt-dw\">",
          "<div class=\"rpt-dc\">",
            severityDonut,
            "<div class=\"rpt-dh\"><div class=\"rpt-dv\">" + tr.total + "</div><div class=\"rpt-dl2\">Assets</div></div>",
          "</div>",
          "<div class=\"rpt-dl3\">" + donutLegend + "</div>",
        "</div>",
      "</div>",

      // Refresh timeline card
      "<div class=\"rpt-card\">",
        "<div class=\"rpt-ct\">Refresh Timeline</div>",
        timelineBar,
        "<div style=\"display:flex;gap:16px;margin-top:14px\">",
          tlStat("#DC2626", "Refresh Now",  nowN),
          tlStat("#D97706", "Refresh Soon", soonN),
          tlStat("#16A34A", "Healthy",      healthyN),
        "</div>",
        "<div class=\"rpt-ct\" style=\"margin-top:22px\">Refresh Waves by Year</div>",
        waveChart,
      "</div>",

    "</div>"
  ].join("\n");
}

// Severity legend row — mirrors the donut colours next to a count + share.
function sevLegendRow(color, name, count, total) {
  var p = total ? Math.round((count / total) * 100) : 0;
  return "<div class=\"rpt-li\">" +
    "<span class=\"rpt-ld\" style=\"background:" + color + "\"></span>" +
    "<span class=\"rpt-ln\">" + esc(name) + "</span>" +
    "<span class=\"rpt-lp\">" + count + "</span>" +
    "<span class=\"rpt-lpct\">" + p + "%</span>" +
  "</div>";
}

// Big-number stat used under the refresh-timeline bar.
function tlStat(color, label, value) {
  return "<div style=\"flex:1\">" +
    "<div style=\"font-size:22px;font-weight:800;line-height:1;color:" + color + "\">" + value + "</div>" +
    "<div style=\"font-size:11px;color:var(--tx3);margin-top:3px\">" + esc(label) + "</div>" +
  "</div>";
}

// Group at-risk assets into refresh "waves" by the year their earliest
// lifecycle boundary lands, so sales can see when demand clusters. Anything
// already past its date rolls into "Overdue"; years beyond +3 roll into a
// single "later" bucket.
function refreshWaveBuckets(tr) {
  var now     = tr.referenceDate || new Date();
  var nowYear = now.getFullYear();
  var order   = ["Overdue"];
  var counts  = { Overdue: 0 };
  var laterKey = (nowYear + 3) + "+";
  for (var y = nowYear; y <= nowYear + 3; y++) { order.push(String(y)); counts[String(y)] = 0; }
  order.push(laterKey); counts[laterKey] = 0;

  tr.rows.forEach(function(r) {
    if (r.severity === "none") return;
    var ds = r.endOfSupportDate || r.endOfServiceLifeDate;
    if (!ds) { counts.Overdue++; return; }
    var d = new Date(ds + "T00:00:00");
    if (d.getTime() < now.getTime()) { counts.Overdue++; return; }
    var y = d.getFullYear();
    if (y > nowYear + 3) counts[laterKey]++;
    else counts[String(y)]++;
  });

  return order
    .filter(function(k) { return counts[k] > 0; })
    .map(function(k) {
      return {
        label: k,
        value: counts[k],
        color: k === "Overdue" ? "#DC2626" : (k === String(nowYear) ? "#EA580C" : "#0076CE")
      };
    });
}

// Compact vertical column chart (self-contained inline styles — no report CSS
// dependency). bars: [{ label, value, color }].
function buildColumnChart(bars) {
  if (!bars || bars.length === 0) {
    return "<div class=\"rpt-empty\">No upcoming refreshes.</div>";
  }
  var max = bars.reduce(function(m, b) { return Math.max(m, b.value); }, 1);
  var cols = bars.map(function(b) {
    var h = Math.max(Math.round((b.value / max) * 100), 4);
    return [
      "<div style=\"flex:1;display:flex;flex-direction:column;align-items:center;gap:6px\">",
        "<div style=\"font-size:12px;font-weight:700;font-family:'JetBrains Mono',monospace;color:var(--tx1)\">" + b.value + "</div>",
        "<div style=\"width:100%;max-width:46px;height:110px;display:flex;align-items:flex-end\">",
          "<div style=\"width:100%;height:" + h + "%;background:" + b.color + ";border-radius:5px 5px 0 0\"></div>",
        "</div>",
        "<div style=\"font-size:10px;color:var(--tx3);text-align:center;line-height:1.2\">" + esc(b.label) + "</div>",
      "</div>"
    ].join("");
  }).join("");
  return "<div style=\"display:flex;align-items:flex-end;gap:12px;padding:8px 0;min-height:160px\">" + cols + "</div>";
}

function buildTechRefreshRoadmap(tr) {
  if (tr.rows.length === 0) {
    return "<div class=\"rpt-sh\">Refresh Roadmap</div><div class=\"rpt-card rpt-empty\">No current-state assets to assess.</div>";
  }
  var sevCls = { critical: "high", high: "high", elevated: "medium", none: "low" };
  var sevLabel = { critical: "Critical", high: "High", elevated: "Elevated", none: "OK" };

  var body = tr.rows.map(function(r) {
    var timing = r.eosDays !== null
      ? (Math.abs(r.eosDays) + "d " + (r.eosDays < 0 ? "ago" : "out"))
      : "—";
    return [
      "<tr>",
        "<td class=\"rpt-fw6\">" + esc(r.label) + "</td>",
        "<td>" + esc(r.envLabel) + "</td>",
        "<td>" + esc(r.layerLabel) + "</td>",
        "<td>" + esc(r.vendor) + "</td>",
        "<td>" + esc(r.endOfSupportDate || "—") + "</td>",
        "<td>" + esc(r.endOfServiceLifeDate || "—") + "</td>",
        "<td>" + esc(timing) + "</td>",
        "<td><span class=\"rpt-urg rpt-urg-" + sevCls[r.severity] + "\">" + esc(sevLabel[r.severity]) + "</span></td>",
        "<td>" + esc(r.action) + "</td>",
      "</tr>"
    ].join("");
  }).join("");

  return [
    "<div class=\"rpt-sh\">Refresh Roadmap</div>",
    "<div class=\"rpt-tbl-wrap\">",
      "<table class=\"rpt-at\">",
        "<thead><tr>",
          "<th>Asset</th><th>Environment</th><th>Layer</th><th>Vendor</th>",
          "<th>End of Support</th><th>End of Service Life</th><th>Timing</th><th>Risk</th><th>Recommended Action</th>",
        "</tr></thead>",
        "<tbody>" + body + "</tbody>",
      "</table>",
    "</div>"
  ].join("\n");
}

function buildTechRefreshBreakdown(tr) {
  var barRow = function(b) {
    var p = b.total ? Math.round((b.atRisk / b.total) * 100) : 0;
    var col = p >= 66 ? "#DC2626" : p >= 33 ? "#D97706" : "#16A34A";
    return [
      "<div class=\"rpt-hbl-row\">",
        "<div class=\"rpt-hbl-meta\">",
          "<span class=\"rpt-hbl-name\">" + esc(b.label) + "</span>",
          "<span class=\"rpt-hbl-ct\">" + b.atRisk + " / " + b.total + " at risk</span>",
        "</div>",
        "<div class=\"rpt-hbt\">",
          "<div class=\"rpt-hbf\" style=\"width:" + p + "%;background:" + col + "\"></div>",
        "</div>",
      "</div>"
    ].join("");
  };

  // ── Refresh demand by vendor: which vendors' gear is aging out. Bars are
  //    scaled to the busiest vendor (absolute counts), so the biggest refresh
  //    opportunities read at a glance. ──
  var vendorAtRisk = {};
  tr.rows.forEach(function(r) {
    if (r.severity === "none") return;
    var v = r.vendor || "—";
    vendorAtRisk[v] = (vendorAtRisk[v] || 0) + 1;
  });
  var vendorRows = Object.keys(vendorAtRisk)
    .map(function(k) { return { label: k, atRisk: vendorAtRisk[k] }; })
    .sort(function(a, b) { return b.atRisk - a.atRisk; })
    .slice(0, 8);
  var vendorMax = vendorRows.reduce(function(m, v) { return Math.max(m, v.atRisk); }, 1);
  var vendorBars = vendorRows.map(function(v) {
    var p = Math.round((v.atRisk / vendorMax) * 100);
    return [
      "<div class=\"rpt-hbl-row\">",
        "<div class=\"rpt-hbl-meta\">",
          "<span class=\"rpt-hbl-name\">" + esc(v.label) + "</span>",
          "<span class=\"rpt-hbl-ct\">" + v.atRisk + " asset" + (v.atRisk !== 1 ? "s" : "") + " at risk</span>",
        "</div>",
        "<div class=\"rpt-hbt\">",
          "<div class=\"rpt-hbf\" style=\"width:" + p + "%;background:#EA580C\"></div>",
        "</div>",
      "</div>"
    ].join("");
  }).join("");

  return [
    "<div class=\"rpt-sh\">Aging by Layer &amp; Environment</div>",
    "<div class=\"rpt-g2\">",
      "<div class=\"rpt-card\">",
        "<div class=\"rpt-ct\">Lifecycle Risk by Layer</div>",
        "<div class=\"rpt-hbl\">" + (tr.byLayer.map(barRow).join("") || "<div class=\"rpt-empty\">No data.</div>") + "</div>",
      "</div>",
      "<div class=\"rpt-card\">",
        "<div class=\"rpt-ct\">Lifecycle Risk by Environment</div>",
        "<div class=\"rpt-hbl\">" + (tr.byEnvironment.map(barRow).join("") || "<div class=\"rpt-empty\">No data.</div>") + "</div>",
      "</div>",
    "</div>",

    "<div class=\"rpt-sh\">Refresh Demand by Vendor</div>",
    "<div class=\"rpt-card\">",
      "<div class=\"rpt-ct\">Assets at Lifecycle Risk by Vendor</div>",
      "<div class=\"rpt-hbl\">" + (vendorBars || "<div class=\"rpt-empty\">No assets at lifecycle risk.</div>") + "</div>",
    "</div>"
  ].join("\n");
}

function buildHead(customerName, reportLabel) {
  var label = reportLabel || "Infrastructure Assessment Report";
  return [
    "<head>",
    "<meta charset=\"UTF-8\">",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">",
    "<title>" + esc(customerName) + " – " + esc(label) + "</title>",
    "<link href=\"https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap\" rel=\"stylesheet\">",
    "<style>",
    buildCSS(),
    "</style>",
    "</head>"
  ].join("\n");
}

function buildHeader(customerName, cust, total, dell, nonDell, gapCount, dateStr) {
  var dellPct = pct(dell, total);
  var nonPct  = pct(nonDell, total);
  var vertical = (cust.vertical && cust.vertical !== "—") ? " · " + esc(cust.vertical) : "";
  var region   = (cust.region   && cust.region   !== "—") ? " · " + esc(cust.region)   : "";

  return [
    "<header class=\"rpt-hdr\">",
      "<div class=\"rpt-hdr-inner\">",
        "<div class=\"rpt-hdr-left\">",
          "<div class=\"rpt-eyebrow\">Discovery Canvas · Infrastructure Assessment Report</div>",
          "<h1 class=\"rpt-title\">" + esc(customerName) + "</h1>",
          "<div class=\"rpt-sub\">Prepared by Dell Technologies · " + esc(dateStr) + vertical + region + "</div>",
        "</div>",
        "<div class=\"rpt-kpis\">",
          rptKpi(total,    "Total Assets",     "info"),
          rptKpi(dell,     "Dell Assets · " + dellPct + "%", "ok"),
          rptKpi(nonDell,  "Non-Dell · " + nonPct + "%",     "warn"),
          rptKpi(gapCount, "Gaps Identified",  "info"),
        "</div>",
      "</div>",
    "</header>"
  ].join("\n");
}

function buildTabNav() {
  var tabs = [
    ["ov", "Overview"],
    ["env", "Environments"],
    ["as", "Asset Inventory"],
    ["hm", "Heatmap"],
    ["rk", "Risks & Gaps"],
    ["rm", "Roadmap"],
    ["br", "Session Brief"]
  ];
  var btns = tabs.map(function(t, i) {
    return "<button class=\"rpt-tb" + (i === 0 ? " on" : "") + "\" data-t=\"" + t[0] + "\">" +
      "<span class=\"rpt-ti\">" + (i + 1) + "</span>" + esc(t[1]) + "</button>";
  });
  return "<nav class=\"rpt-tabs\">" + btns.join("") + "</nav>";
}

// ── Overview panel ────────────────────────────────────────────────────────

function buildOverviewPanel(instances, dellCount, nonDellCount, customCount, totalCount, vendorLabels, vendorsByEnv, visibleEnvs, drivers, coverage, risk) {
  var dellPct  = pct(dellCount, totalCount);
  var nonPct   = pct(nonDellCount, totalCount);
  var custPct  = pct(customCount, totalCount);

  // Donut segments (SVG)
  var donutSegs = buildDonutSVG([
    { count: dellCount,    color: "#0076CE", label: "Dell Technologies" },
    { count: nonDellCount, color: "#6B7A90", label: "Other vendors"    },
    { count: customCount,  color: "#f59e0b", label: "Custom / in-house" }
  ], totalCount);

  // Per-environment stacked bars
  var envBars = visibleEnvs.map(function(env) {
    var ed = vendorsByEnv[env.id] || { dell: 0, nonDell: 0, custom: 0, total: 0 };
    var t  = ed.total || 1;
    return [
      "<div class=\"rpt-sbr\">",
        "<div class=\"rpt-sbrl\">" + esc(env.label) + " <span class=\"rpt-sbrl-ct\">(" + ed.total + ")</span></div>",
        "<div class=\"rpt-sbt\">",
          "<div class=\"rpt-ss rpt-ss-dell\"  style=\"width:" + pct(ed.dell,    t) + "%\"></div>",
          "<div class=\"rpt-ss rpt-ss-nd\"    style=\"width:" + pct(ed.nonDell, t) + "%\"></div>",
          "<div class=\"rpt-ss rpt-ss-cust\"  style=\"width:" + pct(ed.custom,  t) + "%\"></div>",
        "</div>",
        "<span class=\"rpt-sbpct\">" + pct(ed.dell, t) + "%</span>",
      "</div>"
    ].join("");
  }).join("");

  // Vendor legend list
  var vendorLegend = buildVendorLegendList(instances, vendorLabels);

  // Layer breakdown bars
  var layerBars = LAYERS.map(function(layer) {
    var layerInsts = instances.filter(function(i) { return i.layerId === layer.id; });
    var d = layerInsts.filter(function(i) { return i.vendorGroup === "dell";    }).length;
    var n = layerInsts.filter(function(i) { return i.vendorGroup === "nonDell"; }).length;
    var c = layerInsts.filter(function(i) { return i.vendorGroup === "custom";  }).length;
    var t = layerInsts.length || 1;
    if (layerInsts.length === 0) return "";
    return [
      "<div class=\"rpt-hbl-row\">",
        "<div class=\"rpt-hbl-meta\">",
          "<span class=\"rpt-hbl-name\">" + esc(layer.label) + "</span>",
          "<span class=\"rpt-hbl-ct\">" + layerInsts.length + " instances</span>",
        "</div>",
        "<div class=\"rpt-hbt\">",
          "<div class=\"rpt-hbf\" style=\"width:" + pct(d + n + c, instances.length) + "%;background:#0076CE\"></div>",
        "</div>",
      "</div>"
    ].join("");
  }).join("");

  // Driver chips
  var driverChips = drivers.map(function(d) {
    var meta = BUSINESS_DRIVERS.find(function(bd) { return bd.id === d.id; });
    var label = meta ? meta.label : d.id;
    return "<span class=\"rpt-driver-chip\">" + esc(label) +
      " <span class=\"rpt-pri rpt-pri-" + (d.priority || "medium").toLowerCase() + "\">" +
      esc(d.priority || "Medium") + "</span></span>";
  }).join(" ");

  // KPI grid
  var kpiGrid = [
    rptKpiCard(dellCount,    "Dell Instances",    dellPct + "% of estate",    "#0076CE"),
    rptKpiCard(nonDellCount, "Non-Dell",          nonPct  + "% of estate",    "#6B7A90"),
    rptKpiCard(customCount,  "Custom / In-house", custPct + "% of estate",    "#f59e0b"),
    rptKpiCard(coverage.percent + "%", "Discovery Coverage", coverageHint(coverage), coverageCls(coverage.percent)),
    rptKpiCard(risk.level,   "Risk Posture",      risk.actions[0] || "See Risks tab", riskColour(risk.level))
  ].join("");

  return [
    "<div id=\"pov\" class=\"rpt-pnl on\">",

    "<div class=\"rpt-sh\">Key Metrics</div>",
    "<div class=\"rpt-g5\">" + kpiGrid + "</div>",

    "<div class=\"rpt-sh\">Asset Distribution</div>",
    "<div class=\"rpt-g2\">",

      // Donut card
      "<div class=\"rpt-card\">",
        "<div class=\"rpt-ct\">Vendor Mix</div>",
        "<div class=\"rpt-dw\">",
          "<div class=\"rpt-dc\">",
            donutSegs,
            "<div class=\"rpt-dh\"><div class=\"rpt-dv\">" + totalCount + "</div><div class=\"rpt-dl2\">Assets</div></div>",
          "</div>",
          "<div class=\"rpt-dl3\">",
            "<div class=\"rpt-li\"><span class=\"rpt-ld\" style=\"background:#0076CE\"></span><span class=\"rpt-ln\">Dell Technologies</span><span class=\"rpt-lp\">" + dellCount + "</span><span class=\"rpt-lpct\">" + dellPct + "%</span></div>",
            "<div class=\"rpt-li\"><span class=\"rpt-ld\" style=\"background:#6B7A90\"></span><span class=\"rpt-ln\">Other Vendors</span><span class=\"rpt-lp\">" + nonDellCount + "</span><span class=\"rpt-lpct\">" + nonPct + "%</span></div>",
            "<div class=\"rpt-li\"><span class=\"rpt-ld\" style=\"background:#f59e0b\"></span><span class=\"rpt-ln\">Custom / In-house</span><span class=\"rpt-lp\">" + customCount + "</span><span class=\"rpt-lpct\">" + custPct + "%</span></div>",
            vendorLegend,
          "</div>",
        "</div>",
      "</div>",

      // Stacked bars card
      "<div class=\"rpt-card\">",
        "<div class=\"rpt-ct\">Dell vs Non-Dell by Environment</div>",
        "<div class=\"rpt-sbl\">",
          "<div class=\"rpt-sbi\"><div class=\"rpt-sbd rpt-sbd-dell\"></div>Dell</div>",
          "<div class=\"rpt-sbi\"><div class=\"rpt-sbd rpt-sbd-nd\"></div>Non-Dell</div>",
          "<div class=\"rpt-sbi\"><div class=\"rpt-sbd rpt-sbd-cust\"></div>Custom</div>",
        "</div>",
        envBars || "<div class=\"rpt-empty\">No environments configured.</div>",
        "<div class=\"rpt-ct\" style=\"margin-top:20px\">Instance Spread by Architecture Layer</div>",
        "<div class=\"rpt-hbl\">" + (layerBars || "<div class=\"rpt-empty\">No instances yet.</div>") + "</div>",
      "</div>",

    "</div>",

    drivers.length > 0 ? [
      "<div class=\"rpt-sh\">Strategic Drivers</div>",
      "<div class=\"rpt-card\"><div class=\"rpt-drivers-row\">" + driverChips + "</div></div>"
    ].join("") : "",

    "</div>"  // end panel
  ].join("\n");
}

// ── Environments panel ────────────────────────────────────────────────────

function buildEnvironmentsPanel(visibleEnvs, instances, gaps) {
  if (visibleEnvs.length === 0) {
    return "<div id=\"penv\" class=\"rpt-pnl\"><div class=\"rpt-card rpt-empty\">No environments are active in this session.</div></div>";
  }

  var cards = visibleEnvs.map(function(env) {
    var envInsts = instances.filter(function(i) { return i.environmentId === env.id; });
    var curInsts = envInsts.filter(function(i) { return i.state === "current"; });
    var desInsts = envInsts.filter(function(i) { return i.state === "desired"; });
    var dellInsts = envInsts.filter(function(i) { return i.vendorGroup === "dell"; });
    var ndInsts   = envInsts.filter(function(i) { return i.vendorGroup !== "dell"; });
    var envGaps  = gaps.filter(function(g) {
      return (g.affectedEnvironments || []).indexOf(env.id) >= 0;
    });
    var highGaps = envGaps.filter(function(g) { return g.urgency === "High" && g.status !== "closed"; });

    // Group current instances by layer for display
    var byLayer = {};
    LAYERS.forEach(function(l) { byLayer[l.id] = []; });
    curInsts.forEach(function(i) {
      if (!byLayer[i.layerId]) byLayer[i.layerId] = [];
      byLayer[i.layerId].push(i);
    });

    var layerRows = LAYERS.map(function(l) {
      var list = byLayer[l.id] || [];
      if (list.length === 0) return "";
      var items = list.slice(0, 5).map(function(i) {
        var vgCls = i.vendorGroup === "dell" ? "vgd" : i.vendorGroup === "nonDell" ? "vgn" : "vgc";
        return "<div class=\"rpt-al-row\"><span class=\"rpt-vbadge " + vgCls + "\">" +
          esc(i.vendor || "Unknown") + "</span><span class=\"rpt-al-label\">" +
          esc(i.label || "(unnamed)") + "</span></div>";
      }).join("");
      var more = list.length > 5 ? "<div class=\"rpt-more\">+" + (list.length - 5) + " more</div>" : "";
      return [
        "<div class=\"rpt-env-layer\">",
          "<div class=\"rpt-env-layer-title\">" + esc(l.label) + "</div>",
          items, more,
        "</div>"
      ].join("");
    }).join("");

    var observations = buildEnvObservations(env, envInsts, envGaps, dellInsts, ndInsts);

    return [
      "<div class=\"rpt-env-card\">",
        "<div class=\"rpt-env-hdr\">",
          "<h3 class=\"rpt-env-name\">" + esc(env.label) + "</h3>",
          (env.location ? "<div class=\"rpt-env-loc\">📍 " + esc(env.location) + "</div>" : ""),
        "</div>",
        "<div class=\"rpt-env-stats\">",
          "<div><div class=\"rpt-ssv\">" + curInsts.length + "</div><div class=\"rpt-ssl\">Current</div></div>",
          "<div><div class=\"rpt-ssv\">" + desInsts.length + "</div><div class=\"rpt-ssl\">Desired</div></div>",
          "<div><div class=\"rpt-ssv\" style=\"color:#0076CE\">" + dellInsts.length + "</div><div class=\"rpt-ssl\">Dell</div></div>",
          "<div><div class=\"rpt-ssv\" style=\"color:#6B7A90\">" + ndInsts.length + "</div><div class=\"rpt-ssl\">Non-Dell</div></div>",
          "<div><div class=\"rpt-ssv\" style=\"color:" + (highGaps.length > 0 ? "#DC2626" : "#16A34A") + "\">" + highGaps.length + "</div><div class=\"rpt-ssl\">High Gaps</div></div>",
        "</div>",
        layerRows || "<div class=\"rpt-empty\" style=\"padding:16px\">No current instances in this environment.</div>",
        observations ? "<div class=\"rpt-obs\">" + observations + "</div>" : "",
      "</div>"
    ].join("");
  });

  return [
    "<div id=\"penv\" class=\"rpt-pnl\">",
    "<div class=\"rpt-sh\">Environment Breakdown</div>",
    "<div class=\"rpt-envs-grid\">" + cards.join("") + "</div>",
    "</div>"
  ].join("\n");
}

// ── Asset inventory panel ────────────────────────────────────────────────

function buildAssetPanel(instances, visibleEnvs, totalCount, dellCount, nonDellCount) {
  var curInsts = instances.filter(function(i) { return i.state === "current"; });
  var desInsts = instances.filter(function(i) { return i.state === "desired"; });

  // Summary scorecard row
  var byLayer = {};
  LAYERS.forEach(function(l) {
    byLayer[l.id] = instances.filter(function(i) { return i.layerId === l.id; }).length;
  });

  var scorecards = LAYERS.filter(function(l) { return byLayer[l.id] > 0; }).map(function(l) {
    return [
      "<div class=\"rpt-sc-card\">",
        "<div class=\"rpt-sc-label\">" + esc(l.label) + "</div>",
        "<div class=\"rpt-sc-val\">" + byLayer[l.id] + "</div>",
        "<div class=\"rpt-sc-sub\">instances</div>",
      "</div>"
    ].join("");
  }).join("");

  // Build table rows grouped by environment
  var rows = [];
  visibleEnvs.forEach(function(env) {
    var envInsts = curInsts.filter(function(i) { return i.environmentId === env.id; });
    if (envInsts.length === 0) return;
    rows.push("<tr class=\"rpt-tbl-sep\"><td colspan=\"7\">" + esc(env.label) + "</td></tr>");
    envInsts.forEach(function(i) {
      var layer = LAYERS.find(function(l) { return l.id === i.layerId; });
      var vgCls = i.vendorGroup === "dell" ? "vgd" : i.vendorGroup === "nonDell" ? "vgn" : "vgc";
      var groupLabel = i.vendorGroup === "dell" ? "Dell" : i.vendorGroup === "nonDell" ? "Non-Dell" : "Custom";
      var statusCls = i.criticality === "High" ? "rpt-b rpt-b-c" : i.criticality === "Medium" ? "rpt-b rpt-b-w" : "rpt-b rpt-b-g";
      rows.push([
        "<tr>",
          "<td>" + esc(env.label) + "</td>",
          "<td>" + esc(layer ? layer.label : i.layerId) + "</td>",
          "<td><span class=\"rpt-vbadge " + vgCls + "\">" + esc(i.vendor || "—") + "</span></td>",
          "<td class=\"rpt-fw6\">" + esc(i.label || "(unnamed)") + "</td>",
          "<td><span class=\"" + statusCls + "\">" + esc(i.criticality || "Low") + "</span></td>",
          "<td>" + esc(i.disposition || "—") + "</td>",
          "<td class=\"rpt-muted\">" + esc((i.notes || "").slice(0, 60)) + "</td>",
        "</tr>"
      ].join(""));
    });
  });

  // Also show desired instances that have no current origin (new additions)
  var newDesired = desInsts.filter(function(i) { return !i.originId; });
  if (newDesired.length > 0) {
    rows.push("<tr class=\"rpt-tbl-sep\"><td colspan=\"7\">Desired — New Additions</td></tr>");
    newDesired.forEach(function(i) {
      var layer = LAYERS.find(function(l) { return l.id === i.layerId; });
      var vgCls = i.vendorGroup === "dell" ? "vgd" : i.vendorGroup === "nonDell" ? "vgn" : "vgc";
      rows.push([
        "<tr style=\"opacity:0.75\">",
          "<td>Desired</td>",
          "<td>" + esc(layer ? layer.label : i.layerId) + "</td>",
          "<td><span class=\"rpt-vbadge " + vgCls + "\">" + esc(i.vendor || "—") + "</span></td>",
          "<td class=\"rpt-fw6 rpt-italic\">" + esc(i.label || "(unnamed)") + "</td>",
          "<td><span class=\"rpt-b rpt-b-i\">" + esc(i.priority || "Next") + "</span></td>",
          "<td>" + esc(i.disposition || "introduce") + "</td>",
          "<td class=\"rpt-muted\">" + esc((i.notes || "").slice(0, 60)) + "</td>",
        "</tr>"
      ].join(""));
    });
  }

  return [
    "<div id=\"pas\" class=\"rpt-pnl\">",
    "<div class=\"rpt-sh\">Summary by Layer</div>",
    "<div class=\"rpt-sc-grid\">" + (scorecards || "<div class=\"rpt-empty\">No instances recorded.</div>") + "</div>",
    "<div class=\"rpt-sh\">Full Asset Inventory</div>",
    "<div class=\"rpt-tbl-wrap\">",
      "<table class=\"rpt-at\">",
        "<thead><tr>",
          "<th>Environment</th>",
          "<th>Layer</th>",
          "<th>Vendor</th>",
          "<th>Technology</th>",
          "<th>Criticality</th>",
          "<th>Disposition</th>",
          "<th>Notes</th>",
        "</tr></thead>",
        "<tbody>",
          rows.join("") || "<tr><td colspan=\"7\" class=\"rpt-empty\">No instances recorded yet.</td></tr>",
        "</tbody>",
      "</table>",
    "</div>",
    totalCount > 0 ? [
      "<div class=\"rpt-obs-bar\">",
        "<strong>Portfolio Headline:</strong> " + totalCount + " instances across " + visibleEnvs.length +
        " environment" + (visibleEnvs.length === 1 ? "" : "s") + " · " + dellCount +
        " Dell (" + pct(dellCount, totalCount) + "%) · " + nonDellCount +
        " Non-Dell (" + pct(nonDellCount, totalCount) + "%)",
      "</div>"
    ].join("") : "",
    "</div>"
  ].join("\n");
}

// ── Heatmap panel ────────────────────────────────────────────────────────

function buildHeatmapPanel(heatmapRows, visibleEnvs) {
  if (visibleEnvs.length === 0 || heatmapRows.length === 0) {
    return "<div id=\"phm\" class=\"rpt-pnl\"><div class=\"rpt-card rpt-empty\">No heatmap data available.</div></div>";
  }

  // Build grid: layers × envs
  var headerCells = ["<div class=\"rpt-hm-corner\">Layer</div>"];
  visibleEnvs.forEach(function(env) {
    headerCells.push("<div class=\"rpt-hm-envhdr\">" + esc(env.label) + "</div>");
  });

  var bodyRows = heatmapRows.map(function(row) {
    var cells = ["<div class=\"rpt-hm-layerlbl\">" + esc(row.layer.label) + "</div>"];
    row.cells.forEach(function(cell) {
      cells.push([
        "<div class=\"rpt-hm-cell rpt-hm-" + cell.cls + "\">",
          "<div class=\"rpt-hm-cell-label\">" + esc(cell.label) + "</div>",
          "<div class=\"rpt-hm-cell-ct\">" + cell.currentCount + " cur · " + cell.gapCount + " gap</div>",
        "</div>"
      ].join(""));
    });
    return "<div class=\"rpt-hm-row\">" + cells.join("") + "</div>";
  });

  // Legend
  var legend = [
    "<div class=\"rpt-hm-legend\">",
      "<span class=\"rpt-hm-leg rpt-hm-bucket-empty\">No data</span>",
      "<span class=\"rpt-hm-leg rpt-hm-bucket-low\">Stable</span>",
      "<span class=\"rpt-hm-leg rpt-hm-bucket-med\">Moderate</span>",
      "<span class=\"rpt-hm-leg rpt-hm-bucket-high\">High risk</span>",
    "</div>"
  ].join("");

  return [
    "<div id=\"phm\" class=\"rpt-pnl\">",
    "<div class=\"rpt-sh\">Risk Heatmap — Layer × Environment</div>",
    legend,
    "<div class=\"rpt-card\" style=\"overflow-x:auto\">",
      "<div class=\"rpt-hm-grid\" style=\"grid-template-columns:160px repeat(" + visibleEnvs.length + ",1fr)\">",
        headerCells.join(""),
        bodyRows.join(""),
      "</div>",
    "</div>",
    "</div>"
  ].join("\n");
}

// ── Risks & Gaps panel ───────────────────────────────────────────────────

function buildRisksPanel(gaps, highGaps, medGaps, nowHigh, instances, visibleEnvs) {
  // Risk cards
  var riskCards = buildRiskCards(gaps, highGaps, medGaps, instances);

  // Lifecycle risk (end of sale / support / service life)
  var lifecyclePanel = buildLifecycleRiskSection(instances, visibleEnvs);

  // Data quality gaps
  var dqGaps = buildDataQualityGaps(instances, gaps);

  // Opportunity themes
  var hasBackup = instances.some(function(i) { return i.layerId === "dataProtection"; });
  var opportunities = buildOpportunities(highGaps, hasBackup, instances);

  // Gap table (Now phase, high urgency first)
  var sortedGaps = gaps.slice().sort(function(a, b) {
    var up = { "High": 3, "Medium": 2, "Low": 1 };
    var pp = { "now": 3, "next": 2, "later": 1 };
    if ((pp[b.phase] || 0) !== (pp[a.phase] || 0)) return (pp[b.phase] || 0) - (pp[a.phase] || 0);
    return (up[b.urgency] || 0) - (up[a.urgency] || 0);
  });

  var gapRows = sortedGaps.slice(0, 25).map(function(g) {
    var layer = LAYERS.find(function(l) { return l.id === g.layerId; });
    var urg = (g.urgency || "Low").toLowerCase();
    var phaseCls = g.phase === "now" ? "rpt-b rpt-b-c" : g.phase === "next" ? "rpt-b rpt-b-w" : "rpt-b rpt-b-g";
    return [
      "<tr>",
        "<td class=\"rpt-fw6\">" + esc(g.description || "(untitled)") + "</td>",
        "<td><span class=\"rpt-urg rpt-urg-" + urg + "\">" + esc(g.urgency || "Low") + "</span></td>",
        "<td><span class=\"" + phaseCls + "\">" + esc(g.phase || "now") + "</span></td>",
        "<td>" + esc(layer ? layer.label : (g.layerId || "—")) + "</td>",
        "<td>" + esc(g.gapType || "—") + "</td>",
        "<td><span class=\"rpt-status rpt-status-" + (g.status || "open") + "\">" + esc(g.status || "open") + "</span></td>",
      "</tr>"
    ].join("");
  }).join("");

  return [
    "<div id=\"prk\" class=\"rpt-pnl\">",
    "<div class=\"rpt-sh\">Confirmed Risks</div>",
    riskCards || "<div class=\"rpt-card rpt-empty\">No high-risk items identified.</div>",
    lifecyclePanel,
    dqGaps.length > 0 ? [
      "<div class=\"rpt-sh\">Data Quality Gaps</div>",
      "<div class=\"rpt-card\">" + dqGaps.map(function(d) {
        return "<div class=\"rpt-gi\"><div class=\"rpt-gd\"></div><div>" + esc(d) + "</div></div>";
      }).join("") + "</div>"
    ].join("") : "",
    "<div class=\"rpt-sh\">Opportunity Themes</div>",
    "<div class=\"rpt-opp-grid\">" + opportunities + "</div>",
    gaps.length > 0 ? [
      "<div class=\"rpt-sh\">All Gaps</div>",
      "<div class=\"rpt-tbl-wrap\">",
        "<table class=\"rpt-at\">",
          "<thead><tr>",
            "<th>Description</th><th>Urgency</th><th>Phase</th><th>Layer</th><th>Type</th><th>Status</th>",
          "</tr></thead>",
          "<tbody>" + (gapRows || "<tr><td colspan=\"6\" class=\"rpt-empty\">No gaps defined.</td></tr>") + "</tbody>",
        "</table>",
      "</div>",
      sortedGaps.length > 25 ? "<div class=\"rpt-obs-bar\">Showing top 25 of " + sortedGaps.length + " gaps.</div>" : "",
    ].join("") : "",
    "</div>"
  ].join("\n");
}

// ── Roadmap panel ────────────────────────────────────────────────────────

function buildRoadmapPanel(projects, nowCount, nextCount, laterCount, drivers) {
  if (projects.length === 0) {
    return [
      "<div id=\"prm\" class=\"rpt-pnl\">",
        "<div class=\"rpt-sh\">Roadmap</div>",
        "<div class=\"rpt-card rpt-empty\">No projects derived yet. Complete the Gaps step to populate the roadmap.</div>",
      "</div>"
    ].join("");
  }

  // Pulse bar
  var pulse = [
    "<div class=\"rpt-card rpt-pulse\">",
      "<div class=\"rpt-pulse-row\">",
        pulseStat(projects.length, "Projects"),
        pulseStat(nowCount,   "Now"),
        pulseStat(nextCount,  "Next"),
        pulseStat(laterCount, "Later"),
      "</div>",
    "</div>"
  ].join("");

  // Phase columns
  var phases = [
    { id: "now",   label: "Now",   subtitle: "0–12 months",   cls: "rpt-phase-now"   },
    { id: "next",  label: "Next",  subtitle: "12–24 months",  cls: "rpt-phase-next"  },
    { id: "later", label: "Later", subtitle: "> 24 months",   cls: "rpt-phase-later" }
  ];

  // Group projects by driver
  var driverIds = drivers.map(function(d) { return d.id; });
  var byDriver = {};
  driverIds.forEach(function(did) { byDriver[did] = []; });
  byDriver["unassigned"] = [];
  projects.forEach(function(p) {
    if (p.driverId && byDriver[p.driverId]) {
      byDriver[p.driverId].push(p);
    } else {
      byDriver["unassigned"].push(p);
    }
  });

  // Build phase cards
  var phaseCols = phases.map(function(ph) {
    var phProjects = projects.filter(function(p) { return p.phase === ph.id; });
    var cards = phProjects.map(function(p) {
      var urgCls = "rpt-urg-" + (p.urgency || "low").toLowerCase();
      var sols = (p.dellSolutions && p.dellSolutions.length)
        ? "<div class=\"rpt-proj-sols\">" +
            p.dellSolutions.slice(0, 3).map(function(s) {
              return "<span class=\"rpt-sol-chip\">" + esc(s) + "</span>";
            }).join("") +
          "</div>"
        : "<div class=\"rpt-proj-unmapped\">No Dell solutions mapped yet</div>";
      return [
        "<div class=\"rpt-proj-card\">",
          "<div class=\"rpt-proj-head\">",
            "<div class=\"rpt-proj-name\">" + esc(p.name) + "</div>",
            "<div class=\"rpt-proj-badges\">",
              "<span class=\"rpt-urg " + urgCls + "\">" + esc(p.urgency || "Low") + "</span>",
              "<span class=\"rpt-link-badge\">" + p.gapCount + " gap" + (p.gapCount === 1 ? "" : "s") + "</span>",
            "</div>",
          "</div>",
          sols,
        "</div>"
      ].join("");
    }).join("");

    return [
      "<div class=\"" + ph.cls + "\">",
        "<div class=\"rpt-phase-hdr\">",
          "<span class=\"rpt-phase-label\">" + ph.label + "</span>",
          "<span class=\"rpt-phase-sub\">" + ph.subtitle + "</span>",
          "<span class=\"rpt-phase-ct\">" + phProjects.length + " project" + (phProjects.length === 1 ? "" : "s") + "</span>",
        "</div>",
        cards || "<div class=\"rpt-phase-empty\">No projects in this phase</div>",
      "</div>"
    ].join("");
  });

  // Priority summary table per driver
  var driverSummary = drivers.length > 0 ? [
    "<div class=\"rpt-sh\">By Strategic Driver</div>",
    "<div class=\"rpt-tbl-wrap\">",
      "<table class=\"rpt-at\">",
        "<thead><tr><th>Driver</th><th>Priority</th><th>Now</th><th>Next</th><th>Later</th><th>Total</th></tr></thead>",
        "<tbody>",
        drivers.map(function(d) {
          var meta = BUSINESS_DRIVERS.find(function(bd) { return bd.id === d.id; });
          var label = meta ? meta.label : d.id;
          var dp = byDriver[d.id] || [];
          var n  = dp.filter(function(p) { return p.phase === "now"; }).length;
          var nx = dp.filter(function(p) { return p.phase === "next"; }).length;
          var l  = dp.filter(function(p) { return p.phase === "later"; }).length;
          return [
            "<tr>",
              "<td class=\"rpt-fw6\">" + esc(label) + "</td>",
              "<td><span class=\"rpt-pri rpt-pri-" + (d.priority || "medium").toLowerCase() + "\">" + esc(d.priority || "Medium") + "</span></td>",
              "<td>" + n + "</td>",
              "<td>" + nx + "</td>",
              "<td>" + l + "</td>",
              "<td><strong>" + dp.length + "</strong></td>",
            "</tr>"
          ].join("");
        }).join(""),
        "</tbody>",
      "</table>",
    "</div>"
  ].join("") : "";

  return [
    "<div id=\"prm\" class=\"rpt-pnl\">",
    "<div class=\"rpt-sh\">Portfolio Pulse</div>",
    pulse,
    "<div class=\"rpt-sh\">Phased Project Plan</div>",
    "<div class=\"rpt-phases-grid\">" + phaseCols.join("") + "</div>",
    driverSummary,
    "</div>"
  ].join("\n");
}

// ── Session Brief panel ──────────────────────────────────────────────────

function buildBriefPanel(brief, coverage, risk, summary) {
  var coveragePct = coverage.percent;
  var coverageCl  = coveragePct >= 75 ? "ok" : coveragePct >= 40 ? "warn" : "crit";
  var riskCl      = riskColour(risk.level).replace("var(--", "").replace(")", "");

  var statItems = [
    { v: summary.totalCurrent,  l: "Current technologies" },
    { v: summary.totalDesired,  l: "Desired technologies"  },
    { v: summary.totalGaps,     l: "Total gaps"            },
    { v: summary.highRiskGaps,  l: "High-urgency gaps"     }
  ];

  var statsHTML = statItems.map(function(s) {
    return [
      "<div class=\"rpt-stat\">",
        "<div class=\"rpt-stat-num\">" + s.v + "</div>",
        "<div class=\"rpt-stat-label\">" + esc(s.l) + "</div>",
      "</div>"
    ].join("");
  }).join("");

  var briefRows = brief.map(function(r) {
    return [
      "<div class=\"rpt-brief-row\">",
        "<div class=\"rpt-brief-label\">" + esc(r.label) + "</div>",
        "<div class=\"rpt-brief-text\">" + esc(r.text) + "</div>",
      "</div>"
    ].join("");
  }).join("");

  return [
    "<div id=\"pbr\" class=\"rpt-pnl\">",
    "<div class=\"rpt-sh\">Session Metrics</div>",
    "<div class=\"rpt-stats-row\">" + statsHTML + "</div>",
    "<div class=\"rpt-g2\" style=\"margin-top:16px\">",

      // Coverage card
      "<div class=\"rpt-card\">",
        "<div class=\"rpt-ct\">Discovery Coverage</div>",
        "<div class=\"rpt-cov-pct rpt-cov-" + coverageCl + "\">" + coveragePct + "%</div>",
        "<div class=\"rpt-cov-bar\"><div class=\"rpt-cov-fill rpt-cov-fill-" + coverageCl + "\" style=\"width:" + Math.max(2, coveragePct) + "%\"></div></div>",
        coverage.actions.length > 0 ? [
          "<ul class=\"rpt-cov-hints\">",
            coverage.actions.map(function(a) { return "<li>• " + esc(a) + "</li>"; }).join(""),
          "</ul>"
        ].join("") : "<div class=\"rpt-cov-ok\">Coverage complete — well done.</div>",
      "</div>",

      // Risk card
      "<div class=\"rpt-card\">",
        "<div class=\"rpt-ct\">Risk Posture</div>",
        "<div class=\"rpt-risk-pill rpt-risk-" + risk.level.toLowerCase() + "\">" + esc(risk.level) + "</div>",
        risk.actions.length > 0 ? [
          "<ul class=\"rpt-risk-hints\">",
            risk.actions.map(function(a) { return "<li>• " + esc(a) + "</li>"; }).join(""),
          "</ul>"
        ].join("") : "<div class=\"rpt-risk-ok\">Risk posture looks stable.</div>",
      "</div>",

    "</div>",
    "<div class=\"rpt-sh\" style=\"margin-top:24px\">Executive Brief</div>",
    "<div class=\"rpt-card\">",
      "<div class=\"rpt-ct\">Scannable roll-up — re-derives from coverage, risk, drivers, pipeline, and linked Dell solutions</div>",
      "<div class=\"rpt-brief\">" + (briefRows || "<div class=\"rpt-empty\">No data to brief yet.</div>") + "</div>",
    "</div>",
    "</div>"
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Data helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildVendorsByEnv(instances, visibleEnvs) {
  var out = {};
  visibleEnvs.forEach(function(env) {
    out[env.id] = { dell: 0, nonDell: 0, custom: 0, total: 0 };
  });
  instances.forEach(function(i) {
    if (!out[i.environmentId]) return;
    out[i.environmentId][i.vendorGroup === "dell" ? "dell" : i.vendorGroup === "nonDell" ? "nonDell" : "custom"]++;
    out[i.environmentId].total++;
  });
  return out;
}

function uniqueVendors(instances) {
  var seen = {};
  var out  = [];
  instances.forEach(function(i) {
    var v = (i.vendor || "").trim();
    if (v && !seen[v]) { seen[v] = true; out.push({ vendor: v, group: i.vendorGroup }); }
  });
  return out.sort(function(a, b) {
    // Dell first
    if (a.group === "dell" && b.group !== "dell") return -1;
    if (b.group === "dell" && a.group !== "dell") return 1;
    return a.vendor.localeCompare(b.vendor);
  });
}

function buildVendorLegendList(instances, vendorLabels) {
  if (vendorLabels.length === 0) return "";
  return [
    "<div style=\"margin-top:12px;border-top:1px solid #E4E8EE;padding-top:10px\">",
    vendorLabels.slice(0, 8).map(function(vl) {
      var cnt  = instances.filter(function(i) { return i.vendor === vl.vendor; }).length;
      var cls  = vl.group === "dell" ? "vgd" : vl.group === "nonDell" ? "vgn" : "vgc";
      return "<div class=\"rpt-li\"><span class=\"rpt-vbadge " + cls + "\" style=\"margin-right:4px\">" + esc(vl.vendor) + "</span><span class=\"rpt-lpct\">" + cnt + "</span></div>";
    }).join(""),
    vendorLabels.length > 8 ? "<div class=\"rpt-more\">+" + (vendorLabels.length - 8) + " more vendors</div>" : "",
    "</div>"
  ].join("");
}

function buildHeatmapData(session, visibleEnvs) {
  return LAYERS.map(function(layer) {
    var cells = visibleEnvs.map(function(env) {
      var m   = computeBucketMetrics(layer.id, env.id, session);
      var cls = scoreToClass(m.totalScore, m.hasData)
        .replace("bucket-empty", "bucket-empty")
        .replace("bucket-low",   "bucket-low")
        .replace("bucket-med",   "bucket-med")
        .replace("bucket-high",  "bucket-high");
      return {
        cls:          cls,
        label:        scoreToRiskLabel(m.totalScore, m.hasData),
        currentCount: m.current.length,
        gapCount:     m.gaps.length,
        score:        m.totalScore
      };
    });
    return { layer: layer, cells: cells };
  });
}

function buildEnvObservations(env, envInsts, envGaps, dellInsts, ndInsts) {
  var obs = [];
  if (ndInsts.length > 0) {
    var ndVendors = {};
    ndInsts.forEach(function(i) { if (i.vendor) ndVendors[i.vendor] = true; });
    var ndList = Object.keys(ndVendors).slice(0, 3).join(", ");
    obs.push("<strong>Non-Dell exposure:</strong> " + ndInsts.length + " instance" + (ndInsts.length !== 1 ? "s" : "") + (ndList ? " — " + esc(ndList) : "") + ".");
  }
  var hasDataProtection = envInsts.some(function(i) { return i.layerId === "dataProtection"; });
  if (!hasDataProtection && envInsts.length > 0) {
    obs.push("<strong>No data protection</strong> assets detected in this environment.");
  }
  var highGaps = envGaps.filter(function(g) { return g.urgency === "High" && g.status !== "closed"; });
  if (highGaps.length > 0) {
    obs.push("<strong>" + highGaps.length + " high-urgency gap" + (highGaps.length !== 1 ? "s" : "") + "</strong> require immediate attention.");
  }
  return obs.join("<br><br>");
}

function buildRiskCards(gaps, highGaps, medGaps, instances) {
  var cards = [];

  // Critical: no data protection
  var hasDataProt = instances.some(function(i) { return i.layerId === "dataProtection" && i.state === "current"; });
  if (!hasDataProt && instances.length > 0) {
    cards.push(riskCard("🚨", "c", "No Data Protection Platform Detected", "Critical · Confirmed",
      "No current-state data protection or backup assets were recorded. Any hardware failure, ransomware, or data corruption event has no recovery path. This is the highest-priority gap — deploy a data protection solution before any other refresh initiative."));
  }

  // High urgency gaps
  if (highGaps.length > 0) {
    cards.push(riskCard("⚠️", "c", highGaps.length + " High-Urgency Gap" + (highGaps.length !== 1 ? "s" : "") + " — Require Immediate Action", "High · Confirmed",
      "The following gaps are phase Now with High urgency: " + highGaps.slice(0, 3).map(function(g) { return '"' + esc(g.description || "untitled") + '"'; }).join("; ") + (highGaps.length > 3 ? " and " + (highGaps.length - 3) + " more." : ".")));
  }

  // Non-Dell concentration
  var ndInsts = instances.filter(function(i) { return i.vendorGroup === "nonDell" && i.state === "current"; });
  if (ndInsts.length > 0) {
    var ndVendors = {};
    ndInsts.forEach(function(i) { if (i.vendor) ndVendors[i.vendor] = (ndVendors[i.vendor] || 0) + 1; });
    var topVendors = Object.keys(ndVendors).sort(function(a, b) { return ndVendors[b] - ndVendors[a]; }).slice(0, 3);
    cards.push(riskCard("🔀", "w", ndInsts.length + " Non-Dell Instance" + (ndInsts.length !== 1 ? "s" : "") + " — Vendor Fragmentation Risk", "Medium · Confirmed",
      "Non-Dell assets (" + topVendors.map(function(v) { return esc(v) + ": " + ndVendors[v]; }).join(", ") + ") require separate support contracts, management frameworks, and operational overhead. Natural refresh cycles are the right moment to standardise on Dell."));
  }

  // Medium gaps
  if (medGaps.length > 2) {
    cards.push(riskCard("📋", "i", medGaps.length + " Medium-Urgency Gap" + (medGaps.length !== 1 ? "s" : "") + " in Pipeline", "Medium · Action Required",
      medGaps.length + " gaps are at Medium urgency. Review and assign these to strategic drivers in the Gaps tab to maintain momentum and prevent scope drift."));
  }

  // Dual hypervisor risk
  var virtInsts = instances.filter(function(i) { return i.layerId === "virtualization" && i.state === "current"; });
  if (virtInsts.length > 1) {
    var virtVendors = {};
    virtInsts.forEach(function(i) { virtVendors[i.vendor || "Unknown"] = true; });
    if (Object.keys(virtVendors).length > 1) {
      cards.push(riskCard("💻", "w", "Multiple Virtualisation Platforms Detected", "Medium · Confirmed",
        "More than one virtualisation vendor is in the current state: " + Object.keys(virtVendors).map(esc).join(", ") + ". Dual hypervisor environments prevent unified management, shared DR, and live workload migration between environments."));
    }
  }

  if (cards.length === 0) {
    cards.push("<div class=\"rpt-card\" style=\"color:#16A34A;padding:16px\">✓ No critical risks identified in the current data set. Continue building out the discovery to surface more.</div>");
  }

  return cards.join("");
}

// buildLifecycleRiskSection · table of current-state assets past or
// nearing end-of-support / end-of-service-life, using the same
// computeLifecycleRisk used to score the heatmap (buildHeatmapData) and
// auto-draft gaps (state/dispositionLogic.js syncLifecycleGapAction), so
// counts agree everywhere in the app.
function buildLifecycleRiskSection(instances, visibleEnvs) {
  var SEVERITY_RANK = { critical: 0, high: 1, elevated: 2 };
  var rows = [];
  instances.forEach(function(i) {
    if (i.state !== "current") return;
    var risk = computeLifecycleRisk(i);
    if (risk.severity === "none") return;
    rows.push({ instance: i, risk: risk });
  });
  if (rows.length === 0) return "";

  rows.sort(function(a, b) { return SEVERITY_RANK[a.risk.severity] - SEVERITY_RANK[b.risk.severity]; });

  var sevLabel = { critical: "Critical", high: "High", elevated: "Elevated" };
  var sevCls   = { critical: "high", high: "high", elevated: "medium" };

  var tableRows = rows.map(function(r) {
    var i = r.instance, risk = r.risk;
    var layer = LAYERS.find(function(l) { return l.id === i.layerId; });
    var env   = visibleEnvs.find(function(e) { return e.id === i.environmentId; });
    var dateNote = risk.days !== null ? (Math.abs(risk.days) + "d " + (risk.days < 0 ? "ago" : "out")) : "—";
    return [
      "<tr>",
        "<td class=\"rpt-fw6\">" + esc(i.label || "(unnamed)") + "</td>",
        "<td>" + esc(env ? env.label : "—") + "</td>",
        "<td>" + esc(layer ? layer.label : i.layerId) + "</td>",
        "<td><span class=\"rpt-urg rpt-urg-" + sevCls[risk.severity] + "\">" + esc(sevLabel[risk.severity]) + "</span></td>",
        "<td>" + esc(risk.reason) + "</td>",
        "<td>" + esc(dateNote) + "</td>",
      "</tr>"
    ].join("");
  }).join("");

  return [
    "<div class=\"rpt-sh\">Lifecycle Risk</div>",
    "<div class=\"rpt-tbl-wrap\">",
      "<table class=\"rpt-at\">",
        "<thead><tr>",
          "<th>Asset</th><th>Environment</th><th>Layer</th><th>Risk</th><th>Status</th><th>Timing</th>",
        "</tr></thead>",
        "<tbody>" + tableRows + "</tbody>",
      "</table>",
    "</div>"
  ].join("\n");
}

function buildDataQualityGaps(instances, gaps) {
  var dq = [];
  var unnamed = instances.filter(function(i) { return !i.label || !i.label.trim(); });
  if (unnamed.length > 0) dq.push(unnamed.length + " instance" + (unnamed.length !== 1 ? "s" : "") + " without a label — review in Tabs 2 and 3.");
  var noVendor = instances.filter(function(i) { return i.state === "current" && (!i.vendor || !i.vendor.trim()); });
  if (noVendor.length > 0) dq.push(noVendor.length + " current instance" + (noVendor.length !== 1 ? "s" : "") + " with no vendor recorded — required for accurate vendor analytics.");
  var unassigned = gaps.filter(function(g) { return !g.driverId; });
  if (unassigned.length > 0) dq.push(unassigned.length + " gap" + (unassigned.length !== 1 ? "s" : "") + " not assigned to a strategic driver — assign in Tab 4 to populate roadmap swimlanes.");
  var unreviewed = gaps.filter(function(g) { return g.reviewed === false && g.origin === "autoDraft"; });
  if (unreviewed.length > 0) dq.push(unreviewed.length + " auto-drafted gap" + (unreviewed.length !== 1 ? "s" : "") + " awaiting review — confirm or edit in Tab 4.");
  var noServiceTag = instances.filter(function(i) { return i.state === "current" && (!i.notes || !i.notes.trim()); });
  if (noServiceTag.length > 5) dq.push(noServiceTag.length + " current instances have no supporting notes — add lifecycle details, service tags, or version data for a richer report.");
  return dq;
}

function buildOpportunities(highGaps, hasBackup, instances) {
  var opps = [];
  if (!hasBackup && instances.length > 0) {
    opps.push(oppCard("💡", "Data Protection", "Deploy data protection immediately. Eliminate zero-backup risk before any other initiative proceeds.", "pb-h"));
  }
  var ndCount = instances.filter(function(i) { return i.vendorGroup !== "dell" && i.state === "current"; }).length;
  if (ndCount > 0) {
    opps.push(oppCard("🔄", "Vendor Consolidation", "Replace non-Dell assets and standardise on Dell PowerEdge, PowerStore, and PowerFlex to reduce management overhead and support contracts.", "pb-h"));
  }
  if (highGaps.length > 0) {
    opps.push(oppCard("🔥", "Address High-Priority Gaps", "Close " + highGaps.length + " high-urgency Now-phase gap" + (highGaps.length !== 1 ? "s" : "") + " to reduce risk posture and unblock downstream planning.", "pb-m"));
  }
  opps.push(oppCard("📊", "Simplify Architecture", "Rationalise multiple platforms per layer to a single Dell solution family. Reduces management layers, simplifies support, and lowers TCO.", "pb-m"));
  if (opps.length === 0) {
    opps.push(oppCard("✅", "Continue Discovery", "Good coverage. Continue refining the desired state and linking Dell solutions to each gap.", "pb-l"));
  }
  return "<div class=\"rpt-opp-row\">" + opps.slice(0, 4).join("") + "</div>";
}

// ─────────────────────────────────────────────────────────────────────────────
// Small HTML fragment builders
// ─────────────────────────────────────────────────────────────────────────────

function buildDonutSVG(segments, total) {
  if (total === 0) {
    return [
      "<div class=\"rpt-dc\">",
        "<svg width=\"150\" height=\"150\" viewBox=\"0 0 150 150\">",
          "<circle cx=\"75\" cy=\"75\" r=\"54\" fill=\"none\" stroke=\"#E4E8EE\" stroke-width=\"20\"/>",
        "</svg>",
      "</div>"
    ].join("");
  }

  var circumference = 2 * Math.PI * 54; // r=54
  var offset = 0;
  var circles = segments.map(function(seg) {
    if (seg.count === 0) return "";
    var dashArray = (seg.count / total) * circumference;
    var circle = "<circle cx=\"75\" cy=\"75\" r=\"54\" fill=\"none\" stroke=\"" + seg.color + "\" stroke-width=\"20\" " +
      "stroke-dasharray=\"" + dashArray.toFixed(1) + " " + circumference.toFixed(1) + "\" " +
      "stroke-dashoffset=\"" + (-offset).toFixed(1) + "\"/>";
    offset += dashArray;
    return circle;
  }).join("");

  return [
    "<div class=\"rpt-dc\">",
      "<svg width=\"150\" height=\"150\" viewBox=\"0 0 150 150\" style=\"transform:rotate(-90deg)\">",
        "<circle cx=\"75\" cy=\"75\" r=\"54\" fill=\"none\" stroke=\"#E4E8EE\" stroke-width=\"20\"/>",
        circles,
      "</svg>",
    "</div>"
  ].join("");
}

function rptKpi(value, label, cls) {
  return [
    "<div class=\"rpt-hkpi\">",
      "<div class=\"rpt-hkpi-v rpt-hkpi-" + cls + "\">" + esc(String(value)) + "</div>",
      "<div class=\"rpt-hkpi-l\">" + esc(label) + "</div>",
    "</div>"
  ].join("");
}

function rptKpiCard(value, label, sub, color) {
  return [
    "<div class=\"rpt-kc\">",
      "<div class=\"rpt-kc-v\" style=\"color:" + color + "\">" + esc(String(value)) + "</div>",
      "<div class=\"rpt-kc-l\">" + esc(label) + "</div>",
      "<div class=\"rpt-kc-s\">" + esc(sub) + "</div>",
    "</div>"
  ].join("");
}

function riskCard(icon, cls, title, badge, desc) {
  return [
    "<div class=\"rpt-rk\">",
      "<div class=\"rpt-ri rpt-ri-" + cls + "\">" + icon + "</div>",
      "<div class=\"rpt-rbd\">",
        "<div class=\"rpt-rh\">",
          "<h4>" + esc(title) + "</h4>",
          "<span class=\"rpt-b rpt-b-" + cls + "\">" + esc(badge) + "</span>",
        "</div>",
        "<p>" + desc + "</p>",
      "</div>",
    "</div>"
  ].join("");
}

function oppCard(icon, title, desc, barCls) {
  return [
    "<div class=\"rpt-op\">",
      "<div class=\"rpt-oi\">" + icon + "</div>",
      "<div class=\"rpt-ot\">" + esc(title) + "</div>",
      "<div class=\"rpt-od\">" + esc(desc) + "</div>",
      "<div class=\"rpt-pb " + barCls + "\"></div>",
    "</div>"
  ].join("");
}

function pulseStat(num, label) {
  return [
    "<div class=\"rpt-pulse-stat\">",
      "<div class=\"rpt-pulse-num\">" + num + "</div>",
      "<div class=\"rpt-pulse-label\">" + esc(label) + "</div>",
    "</div>"
  ].join("");
}

function sectionItem(num, title, desc) {
  return [
    "<div class=\"er-section-item\">",
      "<div class=\"er-section-num\">" + num + "</div>",
      "<div class=\"er-section-body\">",
        "<div class=\"er-section-title\">" + esc(title) + "</div>",
        "<div class=\"er-section-desc\">" + esc(desc) + "</div>",
      "</div>",
    "</div>"
  ].join("");
}

// ─────────────────────────────────────────────────────────────────────────────
// JS for the generated HTML (tab switching + bar animations)
// ─────────────────────────────────────────────────────────────────────────────

function buildScript() {
  return [
    "<script>",
    "var tabs=document.querySelectorAll('.rpt-tb'),panels=document.querySelectorAll('.rpt-pnl');",
    "tabs.forEach(function(btn){",
    "  btn.addEventListener('click',function(){",
    "    var t=btn.getAttribute('data-t');",
    "    tabs.forEach(function(b){b.classList.remove('on')});",
    "    panels.forEach(function(p){p.classList.remove('on')});",
    "    btn.classList.add('on');",
    "    document.getElementById('p'+t).classList.add('on');",
    "  });",
    "});",
    "window.addEventListener('beforeprint',function(){panels.forEach(function(p){p.style.display='block'})});",
    "window.addEventListener('afterprint',function(){",
    "  panels.forEach(function(p){p.style.display='none'});",
    "  var on=document.querySelector('.rpt-pnl.on');if(on)on.style.display='block';",
    "});",
    "</script>"
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS for the generated HTML
// ─────────────────────────────────────────────────────────────────────────────

function buildCSS() {
  return [
    // ── Design tokens (mirrors app styles.css light theme) ──────────────────
    ":root{",
    "--bg:#ECF1F7;--bg1:#F4F8FC;--bg2:#FFFFFF;--bg3:#F4F6F9;--bg4:#E4E8EE;",
    "--br:#DCE3EC;--br2:#C4CDDA;",
    "--tx1:#0B2A4A;--tx2:#3E4C62;--tx3:#6B7A90;",
    "--ok:#16A34A;--warn:#D97706;--crit:#DC2626;--info:#0076CE;",
    "--db:#0076CE;--db-deep:#0063AE;--db-soft:#E8F2FB;--db-faint:#F5F9FD;",
    "--high:#DC2626;--high-bg:#FEF2F2;--high-bd:#FECACA;",
    "--med:#D97706;--med-bg:#FFFBEB;--med-bd:#FDE68A;",
    "--low:#16A34A;--low-bg:#F0FDF4;--low-bd:#BBF7D0;",
    "}",
    "*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}",
    "html{scroll-behavior:smooth}",
    "body{font-family:'Inter',system-ui,sans-serif;background:var(--bg);color:var(--tx1);font-size:13px;line-height:1.5;min-height:100vh}",
    "::-webkit-scrollbar{width:5px;height:5px}",
    "::-webkit-scrollbar-track{background:var(--bg3)}",
    "::-webkit-scrollbar-thumb{background:var(--br2);border-radius:3px}",

    // ── Header — white with Dell blue bottom border, matching app topbar ────
    ".rpt-hdr{background:linear-gradient(to bottom,var(--db-faint),var(--bg2));border-bottom:2px solid var(--db);padding:32px 48px 28px}",
    ".rpt-hdr-inner{display:flex;align-items:flex-start;justify-content:space-between;gap:32px;flex-wrap:wrap}",
    ".rpt-eyebrow{font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--db);margin-bottom:8px;display:flex;align-items:center;gap:8px}",
    ".rpt-eyebrow::before{content:'';display:inline-block;width:16px;height:2px;background:var(--db)}",
    ".rpt-title{font-size:28px;font-weight:800;letter-spacing:-.02em;margin-bottom:4px;color:var(--tx1)}",
    ".rpt-sub{font-size:12px;color:var(--tx3)}",
    ".rpt-kpis{display:flex;gap:0;background:var(--bg2);border:1px solid var(--br);border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(11,42,74,.06)}",
    ".rpt-hkpi{padding:16px 24px;text-align:center;position:relative}",
    ".rpt-hkpi:not(:last-child)::after{content:'';position:absolute;right:0;top:20%;height:60%;width:1px;background:var(--br)}",
    ".rpt-hkpi-v{font-size:24px;font-weight:800;letter-spacing:-.03em;line-height:1;margin-bottom:4px;color:var(--tx1)}",
    ".rpt-hkpi-l{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--tx3)}",
    ".rpt-hkpi-ok{color:var(--ok)}.rpt-hkpi-warn{color:var(--warn)}.rpt-hkpi-crit{color:var(--crit)}.rpt-hkpi-info{color:var(--db)}",

    // ── Tab nav — matches app .summary-tab style ─────────────────────────────
    ".rpt-tabs{background:var(--bg2);border-bottom:2px solid var(--br);padding:0 48px;display:flex;gap:4px;overflow-x:auto;position:sticky;top:0;z-index:20}",
    ".rpt-tb{background:none;border:none;border-bottom:2px solid transparent;margin-bottom:-2px;padding:12px 16px;font-family:inherit;font-size:12px;font-weight:500;color:var(--tx3);cursor:pointer;white-space:nowrap;transition:.15s;display:flex;align-items:center;gap:6px}",
    ".rpt-ti{width:17px;height:17px;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;background:var(--bg3);color:var(--tx3);flex-shrink:0}",
    ".rpt-tb:hover{color:var(--tx1);background:var(--db-faint)}",
    ".rpt-tb.on{color:var(--db);border-bottom-color:var(--db);font-weight:600}",
    ".rpt-tb.on .rpt-ti{background:var(--db-soft);color:var(--db-deep)}",

    // ── Panel content ────────────────────────────────────────────────────────
    ".rpt-pnl{display:none;padding:32px 48px 72px;animation:rpt-fu .25s ease}",
    ".rpt-pnl.on{display:block}",
    "@keyframes rpt-fu{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}",

    // ── Grid layouts ─────────────────────────────────────────────────────────
    ".rpt-g2{display:grid;grid-template-columns:1fr 1fr;gap:20px}",
    ".rpt-g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px}",
    ".rpt-g4{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}",
    ".rpt-g5{display:grid;grid-template-columns:repeat(5,1fr);gap:14px}",

    // ── Base card ─────────────────────────────────────────────────────────────
    ".rpt-card{background:var(--bg2);border:1px solid var(--br);border-radius:8px;padding:20px 22px}",
    ".rpt-ct{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--tx3);margin-bottom:14px}",
    ".rpt-sh{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--tx3);margin-bottom:14px;margin-top:28px;display:flex;align-items:center;gap:10px}",
    ".rpt-sh:first-child{margin-top:0}",
    ".rpt-sh::after{content:'';flex:1;height:1px;background:var(--br)}",

    // ── KPI stat cards ────────────────────────────────────────────────────────
    ".rpt-kc{background:var(--bg2);border:1px solid var(--br);border-radius:8px;padding:18px 20px;position:relative;overflow:hidden;box-shadow:0 1px 2px rgba(11,42,74,.04)}",
    ".rpt-kc-v{font-size:30px;font-weight:800;letter-spacing:-.04em;line-height:1;margin-bottom:4px;color:var(--tx1)}",
    ".rpt-kc-l{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--tx3)}",
    ".rpt-kc-s{margin-top:5px;font-size:11px;color:var(--tx3)}",

    // ── Status badges — light-bg pill variant ─────────────────────────────────
    ".rpt-b{display:inline-flex;align-items:center;gap:4px;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:600;letter-spacing:.02em}",
    ".rpt-b::before{content:'';width:5px;height:5px;border-radius:50%}",
    ".rpt-b-g{background:var(--low-bg);color:var(--ok);border:1px solid var(--low-bd)}.rpt-b-g::before{background:var(--ok)}",
    ".rpt-b-w{background:var(--med-bg);color:var(--warn);border:1px solid var(--med-bd)}.rpt-b-w::before{background:var(--warn)}",
    ".rpt-b-c{background:var(--high-bg);color:var(--crit);border:1px solid var(--high-bd)}.rpt-b-c::before{background:var(--crit)}",
    ".rpt-b-i{background:var(--db-soft);color:var(--db-deep);border:1px solid #BFDBF7}.rpt-b-i::before{display:none}",
    ".rpt-b-n{background:var(--bg3);color:var(--tx2);border:1px solid var(--br)}.rpt-b-n::before{display:none}",

    // ── Vendor badges ─────────────────────────────────────────────────────────
    ".rpt-vbadge{display:inline-flex;align-items:center;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700}",
    ".vgd{background:var(--db-soft);border:1px solid #BFDBF7;color:var(--db-deep)}",
    ".vgn{background:#F3F4F6;border:1px solid var(--br);color:#374151}",
    ".vgc{background:#FFFBEB;border:1px solid #FDE68A;color:#92400E}",

    // ── Urgency badges ────────────────────────────────────────────────────────
    ".rpt-urg{display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600}",
    ".rpt-urg-high{background:var(--high-bg);color:var(--crit);border:1px solid var(--high-bd)}",
    ".rpt-urg-medium{background:var(--med-bg);color:var(--warn);border:1px solid var(--med-bd)}",
    ".rpt-urg-low{background:var(--low-bg);color:var(--ok);border:1px solid var(--low-bd)}",

    // ── Gap status badges ─────────────────────────────────────────────────────
    ".rpt-status{display:inline-block;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:600;text-transform:uppercase}",
    ".rpt-status-open{background:var(--db-soft);color:var(--db-deep);border:1px solid #BFDBF7}",
    ".rpt-status-closed{background:var(--low-bg);color:var(--ok);border:1px solid var(--low-bd)}",
    ".rpt-status-deferred{background:var(--high-bg);color:var(--crit);border:1px solid var(--high-bd)}",
    ".rpt-status-in_progress{background:var(--med-bg);color:var(--warn);border:1px solid var(--med-bd)}",

    // ── Donut chart ───────────────────────────────────────────────────────────
    ".rpt-dw{display:flex;align-items:center;gap:24px}",
    ".rpt-dc{flex-shrink:0;position:relative;width:150px;height:150px}",
    ".rpt-dc svg{width:150px;height:150px}",
    ".rpt-dh{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center}",
    ".rpt-dv{font-size:20px;font-weight:800;letter-spacing:-.03em;line-height:1;color:var(--tx1)}",
    ".rpt-dl2{font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em}",
    ".rpt-dl3{flex:1;display:flex;flex-direction:column;gap:8px}",
    ".rpt-li{display:flex;align-items:center;gap:8px;font-size:12px}",
    ".rpt-ld{width:9px;height:9px;border-radius:3px;flex-shrink:0}",
    ".rpt-ln{flex:1;color:var(--tx2)}",
    ".rpt-lp{font-weight:700;font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--tx1)}",
    ".rpt-lpct{color:var(--tx3);font-size:11px;margin-left:3px}",
    ".rpt-more{font-size:11px;color:var(--tx3);margin-top:4px}",

    // ── Stacked bars ──────────────────────────────────────────────────────────
    ".rpt-sbl{display:flex;gap:16px;margin-bottom:14px;flex-wrap:wrap}",
    ".rpt-sbi{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--tx2)}",
    ".rpt-sbd{width:9px;height:9px;border-radius:3px}",
    ".rpt-sbd-dell{background:#0076CE}.rpt-sbd-nd{background:#6B7A90}.rpt-sbd-cust{background:#D97706}",
    ".rpt-sbr{display:flex;align-items:center;gap:10px;margin-bottom:10px}",
    ".rpt-sbrl{width:160px;font-size:12px;font-weight:500;color:var(--tx2);flex-shrink:0}",
    ".rpt-sbrl-ct{color:var(--tx3);font-size:10px}",
    ".rpt-sbt{flex:1;height:10px;background:var(--bg4);border-radius:5px;overflow:hidden;display:flex}",
    ".rpt-ss{height:100%}",
    ".rpt-ss-dell{background:#0076CE}.rpt-ss-nd{background:#6B7A90}.rpt-ss-cust{background:#D97706}",
    ".rpt-sbpct{width:38px;text-align:right;font-size:11px;color:var(--tx3);font-family:'JetBrains Mono',monospace;flex-shrink:0}",

    // ── Horizontal bar chart ──────────────────────────────────────────────────
    ".rpt-hbl{display:flex;flex-direction:column;gap:10px}",
    ".rpt-hbl-row{}",
    ".rpt-hbl-meta{display:flex;justify-content:space-between;margin-bottom:4px;font-size:12px}",
    ".rpt-hbl-name{font-weight:600;color:var(--tx1)}",
    ".rpt-hbl-ct{color:var(--tx3);font-size:11px}",
    ".rpt-hbt{height:7px;background:var(--bg4);border-radius:4px;overflow:hidden}",
    ".rpt-hbf{height:100%;border-radius:4px}",

    // ── Environment cards ─────────────────────────────────────────────────────
    ".rpt-envs-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}",
    ".rpt-env-card{background:var(--bg2);border:1px solid var(--br);border-radius:8px;overflow:hidden;box-shadow:0 1px 2px rgba(11,42,74,.04)}",
    ".rpt-env-hdr{padding:18px 22px 14px;border-bottom:1px solid var(--br);background:var(--db-faint)}",
    ".rpt-env-name{font-size:16px;font-weight:700;letter-spacing:-.01em;margin-bottom:2px;color:var(--tx1)}",
    ".rpt-env-loc{font-size:11px;color:var(--tx3)}",
    ".rpt-env-stats{display:flex;gap:20px;padding:12px 22px;border-bottom:1px solid var(--br);background:var(--bg3);flex-wrap:wrap}",
    ".rpt-ssv{font-size:22px;font-weight:800;letter-spacing:-.03em;line-height:1;color:var(--tx1)}",
    ".rpt-ssl{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--tx3);margin-top:2px}",
    ".rpt-env-layer{padding:10px 22px;border-bottom:1px solid var(--br)}",
    ".rpt-env-layer:last-child{border-bottom:none}",
    ".rpt-env-layer-title{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--tx3);margin-bottom:6px}",
    ".rpt-al-row{display:flex;align-items:center;gap:8px;padding:5px 0;font-size:12px;color:var(--tx2)}",
    ".rpt-al-label{color:var(--tx1);font-weight:500}",
    ".rpt-obs{margin:0 22px 18px;padding:10px 12px;background:var(--db-faint);border-left:3px solid var(--db);border-radius:0 6px 6px 0;font-size:12px;color:var(--tx2);line-height:1.6}",

    // ── Asset summary cards ───────────────────────────────────────────────────
    ".rpt-sc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin-bottom:0}",
    ".rpt-sc-card{background:var(--bg2);border:1px solid var(--br);border-top:3px solid var(--db);border-radius:6px;padding:14px}",
    ".rpt-sc-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--tx3);margin-bottom:5px}",
    ".rpt-sc-val{font-size:26px;font-weight:800;letter-spacing:-.03em;line-height:1;color:var(--tx1);margin-bottom:4px}",
    ".rpt-sc-sub{font-size:11px;color:var(--tx3)}",

    // ── Asset inventory table ─────────────────────────────────────────────────
    ".rpt-tbl-wrap{background:var(--bg2);border:1px solid var(--br);border-radius:8px;overflow:hidden;overflow-x:auto}",
    ".rpt-at{width:100%;border-collapse:collapse;font-size:12px}",
    ".rpt-at th{background:var(--bg3);padding:9px 14px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--tx3);border-bottom:1px solid var(--br)}",
    ".rpt-at td{padding:9px 14px;border-bottom:1px solid var(--br);vertical-align:middle;color:var(--tx2)}",
    ".rpt-at tr:last-child td{border-bottom:none}",
    ".rpt-at tbody tr:hover td{background:var(--db-faint)}",
    ".rpt-tbl-sep td{background:var(--bg3)!important;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--tx3);padding:5px 14px}",
    ".rpt-fw6{font-weight:600;color:var(--tx1)!important}",
    ".rpt-italic{font-style:italic}",
    ".rpt-muted{color:var(--tx3)!important;font-size:11px}",

    // ── Heatmap ───────────────────────────────────────────────────────────────
    ".rpt-hm-grid{display:grid;gap:5px;padding:4px;background:var(--bg3);border:1px solid var(--br);border-radius:6px}",
    ".rpt-hm-corner{display:flex;align-items:flex-end;padding:8px 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--tx3)}",
    ".rpt-hm-envhdr{padding:7px 10px;text-align:center;font-size:11px;font-weight:600;color:var(--tx2);background:var(--bg2);border-radius:5px;border:1px solid var(--br)}",
    ".rpt-hm-row{display:contents}",
    ".rpt-hm-layerlbl{display:flex;align-items:center;padding:8px 10px;font-size:11px;font-weight:600;color:var(--tx2);background:var(--bg2);border-radius:5px}",
    ".rpt-hm-cell{padding:10px;border-radius:5px;text-align:center;min-height:52px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px}",
    ".rpt-hm-cell-label{font-size:11px;font-weight:700}",
    ".rpt-hm-cell-ct{font-size:10px;opacity:.8}",
    ".rpt-hm-bucket-empty{background:#FAFAFA;color:var(--tx3);border:1px solid var(--br)}",
    ".rpt-hm-bucket-low{background:var(--low-bg);color:var(--ok);border:1px solid var(--low-bd)}",
    ".rpt-hm-bucket-med{background:var(--med-bg);color:var(--warn);border:1px solid var(--med-bd)}",
    ".rpt-hm-bucket-high{background:var(--high-bg);color:var(--crit);border:1px solid var(--high-bd)}",
    ".rpt-hm-legend{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px}",
    ".rpt-hm-leg{display:inline-flex;align-items:center;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;gap:5px}",

    // ── Risk cards ────────────────────────────────────────────────────────────
    ".rpt-rk{background:var(--bg2);border:1px solid var(--br);border-radius:8px;padding:16px 18px;display:flex;gap:14px;margin-bottom:10px;box-shadow:0 1px 2px rgba(11,42,74,.04)}",
    ".rpt-ri{flex-shrink:0;width:40px;height:40px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px}",
    ".rpt-ri-c{background:var(--high-bg);border:1px solid var(--high-bd)}",
    ".rpt-ri-w{background:var(--med-bg);border:1px solid var(--med-bd)}",
    ".rpt-ri-i{background:var(--db-soft);border:1px solid #BFDBF7}",
    ".rpt-rh{display:flex;align-items:center;gap:10px;margin-bottom:5px;flex-wrap:wrap}",
    ".rpt-rh h4{font-size:13px;font-weight:700;color:var(--tx1)}",
    ".rpt-rbd p{font-size:12px;color:var(--tx2);line-height:1.65}",
    ".rpt-gi{display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--br);font-size:12px;color:var(--tx2)}",
    ".rpt-gi:last-child{border-bottom:none}",
    ".rpt-gd{flex-shrink:0;width:7px;height:7px;border-radius:50%;background:var(--warn);margin-top:4px}",
    ".rpt-opp-row{display:flex;gap:14px;flex-wrap:wrap}",
    ".rpt-opp-grid{margin-top:4px}",
    ".rpt-op{background:var(--bg2);border:1px solid var(--br);border-radius:8px;padding:18px;text-align:center;flex:1;min-width:160px}",
    ".rpt-oi{font-size:26px;margin-bottom:8px}",
    ".rpt-ot{font-size:13px;font-weight:700;margin-bottom:5px;color:var(--tx1)}",
    ".rpt-od{font-size:11px;color:var(--tx3);line-height:1.55}",
    ".rpt-pb{height:3px;border-radius:2px;margin-top:12px}",
    ".pb-h{background:var(--crit)}.pb-m{background:var(--warn)}.pb-l{background:var(--ok)}",

    // ── Roadmap ───────────────────────────────────────────────────────────────
    ".rpt-pulse{margin-bottom:0}",
    ".rpt-pulse-row{display:flex;flex-wrap:wrap;gap:32px;align-items:center}",
    ".rpt-pulse-stat{text-align:center;padding:8px 16px}",
    ".rpt-pulse-num{font-size:26px;font-weight:800;letter-spacing:-.03em;line-height:1;color:var(--tx1)}",
    ".rpt-pulse-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--tx3);margin-top:4px}",
    ".rpt-phases-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;margin-bottom:0}",
    ".rpt-phase-now,.rpt-phase-next,.rpt-phase-later{background:var(--bg2);border:1px solid var(--br);border-radius:8px;overflow:hidden;box-shadow:0 1px 2px rgba(11,42,74,.04)}",
    ".rpt-phase-now{border-top:3px solid var(--crit)}",
    ".rpt-phase-next{border-top:3px solid var(--warn)}",
    ".rpt-phase-later{border-top:3px solid var(--ok)}",
    ".rpt-phase-hdr{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--br);flex-wrap:wrap}",
    ".rpt-phase-label{font-size:13px;font-weight:700;color:var(--tx1)}",
    ".rpt-phase-sub{font-size:11px;color:var(--tx3)}",
    ".rpt-phase-ct{margin-left:auto;font-size:11px;font-weight:600;color:var(--tx3)}",
    ".rpt-phase-empty{padding:18px;font-size:12px;color:var(--tx3);text-align:center;font-style:italic}",
    ".rpt-proj-card{padding:12px 16px;border-bottom:1px solid var(--br);transition:background .15s}",
    ".rpt-proj-card:last-child{border-bottom:none}",
    ".rpt-proj-card:hover{background:var(--db-faint)}",
    ".rpt-proj-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:7px}",
    ".rpt-proj-name{font-size:12px;font-weight:600;color:var(--tx1);line-height:1.4;flex:1}",
    ".rpt-proj-badges{display:flex;align-items:center;gap:4px;flex-shrink:0}",
    ".rpt-proj-sols{display:flex;flex-wrap:wrap;gap:4px}",
    ".rpt-sol-chip{display:inline-block;background:var(--db-soft);color:var(--db-deep);border:1px solid #BFDBF7;border-radius:4px;padding:2px 7px;font-size:10px;font-weight:600}",
    ".rpt-proj-unmapped{font-size:11px;color:var(--tx3);font-style:italic}",
    ".rpt-link-badge{display:inline-flex;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:600;background:var(--bg3);color:var(--tx2);border:1px solid var(--br)}",
    ".rpt-drivers-row{display:flex;flex-wrap:wrap;gap:8px}",
    ".rpt-driver-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;background:var(--db-faint);border:1px solid #BFDBF7;border-radius:6px;font-size:12px;font-weight:500;color:var(--tx2)}",
    ".rpt-pri{display:inline-block;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}",
    ".rpt-pri-high{background:var(--high-bg);color:var(--crit);border:1px solid var(--high-bd)}",
    ".rpt-pri-medium{background:var(--med-bg);color:var(--warn);border:1px solid var(--med-bd)}",
    ".rpt-pri-low{background:var(--low-bg);color:var(--ok);border:1px solid var(--low-bd)}",

    // ── Session brief ─────────────────────────────────────────────────────────
    ".rpt-stats-row{display:flex;gap:24px;flex-wrap:wrap;background:var(--bg2);border:1px solid var(--br);border-radius:8px;padding:14px 22px;box-shadow:0 1px 2px rgba(11,42,74,.04)}",
    ".rpt-stat{text-align:center;padding:4px 8px}",
    ".rpt-stat-num{font-size:26px;font-weight:800;letter-spacing:-.03em;line-height:1;color:var(--tx1)}",
    ".rpt-stat-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--tx3);margin-top:4px}",
    ".rpt-cov-pct{font-size:44px;font-weight:800;letter-spacing:-.04em;line-height:1;margin-bottom:10px}",
    ".rpt-cov-ok{color:var(--ok)}.rpt-cov-warn{color:var(--warn)}.rpt-cov-crit{color:var(--crit)}",
    ".rpt-cov-bar{height:8px;background:var(--bg4);border-radius:4px;overflow:hidden;margin-bottom:10px}",
    ".rpt-cov-fill{height:100%;border-radius:4px}",
    ".rpt-cov-fill-ok{background:var(--ok)}.rpt-cov-fill-warn{background:var(--warn)}.rpt-cov-fill-crit{background:var(--crit)}",
    ".rpt-cov-hints,.rpt-risk-hints{list-style:none;display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--tx2)}",
    ".rpt-risk-pill{display:inline-block;padding:7px 18px;border-radius:20px;font-size:15px;font-weight:700;letter-spacing:.02em;margin-bottom:10px;border:1px solid transparent}",
    ".rpt-risk-high{background:var(--high-bg);color:var(--crit);border-color:var(--high-bd)}",
    ".rpt-risk-elevated{background:#FFF7ED;color:#C2410C;border-color:#FDBA74}",
    ".rpt-risk-moderate{background:var(--med-bg);color:var(--warn);border-color:var(--med-bd)}",
    ".rpt-risk-stable{background:var(--low-bg);color:var(--ok);border-color:var(--low-bd)}",
    ".rpt-brief{display:flex;flex-direction:column;gap:0}",
    ".rpt-brief-row{display:flex;align-items:baseline;gap:16px;padding:10px 0;border-bottom:1px solid var(--br)}",
    ".rpt-brief-row:last-child{border-bottom:none}",
    ".rpt-brief-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--tx3);width:180px;flex-shrink:0}",
    ".rpt-brief-text{font-size:12px;color:var(--tx2);flex:1;line-height:1.5}",

    // ── Utility ───────────────────────────────────────────────────────────────
    ".rpt-empty{padding:20px;text-align:center;color:var(--tx3);font-size:12px;font-style:italic}",
    ".rpt-obs-bar{background:var(--db-faint);border-left:3px solid var(--db);border-radius:0 6px 6px 0;padding:10px 14px;font-size:12px;color:var(--tx2);margin-top:12px;line-height:1.6}",

    // ── Print ─────────────────────────────────────────────────────────────────
    "@media print{",
    "  body{background:#FFFFFF!important;print-color-adjust:exact;-webkit-print-color-adjust:exact}",
    "  .rpt-tabs{display:none!important}",
    "  .rpt-pnl{display:block!important;padding:24px!important;page-break-before:always}",
    "  .rpt-pnl:first-of-type{page-break-before:auto}",
    "  .rpt-card,.rpt-rk,.rpt-env-card,.rpt-proj-card,.rpt-kc{break-inside:avoid}",
    "}",

    // ── Responsive ────────────────────────────────────────────────────────────
    "@media(max-width:900px){",
    "  .rpt-hdr{padding:20px}",
    "  .rpt-pnl{padding:16px}",
    "  .rpt-g2,.rpt-g3,.rpt-g5,.rpt-phases-grid,.rpt-envs-grid{grid-template-columns:1fr}",
    "  .rpt-g4{grid-template-columns:1fr 1fr}",
    "  .rpt-kpis{flex-wrap:wrap}",
    "}"
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────────────────────

// Returns a base filename (no extension). Callers append ".html" / ".pdf".
function buildFilename(session, kind) {
  var name = (session.customer && session.customer.name || "customer").replace(/\s+/g, "-").toLowerCase();
  var date = new Date().toISOString().slice(0, 10);
  var slug = kind ? ("-" + kind) : "";
  return "discovery-canvas-report" + slug + "-" + name + "-" + date;
}

function pct(val, total) {
  if (!total) return 0;
  return Math.round((val / total) * 100);
}

function esc(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function coverageHint(cov) {
  return cov.actions.length > 0 ? cov.actions[0] : "Complete";
}

function coverageCls(pct) {
  return pct >= 75 ? "#16A34A" : pct >= 40 ? "#D97706" : "#DC2626";
}

function riskColour(level) {
  return level === "High"     ? "#DC2626"
       : level === "Elevated" ? "#EA580C"
       : level === "Moderate" ? "#D97706"
       :                        "#16A34A";
}

function mk(tag, cls) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function mkt(tag, cls, text) {
  var e = mk(tag, cls);
  e.textContent = text;
  return e;
}
