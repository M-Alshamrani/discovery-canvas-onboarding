// ui/views/MatrixView.js -- current / desired state matrix.
//
// All reads operate on the active engagement (via getActiveEngagement());
// all writes route through state/adapter.js commit* helpers. The legacy
// `session` arg in the renderer signature is preserved for caller
// compatibility but ignored -- every entity reference resolves against
// engagementStore.

import { LAYERS, ENV_CATALOG, CATALOG } from "../../core/config.js";
import {
  // Adapter write surface:
  commitInstanceAdd,
  commitInstanceUpdate,
  commitInstanceRemove,
  commitWorkloadMap,
  commitGapAdd
} from "../../state/adapter.js";
import { getActiveEngagement } from "../../state/engagementStore.js";
// Shared empty-environments UX.
import { renderEmptyEnvsCenterCard, visibleEnvCount } from "../components/NoEnvsCard.js";
import {
  DISPOSITION_ACTIONS, ACTION_TO_GAP_TYPE,
  getDesiredCounterpart, getCurrentSource, buildGapFromDisposition,
  proposeCriticalityUpgrades,
  commitSyncGapFromDesired,
  commitSyncGapsFromCurrentCriticality
} from "../../state/dispositionLogic.js";
import { helpButton } from "./HelpModal.js";
import { renderDemoBanner } from "../components/DemoBanner.js";
// Centralized label resolvers. Aliased to avoid name collisions with
// local helpers and make call sites read intentionally.
import {
  envLabel as envLabelResolver,
  layerLabel as layerLabelResolver
} from "../../core/labelResolvers.js";

// Selection state lives in module scope so it survives re-renders triggered
// by a commit (which fires the engagement subscriber chain → renderStage →
// a fresh renderMatrixView closure). If it were closure-local, each re-mount
// would start with selectedInstId=null and wipe the right-pane detail panel.
// Indexed by stateFilter so the current (Tab 2) and desired (Tab 3) views
// keep independent selections.
var _selectedInstIdByState = { current: null, desired: null };

