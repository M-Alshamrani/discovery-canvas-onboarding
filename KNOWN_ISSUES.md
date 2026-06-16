# Known Issues

A running log of known bugs and rough edges, for the intern. Each entry says what you see, why
it happens, its status, and — where still open — a suggested fix. Several are tagged
**good first issue** if you're looking for a place to start.

---

## Fixed

### 1. The Gaps board went empty when an environment filter was active  — FIXED
**What you saw:** On the Gaps tab, once an environment filter was applied (sometimes carried over
from another tab), the kanban showed **0 cards** in every column — which made drag-and-drop look
broken, because there was nothing to drag.

**Why:** The environment filter is **shared across tabs** (`state/filterState.js`). The Gaps tab
keys it by environment **UUID** (to match `gap.affectedEnvironments`), but the shared filter bar
used on other tabs wrote the environment **catalog id** (e.g. `coreDc`). A catalog-id value can
never match the UUID-based gaps, so every gap was filtered out and the board rendered empty.

**Fix (in this repo):** `ui/views/GapsEditView.js` `filteredGaps()` now resolves each gap's
environment UUIDs to their catalog ids and matches **either** form. Verified: with the env filter
set to `coreDc`, the board now shows the 7 Primary-Data-Center gaps (it was 0 before).

**Still recommended — good first issue:** the *root* fix is to make the shared environment filter
use one id form everywhere. `ui/components/SharedFilterBar.js` builds its environment options with
the catalog id (`{ id: e.id }`) while the Gaps tab uses the UUID; aligning SharedFilterBar to the
UUID removes the inconsistency at the source (and the fix above becomes belt-and-braces).

> Note for the maintainer: this fix lives only in this clean copy so far. It also needs to land in
> the development repository (with a regression test) before the next clean-copy refresh, or it
> would be overwritten.

### Drag-and-drop itself works
HTML5 drag-and-drop on the Gaps kanban is functional: dragging a card between the Now / Next /
Later columns moves the gap to that phase and saves it. The report of "drag-and-drop doesn't work"
was the empty-board issue above, not the drag itself.

---

## Open

### 2. The active-filter chip shows the raw id, not the label  — cosmetic · good first issue
When an environment filter is active, the chip reads e.g. `environment: coreDc` instead of
`environment: Primary Data Center`. Resolve the value through the label resolver
(`core/labelResolvers.js`) before rendering the chip. Related to issue #1's id inconsistency.

### 3. A fully-filtered Gaps board shows nothing, with no explanation  — UX · good first issue
If the active filters genuinely exclude every gap, the kanban renders three empty columns with no
message. Add an empty-state ("No gaps match the active filters") with a **Clear filters** button so
it's obvious what happened and easy to recover. (This is exactly what made issue #1 read as
"drag-and-drop is broken.")

### 4. Drag-and-drop never sets drag data  — cross-browser robustness · good first issue
In `GapsEditView.js`, the card `dragstart` handler sets `effectAllowed` but never calls
`e.dataTransfer.setData(...)`. Chrome tolerates this; Firefox and some browsers require `setData`
to initiate a drag. Add `e.dataTransfer.setData("text/plain", gap.id)` in `dragstart`.

### 5. Re-opening a saved .canvas shows "(unknown driver)" labels  — scheduled
Saving and re-opening a `.canvas` file currently loses the driver→catalog link, so strategic-driver
labels read "(unknown driver)" on the reopened file. This is the v3→v2→v3 file round-trip described
in [DATA_ARCHITECTURE.md](DATA_ARCHITECTURE.md) §3. A change to make file save/load fully v3-native
is planned; this copy will be refreshed when it lands.

### 6. Default AI fallback models are stale  — config
`core/aiConfig.js` ships `gemini-2.0-flash` / `gemini-1.5-flash` as Gemini fallback models; both now
return 404 from the provider. The primary `gemini-2.5-flash` works. Set your provider and model in
**Settings** (the gear icon). A "pick the model from the provider's live list" feature is planned.

---

## QA notes

A full pass through every tab — Context, Current state, Desired state, Gaps, and Reporting (with its
five sub-views: Overview, Heatmap, Gaps board, Vendor mix, Roadmap) — plus both AI surfaces (AI
Assist and AI Notes) and a file save→open round-trip showed **no console errors**, with every
surface rendering and interacting correctly. The items above are the findings from that pass.
