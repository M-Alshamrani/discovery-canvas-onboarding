# Known Issues

A running log of known bugs and rough edges, for the intern. Each entry says what you see, why
it happens, its status, and — where still open — a suggested fix. The open ones are tagged
**good first issue**: they're small, self-contained, and a good place to start.

---

## Fixed

### 1. The Gaps board went empty when an environment filter was active  — FIXED
**What you saw:** On the Gaps tab, once an environment filter was applied (sometimes carried over
from another tab), the kanban showed **0 cards** in every column — which made drag-and-drop look
broken, because there was nothing to drag.

**Why:** The environment filter is **shared across tabs** (`state/filterState.js`). The Gaps tab
keyed it by environment **UUID** (to match `gap.affectedEnvironments`), but the shared filter bar
on other tabs wrote the environment **catalog id** (e.g. `coreDc`). A catalog-id value can never
match the UUID-based gaps, so every gap was filtered out and the board rendered empty.

**Fix (in this repo):** `ui/views/GapsEditView.js` `filteredGaps()` resolves each gap's environment
UUIDs to their catalog ids and matches either form. Verified: with the env filter set to `coreDc`,
the board shows the Primary-Data-Center gaps (it was 0 before).

**Still recommended — good first issue:** the *root* fix is to make the shared environment filter
use one id form everywhere (the catalog id), so that the resolve above is no longer needed. The
development repository has since adopted this root approach (with a regression test); aligning this
copy to it is a clean exercise.

### 2. Re-opening a saved .canvas showed "(unknown driver)" labels  — FIXED
**What you saw:** Saving and re-opening a `.canvas` file lost the driver-to-catalog link, so
strategic-driver labels read "(unknown driver)" on the reopened file.

**Why:** the file used to be written and read through an older session shape, and the
driver-to-catalog link did not survive that round-trip.

**Fix:** file save and load are now fully **v3-native**. The engagement is written and read in its
own shape (`services/canvasFile.js`), with no intermediate translation, so the driver link survives
a save then reopen and labels resolve. Files written by an older app version are politely rejected
with a "start a fresh session" message rather than mangled. See
[DATA_ARCHITECTURE.md](DATA_ARCHITECTURE.md).

### 3. Default AI fallback models were stale  — FIXED
**What you saw:** `core/aiConfig.js` shipped `gemini-2.0-flash` / `gemini-1.5-flash` as Gemini
fallback models; both return 404 from the provider.

**Fix:** the stale Gemini fallbacks were dropped. **Settings** (the gear icon) now offers a **model
dropdown** per provider — Anthropic and Gemini list their known models, with a **Custom…** option
for anything else; the local / self-hosted providers stay free-text. A saved model that is not in
the list is kept (shown under "Custom…"), never lost.

### Drag-and-drop itself works
HTML5 drag-and-drop on the Gaps kanban is functional: dragging a card between the Now / Next /
Later columns moves the gap to that phase and saves it. The "drag-and-drop doesn't work" report was
the empty-board issue (#1), not the drag itself.

---

## Open — good first issues

> Note: the development repository has already implemented all three of these. They are kept here as
> starter exercises. If you'd rather they were already done, ask the maintainer to sync them from dev.

### A. The active-filter chip shows the raw id, not the label  — cosmetic
When an environment filter is active, the chip reads e.g. `environment: coreDc` instead of
`environment: Primary Data Center`. Resolve the value through the label source (the filter's own
options, or `core/labelResolvers.js`) before rendering the chip.

### B. A fully-filtered Gaps board shows nothing, with no explanation  — UX
If the active filters genuinely exclude every gap, the kanban renders three empty columns with no
message. Add an empty-state ("No gaps match the active filters") with a **Clear filters** button so
it's obvious what happened and easy to recover.

### C. Drag-and-drop never sets drag data  — cross-browser robustness
In `GapsEditView.js`, the card `dragstart` handler sets `effectAllowed` but never calls
`e.dataTransfer.setData(...)`. Chrome tolerates this; Firefox and some browsers require `setData`
to initiate a drag. Add `e.dataTransfer.setData("text/plain", gap.id)` in `dragstart`.

---

## QA notes

A full pass through every tab — Context, Current state, Desired state, Gaps, and Reporting (with its
five sub-views: Overview, Heatmap, Gaps board, Vendor mix, Roadmap) — plus both AI surfaces (AI
Assist and AI Notes) and a file save→open round-trip showed **no console errors**, with every
surface rendering and interacting correctly.