export function renderMatrixView(left, right, _legacySession, opts) {
  // _legacySession is ignored -- kept in the signature so existing
  // callers don't break. Every read resolves against getActiveEngagement().
  var stateFilter    = (opts && opts.stateFilter) || "current";
  // Accessors over the module-scope selection for the active stateFilter.
  function getSelectedInstId() { return _selectedInstIdByState[stateFilter] || null; }
  function setSelectedInstId(id) { _selectedInstIdByState[stateFilter] = id || null; }
  var selectedInstId = getSelectedInstId();

  // Demo banner -- the engagement carries isDemo on engagement.meta.
  var bootEng = getActiveEngagement();
  if (bootEng && bootEng.meta && bootEng.meta.isDemo) renderDemoBanner(left);

  // Visible-env list. Walks engagement.environments filtered by !hidden.
  // Each entry exposes { uuid, envCatalogId, label, alias } so downstream
  // code can address an env by UUID (data-env-uuid, instance.environmentId
  // match) or by display label.
  var activeEnvs = _getVisibleEnvs();

  // Empty-environments empty-state via the shared NoEnvsCard. Order
  // matters: this branch returns BEFORE the matrix header is built, so
  // the header's explanatory hint doesn't render redundantly above the
  // info card.
  if (activeEnvs.length === 0) {
    renderEmptyEnvsCenterCard(left,
      stateFilter === "current" ? "matrix-current" : "matrix-desired",
      {});
    showHint(right);
    return;
  }

  // Header (only built when there is at least one visible environment).
  var header = mk("div", "card");
  var titleRow = mk("div", "card-title-row");
  var titleEl = mk("div", "card-title");
  titleEl.textContent = (stateFilter === "current" ? "Current state" : "Desired state") + " . architecture matrix";
  titleRow.appendChild(titleEl);
  titleRow.appendChild(helpButton(stateFilter === "current" ? "current" : "desired"));
  header.appendChild(titleRow);
  var hintEl = mk("div", "card-hint");
  hintEl.textContent = stateFilter === "current"
    ? "Map technologies the customer has today. Click any tile to set criticality and notes. Use Add to browse the catalog."
    : "Set a disposition for each current technology (grey dashed tiles). Add net-new desired technologies using the Add button.";
  header.appendChild(hintEl);

  // Unreviewed banner (desired state only)
  if (stateFilter === "desired") {
    var unreviewedEl = mk("div", "");
    unreviewedEl.id = "unreviewed-banner-wrap";
    left.appendChild(header);
    left.appendChild(unreviewedEl);
    updateUnreviewedBanner(unreviewedEl);
  } else {
    left.appendChild(header);
  }

  // Grid column scaling: this view sets only the --env-count CSS custom
  // property; styles.css owns grid-template-columns and the max-width
  // clamp (1-2 envs cap at ~320px each; 3+ envs scale to fill). Do not
  // override grid-template-columns inline.
  var wrap = mk("div", "matrix-scroll-wrap");
  var grid = mk("div", "matrix-grid");
  grid.style.setProperty("--env-count", String(activeEnvs.length));

  // Header row.
  grid.appendChild(mk("div", "matrix-corner"));
  activeEnvs.forEach(function(env, eIdx) {
    var h = mk("div", "matrix-env-head");
    // data-env-id carries the catalog ref (e.g. "coreDc") for CSS / a11y
    // selectors; data-env-uuid carries the stored UUID. Internal cell-
    // targeting code matches on data-env-uuid, never data-env-id.
    h.setAttribute("data-env-id",   env.envCatalogId);
    h.setAttribute("data-env-uuid", env.uuid);
    h.setAttribute("data-env",      env.envCatalogId);
    var code = mk("span", "matrix-env-code");
    code.textContent = "E." + ("0" + (eIdx + 1)).slice(-2);
    var name = mk("span", "matrix-env-name");
    name.textContent = env.label;
    h.appendChild(code);
    h.appendChild(name);
    grid.appendChild(h);
  });

  // Layer rows.
  LAYERS.forEach(function(layer, lIdx) {
    var hdr = mk("div", "matrix-layer-header");
    hdr.setAttribute("data-layer-id", layer.id);
    var bar = mk("div", "matrix-layer-bar");
    bar.setAttribute("data-layer-id", layer.id);
    hdr.appendChild(bar);
    var code = mk("span", "matrix-layer-code");
    code.textContent = "L." + ("0" + (lIdx + 1)).slice(-2);
    hdr.appendChild(code);
    var nameEl = mk("span", "matrix-layer-name");
    nameEl.textContent = layer.label;
    hdr.appendChild(nameEl);
    grid.appendChild(hdr);
    activeEnvs.forEach(function(env) {
      var cell = mk("div", "matrix-cell");
      cell.setAttribute("data-matrix-cell", "");
      cell.setAttribute("data-layer-id", layer.id);
      // data-env-id: catalog ref. data-env-uuid: stored UUID. refreshCell
      // and renderCell address by UUID; CSS selectors use data-env-id.
      cell.setAttribute("data-env-id",   env.envCatalogId);
      cell.setAttribute("data-env-uuid", env.uuid);
      renderCell(cell, layer.id, env.uuid);
      grid.appendChild(cell);
    });
  });

  wrap.appendChild(grid);
  left.appendChild(wrap);

  // Restore the right-pane detail panel if a selection persisted across
  // the re-mount. If there's a persisted selectedInstId AND the instance
  // still exists in the live engagement (it may have been deleted mid-
  // edit), re-mount the detail panel; otherwise fall back to the hint.
  var _restoreEng = getActiveEngagement();
  var _restoreInst = (selectedInstId && _restoreEng && _restoreEng.instances && _restoreEng.instances.byId)
    ? _restoreEng.instances.byId[selectedInstId]
    : null;
  if (_restoreInst && _restoreInst.state === stateFilter) {
    showDetailPanel(right, _restoreInst);
  } else {
    if (!_restoreInst) setSelectedInstId(null);   // stale selection (instance deleted) → clear it
    showHint(right);
  }

  // ---- Cell renderer ----
  function renderCell(cell, layerId, envUuid) {
    cell.innerHTML = "";
    var eng = getActiveEngagement();
    if (!eng) return;

    // In desired view, show current items not yet reviewed as ghost tiles.
    //
    // Ghost suppression: a current item's ghost is hidden when a matching
    // desired tile already exists in the same (layerId, environmentId)
    // cell. The match is satisfied either by an originId link OR by an
    // identical label. The label-match arm matters because some import
    // flows create two independent records (one current, one desired)
    // with no originId linkage; without it the engineer would see a ghost
    // tile next to the very desired tile that fulfills it.
    if (stateFilter === "desired") {
      var currentInCell = _walkInstances(eng, function(i) {
        return i.state === "current" && i.layerId === layerId && i.environmentId === envUuid;
      });
      currentInCell.forEach(function(curInst) {
        var sameLabelDesiredExists = _walkInstances(eng, function(d) {
          return d.state === "desired" &&
                 d.layerId === curInst.layerId &&
                 d.environmentId === curInst.environmentId &&
                 d.label === curInst.label;
        }).length > 0;
        var hasOriginIdCounterpart = _walkInstances(eng, function(d) {
          return d.state === "desired" && d.originId === curInst.id;
        }).length > 0;
        var hasCounterpart = hasOriginIdCounterpart || sameLabelDesiredExists;
        if (!hasCounterpart) {
          cell.appendChild(buildGhostTile(curInst));
        }
      });
    }

    // Actual desired/current instances in this cell
    var instances = _walkInstances(eng, function(i) {
      return i.state === stateFilter && i.layerId === layerId && i.environmentId === envUuid;
    });
    instances.forEach(function(inst) {
      cell.appendChild(buildTile(inst));
    });

    // Add button
    var addBtn = mk("button", "add-tile-btn");
    addBtn.setAttribute("data-add-instance", "");
    addBtn.setAttribute("data-layer-id", layerId);
    addBtn.setAttribute("data-env-id",   envUuid);
    addBtn.textContent = "+ Add";
    addBtn.addEventListener("click", function(e) {
      e.stopPropagation();
      openCommandPalette(layerId, envUuid);
    });
    cell.appendChild(addBtn);
  }

  function refreshCell(layerId, envUuid) {
    // Cells are keyed by data-env-uuid for internal lookups; data-env-id
    // is the catalog-ref attribute used by CSS.
    var cell = grid.querySelector("[data-layer-id='" + layerId + "'][data-env-uuid='" + envUuid + "']");
    if (cell) renderCell(cell, layerId, envUuid);
    if (stateFilter === "desired") {
      var wrap2 = document.getElementById("unreviewed-banner-wrap");
      if (wrap2) updateUnreviewedBanner(wrap2);
    }
  }

  // ---- Ghost tile (unreviewed current item in desired view) ----
  function buildGhostTile(curInst) {
    var critLevel = curInst.criticality ? curInst.criticality.toLowerCase() : null;
    var cls = "instance-tile vg-" + (curInst.vendorGroup || "custom") + " ghost-tile mirror-tile";
    if (critLevel) cls += " crit-" + critLevel;

    var tile = mk("div", cls);
    tile.title = "Click to set what happens to this in the desired state";
    var lbl = mk("span", "tile-label"); lbl.textContent = curInst.label; tile.appendChild(lbl);
    var badge = mk("span", "disposition-badge badge-unreviewed"); badge.textContent = "? Review"; tile.appendChild(badge);
    if (critLevel) {
      var shape = mk("span", "crit-shape-" + critLevel);
      shape.title = "Criticality carried from current: " + curInst.criticality;
      tile.appendChild(shape);
    }
    tile.addEventListener("click", function() { showDispositionPanel(right, curInst, null); });
    return tile;
  }

  // ---- Regular tile ----
  function buildTile(inst) {
    var vg  = inst.vendorGroup || "custom";

    var critLevel   = null;
    var critSourceLbl = null;
    if (stateFilter === "current" && inst.criticality) {
      critLevel = inst.criticality.toLowerCase();
      critSourceLbl = inst.criticality;
    } else if (stateFilter === "desired" && inst.originId) {
      var eng = getActiveEngagement();
      var origin = eng && eng.instances && eng.instances.byId[inst.originId];
      if (origin && origin.criticality) {
        critLevel = origin.criticality.toLowerCase();
        critSourceLbl = origin.criticality + " , carried from '" + origin.label + "'";
      }
    }

    var cls = "instance-tile vg-" + vg + (inst.id === selectedInstId ? " selected" : "");
    if (critLevel) cls += " crit-" + critLevel;
    // Instances mutated by AI gain an "ai-tagged" CSS modifier; the
    // .ai-tag-badge inside surfaces a "Done by AI" chip. The aiTag clears
    // on the next engineer save (updateInstance strips it).
    if (inst.aiTag) cls += " ai-tagged";

    var tile = mk("div", cls);
    tile.setAttribute("data-instance-id", inst.id);

    // "Done by AI" badge on AI-mutated instances. aiTag.kind splits the
    // badge into two variants:
    //   - kind="skill"        -> "AI" badge
    //   - kind="external-llm" -> "iLLM" badge, for imports via the
    //                            Dell-internal-LLM workflow
    // The tooltip carries the source or skillId per kind.
    if (inst.aiTag) {
      var aiBadge = mk("span", "ai-tag-badge");
      aiBadge.setAttribute("data-ai-tag-badge", "");
      var isExternalLlm = inst.aiTag.kind === "external-llm";
      if (isExternalLlm) {
        aiBadge.classList.add("ai-tag-badge-illm");
        aiBadge.setAttribute("data-ai-tag-kind", "external-llm");
        aiBadge.title = "Imported from external LLM (" + (inst.aiTag.source || "?") + ") · runId " +
          (inst.aiTag.runId || "?") + " · " + (inst.aiTag.mutatedAt || "?") +
          " - clears when you save the next edit on this tile.";
        aiBadge.textContent = "iLLM";
      } else {
        aiBadge.setAttribute("data-ai-tag-kind", "skill");
        aiBadge.title = "Mutated by AI · skill " + (inst.aiTag.skillId || "?") +
          " · " + (inst.aiTag.mutatedAt || "?") +
          " - clears when you save the next edit on this tile.";
        aiBadge.textContent = "AI";
      }
      tile.appendChild(aiBadge);
    }

    var lbl = mk("span", "tile-label"); lbl.textContent = inst.label; tile.appendChild(lbl);

    if (stateFilter === "desired" && inst.disposition) {
      var da = DISPOSITION_ACTIONS.find(function(a) { return a.id === inst.disposition; });
      var badge = mk("span", "disposition-badge badge-" + inst.disposition);
      badge.textContent = da ? da.label : inst.disposition;
      tile.appendChild(badge);
    }
    if (stateFilter === "desired" && inst.priority && !inst.disposition) {
      var pb = mk("span", "priority-badge priority-" + inst.priority.toLowerCase());
      pb.textContent = inst.priority; tile.appendChild(pb);
    }
    if (critLevel) {
      var shape = mk("span", "crit-shape-" + critLevel);
      shape.title = "Criticality: " + critSourceLbl;
      tile.appendChild(shape);
    }

    var del = mk("button", "tile-del"); del.textContent = "x"; del.title = "Remove";
    del.addEventListener("click", function(e) {
      e.stopPropagation();
      if (!confirm("Remove " + inst.label + "?")) return;
      var r = commitInstanceRemove(inst.id);
      if (r && r.ok === false) { showToast(r.errors ? "Remove failed: " + r.errors[0].message : "Remove failed", "err"); return; }
      if (selectedInstId === inst.id) { selectedInstId = null; setSelectedInstId(null); showHint(right); }
      refreshCell(inst.layerId, inst.environmentId);
    });
    tile.appendChild(del);

    tile.addEventListener("click", function() {
      selectedInstId = inst.id;
      setSelectedInstId(inst.id);
      grid.querySelectorAll(".instance-tile").forEach(function(t) {
        t.classList.toggle("selected", t.getAttribute("data-instance-id") === inst.id);
      });
      if (stateFilter === "desired" && inst.originId && !inst.disposition) {
        var eng = getActiveEngagement();
        var srcInst = getCurrentSource(eng, inst);
        if (srcInst) { showDispositionPanel(right, srcInst, inst.disposition); return; }
      }
      showDetailPanel(right, inst);
    });
    return tile;
  }

  // ---- Disposition picker panel ----
  function showDispositionPanel(right, curInst, preselected) {
    right.innerHTML = "";
    var panel = mk("div", "detail-panel");

    var titleEl = mk("div", "detail-title"); titleEl.textContent = "What happens to this?"; panel.appendChild(titleEl);
    var subEl   = mk("div", "detail-sub");   subEl.textContent   = curInst.label;            panel.appendChild(subEl);
    var vb      = mk("span", "vg-badge vg-" + (curInst.vendorGroup || "custom"));
    vb.textContent = curInst.vendorGroup === "dell" ? "Dell" : curInst.vendorGroup === "nonDell" ? "Non-Dell" : "Custom";
    panel.appendChild(vb);

    panel.appendChild(mkSep("Choose a disposition"));

    var grid2 = mk("div", "disposition-grid");
    DISPOSITION_ACTIONS.forEach(function(action) {
      var btn = mk("div", "disposition-btn" + (preselected === action.id ? " disposition-btn-selected" : ""));
      var nameSpan = mk("strong"); nameSpan.textContent = action.label;
      var hintSpan = mk("span");   hintSpan.textContent = action.hint;
      btn.appendChild(nameSpan); btn.appendChild(hintSpan);
      btn.addEventListener("click", function() {
        applyDisposition(curInst, action.id);
      });
      grid2.appendChild(btn);
    });
    panel.appendChild(grid2);

    var notesGroup = mk("div", "form-group");
    notesGroup.style.marginTop = "12px";
    var notesLabel = mk("label", "form-label"); notesLabel.textContent = "Notes (optional)";
    var notesInput = mk("textarea", "form-textarea");
    notesInput.id = "disposition-notes"; notesInput.rows = 2;
    notesInput.placeholder = "Add context about why this disposition was chosen...";
    notesGroup.appendChild(notesLabel); notesGroup.appendChild(notesInput);
    panel.appendChild(notesGroup);

    right.appendChild(panel);
  }

  // ---- Apply disposition ----
  function applyDisposition(curInst, actionId) {
    var notes = (document.getElementById("disposition-notes") || {}).value || "";
    var eng = getActiveEngagement();
    if (!eng) return;

    // Find existing desired counterpart (may have been created before).
    var existing = getDesiredCounterpart(eng, curInst.id);

    var desiredInst;
    if (existing) {
      var r = commitInstanceUpdate(existing.id, {
        disposition: actionId,
        notes:       notes || existing.notes || ""
      });
      if (r && r.ok === false) { showToast("Update failed: " + (r.errors && r.errors[0] && r.errors[0].message), "err"); return; }
      desiredInst = getActiveEngagement().instances.byId[existing.id];
    } else {
      var newLabel = actionId === "retire" ? curInst.label + " [RETIRE]" : curInst.label;
      var addRes = commitInstanceAdd({
        state:         "desired",
        layerId:       curInst.layerId,
        environmentId: curInst.environmentId,   // v3 env UUID
        label:         newLabel,
        vendor:        curInst.vendor,
        vendorGroup:   curInst.vendorGroup,
        disposition:   actionId,
        originId:      curInst.id,
        notes:         notes,
        priority:      "Now"
      });
      if (addRes && addRes.ok === false) { showToast("Create failed: " + (addRes.errors && addRes.errors[0] && addRes.errors[0].message), "err"); return; }
      // Find the freshly-added instance via its originId, reading from the
      // engagement reference the commit returned.
      var nextEng = (addRes && addRes.engagement) || getActiveEngagement();
      desiredInst = _walkInstances(nextEng, function(i) {
        return i.state === "desired" && i.originId === curInst.id;
      })[0];
    }

    // Auto-create gap draft if applicable. Walk gaps from the latest
    // engagement reference (post commit).
    var gapDrafted = false;
    var engPost = getActiveEngagement();
    if (ACTION_TO_GAP_TYPE[actionId] && desiredInst) {
      var alreadyLinked = engPost.gaps.allIds.some(function(gapId) {
        var g = engPost.gaps.byId[gapId];
        return (Array.isArray(g.relatedCurrentInstanceIds) && g.relatedCurrentInstanceIds.indexOf(curInst.id) >= 0)
            || (Array.isArray(g.relatedDesiredInstanceIds) && g.relatedDesiredInstanceIds.indexOf(desiredInst.id) >= 0);
      });
      if (!alreadyLinked) {
        var gapProps = buildGapFromDisposition(engPost, desiredInst);
        if (gapProps) {
          var gapRes = commitGapAdd(gapProps);
          if (gapRes && gapRes.ok !== false) gapDrafted = true;
        }
      }
    }

    // Sync linked gaps' phase/gapType/urgency from the post-edit
    // desired instance.
    if (desiredInst) commitSyncGapFromDesired(desiredInst.id);

    refreshCell(curInst.layerId, curInst.environmentId);
    if (desiredInst) showDetailPanel(right, _liveInstance(desiredInst.id) || desiredInst);

    if (gapDrafted) {
      var engNow = getActiveEngagement();
      var unreviewed = engNow.gaps.allIds.filter(function(gid) {
        var g = engNow.gaps.byId[gid];
        return g.reviewed === false && g.status !== "closed";
      }).length;
      showToast("↳ Gap drafted on Tab 4 (" + unreviewed + " unreviewed)", "ok");
    } else if (actionId === "keep") {
      showToast("Set to Keep , any linked gaps were closed (Tab 4 → Show closed)", "ok");
    } else {
      showToast("Disposition set: " + actionId, "ok");
    }
  }

  // ---- Command palette ----
  function openCommandPalette(layerId, envUuid) {
    document.getElementById("cmd-palette")?.remove();
    var overlay = mk("div", "cmd-overlay"); overlay.id = "cmd-palette";
    var box     = mk("div", "cmd-box");

    // envCatalogId is needed below for the catalog filter (CATALOG entries
    // opt into specific env catalogs by envCatalogId, not by UUID).
    var envCatalogId = _envCatalogIdFromUuid(envUuid);
    // Centralized label resolvers return structured placeholders
    // ("(unknown layer)", "(unknown environment)") rather than leaking a
    // raw id when resolution misses.
    var ctx = mk("div", "cmd-context");
    ctx.textContent = layerLabelResolver(layerId) + " -- " + envLabelResolver(envCatalogId || envUuid);
    box.appendChild(ctx);

    var srch = document.createElement("input");
    srch.className = "cmd-search";
    srch.placeholder = "Search catalog or type a custom name...";
    srch.setAttribute("autocomplete", "off");
    box.appendChild(srch);

    var results = mk("div", "cmd-results");
    box.appendChild(results);
    box.appendChild(mkt("div", "cmd-hint", "Arrows navigate, Enter selects, Esc closes"));

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    srch.focus();

    // Catalog filter is keyed by envCatalogId (e.g. "coreDc" /
    // "publicCloud") -- entries opt into specific env catalogs.
    var catalog = (CATALOG[layerId] || []).filter(function(t) {
      return !t.environments || t.environments.indexOf(envCatalogId) >= 0;
    });
    var activeIdx = -1;

    function render(q) {
      results.innerHTML = ""; activeIdx = -1;
      var filtered = q
        ? catalog.filter(function(t) { return t.label.toLowerCase().indexOf(q.toLowerCase()) >= 0; })
        : catalog;

      var groups = { dell:[], nonDell:[], custom:[] };
      filtered.forEach(function(t) { (groups[t.vendorGroup] = groups[t.vendorGroup] || []).push(t); });

      [["dell","Dell"],["nonDell","Non-Dell"],["custom","Other / Custom"]].forEach(function(g) {
        if (!groups[g[0]] || !groups[g[0]].length) return;
        results.appendChild(mkt("div", "cmd-group-sep", g[1]));
        groups[g[0]].forEach(function(tile) {
          results.appendChild(buildItem(tile.label, tile.vendor, tile.vendorGroup, function() {
            addToCell(tile.label, tile.vendor, tile.vendorGroup);
          }));
        });
      });

      if (q && !filtered.find(function(t) { return t.label.toLowerCase() === q.toLowerCase(); })) {
        results.appendChild(mkt("div", "cmd-group-sep", "Add new"));
        results.appendChild(buildItem("+ Add \"" + q + "\" , Dell SKU", "Dell", "dell", function() {
          addToCell(q, "Dell", "dell");
        }));
        var thirdParty = mk("div", "cmd-item cmd-item-3p");
        thirdParty.appendChild(mk("span", "cmd-dot cmd-dot-nonDell"));
        thirdParty.appendChild(mkt("span", "cmd-item-name", "+ Add \"" + q + "\" , 3rd-party vendor..."));
        thirdParty.appendChild(mkt("span", "cmd-item-vendor", "Non-Dell"));
        thirdParty.addEventListener("click", function() { openVendorChooser(q); });
        thirdParty.addEventListener("mouseenter", function() {
          var items = getItems();
          items.forEach(function(el, i) { el.classList.toggle("active", el === thirdParty); if (el === thirdParty) activeIdx = i; });
        });
        results.appendChild(thirdParty);
        results.appendChild(buildItem("+ Add \"" + q + "\" , Custom / internal", "Custom", "custom", function() {
          addToCell(q, "Custom", "custom");
        }));
      }
    }

    var COMMON_VENDORS = ["HPE","Cisco","NetApp","Pure","IBM","Microsoft","VMware","Nutanix","Red Hat","AWS","Azure","Google"];
    function openVendorChooser(name) {
      results.innerHTML = "";
      results.appendChild(mkt("div", "cmd-group-sep", "Pick vendor for \"" + name + "\""));
      COMMON_VENDORS.forEach(function(v) {
        results.appendChild(buildItem(v, v, "nonDell", function() {
          addToCell(name, v, "nonDell");
        }));
      });
      var otherRow = mk("div", "cmd-item");
      otherRow.appendChild(mk("span", "cmd-dot cmd-dot-nonDell"));
      otherRow.appendChild(mkt("span", "cmd-item-name", "Other (type vendor name)"));
      otherRow.appendChild(mkt("span", "cmd-item-vendor", "custom"));
      otherRow.addEventListener("click", function() {
        results.innerHTML = "";
        results.appendChild(mkt("div", "cmd-group-sep", "Type vendor name for \"" + name + "\""));
        var input = document.createElement("input");
        input.className = "cmd-search";
        input.placeholder = "e.g. Veritas, Hitachi...";
        input.style.margin = "8px 12px";
        results.appendChild(input);
        setTimeout(function() { input.focus(); }, 0);
        input.addEventListener("keydown", function(e) {
          if (e.key === "Enter" && input.value.trim()) {
            addToCell(name, input.value.trim(), "nonDell");
            close();
          }
          if (e.key === "Escape") { render(srch.value.trim()); }
        });
      });
      results.appendChild(otherRow);
    }

    function buildItem(label, vendor, vg, onClick) {
      var item = mk("div", "cmd-item");
      var dot  = mk("span", "cmd-dot cmd-dot-" + vg);
      item.appendChild(dot);
      item.appendChild(mkt("span", "cmd-item-name", label));
      item.appendChild(mkt("span", "cmd-item-vendor", vendor));
      item.addEventListener("click", function() { onClick(); close(); });
      item.addEventListener("mouseenter", function() {
        var items = getItems();
        items.forEach(function(el, i) { el.classList.toggle("active", el === item); if (el === item) activeIdx = i; });
      });
      return item;
    }

    function getItems() { return Array.from(results.querySelectorAll(".cmd-item")); }

    function addToCell(label, vendor, vg) {
      var r = commitInstanceAdd({
        state:         stateFilter,
        layerId:       layerId,
        environmentId: envUuid,
        label:         label,
        vendor:        vendor,
        vendorGroup:   vg
      });
      if (r && r.ok === false) {
        showToast("Add failed: " + (r.errors && r.errors[0] && r.errors[0].message), "err");
        return;
      }
      refreshCell(layerId, envUuid);
    }

    function close() { overlay.remove(); }

    srch.addEventListener("input", function() { render(srch.value.trim()); });
    srch.addEventListener("keydown", function(e) {
      var items = getItems();
      if (e.key === "Escape") { close(); return; }
      if (e.key === "ArrowDown") { activeIdx = Math.min(activeIdx + 1, items.length - 1); highlight(items); e.preventDefault(); }
      if (e.key === "ArrowUp")   { activeIdx = Math.max(activeIdx - 1, 0);                highlight(items); e.preventDefault(); }
      if (e.key === "Enter" && activeIdx >= 0 && items[activeIdx]) items[activeIdx].click();
    });
    function highlight(items) {
      items.forEach(function(el, i) { el.classList.toggle("active", i === activeIdx); });
      if (items[activeIdx]) items[activeIdx].scrollIntoView({ block:"nearest" });
    }

    overlay.addEventListener("click", function(e) { if (e.target === overlay) close(); });
    render("");
  }

  // ---- Detail panel ----
  function showDetailPanel(right, inst) {
    selectedInstId = inst.id;
    setSelectedInstId(inst.id);
    right.innerHTML = "";
    var panel = mk("div", "detail-panel");

    var titleEl = mk("div", "detail-title"); titleEl.textContent = inst.label; panel.appendChild(titleEl);
    var subEl   = mk("div", "detail-sub");   subEl.textContent   = inst.vendor || inst.vendorGroup; panel.appendChild(subEl);
    var vb = mk("span", "vg-badge vg-" + (inst.vendorGroup || "custom"));
    vb.textContent = inst.vendorGroup === "dell" ? "Dell" : inst.vendorGroup === "nonDell" ? "Non-Dell" : "Custom";
    panel.appendChild(vb);

    if (inst.originId) {
      var eng = getActiveEngagement();
      var src = getCurrentSource(eng, inst);
      if (src) {
        var originNote = mk("div", "detail-origin");
        originNote.textContent = "Mirrors current: " + src.label;
        panel.appendChild(originNote);
      }
    }

    var form = mk("div", "edit-form");

    if (stateFilter === "current") {
      form.appendChild(fg("Criticality", selEl("criticality", ["","Low","Medium","High"], inst.criticality || "")));
    } else {
      var dispOpts = [""].concat(DISPOSITION_ACTIONS.map(function(a) { return a.id; }));
      var dispLabels = {};
      DISPOSITION_ACTIONS.forEach(function(a) { dispLabels[a.id] = a.label; });
      form.appendChild(fg("Action", selEl("disposition", dispOpts, inst.disposition || "", dispLabels)));

      if (inst.disposition !== "keep") {
        var currentPhase = inst.priority || (!inst.originId ? "Next" : "");
        var phaseLabels = {
          "":      "-- choose --",
          "Now":   "Now (0-12 months)",
          "Next":  "Next (12-24 months)",
          "Later": "Later (> 24 months)"
        };
        var phaseSel = selEl("priority", ["","Now","Next","Later"], currentPhase, phaseLabels);
        phaseSel.setAttribute("title",
          "Phase drives the roadmap column and the linked gap's phase. Defaults to 'Next' for net-new items. Change it to reschedule the related project.");
        form.appendChild(fg("Phase", phaseSel));
      }
    }

    var notesHint = stateFilter === "current"
      ? "Pain, version, end-of-life, technical debt..."
      : "Outcome, requirements, constraints...";
    form.appendChild(fg("Notes", taEl("notes", inst.notes || "", notesHint)));
    panel.appendChild(form);

    var saveBtn = mk("button", "btn-primary"); saveBtn.textContent = "Save changes";
    saveBtn.addEventListener("click", function() {
      var patch = {};
      form.querySelectorAll("[data-prop]").forEach(function(el) {
        var v = el.value;
        // Schema fields default to "" for notes and null for optional
        // priority/disposition. Map empty-string to null for nullable
        // fields; pass others through.
        var prop = el.getAttribute("data-prop");
        if ((prop === "priority" || prop === "disposition") && (v === "" || v === undefined)) {
          patch[prop] = null;
        } else if (prop === "criticality" && (v === "" || v === undefined)) {
          // criticality is required-non-null in schema; coerce empty to "Low" default.
          patch[prop] = "Low";
        } else {
          patch[prop] = v;
        }
      });
      var r = commitInstanceUpdate(inst.id, patch);
      if (r && r.ok === false) {
        showToast(r.errors && r.errors[0] ? r.errors[0].message : "Save failed", "err");
        return;
      }
      // Post-save sync: keep linked gaps in line with upstream changes.
      if (stateFilter === "desired") {
        commitSyncGapFromDesired(inst.id);
      } else if (stateFilter === "current") {
        commitSyncGapsFromCurrentCriticality(inst.id);
      }
      saveBtn.textContent = "Saved";
      setTimeout(function() {
        saveBtn.textContent = "Save changes";
        refreshCell(inst.layerId, inst.environmentId);
      }, 800);
    });

    var actions = mk("div", "form-actions");
    actions.appendChild(saveBtn);
    var delBtn = mk("button", "btn-danger"); delBtn.textContent = "Remove";
    delBtn.addEventListener("click", function() {
      if (!confirm("Remove " + inst.label + "?")) return;
      var r = commitInstanceRemove(inst.id);
      if (r && r.ok === false) { showToast("Remove failed", "err"); return; }
      selectedInstId = null;
      setSelectedInstId(null);
      refreshCell(inst.layerId, inst.environmentId);
      showHint(right);
    });
    actions.appendChild(delBtn);
    panel.appendChild(actions);

    if (inst.layerId === "workload") {
      panel.appendChild(buildMappedAssetsSection(right, inst));
    }

    right.appendChild(panel);
  }

  // ---- Mapped infrastructure (workload tiles) ----
  function buildMappedAssetsSection(right, workload) {
    var section = mk("div", "mapped-assets-section");
    section.appendChild(mkt("div", "mapped-assets-title", "Mapped infrastructure"));

    var eng = getActiveEngagement();

    // Linked variants in other environments -- same workload label/state
    // across multiple environments.
    var variants = _walkInstances(eng, function(i) {
      return i.id !== workload.id &&
             i.layerId === "workload" &&
             i.state === workload.state &&
             i.label === workload.label &&
             i.environmentId !== workload.environmentId;
    });
    if (variants.length > 0) {
      var variantBox = mk("div", "linked-variants-box");
      variantBox.appendChild(mkt("span", "linked-variants-eyebrow", "LINKED VARIANTS"));
      variantBox.appendChild(mkt("span", "linked-variants-msg", "Same workload also runs in: "));
      variants.forEach(function(v, idx) {
        var envLabel = _envLabelFromUuid(v.environmentId);
        var chip = mkt("span", "linked-variant-chip", envLabel);
        chip.title = "Click to open this variant tile in " + envLabel;
        chip.style.cursor = "pointer";
        chip.addEventListener("click", function() {
          document.dispatchEvent(new CustomEvent("dell-canvas:navigate-to-tile", {
            detail: { instanceId: v.id, state: v.state, layerId: v.layerId, environmentId: v.environmentId }
          }));
        });
        variantBox.appendChild(chip);
        if (idx < variants.length - 1) variantBox.appendChild(document.createTextNode(" "));
      });
      section.appendChild(variantBox);
    }

    var mapped = (workload.mappedAssetIds || [])
      .map(function(id) { return eng.instances.byId[id]; })
      .filter(Boolean);

    var list = mk("div", "mapped-asset-list");
    if (mapped.length === 0) {
      list.appendChild(mkt("div", "mapped-asset-empty", "No assets mapped yet. Map the infrastructure this workload runs on so its criticality can propagate down."));
    } else {
      mapped.forEach(function(asset) {
        var row = mk("div", "mapped-asset-row");
        var dot = mk("span", "cmd-dot cmd-dot-" + (asset.vendorGroup || "custom"));
        row.appendChild(dot);
        row.appendChild(mkt("span", "mapped-asset-label", asset.label));
        var layerObj = LAYERS.find(function(l) { return l.id === asset.layerId; });
        var envLabel2 = _envLabelFromUuid(asset.environmentId);
        row.appendChild(mkt("span", "mapped-asset-sub",
          (layerObj ? layerObj.label : asset.layerId) + " / " + envLabel2));
        if (asset.criticality) {
          row.appendChild(mkt("span", "mapped-asset-crit crit-" + asset.criticality.toLowerCase(), asset.criticality));
        }
        var unmap = mkt("button", "link-unlink-btn", "x");
        unmap.title = "Unmap this asset";
        unmap.addEventListener("click", function() {
          // Read the current mappedAssetIds, drop the one being unmapped,
          // and commit via commitWorkloadMap.
          var live = _liveInstance(workload.id);
          if (!live) return;
          var nextIds = (live.mappedAssetIds || []).filter(function(id) { return id !== asset.id; });
          var r = commitWorkloadMap(workload.id, nextIds);
          if (r && r.ok === false) { alert(r.errors && r.errors[0] ? r.errors[0].message : "Unmap failed"); return; }
          showDetailPanel(right, _liveInstance(workload.id) || workload);
        });
        row.appendChild(unmap);
        list.appendChild(row);
      });
    }
    section.appendChild(list);

    var btnRow = mk("div", "mapped-asset-actions");
    var addBtn = mkt("button", "btn-ghost-sm", "+ Map asset");
    addBtn.addEventListener("click", function() { openAssetPicker(workload, right); });
    btnRow.appendChild(addBtn);

    if (workload.criticality && mapped.length > 0) {
      var propBtn = mkt("button", "btn-ghost-sm propagate-btn", "↑ Propagate criticality");
      propBtn.title = "Upgrade any mapped asset whose criticality is lower than this workload's.";
      propBtn.addEventListener("click", function() { runPropagation(workload, right); });
      btnRow.appendChild(propBtn);
    }
    section.appendChild(btnRow);
    return section;
  }

  function openAssetPicker(workload, right) {
    document.getElementById("map-asset-picker")?.remove();
    var overlay = mk("div", "dialog-overlay"); overlay.id = "map-asset-picker";
    var box     = mk("div", "dialog-box");
    box.appendChild(mkt("div", "dialog-title", "Map an asset to '" + workload.label + "'"));

    var eng = getActiveEngagement();
    var alreadyMapped = workload.mappedAssetIds || [];
    var candidates = _walkInstances(eng, function(i) {
      return i.state === workload.state
          && i.environmentId === workload.environmentId
          && i.layerId !== "workload"
          && alreadyMapped.indexOf(i.id) < 0;
    });

    var envLabel = _envLabelFromUuid(workload.environmentId);
    box.appendChild(mkt("div", "detail-ph-hint",
      "Showing " + workload.state + " assets in " + envLabel +
      " only. To map a hybrid workload, create a separate workload tile in the other environment."));

    if (candidates.length === 0) {
      box.appendChild(mkt("div", "detail-ph-hint",
        "No unmapped " + workload.state + " assets available in " + envLabel +
        ". Add infrastructure tiles in this environment's column first."));
    } else {
      var list = mk("div", "link-picker-list");
      candidates.forEach(function(asset) {
        var item = mk("div", "link-picker-item");
        var dot  = mk("span", "cmd-dot cmd-dot-" + (asset.vendorGroup || "custom"));
        item.appendChild(dot);
        item.appendChild(mkt("span", "cmd-item-name", asset.label));
        var layerObj = LAYERS.find(function(l) { return l.id === asset.layerId; });
        var envLabel2 = _envLabelFromUuid(asset.environmentId);
        item.appendChild(mkt("span", "cmd-item-vendor",
          (layerObj ? layerObj.label : asset.layerId) + " / " + envLabel2));
        item.addEventListener("click", function() {
          var live = _liveInstance(workload.id);
          var nextIds = (live ? (live.mappedAssetIds || []).slice() : []);
          if (nextIds.indexOf(asset.id) < 0) nextIds.push(asset.id);
          var r = commitWorkloadMap(workload.id, nextIds);
          if (r && r.ok === false) { alert(r.errors && r.errors[0] ? r.errors[0].message : "Map failed"); return; }
          overlay.remove();
          showDetailPanel(right, _liveInstance(workload.id) || workload);
        });
        list.appendChild(item);
      });
      box.appendChild(list);
    }
    var foot = mk("div", "form-actions");
    var cancel = mkt("button", "btn-secondary", "Cancel");
    cancel.addEventListener("click", function() { overlay.remove(); });
    foot.appendChild(cancel);
    box.appendChild(foot);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    overlay.addEventListener("click", function(e) { if (e.target === overlay) overlay.remove(); });
  }

  function runPropagation(workload, right) {
    var eng = getActiveEngagement();
    var freshWorkload = (eng && eng.instances.byId[workload.id]) || workload;
    var proposals = proposeCriticalityUpgrades(eng, freshWorkload.id);
    if (proposals.length === 0) {
      alert("All mapped assets already meet or exceed '" + freshWorkload.label + "' criticality (" + freshWorkload.criticality + "). Nothing to propagate.");
      return;
    }
    var applied = [];
    proposals.forEach(function(p) {
      var msg = "Upgrade '" + p.label + "' criticality from " +
                (p.currentCrit || "(unset)") + " to " + p.newCrit +
                " to match workload '" + freshWorkload.label + "'?";
      if (window.confirm(msg)) {
        var r = commitInstanceUpdate(p.assetId, { criticality: p.newCrit });
        if (r && r.ok === false) {
          alert("Failed to upgrade " + p.label + ": " + (r.errors && r.errors[0] && r.errors[0].message));
        } else {
          applied.push(p);
        }
      }
    });
    applied.forEach(function(p) {
      var asset = (getActiveEngagement().instances.byId[p.assetId]);
      if (asset) refreshCell(asset.layerId, asset.environmentId);
    });
    showDetailPanel(right, _liveInstance(freshWorkload.id) || freshWorkload);
    if (applied.length > 0) {
      var appliedLevel = (applied[0] && applied[0].newCrit) || freshWorkload.criticality || "(unknown)";
      try { showToast(applied.length + " asset" + (applied.length === 1 ? "" : "s") + " upgraded to " + appliedLevel, "ok"); }
      catch(e) { /* showToast is module-scoped; ignore if unreachable */ }
    }
  }

  // ---- v3-native helpers (closure-scoped) ----
  function _liveInstance(uuid) {
    var eng = getActiveEngagement();
    return eng && eng.instances ? eng.instances.byId[uuid] : null;
  }

  // _getVisibleEnvs · returns the engagement's environments filtered by
  // !hidden. Each entry: { uuid, envCatalogId, label, alias, hidden }.
  // Returns an empty list when the engagement has no environments.
  function _getVisibleEnvs() {
    var eng = getActiveEngagement();
    if (eng && eng.environments && eng.environments.allIds && eng.environments.allIds.length > 0) {
      var out = [];
      for (var i = 0; i < eng.environments.allIds.length; i++) {
        var id = eng.environments.allIds[i];
        var e = eng.environments.byId[id];
        if (!e || e.hidden) continue;
        var catalog = ENV_CATALOG.find(function(c) { return c.id === e.envCatalogId; });
        out.push({
          uuid:         e.id,
          envCatalogId: e.envCatalogId,
          label:        (e.alias && e.alias.length > 0) ? e.alias : (catalog ? catalog.label : e.envCatalogId),
          alias:        e.alias || null,
          hidden:       false
        });
      }
      return out;
    }
    // Fresh / empty engagement -- no environments to show. Environments
    // must be materialized (via Tab 1's "+ Add environment") before
    // instances can land in them.
    return [];
  }

  function _envLabelFromUuid(uuid) {
    var eng = getActiveEngagement();
    if (eng && eng.environments && eng.environments.byId[uuid]) {
      var e = eng.environments.byId[uuid];
      if (e.alias && e.alias.length > 0) return e.alias;
      var cat = ENV_CATALOG.find(function(c) { return c.id === e.envCatalogId; });
      return cat ? cat.label : e.envCatalogId;
    }
    return uuid;
  }

  function _envCatalogIdFromUuid(uuid) {
    var eng = getActiveEngagement();
    if (eng && eng.environments && eng.environments.byId[uuid]) {
      return eng.environments.byId[uuid].envCatalogId;
    }
    return null;
  }

  // Walk eng.instances.allIds + filter. Returns array of instance
  // records (in allIds order). Replaces v2's session.instances.filter().
  function _walkInstances(eng, predicate) {
    if (!eng || !eng.instances || !Array.isArray(eng.instances.allIds)) return [];
    var out = [];
    for (var i = 0; i < eng.instances.allIds.length; i++) {
      var id = eng.instances.allIds[i];
      var inst = eng.instances.byId[id];
      if (inst && predicate(inst)) out.push(inst);
    }
    return out;
  }

  // ---- Banner update ----
  function updateUnreviewedBanner(container) {
    container.innerHTML = "";
    var eng = getActiveEngagement();
    if (!eng) return;
    var totals = { current: 0, unreviewed: 0 };
    var currents = _walkInstances(eng, function(i) { return i.state === "current"; });
    totals.current = currents.length;
    currents.forEach(function(curInst) {
      var hasCounterpart = _walkInstances(eng, function(d) {
        return d.state === "desired" && d.originId === curInst.id;
      }).length > 0;
      if (!hasCounterpart) totals.unreviewed++;
    });
    if (totals.current === 0) return;

    var banner = mk("div", totals.unreviewed > 0 ? "unreviewed-banner banner-warn" : "unreviewed-banner banner-ok");
    if (totals.unreviewed > 0) {
      banner.textContent = totals.unreviewed + " of " + totals.current + " current item" + (totals.current > 1 ? "s" : "") +
        " not yet reviewed -- click the grey dashed tiles to set each disposition.";
    } else {
      banner.textContent = "All " + totals.current + " current items reviewed in desired state.";
    }
    container.appendChild(banner);
  }
}

