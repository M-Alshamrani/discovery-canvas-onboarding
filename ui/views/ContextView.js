// ui/views/ContextView.js -- Tab 1 · Context.
//
// Reads engagement state via getActiveEngagement() directly; writes via
// state/adapter.js UUID-keyed commit* helpers.
//
// Right-panel state preservation: a full repaint runs on every commit,
// which would otherwise blow away the selected driver / env detail. This
// view tracks _selectedDriverUuid + _selectedEnvUuid in module scope and
// re-paints the right panel for the last selection at end-of-render, so
// the panel survives commits and app.js's onSessionChanged-driven re-render.
//
// UX contract:
//   1. Identity card (customer name, vertical, region, presales owner).
//      "Save context" commits customer fields.
//   2. Strategic Drivers card -- tiles + "+ Add driver" command palette.
//      Click tile → right panel shows priority + outcomes + conversation
//      starter. Priority change writes via commitDriverUpdate; the right
//      panel persists across the resulting re-render.
//   3. Environments card -- visible tiles + hidden section + "+ Add
//      environment" palette. Click tile → right panel shows alias /
//      location / sizeKw / sqm / tier / notes inputs. Each input change
//      writes via commitEnvUpdate; the right panel persists.

import {
  BUSINESS_DRIVERS, CUSTOMER_VERTICALS, ENV_CATALOG
} from "../../core/config.js";
import {
  commitContextEdit,
  commitDriverAdd,
  commitDriverUpdate,
  commitDriverRemove,
  commitEnvAdd,
  commitEnvUpdate,
  commitEnvHide,
  commitEnvUnhide
} from "../../state/adapter.js";
import {
  getActiveEngagement, setActiveEngagement, commitAction
} from "../../state/engagementStore.js";
import { loadDemo } from "../../core/demoEngagement.js";
import { helpButton } from "./HelpModal.js";
import { renderDemoBanner } from "../components/DemoBanner.js";
import { getStatus as getSaveStatus } from "../../core/saveStatus.js";
import { openOverlay, closeOverlay } from "../components/Overlay.js";
import { confirmAction } from "../components/Notify.js";

// Module-scope selection state. Survives renderContextView re-runs
// triggered by app.js's onSessionChanged listener after a commit.
var _selectedDriverUuid = null;
var _selectedEnvUuid    = null;
// Drives which view re-paints to the right panel after renderContextView:
// "driver" / "env" / null (welcome).
var _selectedKind = null;

export function renderContextView(left, right, _legacySession) {
  // _legacySession is ignored -- kept in the signature for caller
  // compatibility. All reads go through getActiveEngagement.
  left.innerHTML  = "";
  right.innerHTML = "";

  var eng = getActiveEngagement();

  // Fresh-start welcome card vs demo banner. Mutually exclusive.
  if (_isFreshEngagement(eng)) {
    _renderFreshStartCard(left);
  } else if (eng && eng.meta && eng.meta.isDemo) {
    renderDemoBanner(left);
  }

  // ── Identity card ─────────────────────────────────────────
  var idCard = mk("div", "card");
  var titleRow = mk("div", "card-title-row");
  titleRow.appendChild(mkt("div", "card-title", "Discovery context"));
  titleRow.appendChild(helpButton("context"));
  idCard.appendChild(titleRow);
  idCard.appendChild(mkt("div", "card-hint",
    "Capture the essentials. Add the drivers that matter to the customer, then open each to map outcomes."));

  var form = mk("div", "context-form");
  var customer = (eng && eng.customer) || { name: "", vertical: "", region: "", notes: "" };
  var engMeta  = (eng && eng.meta) || {};

  var row1 = mk("div", "context-row-2");
  row1.appendChild(fg("Customer name",
    inputF("customer.name", customer.name || "", "e.g. Acme Financial Services")));
  row1.appendChild(fg("Vertical / segment",
    selectF("customer.vertical", customer.vertical || "", CUSTOMER_VERTICALS, "Select vertical...")));
  form.appendChild(row1);

  var row2 = mk("div", "context-row-2");
  row2.appendChild(fg("Region",
    inputF("customer.region", customer.region || "", "e.g. EMEA, North America")));
  // presalesOwner is wired through to engagement.meta.presalesOwner via
  // commitContextEdit({meta:{...}}); the executive-summary selector reads it.
  row2.appendChild(fg("Presales owner",
    inputF("engagementMeta.presalesOwner", engMeta.presalesOwner || "", "Your name")));
  form.appendChild(row2);

  // customer.notes is a free-text field; it gets a full-width row since
  // it benefits from horizontal space.
  var row3 = mk("div", "context-row-1");
  var notesInput = mk("textarea", "form-textarea");
  notesInput.setAttribute("data-field", "customer.notes");
  notesInput.rows = 3;
  notesInput.placeholder = "Anything else worth remembering about this customer - context, history, sensitivities, prior engagements...";
  notesInput.value = customer.notes || "";
  row3.appendChild(fg("Customer notes (optional)", notesInput));
  form.appendChild(row3);

  idCard.appendChild(form);

  var saveIdBtn = mk("button", "btn-primary");
  saveIdBtn.textContent = "Save context";
  saveIdBtn.style.marginTop = "8px";
  saveIdBtn.addEventListener("click", function() {
    var customerPatch = {};
    var metaPatch     = {};
    form.querySelectorAll("[data-field]").forEach(function(input) {
      var path = input.getAttribute("data-field").split(".");
      if (path.length === 2 && path[0] === "customer") {
        customerPatch[path[1]] = input.value;
      } else if (path.length === 2 && path[0] === "engagementMeta") {
        metaPatch[path[1]] = input.value;
      }
    });

    // Detect an actual change against current values. A no-op save
    // (clicking Save with the demo's own values intact) preserves isDemo
    // and skips the commit.
    var preEng = getActiveEngagement();
    var preCustomer = (preEng && preEng.customer) || {};
    var preMeta     = (preEng && preEng.meta)     || {};
    var customerChanged = Object.keys(customerPatch).some(function(k) {
      return (preCustomer[k] || "") !== (customerPatch[k] || "");
    });
    var metaChanged = Object.keys(metaPatch).some(function(k) {
      return (preMeta[k] || "") !== (metaPatch[k] || "");
    });

    if (customerChanged || metaChanged) {
      commitContextEdit({
        customer: customerChanged ? customerPatch : undefined,
        meta:     metaChanged     ? metaPatch     : undefined
      });
      // Flip isDemo off only when the user actually edited a field AND
      // customer.name is non-empty: typing your own customer name signals
      // "this is a real session".
      var postEng = getActiveEngagement();
      var name = (postEng && postEng.customer && postEng.customer.name) || "";
      if (postEng && postEng.meta && postEng.meta.isDemo === true && name.trim().length > 0) {
        setActiveEngagement(Object.assign({}, postEng, {
          meta: Object.assign({}, postEng.meta, { isDemo: false })
        }));
      }
    }

    saveIdBtn.textContent = "Saved";
    setTimeout(function() { saveIdBtn.textContent = "Save context"; }, 1500);
  });
  idCard.appendChild(saveIdBtn);
  left.appendChild(idCard);

  // ── Drivers card ─────────────────────────────────────────
  var driversCard = mk("div", "card");
  driversCard.style.marginTop = "12px";
  driversCard.appendChild(mkt("div", "card-title", "Strategic Drivers"));
  driversCard.appendChild(mkt("div", "card-hint",
    "Add the strategic drivers the customer cares about. Click any tile to open its priority and outcomes on the right."));

  var driversRow = mk("div", "drivers-row");
  driversCard.appendChild(driversRow);
  left.appendChild(driversCard);

  _paintDriverTiles(driversRow, right);

  // ── Environments card ────────────────────────────────────
  var envCard = _renderEnvironmentsCard(right);
  left.appendChild(envCard);

  // Right panel: re-paint based on the preserved selection. If nothing
  // is selected, render the welcome placeholder. This keeps the selected
  // detail alive across the full re-render that follows a commit.
  _paintRightPanel(right, driversRow, envCard);
}

