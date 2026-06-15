# Architecture

Read this before changing the code. It explains how the app is put together and how the
data model works.

---

## The shape of the app

Plain JavaScript, ES modules, **no build step**, served as static files. The browser does
everything; there is no backend. The only network calls are to the AI provider you configure.
**Zod** (vendored) validates all data against a schema. **marked** (vendored) renders Markdown
in the chat.

The code follows a one-way flow:

```
schema  →  state  →  selectors  →  ui
(define   (the one   (read-only    (render)
 + check   writer)    computed
 data)                views)
```

Services sit alongside this flow for AI, file save/open, import, and other cross-cutting work.

---

## Folder map

- `core/` — configuration and source-of-truth constants: the layer / environment / driver /
  gap-type catalogs (`config.js`), the data-relationship contract (`dataContract.js`),
  version, help text, the demo engagement, and the seed skills.
- `schema/` — the Zod data model. `engagement.js` composes the whole thing; `customer.js`,
  `driver.js`, `environment.js`, `instance.js`, and `gap.js` are the entities; `helpers/`
  holds shared field shapes.
- `state/` — the live data in memory. `engagementStore.js` is the single write path;
  `adapter.js` is the read/write surface the UI uses; `collections/` holds the per-entity
  write actions.
- `selectors/` — pure functions that compute read-only views (matrix, gaps kanban, vendor
  mix, roadmap, health) from the engagement.
- `services/` — AI (`aiService`, `chatService`, `systemPromptAssembler`, the grounding
  pair), file save/open (`sessionFile`), the import pipeline, skills, roadmap, and the
  Workshop Notes pipeline.
- `ui/` — `views/` are the tabs and overlays; `components/` are reusable pieces (modals,
  filter bars, notifications, the overlay shell).
- `catalogs/` — the catalog data snapshots (business drivers, verticals, Dell product
  taxonomy, environment kinds, gap types, layers, service types).
- `migrations/` — upgrades a file saved by an older version up to the current schema.
- `vendor/` — third-party libraries (Zod, marked), vendored so there is nothing to install.

---

## The data model (the heart)

The whole workshop is one **Engagement** (the UI calls it a "session"; the code calls it an
"engagement"). It is composed of:

```
Engagement
├─ meta          id, status, dates, owner, isDemo flag
├─ customer      name, vertical, region, notes
├─ drivers       the business drivers that matter to the customer
├─ environments  data centers, clouds, sites
├─ instances     technology items — both current AND desired
└─ gaps          the differences worth acting on
```

Each collection is stored **normalized** as `{ byId, allIds }` — a map of id → record plus
an ordered list of ids. Instances additionally carry a `byState` index that splits them into
`current` and `desired`.

The relations:

- **drivers** and **environments** are owned directly by the engagement.
- An **instance** lives in one environment (`environmentId`) and on one layer (`layerId`),
  and has a `state` of *current* or *desired*. A *desired* instance can link back to the
  *current* instance it replaces (`originId`) and carries a disposition (keep / enhance /
  replace / consolidate / retire / introduce).
- A **gap** ties to a business driver, has a type, an urgency (High / Medium / Low), a phase
  (Now / Next / Later), and a status; it records which environments and which current and
  desired instances it affects. Its project grouping is *derived* at read time, not stored.
- **drivers, instances, and gaps** can carry an `aiTag` — a small provenance stamp marking a
  record that an AI helper created or changed. (Environments, customer, and meta never do.)

A couple of fields (`activeEntity`, `integrityLog`) live on the engagement in memory but are
stripped when you save to a file.

Every entity and field is validated by Zod. If data does not match the schema, it is rejected
at the boundary rather than silently corrupting the store.

---

## How data flows

**Reads and writes**

```
schema (validate)
   → state/engagementStore.commitAction   ← the ONLY function that writes
   → state/adapter                          read selectors + write helpers the views call
   → ui/views                               render from the adapter
```

Every change goes through one function, `commitAction`, in `engagementStore.js`. Views never
mutate state directly — they call write helpers on `adapter.js`, which route through
`commitAction`. Keeping every write in one place is what makes the app easy to reason about.

**AI**

```
services/aiService              talks to the chosen provider (OpenAI-compatible / Anthropic / Gemini)
services/chatService            pulls the relevant canvas data first, asks the model, then checks the reply
services/systemPromptAssembler  builds the instructions the model receives
```

The chat is *grounded*: before answering, it gathers the relevant slice of your engagement and
gives it to the model, then runs a light check on the reply. That is why it answers from your
data instead of inventing facts.

---

## Persistence

- **Auto-save** to the browser's `localStorage` on every change.
- **Save to file / Open file** for portability — a `.canvas` file you can keep or share.
- `migrations/` upgrades a file saved by an older version to the current schema when you open it.

---

## Adding a feature: a quick walkthrough

Say you want to add a new field to an entity:

1. Add it to that entity's **schema** (e.g. `schema/driver.js`), with a sensible default so
   files saved by older versions still load.
2. Expose it through **`state/adapter.js`** — a read selector, and if it is editable, a write
   helper that goes through `commitAction`.
3. Render and edit it in the relevant **`ui/views`** file.
4. If it appears in a report, update the matching **selector**.

Work in that order — schema first, UI last — and the one-way flow keeps the change contained.