// ---- Shared helpers (module scope) ----
function showToast(msg, type) {
  var t = document.getElementById("matrix-toast");
  if (!t) { t = mk("div", ""); t.id = "matrix-toast"; document.body.appendChild(t); }
  t.className = "matrix-toast toast-" + (type || "ok");
  t.textContent = msg;
  t.style.opacity = "1";
  clearTimeout(t._timer);
  t._timer = setTimeout(function() { t.style.opacity = "0"; }, 2800);
}

function mk(tag, cls)         { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
function mkt(tag, cls, text)  { var e = mk(tag, cls); e.textContent = text; return e; }
function mkSep(text)          { return mkt("div", "detail-sep", text); }
function fg(label, input)     { var g = mk("div","form-group"); g.appendChild(mkt("label","form-label",label)); g.appendChild(input); return g; }
function selEl(prop, opts, val, lm) {
  var s = mk("select","form-select"); s.setAttribute("data-prop",prop);
  opts.forEach(function(o) { var opt = document.createElement("option"); opt.value = o; opt.textContent = (lm&&lm[o])?lm[o]:(o||"-- none --"); if(o===val)opt.selected=true; s.appendChild(opt); });
  return s;
}
function taEl(prop, val, ph) { var t = mk("textarea","form-textarea"); t.setAttribute("data-prop",prop); t.value=val; t.placeholder=ph||""; t.rows=4; return t; }
function showHint(right) {
  right.innerHTML = "";
  var ph = mk("div","detail-placeholder");
  ph.appendChild(mkt("div","detail-ph-icon","+"));
  ph.appendChild(mkt("div","detail-ph-title","Select a technology"));
  ph.appendChild(mkt("div","detail-ph-hint","Click any tile to edit it. In Desired State, click grey dashed tiles to set a disposition for each current technology."));
  right.appendChild(ph);
}

// The empty-environments UX lives in the shared ui/components/NoEnvsCard.js.
