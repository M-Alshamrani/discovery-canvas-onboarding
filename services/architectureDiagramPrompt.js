// services/architectureDiagramPrompt.js
//
// Builds a rich, copy-pasteable image-generation prompt that describes the
// customer's CURRENT-STATE estate as a layered architecture diagram — the
// same layering the app uses everywhere else (the LAYERS stack × the
// active environments, see ui/views/MatrixView.js). The output is plain
// text the user pastes into any image-capable LLM; this module renders no
// diagram itself (per product decision: prompt only, no in-app Mermaid).
//
// Pure: reads the projected session shape and returns a string.

import { LAYERS } from "../core/config.js";

// Layers are described top → bottom exactly as the matrix renders them.
const CRITICALITY_TAG = { High: "critical", Medium: "important", Low: "standard" };

function vendorGroupLabel(g) {
  if (g === "dell") return "Dell";
  if (g === "custom") return "custom/in-house";
  return "third-party";
}

// buildArchitectureDiagramPrompt · returns the image-gen prompt text.
//   session     — projected session (getEngagementAsSession)
//   visibleEnvs — [{ id, label }] active environments (catalog-id shape)
export function buildArchitectureDiagramPrompt(session, visibleEnvs) {
  const cust    = session.customer || {};
  const name    = (cust.name && cust.name.trim()) || "the customer";
  const envs    = visibleEnvs || [];
  const current = (session.instances || []).filter(function(i) { return i.state === "current"; });

  const byId = {};
  current.forEach(function(i) { byId[i.id] = i; });

  // ── Per-layer, per-environment cell contents ──────────────────────────
  const layerBlocks = LAYERS.map(function(layer) {
    const cells = envs.map(function(env) {
      const items = current
        .filter(function(i) { return i.layerId === layer.id && i.environmentId === env.id; })
        .map(function(i) {
          var tag = CRITICALITY_TAG[i.criticality] || "standard";
          return "      • " + i.label + " (" + vendorGroupLabel(i.vendorGroup) + ", " + tag + ")";
        });
      if (items.length === 0) return "    " + env.label + ": (none)";
      return "    " + env.label + ":\n" + items.join("\n");
    });
    return "  " + layer.label + "\n" + cells.join("\n");
  }).join("\n\n");

  // ── Workload → asset dependency links ─────────────────────────────────
  const workloadLinks = current
    .filter(function(i) { return i.layerId === "workload" && Array.isArray(i.mappedAssetIds) && i.mappedAssetIds.length > 0; })
    .map(function(w) {
      var targets = w.mappedAssetIds
        .map(function(id) { return byId[id] ? byId[id].label : null; })
        .filter(Boolean);
      if (targets.length === 0) return null;
      return "  • " + w.label + "  →  " + targets.join(", ");
    })
    .filter(Boolean);

  const envNames = envs.map(function(e) { return e.label; }).join(", ") || "(no environments)";

  // ── Estate summary stats (for the bottom banner) ──────────────────────
  const total    = current.length;
  const dellCount = current.filter(function(i) { return i.vendorGroup === "dell"; }).length;
  const pct = function(n) { return total > 0 ? Math.round((n / total) * 100) : 0; };
  const dellPct    = pct(dellCount);
  const nonDellPct = 100 - dellPct;
  const highRisk   = current.filter(function(i) { return i.criticality === "High"; }).length;

  // ── Assemble the prompt ───────────────────────────────────────────────
  const lines = [
    "Create a clean, professional current-state IT infrastructure architecture diagram for " + name + ", rendered as a polished executive-grade infographic.",
    "",
    "VISUAL STYLE (match this exact look and feel):",
    "  • Overall: crisp white background, modern enterprise infographic, generous whitespace, everything sharply aligned to a grid — suitable for a boardroom slide.",
    "  • Colour system: deep navy blue (#123a75) as the primary/anchor colour, a lighter accent blue (#2f7dd1) for highlights, and each technology drawn in its real vendor brand colours.",
    "  • Title: large bold navy heading centred across the top, e.g. \"" + name + " — AS-IS Current-State Architecture\", with the final word accented in the lighter blue.",
    "  • Environment headers: draw each environment/site as its own vertical column with a solid navy-blue rounded header banner at the top, white uppercase label, and a small white glyph icon (data-center/building, disaster-recovery, cloud, etc.). Each column sits inside a light-grey rounded container that frames all of that environment's cells.",
    "  • Layer labels: run the layer names down the LEFT edge as light-blue rounded pill badges, each with a small matching line icon (workloads, compute, virtualization, storage, data-protection, infrastructure).",
    "  • Cells: at each layer × environment intersection, render the technologies as their actual VENDOR BRAND LOGOS / product icons in brand colour, with a short product-name caption in dark grey directly beneath each icon (e.g. Dell, Nutanix, VMware, Veeam, OpenText, Cisco, Palo Alto, Fortinet, Splunk, F5, Microsoft). Arrange icons neatly in rows within the cell.",
    "  • Criticality / highlights: wrap notably high-risk or standout assets in a dashed AMBER-orange rounded border to draw the eye.",
    "  • Cross-site relationships: draw dashed RED bidirectional arrows between matching cells in different sites to indicate replication / backup / failover links.",
    "  • KEY OBSERVATIONS panel: add a narrow column on the far RIGHT titled \"KEY OBSERVATIONS\", listing short insight bullets, each paired with a small circular icon (e.g. fragmentation, dual-vendor sprawl, high-risk posture, limited cloud landing zone).",
    "  • Bottom summary banner: a full-width solid navy rounded bar across the bottom labelled \"Current estate:\" showing headline metrics with small icons and pie-chart glyphs — \"" + total + " assets\", \"" + dellPct + "% Dell\", \"" + nonDellPct + "% non-Dell\", and a red warning icon reading \"high risk posture\".",
    "  • Typography: clean sans-serif, bold uppercase for headers, legible captions, balanced spacing throughout.",
    "",
    "LAYERS (top to bottom, one horizontal band each): " + LAYERS.map(function(l) { return l.label; }).join(" → "),
    "ENVIRONMENTS (left to right columns, each a framed vertical column with a navy header): " + envNames,
    "",
    "LAYER CONTENTS (layer → environment → assets to place as vendor-logo icons):",
    layerBlocks,
    ""
  ];

  if (workloadLinks.length > 0) {
    lines.push("WORKLOAD → ASSET DEPENDENCIES (draw connecting lines from each workload down to the assets it runs on):");
    lines.push(workloadLinks.join("\n"));
    lines.push("");
  }

  lines.push("ESTATE SUMMARY (use in the bottom banner): " + total + " total assets · " + dellPct + "% Dell · " + nonDellPct + "% non-Dell · " + highRisk + " high-criticality (high-risk posture).");
  lines.push("");
  lines.push("Label the diagram \"" + name + " — AS-IS Current-State Architecture\". Keep it strictly accurate to the assets listed above; do not invent components.");

  return lines.join("\n");
}