// ── right-panel paint dispatcher ─────────────────────────────────────
function _paintRightPanel(right, driversRow, envCard) {
  var eng = getActiveEngagement();
  if (_selectedKind === "driver" && _selectedDriverUuid && eng && eng.drivers && eng.drivers.byId[_selectedDriverUuid]) {
    var d = eng.drivers.byId[_selectedDriverUuid];
    _renderDriverDetail(right, d, driversRow);
    // Re-mark selected tile.
    if (driversRow) {
      driversRow.querySelectorAll(".driver-tile").forEach(function(t) {
        t.classList.toggle("selected", t.getAttribute("data-driver-id") === d.businessDriverId);
      });
    }
    return;
  }
  if (_selectedKind === "env" && _selectedEnvUuid && eng && eng.environments && eng.environments.byId[_selectedEnvUuid]) {
    var e = eng.environments.byId[_selectedEnvUuid];
    _renderEnvDetail(right, e, envCard);
    if (envCard) {
      envCard.querySelectorAll(".env-tile").forEach(function(t) {
        t.classList.toggle("selected", t.getAttribute("data-env-id") === e.envCatalogId);
      });
    }
    return;
  }
  _renderWelcomePanel(right);
}

// ── Drivers ──────────────────────────────────────────────────────────
function _paintDriverTiles(row, right) {
  row.innerHTML = "";
  var eng = getActiveEngagement();
  var drivers = (eng && eng.drivers && Array.isArray(eng.drivers.allIds))
    ? eng.drivers.allIds.map(function(id) { return eng.drivers.byId[id]; }).filter(Boolean)
    : [];
  drivers.forEach(function(d) {
    row.appendChild(_buildDriverTile(d, row, right));
  });

  var addBtn = mk("button", "driver-add-btn");
  addBtn.textContent = "+ Add driver";
  addBtn.addEventListener("click", function() { _openDriverPalette(row, right); });
  row.appendChild(addBtn);
}

function _buildDriverTile(driver, row, right) {
  var meta = BUSINESS_DRIVERS.find(function(bd) { return bd.id === driver.businessDriverId; });
  var label = meta ? meta.label : driver.businessDriverId;
  var hint  = meta ? meta.shortHint : "";

  var tile = mk("div", "driver-tile" + (_selectedDriverUuid === driver.id ? " selected" : ""));
  tile.setAttribute("data-driver-id", driver.businessDriverId);
  tile.setAttribute("data-driver-uuid", driver.id);

  tile.appendChild(mkt("div", "driver-tile-label", label));
  tile.appendChild(mkt("div", "driver-tile-hint",  hint));

  var pri = driver.priority || "Medium";
  var pb = mk("span", "driver-priority-badge priority-" + pri.toLowerCase());
  pb.textContent = pri;
  tile.appendChild(pb);

  var del = mk("button", "driver-tile-del");
  del.textContent = "×";
  del.title = "Remove driver";
  del.addEventListener("click", function(e) {
    e.stopPropagation();
    function doDelete() {
      commitDriverRemove(driver.id);
      // Clear selection if we just deleted the selected driver.
      if (_selectedDriverUuid === driver.id) {
        _selectedDriverUuid = null;
        _selectedKind = null;
      }
      _paintDriverTiles(row, right);
      _paintRightPanel(right, row, null);
    }
    if (driver.outcomes && driver.outcomes.trim().length > 0) {
      confirmAction({
        title: "Remove driver?",
        body: "'" + label + "' has outcomes you've already typed. Removing the driver discards them. This can't be undone.",
        confirmLabel: "Remove driver",
        danger: true
      }).then(function(yes) { if (yes) doDelete(); });
    } else {
      doDelete();
    }
  });
  tile.appendChild(del);

  tile.addEventListener("click", function() {
    _selectedDriverUuid = driver.id;
    _selectedEnvUuid    = null;
    _selectedKind       = "driver";
    row.querySelectorAll(".driver-tile").forEach(function(t) { t.classList.remove("selected"); });
    tile.classList.add("selected");
    _renderDriverDetail(right, driver, row);
  });

  return tile;
}

