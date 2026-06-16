# Revision History

A short, high-level story of how the app reached its current shape. For the detail, read the
code — this is just the map.

---

## v2.x — the workshop canvas
The original tool: the five tabs, manual data entry, and a workshop you could save to a file.
It worked, but its data lived in a loose shape that was easy to drift out of sync.

## v3.0 — the data-model rewrite ("v3-pure")
The app was rebuilt around a single, validated data model — the **Engagement** described in
[ARCHITECTURE.md](ARCHITECTURE.md). Three ideas define it:

- one schema (Zod) that all data must satisfy,
- one place where every write happens (`commitAction`),
- a thin adapter the views read and write through.

This is the architecture you see today.

## The AI arc
On top of v3, the AI features were added in turn:

- the **Canvas AI Assistant** — a grounded chat that also serves as the app's help center,
- **Skills** — small, saved AI helpers you can run on your data,
- the **AI Notes** workshop overlay and the import pipeline that turns rough notes into
  reviewed canvas entries.

## Recent polish
- The assistant answers in a natural voice and can give clearly-marked "beyond the canvas"
  outside analysis.
- The AI Notes window has draggable dividers and is resizable.
- File save and load are fully v3-native: the engagement is written and read in its own shape, so a
  saved-then-reopened `.canvas` keeps every link (a file from an older app version is politely
  declined). Earlier builds round-tripped through an older shape and could drop the driver link.
- The Settings panel picks the AI model from a dropdown per provider, with a "Custom…" option for
  self-hosted endpoints; stale default fallback models were removed.

---

## What changed when this clean copy was made

This is a lean, standalone copy prepared for onboarding. Two things were trimmed from the full
development repository, and the comments were cleaned. **No application logic was changed.**

**The test / evaluation harness was moved out.** The original repository keeps a large
automated test suite and an AI-evaluation harness. Neither is part of the running app, so they
were left in the development repository as the reference. (A plain-language behavior
specification will be distilled from them separately.)

**Dead modules were removed** after proving — by tracing every import from the entry point
(`app.js`) — that nothing the running app loads ever reaches them:

- `core/` — `bindingResolvers.js`, `dataContract.reference.js`, `fieldManifest.js`, `promptGuards.js`
- `services/` — `canvasFile.js`, `realLLMProvider.js`, and the old skill-runtime cluster
  `skillEngine.js` / `skillOutputSchemas.js` / `skillRunner.js` / `skillSaveValidator.js`
  (the live Skills feature runs through the chat overlay and `state/v3SkillStore.js` instead)
- `state/` — `demoSession.js`, `integritySweep.js`
- `schema/` — `helpers/fkDeclaration.js`, `aiOutputs/dellSolutionList.js`
- `ui/components/` — `PillEditor.js`
- the now-empty `interactions/` folder (its old command modules were superseded by `state/adapter.js`)

**Comments were cleaned.** Throughout the code, comments were trimmed of development-process
notes — commit IDs, bug numbers, dated session stamps, and spec cross-references — so they
describe what the code does and why, not how it was built. Only comments and blank lines were
touched; every line of code is unchanged.
