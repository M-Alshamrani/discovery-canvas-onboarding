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

  // ── Assemble the prompt ───────────────────────────────────────────────
  const lines = [
    "Create a clean, professional current-state IT infrastructure architecture diagram for " + name + ".",
    "",
    "STYLE:",
    "  • Layered architecture diagram: horizontal bands stacked top-to-bottom, one band per layer.",
    "  • Columns represent environments/sites; draw each environment as a labelled vertical column.",
    "  • Each technology is a rounded rectangle tile placed in its layer band and environment column.",
    "  • Colour tiles by vendor: Dell in blue, third-party in grey, custom/in-house in amber.",
    "  • Use a subtle criticality cue (e.g. a left accent or border weight) for critical vs standard assets.",
    "  • Neutral background, clear layer labels down the left edge, environment labels across the top.",
    "  • Modern enterprise look, legible labels, balanced spacing — suitable for an executive slide.",
    "",
    "LAYERS (top to bottom): " + LAYERS.map(function(l) { return l.label; }).join(" → "),
    "ENVIRONMENTS (left to right columns): " + envNames,
    "",
    "LAYER CONTENTS (layer → environment → assets):",
    layerBlocks,
    ""
  ];

  if (workloadLinks.length > 0) {
    lines.push("WORKLOAD → ASSET DEPENDENCIES (draw connecting lines from each workload down to the assets it runs on):");
    lines.push(workloadLinks.join("\n"));
    lines.push("");
  }

  lines.push("Label the diagram \"" + name + " — Current State Architecture\". Keep it accurate to the assets listed above; do not invent components.");

  return lines.join("\n");
}