function _openDriverPalette(row, right) {
  document.getElementById("driver-palette")?.remove();
  var overlay = mk("div", "cmd-overlay");
  overlay.id = "driver-palette";
  var box = mk("div", "cmd-box");

  box.appendChild(mkt("div", "cmd-context", "Add a business driver"));
  var srch = document.createElement("input");
  srch.className = "cmd-search";
  srch.placeholder = "Search drivers...";
  srch.setAttribute("autocomplete", "off");
  box.appendChild(srch);

  var results = mk("div", "cmd-results");
  box.appendChild(results);
  box.appendChild(mkt("div", "cmd-hint", "Arrows navigate · Enter selects · Esc closes"));

  overlay.appendChild(box);
  document.body.appendChild(overlay);
  setTimeout(function() { srch.focus(); }, 0);

  var activeIdx = -1;

  function render(q) {
    results.innerHTML = ""; activeIdx = -1;
    var eng = getActiveEngagement();
    var addedIds = new Set();
    if (eng && eng.drivers && Array.isArray(eng.drivers.allIds)) {
      eng.drivers.allIds.forEach(function(id) {
        var d = eng.drivers.byId[id];
        if (d && d.businessDriverId) addedIds.add(d.businessDriverId);
      });
    }
    var qlc = (q || "").toLowerCase();
    var filtered = BUSINESS_DRIVERS.filter(function(bd) {
      if (addedIds.has(bd.id)) return false;
      if (!qlc) return true;
      return (bd.label + " " + bd.shortHint).toLowerCase().indexOf(qlc) >= 0;
    });

    if (filtered.length === 0) {
      var empty = mk("div", "cmd-empty");
      empty.textContent = addedIds.size >= BUSINESS_DRIVERS.length
        ? "All 8 drivers already added."
        : "No drivers match your search.";
      results.appendChild(empty);
      return;
    }

    filtered.forEach(function(bd) {
      var item = mk("div", "cmd-item");
      item.appendChild(mkt("span", "cmd-item-name", bd.label));
      item.appendChild(mkt("span", "cmd-item-vendor", bd.shortHint));
      item.addEventListener("click", function() {
        var addRes = commitDriverAdd({
          businessDriverId: bd.id, priority: "Medium", outcomes: ""
        });
        // Auto-select the new driver so the right panel opens to its
        // detail editor.
        if (addRes && addRes.engagement) {
          var nextEng = addRes.engagement;
          for (var i = nextEng.drivers.allIds.length - 1; i >= 0; i--) {
            var nd = nextEng.drivers.byId[nextEng.drivers.allIds[i]];
            if (nd && nd.businessDriverId === bd.id) {
              _selectedDriverUuid = nd.id;
              _selectedKind = "driver";
              break;
            }
          }
        }
        close();
      });
      item.addEventListener("mouseenter", function() {
        var items = Array.from(results.querySelectorAll(".cmd-item"));
        items.forEach(function(el, i) {
          el.classList.toggle("active", el === item);
          if (el === item) activeIdx = i;
        });
      });
      results.appendChild(item);
    });
  }

  function close() {
    overlay.remove();
    _paintDriverTiles(row, right);
    _paintRightPanel(right, row, null);
  }

  srch.addEventListener("input", function() { render(srch.value.trim()); });
  srch.addEventListener("keydown", function(e) {
    var items = Array.from(results.querySelectorAll(".cmd-item"));
    if (e.key === "Escape") { close(); return; }
    if (e.key === "ArrowDown") { activeIdx = Math.min(activeIdx + 1, items.length - 1); _highlight(items, activeIdx); e.preventDefault(); }
    if (e.key === "ArrowUp")   { activeIdx = Math.max(activeIdx - 1, 0);                _highlight(items, activeIdx); e.preventDefault(); }
    if (e.key === "Enter" && activeIdx >= 0 && items[activeIdx]) items[activeIdx].click();
  });
  overlay.addEventListener("click", function(e) { if (e.target === overlay) close(); });

  render("");
}

function _renderDriverDetail(right, driver, driversRow) {
  right.innerHTML = "";

  var meta = BUSINESS_DRIVERS.find(function(bd) { return bd.id === driver.businessDriverId; });

  // Conversation-starter card.
  var coaching = mk("div", "card coaching-card");
  coaching.appendChild(mkt("div", "coaching-title", "Conversation starter"));
  coaching.appendChild(mkt("div", "coaching-text", meta ? meta.conversationStarter : ""));
  right.appendChild(coaching);

  // Driver form.
  var formCard = mk("div", "card");
  formCard.style.marginTop = "12px";
  formCard.appendChild(mkt("div", "card-title", meta ? meta.label : driver.businessDriverId));
  if (meta) formCard.appendChild(mkt("div", "card-hint", meta.shortHint));

  var prioGroup = mk("div", "form-group");
  prioGroup.style.marginTop = "12px";
  prioGroup.appendChild(mkt("label", "form-label", "Priority"));
  var prioSel = document.createElement("select");
  prioSel.className = "form-select";
  prioSel.setAttribute("data-field", "driver.priority");
  ["High", "Medium", "Low"].forEach(function(v) {
    var opt = document.createElement("option");
    opt.value = v; opt.textContent = v;
    if (v === (driver.priority || "Medium")) opt.selected = true;
    prioSel.appendChild(opt);
  });
  prioSel.addEventListener("change", function() {
    commitDriverUpdate(driver.id, { priority: prioSel.value });
    // Re-paint the driver tiles to reflect the new priority badge. The
    // right-panel preservation happens in renderContextView's tail
    // _paintRightPanel, which the commit's emit triggers via app.js.
    if (driversRow) _paintDriverTiles(driversRow, right);
  });
  prioGroup.appendChild(prioSel);
  formCard.appendChild(prioGroup);

  var outGroup = mk("div", "form-group");
  outGroup.style.marginTop = "10px";
  outGroup.appendChild(mkt("label", "form-label", "Business outcomes"));
  var outHint = mkt("div", "card-hint", "Press Enter to start a new bullet.");
  outHint.style.marginBottom = "4px";
  outGroup.appendChild(outHint);
  var out = document.createElement("textarea");
  out.className = "form-textarea driver-outcomes";
  out.setAttribute("data-field", "driver.outcomes");
  out.rows = 5;
  out.value = driver.outcomes || "";
  out.placeholder = "• Example: recover from ransomware within 4 hours, proven quarterly.";
  _attachAutoBullet(out);
  // Commit on every input so AI tooling can observe the outcomes
  // immediately. The emit cascade is light enough that a per-keystroke
  // commit is affordable.
  out.addEventListener("input", function() {
    commitDriverUpdate(driver.id, { outcomes: out.value });
  });
  outGroup.appendChild(out);
  formCard.appendChild(outGroup);

  right.appendChild(formCard);
}

