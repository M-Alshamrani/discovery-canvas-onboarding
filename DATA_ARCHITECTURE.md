# Data Architecture

How this app models its data: the schemas, the foreign keys, the catalogs, and the rules that
hold it together. Read **[ARCHITECTURE.md](ARCHITECTURE.md)** first for the folder map and the
one-way data flow — this document goes one level deeper, into the data itself.

The app's whole job is to hold one well-shaped **Engagement** and never let it drift into a bad
state. Three ideas make that work:

1. **One schema** describes every piece of data, and nothing enters the store without passing it (Zod).
2. **Foreign keys + catalogs** keep shared vocabulary consistent — a driver doesn't store the text "Cyber Resilience", it stores a *reference* to it.
3. **Invariants** are rules the data must always satisfy, checked automatically.

---

## 1. Zod schemas — the data's gatekeeper

[Zod](https://zod.dev) is a small validation library (vendored in `vendor/zod/`). You declare the
*shape* of an object once and Zod gives you a checker that either returns clean data or a list of
precise errors. Every entity has a schema in `schema/`. Simplified, a customer looks like:

```js
export const CustomerSchema = z.object({
  engagementId: z.string().uuid(),
  name:         z.string(),
  vertical:     z.string(),      // a catalog id — see §3
  region:       z.string(),
  notes:        z.string().default("")
}).strict();
```

Three patterns show up everywhere:

- **`.strict()`** — unknown fields are rejected, not silently kept. A stale or misspelled field is an error.
- **`.default(...)`** — a missing field gets a sensible value, so a file saved by an older build still loads.
- **`.uuid()` / `.enum([...])`** — fields are constrained to real shapes (a UUID, or one of a fixed set).

The top-level `EngagementSchema` (`schema/engagement.js`) composes all the entity schemas into one
object. **Data only enters the store after a schema accepts it.** If it doesn't validate, it's
rejected at the boundary — that's the single rule that keeps the store always-valid.

---

## 2. The entities

An Engagement is six kinds of record:

| Entity | What it is |
|---|---|
| **engagementMeta** | Workshop-level metadata. One per engagement (id, status, dates, owner). |
| **customer** | The single customer record (name, vertical, region, notes). |
| **driver** | A strategic / business driver the customer cares about. Many. |
| **environment** | A place things run — data center, edge site, cloud region. Many. |
| **instance** | One asset or workload, at a (state, layer, environment) cell. `state` is *current* (today) or *desired* (the plan). Many. |
| **gap** | An improvement opportunity derived from the current↔desired delta + a driver. Many. |

`customer` and `engagementMeta` are **singletons** (exactly one). `driver`, `environment`,
`instance`, `gap` are **collections** (zero or more).

---

## 3. Catalogs and foreign keys (the "FK pairs")

This is the heart of the model, and the part worth slowing down on.

**A catalog is a fixed, shared vocabulary.** The app ships eight (in `catalogs/snapshots/`):
`LAYERS` (the 6 architectural layers), `BUSINESS_DRIVERS` (the 8 CxO drivers), `ENV_CATALOG`,
`GAP_TYPES`, `DISPOSITION_ACTIONS`, `SERVICE_TYPES`, `CUSTOMER_VERTICALS`, `DELL_PRODUCT_TAXONOMY`.
Each entry has an **id** and a human **label** (sometimes a hint):

```js
{ id: "cyber_resilience", label: "Cyber Resilience", hint: "Recover from attacks without paying." }
```

**A foreign key (FK) is a field that stores a catalog id, not the label.** A driver record doesn't
store "Cyber Resilience" — it stores `businessDriverId: "cyber_resilience"`. The label is looked up
when needed. Why store the id?

- **One source of truth:** rename the label in the catalog and every driver reflects it at once.
- **No drift:** a driver can only point at a real catalog entry.
- **Stable, comparable data:** ids are stable; labels are presentation.

**Resolving a label (the join).** To display a driver's name, the app joins the id back to the catalog:

```
driver.businessDriverId ("cyber_resilience")
   → BUSINESS_DRIVERS catalog
   → entry.label ("Cyber Resilience")
```

That join lives in `core/labelResolvers.js`. The UI never shows the raw id; it asks the resolver for
the label.

**The "FK pair".** So most links exist as *two paths that are two views of the same thing*:

- the **raw id** — `driver.businessDriverId` → `"cyber_resilience"`
- the **resolved label** — `driver.name` → `"Cyber Resilience"`

`core/dataContract.js` records these as `fkPair`s so tools (and the AI) know they're one link seen
two ways. Code that narrates almost always wants the label path; the raw id is there for matching.

**FK chains can be multi-hop.** A gap points at a driver *record*, which points at a catalog:

```
gap.driverId  →  drivers.byId[id]  →  .businessDriverId  →  BUSINESS_DRIVERS  →  .label
```

So `gap.driverName` ("Modernize Aging Infrastructure") is a two-hop resolution.

**FKs also point at other records, not just catalogs.** `instance.environmentId` points at an entry
in the engagement's own `environments` collection; `gap.relatedCurrentInstanceIds[]` point at
current instances. These are what make the canvas a connected graph instead of flat lists.

The full set of links, at a glance:

| From | Field | Points at |
|---|---|---|
| customer | `vertical` | CUSTOMER_VERTICALS catalog |
| driver | `businessDriverId` | BUSINESS_DRIVERS catalog |
| environment | `envCatalogId` | ENV_CATALOG catalog |
| instance | `layerId` | LAYERS catalog |
| instance | `environmentId` | the engagement's environments |
| instance | `disposition` | DISPOSITION_ACTIONS catalog (desired-only) |
| instance | `originId` | the current instance it replaces (desired-only) |
| instance | `mappedAssetIds[]` | other instances (workload-only) |
| gap | `gapType` | GAP_TYPES catalog |
| gap | `driverId` | the engagement's drivers (the "why") |
| gap | `layerId` / `affectedLayers[]` | LAYERS catalog |
| gap | `affectedEnvironments[]` | the engagement's environments |
| gap | `relatedCurrent/DesiredInstanceIds[]` | instances |
| gap | `services[]` | SERVICE_TYPES catalog |

> **This FK link is why a saved-then-reopened file used to show "(unknown driver)" — and why it no
> longer does.** Earlier, a file was written and read through an older session shape, and the
> `businessDriverId` FK link did not survive that translation cleanly, so the label join failed and
> the UI fell back to "(unknown driver)". File save and load are now fully **v3-native**
> (`services/canvasFile.js`): the engagement is written and read in its own shape, with no lossy
> translation in the middle, so the link survives and labels resolve. A file written by an older app
> version is politely declined ("start a fresh session") rather than mangled.

---

## 4. Normalized collections

Collections aren't plain arrays. Each is a **`{ byId, allIds }`** pair:

```js
drivers: {
  byId:   { "uuid-1": {…driver…}, "uuid-2": {…driver…} },
  allIds: ["uuid-1", "uuid-2"]            // the order
}
```

- `byId` — instant lookup by id, no scanning.
- `allIds` — the display order.

A hard rule (enforced by Zod): **the set of `byId` keys must exactly equal `allIds`.** No orphan
records, no dangling ids.

Instances carry one extra index, `byState`, splitting them into `current` and `desired`, so the
matrix view and the origin-link logic don't filter every time:

```js
instances: { byId: {…}, allIds: [...], byState: { current: [...], desired: [...] } }
```

---

## 5. Invariants — the rules that always hold

Some rules involve relationships *between* fields. Zod enforces them with `superRefine` (a custom
check that runs after the basic shape passes). The important ones:

- **G6** — a gap's `affectedLayers[0]` is its primary `layerId` (primary layer is always first).
- **originId is desired-only** — only a *desired* instance links back to the current instance it replaces.
- **priority is desired-only** — only desired instances carry a Now/Next/Later phase.
- **mappedAssetIds is workload-only** — only a `workload`-layer instance maps to underlying assets.
- **no self-origin** — an instance's `originId` can't point at itself.
- **byId == allIds** — the collection parity rule from §4.
- **schemaVersion is locked to "3.0"** — every engagement declares its model version.

Because these live in the schema, a bad combination is rejected at the boundary — the store cannot
reach an invalid state.

---

## 6. Levels vs. phases (a distinction the app is strict about)

Three fields are **levels** — `driver.priority`, `instance.criticality`, `gap.urgency` — all
High / Medium / Low. A level is **not a rank**: several drivers can all be "High". Say "the High
drivers", never "the top driver".

Two fields are **phases** — `instance.priority` and `gap.phase` — Now / Next / Later. A phase **is**
ordered (Now before Next).

The app keeps these apart on purpose (the data contract tags every field as one or the other),
because confusing "most critical" with "do first" produces wrong roadmaps. Worth knowing before you
write anything that sorts or summarizes.

---

## 7. Provenance — marking what the AI touched

When an AI helper creates or changes a record, it stamps an **`aiTag`** on it (a small object: which
kind of AI write, when, which skill). The tile shows a "done by AI" badge, and the tag is **cleared
the next time the engineer saves that record** — so AI suggestions stay visibly provisional until a
human confirms them. Only `driver`, `instance`, and `gap` carry `aiTag`; `environment`, `customer`,
and `engagementMeta` don't.

AI-suggested *content* (like a Dell-product mapping) is **provenance-wrapped** — stored alongside
who/what produced it, never as a bare string — so the UI can always show "this came from AI" instead
of passing it off as authored fact. The wrapper lives in `schema/helpers/provenanceWrapper.js`.

---

## 8. The data contract — one source of truth (and what the AI sees)

`core/dataContract.js` ties everything above into a single, **derived** artifact:

- It's assembled at load time from the schemas + catalogs + a field manifest — never hand-maintained, so it can't drift from the real schemas.
- It validates itself on import and carries a checksum.
- It publishes the lists the Skill Builder's field picker uses (author-meaningful fields, derived insights, and which paths need a catalog join).
- **It is serialized into the AI's system prompt on every turn** — so the assistant reasons about *your* real data model (entities, fields, FK relationships, levels-vs-phases, invariants) instead of guessing.

That's why, in the Skill Builder under the gear menu, those relationships are described per field —
the picker reads from this same contract. This document explains that same model for the whole app,
for humans.

---

## 9. How it composes — a worked example

Adding a driver walks the entire stack:

1. The user picks "Cyber Resilience" from the catalog-backed dropdown. The app stores a driver with `businessDriverId: "cyber_resilience"` (the **FK**, not the label), a fresh UUID, a priority, and outcomes text.
2. The new driver is validated against `DriverSchema` and committed through the single write path (`commitAction`), which also keeps `byId` / `allIds` in sync.
3. The Context tab renders the driver's **name** by resolving `businessDriverId → BUSINESS_DRIVERS → label` → "Cyber Resilience".
4. A gap later references the driver by `driverId`; its "why" column resolves the **multi-hop** chain back to the same label.
5. Had an AI skill added the driver, it would carry an `aiTag` until the next save.

**Schema in, label out, one write path, links by id** — that's the whole pattern, repeated for
every entity.