// ── Environments ─────────────────────────────────────────────────────
function _renderEnvironmentsCard(right) {
  var card = mk("div", "card env-card");
  card.style.marginTop = "12px";
  card.appendChild(mkt("div", "card-title", "Environments"));
  card.appendChild(mkt("div", "card-hint",
    "Click any environment to edit alias, location, capacity, and tier on the right. Click \"+ Add environment\" to bring a new type into scope. Hide an environment to drop it from the report without losing its data."));

  _paintEnvironmentsCard(card, right);
  return card;
}

function _paintEnvironmentsCard(card, right) {
  while (card.children.length > 2) card.removeChild(card.lastChild);

  var eng = getActiveEngagement();
  var envs = _envsAsArray(eng);

  // No auto-materialize on render. A fresh engagement has zero envs; the
  // "+ Add environment" button creates them on demand, and the demo
  // session ships with envs pre-configured. Materializing defaults as a
  // side effect of rendering would leak envs the caller never asked for.

  var visible = envs.filter(function(e) { return !e.hidden; });
  var hidden  = envs.filter(function(e) { return e.hidden === true; });
  var canHide = visible.length > 1;

  if (visible.length > 1) {
    var presetRow = mk("div", "env-preset-row");
    presetRow.appendChild(mkt("span", "env-preset-label", "Quick shape"));
    presetRow.appendChild(_buildPresetChip("Single site",
      "Hide every environment except the Primary Data Center. Useful when the client has a single on-prem footprint.",
      function() { return ["coreDc"]; },
      card, right));
    card.appendChild(presetRow);
  }

  var activeRow = mk("div", "env-tiles-row");
  visible.forEach(function(e) {
    activeRow.appendChild(_buildEnvTile(e, card, right, /*isHidden*/ false, canHide));
  });

  // "+ Add environment" tile when there are catalog options not yet
  // in the engagement.
  var inEng = {};
  envs.forEach(function(e) { inEng[e.envCatalogId] = true; });
  var available = ENV_CATALOG.filter(function(c) { return !inEng[c.id]; });
  if (available.length > 0) {
    var addBtn = mk("button", "env-add-btn");
    addBtn.type = "button";
    addBtn.textContent = "+ Add environment";
    addBtn.addEventListener("click", function() { _openEnvPalette(card, right); });
    activeRow.appendChild(addBtn);
  }
  card.appendChild(activeRow);

  if (hidden.length > 0) {
    var hiddenSection = mk("div", "env-hidden-section hidden-environments");
    hiddenSection.setAttribute("data-env-hidden-section", "true");
    hiddenSection.appendChild(mkt("div", "env-section-heading muted",
      "Hidden environments (" + hidden.length + ") . excluded from the report; click to restore."));
    var hiddenRow = mk("div", "env-tiles-row env-tiles-row-hidden");
    hidden.forEach(function(e) {
      hiddenRow.appendChild(_buildEnvTile(e, card, right, /*isHidden*/ true, /*canHide*/ false));
    });
    hiddenSection.appendChild(hiddenRow);
    card.appendChild(hiddenSection);
  }
}

function _envsAsArray(eng) {
  if (!eng || !eng.environments || !Array.isArray(eng.environments.allIds)) return [];
  return eng.environments.allIds.map(function(id) { return eng.environments.byId[id]; }).filter(Boolean);
}

function _buildPresetChip(label, hint, keepFn, card, right) {
  var chip = mk("button", "env-preset-chip tag");
  chip.type = "button";
  chip.setAttribute("data-t", "biz");
  chip.textContent = label;
  chip.title = hint;
  chip.addEventListener("click", function() {
    var keep = keepFn() || [];
    var keepSet = {};
    keep.forEach(function(catId) { keepSet[catId] = true; });
    var eng = getActiveEngagement();
    var envs = _envsAsArray(eng);
    var willHide = envs
      .filter(function(e) { return !e.hidden && !keepSet[e.envCatalogId]; })
      .map(function(e) {
        var cat = ENV_CATALOG.find(function(c) { return c.id === e.envCatalogId; });
        return e.alias || (cat ? cat.label : e.envCatalogId);
      });
    if (willHide.length === 0) return;
    confirmAction({
      title: label + " preset",
      lede:  hint,
      body:  "Will hide: " + willHide.join(", ") + ". Each one stays in your saved file and can be restored from the Hidden environments section."
    }).then(function(yes) {
      if (!yes) return;
      // Apply the hides as a single engagement update so the emit cascade
      // fires once.
      commitAction(function(engagement) {
        var next = engagement;
        var ids = engagement.environments.allIds.slice();
        for (var i = 0; i < ids.length; i++) {
          var e = next.environments.byId[ids[i]];
          if (!e || e.hidden || keepSet[e.envCatalogId]) continue;
          var byIdNext = Object.assign({}, next.environments.byId);
          byIdNext[ids[i]] = Object.assign({}, e, { hidden: true });
          next = Object.assign({}, next, {
            environments: Object.assign({}, next.environments, { byId: byIdNext })
          });
        }
        return { ok: true, engagement: next };
      });
      _paintEnvironmentsCard(card, right);
    });
  });
  return chip;
}

function _buildEnvTile(envEntry, card, right, isHidden, canHide) {
  var catalog = ENV_CATALOG.find(function(c) { return c.id === envEntry.envCatalogId; });
  var label   = catalog ? catalog.label : envEntry.envCatalogId;
  var alias   = (envEntry.alias && envEntry.alias.trim()) || label;

  var tile = mk("div", "env-tile" + (isHidden ? " env-tile-hidden" : "") + (_selectedEnvUuid === envEntry.id ? " selected" : ""));
  tile.setAttribute("data-env-row", "true");
  tile.setAttribute("data-env-id", envEntry.envCatalogId);     // v2-compat catalog ref for tests + CSS
  tile.setAttribute("data-env-uuid", envEntry.id);             // v3 UUID for internal targeting

  tile.appendChild(mkt("div", "env-tile-label", alias));
  tile.appendChild(mkt("div", "env-tile-sublabel", catalog ? catalog.label : envEntry.envCatalogId));

  if (isHidden) {
    var hiddenRow = mk("div", "env-tile-tags");
    hiddenRow.appendChild(_mkLucide("eye-off", 12));
    var hiddenTag = mkt("span", "tag", "HIDDEN");
    hiddenTag.setAttribute("data-t", "ops");
    hiddenRow.appendChild(hiddenTag);
    tile.appendChild(hiddenRow);
    var instCount = _countInstancesForEnv(envEntry.id);
    if (instCount > 0) {
      tile.appendChild(mkt("div", "env-tile-meta",
        instCount + " instance" + (instCount === 1 ? "" : "s") + " preserved in saved file"));
    }
    var restore = mk("button", "env-restore-btn btn-with-feedback");
    restore.type = "button";
    restore.textContent = "Restore";
    restore.setAttribute("data-env-restore", envEntry.envCatalogId);
    restore.addEventListener("click", function(e) {
      e.stopPropagation();
      restore.classList.add("is-loading");
      try {
        commitEnvUnhide(envEntry.id);
        _paintEnvironmentsCard(card, right);
      } catch (err) {
        restore.classList.remove("is-loading");
        restore.classList.add("is-error");
        restore.textContent = "Restore failed";
      }
    });
    tile.appendChild(restore);
  } else {
    var tagsRow = mk("div", "env-tile-tags");
    if (envEntry.location) {
      var loc = mkt("span", "tag", envEntry.location);
      loc.setAttribute("data-t", "tech");
      tagsRow.appendChild(loc);
    }
    if (envEntry.sizeKw != null) {
      var size = mkt("span", "tag", envEntry.sizeKw + " MW");
      size.setAttribute("data-t", "data");
      tagsRow.appendChild(size);
    }
    if (envEntry.sqm != null) {
      var sqm = mkt("span", "tag", envEntry.sqm + " m²");
      sqm.setAttribute("data-t", "data");
      tagsRow.appendChild(sqm);
    }
    if (envEntry.tier) {
      var tier = mkt("span", "tag", envEntry.tier);
      tier.setAttribute("data-t", "biz");
      tagsRow.appendChild(tier);
    }
    if (tagsRow.children.length > 0) tile.appendChild(tagsRow);
  }

  tile.addEventListener("click", function() {
    _selectedEnvUuid    = envEntry.id;
    _selectedDriverUuid = null;
    _selectedKind       = "env";
    card.querySelectorAll(".env-tile").forEach(function(t) { t.classList.remove("selected"); });
    tile.classList.add("selected");
    _renderEnvDetail(right, envEntry, card);
  });

  return tile;
}

function _renderEnvDetail(right, envEntry, card) {
  var catalog = ENV_CATALOG.find(function(c) { return c.id === envEntry.envCatalogId; });
  var displayName = (envEntry.alias && envEntry.alias.trim()) || (catalog ? catalog.label : envEntry.envCatalogId);
  right.innerHTML = "";

  var panel = mk("div", "card env-detail-panel");
  panel.appendChild(mkt("div", "panel-eyebrow", catalog ? catalog.label : envEntry.envCatalogId));
  panel.appendChild(mkt("div", "panel-title", displayName));
  if (catalog && catalog.hint) {
    panel.appendChild(mkt("div", "panel-lede muted", catalog.hint));
  }

  var fields = [
    { key: "alias",    label: "Alias",            placeholder: catalog ? catalog.label : envEntry.envCatalogId, type: "text",   hint: "What the customer calls this site." },
    { key: "location", label: "Location",         placeholder: "City, region",                                  type: "text",   hint: "Used in the report." },
    { key: "sizeKw",   label: "Capacity (MW)",    placeholder: "e.g. 5",                                        type: "number", min: 0, max: 200, step: 0.5,
      hint: "Power footprint in megawatts. Use the +/- buttons or type." },
    { key: "sqm",      label: "Floor area (m²)",  placeholder: "e.g. 320",                                      type: "number", min: 0, max: 100000, step: 50,
      hint: "Useful for telco / colo conversations." },
    { key: "tier",     label: "Tier",             placeholder: "e.g. Tier III",                                 type: "datalist",
      list:  ["Tier I", "Tier II", "Tier III", "Tier IV", "Public", "Sovereign", "Edge / Branch", "N/A"],
      hint: "Pick a standard tier or type a custom value." },
    { key: "notes",    label: "Notes",            placeholder: "Anything else to remember",                     type: "text",   hint: "Free-form context for this site." }
  ];
  var grid = mk("div", "env-detail-grid");
  fields.forEach(function(f) {
    var grp = mk("div", "form-group env-meta-field");
    grp.appendChild(mkt("label", "form-label", f.label));
    var input = mk("input", "form-input env-meta-input");
    if (f.type === "datalist") {
      input.type = "text";
      var listId = "env-datalist-" + envEntry.envCatalogId + "-" + f.key;
      input.setAttribute("list", listId);
      var dl = document.createElement("datalist");
      dl.id = listId;
      (f.list || []).forEach(function(opt) {
        var o = document.createElement("option");
        o.value = opt;
        dl.appendChild(o);
      });
      grp.appendChild(dl);
    } else {
      input.type = f.type;
    }
    if (f.type === "number") {
      if (typeof f.min  === "number") input.setAttribute("min",  String(f.min));
      if (typeof f.max  === "number") input.setAttribute("max",  String(f.max));
      if (typeof f.step === "number") input.setAttribute("step", String(f.step));
      input.setAttribute("inputmode", "decimal");
    }
    input.placeholder = f.placeholder;
    var current = envEntry[f.key];
    input.value = (current === undefined || current === null) ? "" : String(current);
    input.setAttribute("data-env-meta", f.key);
    input.addEventListener("change", function() {
      var v = (input.value || "").trim();
      var nextValue;
      if (f.type === "number") {
        var n = parseFloat(v);
        if (!isNaN(n)) {
          if (typeof f.min === "number" && n < f.min) n = f.min;
          if (typeof f.max === "number" && n > f.max) n = f.max;
        }
        nextValue = isNaN(n) ? null : n;
      } else {
        nextValue = v.length === 0 ? null : v;
      }
      var v3Patch = {};
      v3Patch[f.key] = nextValue;
      commitEnvUpdate(envEntry.id, v3Patch);
      // Re-paint the env tiles row so the alias / location tag updates.
      // The right panel persists via _paintRightPanel at the end of
      // renderContextView (triggered by the commit's emit cascade).
      _paintEnvironmentsCard(card, right);
    });
    grp.appendChild(input);
    if (f.hint) grp.appendChild(mkt("div", "form-hint muted", f.hint));
    grid.appendChild(grp);
  });
  panel.appendChild(grid);

  // Hide / Restore action.
  var footer = mk("div", "env-detail-footer");
  if (envEntry.hidden) {
    var rest = mk("button", "btn-primary env-restore-btn-detail");
    rest.type = "button";
    rest.textContent = "Restore environment";
    rest.setAttribute("data-env-restore", envEntry.envCatalogId);
    rest.addEventListener("click", function() {
      commitEnvUnhide(envEntry.id);
      _paintEnvironmentsCard(card, right);
      _renderWelcomePanel(right);
    });
    footer.appendChild(rest);
  } else {
    var canHide = _envsAsArray(getActiveEngagement()).filter(function(e) { return !e.hidden; }).length > 1;
    var hide = mk("button", "btn-secondary env-hide-btn");
    hide.type = "button";
    hide.textContent = "Hide environment";
    hide.setAttribute("data-env-hide", envEntry.envCatalogId);
    if (!canHide) {
      hide.disabled = true;
      hide.setAttribute("aria-disabled", "true");
      hide.title = "At least one environment must remain active";
    } else {
      hide.addEventListener("click", function() {
        _startHideFlow(envEntry, hide, function() {
          _paintEnvironmentsCard(card, right);
          _renderWelcomePanel(right);
        });
      });
    }
    footer.appendChild(hide);
  }
  panel.appendChild(footer);

  right.appendChild(panel);
}

function _openEnvPalette(card, right) {
  document.getElementById("env-palette")?.remove();
  var overlay = mk("div", "cmd-overlay");
  overlay.id = "env-palette";
  var box = mk("div", "cmd-box");
  box.appendChild(mkt("div", "cmd-context", "Add an environment"));
  var srch = document.createElement("input");
  srch.className = "cmd-search";
  srch.placeholder = "Search environment types…";
  srch.setAttribute("autocomplete", "off");
  box.appendChild(srch);
  var results = mk("div", "cmd-results");
  box.appendChild(results);
  box.appendChild(mkt("div", "cmd-hint", "Arrows navigate · Enter selects · Esc closes"));
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  setTimeout(function() { srch.focus(); }, 0);

  var activeIdx = -1;

  function render(q) {
    results.innerHTML = ""; activeIdx = -1;
    var eng = getActiveEngagement();
    var taken = {};
    _envsAsArray(eng).forEach(function(e) { taken[e.envCatalogId] = true; });
    var qlc = (q || "").toLowerCase();
    var filtered = ENV_CATALOG.filter(function(c) {
      if (taken[c.id]) return false;
      if (!qlc) return true;
      return (c.label + " " + c.hint).toLowerCase().indexOf(qlc) >= 0;
    });
    if (filtered.length === 0) {
      results.appendChild(mkt("div", "cmd-empty",
        Object.keys(taken).length >= ENV_CATALOG.length
          ? "All catalog environments are already in this session."
          : "No environments match your search."));
      return;
    }
    filtered.forEach(function(c) {
      var item = mk("div", "cmd-item");
      item.appendChild(mkt("span", "cmd-item-name", c.label));
      item.appendChild(mkt("span", "cmd-item-vendor", c.hint));
      item.addEventListener("click", function() {
        var addRes = commitEnvAdd({ envCatalogId: c.id });
        // Auto-select the new env so the right panel opens to the
        // detail editor.
        if (addRes && addRes.engagement) {
          var nextEng = addRes.engagement;
          for (var i = nextEng.environments.allIds.length - 1; i >= 0; i--) {
            var ne = nextEng.environments.byId[nextEng.environments.allIds[i]];
            if (ne && ne.envCatalogId === c.id) {
              _selectedEnvUuid = ne.id;
              _selectedKind = "env";
              break;
            }
          }
        }
        close();
      });
      item.addEventListener("mouseenter", function() {
        var items = Array.from(results.querySelectorAll(".cmd-item"));
        items.forEach(function(el, i) {
          el.classList.toggle("active", el === item);
          if (el === item) activeIdx = i;
        });
      });
      results.appendChild(item);
    });
  }
  function close() {
    overlay.remove();
    _paintEnvironmentsCard(card, right);
    _paintRightPanel(right, null, card);
  }
  srch.addEventListener("input", function() { render(srch.value.trim()); });
  srch.addEventListener("keydown", function(e) {
    var items = Array.from(results.querySelectorAll(".cmd-item"));
    if (e.key === "Escape") { close(); return; }
    if (e.key === "ArrowDown") { activeIdx = Math.min(activeIdx + 1, items.length - 1); _highlight(items, activeIdx); e.preventDefault(); }
    if (e.key === "ArrowUp")   { activeIdx = Math.max(activeIdx - 1, 0); _highlight(items, activeIdx); e.preventDefault(); }
    if (e.key === "Enter" && activeIdx >= 0) { items[activeIdx].click(); }
  });
  overlay.addEventListener("click", function(e) { if (e.target === overlay) close(); });
  render("");
}

function _countInstancesForEnv(envUuid) {
  var eng = getActiveEngagement();
  if (!eng || !eng.instances || !Array.isArray(eng.instances.allIds)) return 0;
  var n = 0;
  for (var i = 0; i < eng.instances.allIds.length; i++) {
    var inst = eng.instances.byId[eng.instances.allIds[i]];
    if (inst && inst.environmentId === envUuid) n++;
  }
  return n;
}

// ── Hide flow (save-guard → confirm → commit) ────────────────────────
function _startHideFlow(envEntry, anchorBtn, onAfterHide) {
  var status = (typeof getSaveStatus === "function") ? getSaveStatus() : null;
  var dirty = status && status.status === "saving";
  if (dirty) {
    _openSaveGuardModal(envEntry, anchorBtn, onAfterHide);
  } else {
    _openHideConfirmModal(envEntry, anchorBtn, onAfterHide);
  }
}

function _openSaveGuardModal(envEntry, anchorBtn, onAfterHide) {
  var body = mk("div", "save-guard-body");
  body.appendChild(mkt("div", "save-guard-lede",
    "You have unsaved changes. Save them first before hiding this environment?"));

  var saveAndHide = _mkBtn("Save & Hide", "btn-primary btn-with-feedback save-and-hide",
    function() {
      saveAndHide.classList.add("is-loading");
      try {
        // engagementStore auto-persists, so there's nothing to save
        // explicitly; just proceed to the confirm step.
        closeOverlay();
        _openHideConfirmModal(envEntry, anchorBtn, onAfterHide);
      } catch (e) {
        saveAndHide.classList.remove("is-loading");
        saveAndHide.classList.add("is-error");
        saveAndHide.textContent = "Save failed";
      }
    });
  var hideOnly = _mkBtn("Hide without saving", "btn-secondary btn-with-feedback hide-without-save",
    function() {
      closeOverlay();
      _openHideConfirmModal(envEntry, anchorBtn, onAfterHide);
    });
  var cancel = _mkBtn("Cancel", "btn-link btn-cancel", function() { closeOverlay(); });

  var foot = mk("div", "overlay-actions");
  foot.appendChild(cancel);
  foot.appendChild(hideOnly);
  foot.appendChild(saveAndHide);

  openOverlay({
    title: "Save before hiding?",
    lede: "Unsaved changes detected.",
    body: body,
    footer: foot,
    kind: "save-guard",
    size: "default"
  });
  var panel = document.querySelector(".overlay.open");
  if (panel) {
    panel.classList.add("save-guard-modal");
    panel.classList.add("hide-env-modal");
    panel.setAttribute("data-save-guard", "true");
  }
}

function _openHideConfirmModal(envEntry, anchorBtn, onAfterHide) {
  var catalog = ENV_CATALOG.find(function(c) { return c.id === envEntry.envCatalogId; });
  var displayName = (envEntry.alias && envEntry.alias.length > 0)
    ? envEntry.alias
    : (catalog ? catalog.label : envEntry.envCatalogId);
  var instCount = _countInstancesForEnv(envEntry.id);

  var body = mk("div", "hide-env-body");
  var lede = mkt("p", "hide-env-lede",
    "It will be removed from Current state, Desired state, and Reporting. " +
    instCount + " instance" + (instCount === 1 ? "" : "s") +
    " will stay in your saved file. You can restore it any time from the Context tab.");
  body.appendChild(lede);

  var confirmBtn = _mkBtn("Hide environment", "btn-primary btn-with-feedback confirm-hide",
    function() {
      confirmBtn.classList.add("is-loading");
      try {
        commitEnvHide(envEntry.id);
        closeOverlay();
        if (typeof onAfterHide === "function") onAfterHide();
      } catch (e) {
        confirmBtn.classList.remove("is-loading");
        confirmBtn.classList.add("is-error");
        confirmBtn.textContent = "Hide failed";
      }
    });
  confirmBtn.setAttribute("data-hide-env-confirm", "true");
  var cancelBtn = _mkBtn("Cancel", "btn-link btn-cancel", function() { closeOverlay(); });
  cancelBtn.setAttribute("data-hide-env-cancel", "true");

  var foot = mk("div", "overlay-actions");
  foot.appendChild(cancelBtn);
  foot.appendChild(confirmBtn);

  openOverlay({
    title: "Hide '" + displayName + "'?",
    lede: catalog ? catalog.label : envEntry.envCatalogId,
    body: body,
    footer: foot,
    kind: "hide-env",
    size: "default"
  });
  var panel = document.querySelector(".overlay.open");
  if (panel) {
    panel.classList.add("hide-env-modal");
    panel.setAttribute("data-hide-env-modal", envEntry.envCatalogId);
  }
}

// ── Welcome / fresh-start cards ──────────────────────────────────────
function _renderWelcomePanel(right) {
  right.innerHTML = "";
  var ph = mk("div", "detail-placeholder");
  ph.appendChild(mkt("div", "detail-ph-title", "Select a strategic driver"));
  ph.appendChild(mkt("div", "detail-ph-hint",
    "Click any driver on the left to open its conversation starter, priority, and business-outcomes editor. Or add a new driver via '+ Add driver'. Press ? for guidance."));
  right.appendChild(ph);
}

function _isFreshEngagement(eng) {
  if (!eng || typeof eng !== "object") return true;
  var c = eng.customer;
  // An empty customer ships the schema-required default name
  // ("New customer"). Treat that placeholder as "fresh" -- the user
  // hasn't touched anything yet. A real name means authored data.
  var nameIsDefault = !c || !c.name || c.name === "" || c.name === "New customer";
  if (!nameIsDefault) return false;
  if (eng.drivers && Array.isArray(eng.drivers.allIds) && eng.drivers.allIds.length > 0) return false;
  if (eng.instances && Array.isArray(eng.instances.allIds) && eng.instances.allIds.length > 0) return false;
  if (eng.gaps && Array.isArray(eng.gaps.allIds) && eng.gaps.allIds.length > 0) return false;
  if (eng.environments && Array.isArray(eng.environments.allIds) && eng.environments.allIds.length > 0) return false;
  return true;
}

function _renderFreshStartCard(container) {
  var card = mk("div", "card fresh-start-card");
  card.setAttribute("data-fresh-start", "");
  card.appendChild(mkt("div", "fresh-start-eyebrow", "NEW SESSION"));
  card.appendChild(mkt("div", "fresh-start-title", "Start a workshop from scratch, or explore with demo data"));
  card.appendChild(mkt("div", "fresh-start-body",
    "Fill in the customer identity below and add the strategic drivers the customer cares about. " +
    "Or load the Acme Financial Services demo to see every tab populated with realistic data."));
  var actions = mk("div", "fresh-start-actions");
  var loadBtn = mkt("button", "btn-primary", "↺ Load demo session");
  loadBtn.type = "button";
  loadBtn.addEventListener("click", function() {
    // loadDemo() returns a frozen, fully-populated engagement object.
    setActiveEngagement(loadDemo());
  });
  var dismissBtn = mkt("button", "btn-secondary", "Start fresh");
  dismissBtn.type = "button";
  dismissBtn.addEventListener("click", function() {
    card.remove();
  });
  actions.appendChild(loadBtn);
  actions.appendChild(dismissBtn);
  card.appendChild(actions);
  container.appendChild(card);
}

// ── Auto-bullet textarea helper ──────────────────────────────────────
function _attachAutoBullet(textarea) {
  textarea.addEventListener("keydown", function(e) {
    if (textarea.value === "" && e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      textarea.value = "• " + e.key;
      textarea.setSelectionRange(3, 3);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      var start  = textarea.selectionStart;
      var end    = textarea.selectionEnd;
      var val    = textarea.value;
      var before = val.slice(0, start);
      var after  = val.slice(end);
      var prefix = (before === "" && after === "") ? "• " : "\n• ";
      textarea.value = before + prefix + after;
      var newPos = before.length + prefix.length;
      textarea.setSelectionRange(newPos, newPos);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    if (e.key === "Backspace") {
      var s = textarea.selectionStart;
      var e2 = textarea.selectionEnd;
      if (s !== e2) return;
      var v = textarea.value;
      var beforeB = v.slice(0, s);
      var lineStart = beforeB.lastIndexOf("\n") + 1;
      var lineContent = beforeB.slice(lineStart);
      if (lineContent === "• ") {
        e.preventDefault();
        textarea.value = v.slice(0, lineStart) + v.slice(s);
        textarea.setSelectionRange(lineStart, lineStart);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  });
}

// ── Lucide icon helper ───────────────────────────────────────────────
var LUCIDE_ICONS = {
  "eye-off": [
    "M9.88 9.88a3 3 0 1 0 4.24 4.24",
    "M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 11 7 11 7a13.16 13.16 0 0 1-1.67 2.68",
    "M6.61 6.61A13.526 13.526 0 0 0 1 12s4 7 11 7a9.74 9.74 0 0 0 5.39-1.61",
    { tag: "line", x1: "2", x2: "22", y1: "2", y2: "22" }
  ]
};

function _mkLucide(name, size) {
  var s = size || 14;
  var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width",  String(s));
  svg.setAttribute("height", String(s));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("lucide-" + name);
  var paths = LUCIDE_ICONS[name] || [];
  paths.forEach(function(d) {
    if (typeof d === "string") {
      var p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", d);
      svg.appendChild(p);
    } else if (d && d.tag) {
      var el = document.createElementNS("http://www.w3.org/2000/svg", d.tag);
      Object.keys(d).forEach(function(k) {
        if (k !== "tag") el.setAttribute(k, d[k]);
      });
      svg.appendChild(el);
    }
  });
  return svg;
}

function _highlight(items, idx) {
  items.forEach(function(el, i) { el.classList.toggle("active", i === idx); });
  if (items[idx]) items[idx].scrollIntoView({ block: "nearest" });
}

function _mkBtn(text, klass, onClick) {
  var b = mk("button", klass);
  b.type = "button";
  b.textContent = text;
  if (typeof onClick === "function") b.addEventListener("click", onClick);
  return b;
}

// ── DOM construction helpers ─────────────────────────────────────────
function mk(tag, cls)        { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
function mkt(tag, cls, text) { var e = mk(tag, cls); e.textContent = text; return e; }
function fg(label, input)    { var g = mk("div", "form-group"); g.appendChild(mkt("label", "form-label", label)); g.appendChild(input); return g; }
function inputF(field, value, ph) {
  var i = mk("input", "form-input");
  i.setAttribute("data-field", field);
  i.value = value || "";
  i.placeholder = ph || "";
  return i;
}
function selectF(field, value, options, placeholder) {
  var s = mk("select", "form-select");
  s.setAttribute("data-field", field);
  if (placeholder) {
    var o = document.createElement("option");
    o.value = ""; o.textContent = placeholder;
    s.appendChild(o);
  }
  options.forEach(function(o) {
    var opt = document.createElement("option");
    opt.value = o; opt.textContent = o;
    if (o === value) opt.selected = true;
    s.appendChild(opt);
  });
  return s;
}

// Test helper -- reset selection state between tests so cross-test
// pollution doesn't surface a stale right panel.
export function _resetSelectionForTests() {
  _selectedDriverUuid = null;
  _selectedEnvUuid    = null;
  _selectedKind       = null;
}
