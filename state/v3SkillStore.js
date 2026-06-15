// state/v3SkillStore.js
//
// localStorage-backed storage for user-authored skills. The skill shape
// is Seed prompt + Data points + Improved prompt + Output format +
// Mutation policy + Description + Parameters. Stored skills must match
// the current schema; there is no migration of older shapes.
//
// Save path:
//   1. Draft passed in (must already be schema-shaped from SkillBuilder.js)
//   2. Stamp cross-cutting fields if not present
//   3. SkillSchema.parse (strict shape; rejects legacy fields)
//   4. Persist to localStorage under STORAGE_KEY
//
// Load path:
//   1. Read JSON
//   2. Return raw map (no migration; current shape only)

import { SkillSchema } from "../schema/skill.js";
import { generateDeterministicId } from "../migrations/helpers/deterministicId.js";

const STORAGE_KEY = "v3_saved_skills_v1";

// saveV3Skill(draft, opts) -> { ok, skill } | { ok:false, errors }
//   draft.skillId is the user-visible id; if it already exists, this
//   overwrites (treat as update). The caller is responsible for
//   prompting for confirmation.
//   opts.manifest is currently unused (kept for the SkillBuilder.js call
//   site; the binding declaration lives in draft.dataPoints[]).
export function saveV3Skill(draft, _opts = {}) {
  // Stamp cross-cutting fields if not present.
  const now = new Date().toISOString();
  const candidate = {
    id:           draft.id           || generateDeterministicId("skill", "v3-saved", draft.skillId),
    engagementId: draft.engagementId || "00000000-0000-4000-8000-000000000000",
    createdAt:    draft.createdAt    || now,
    updatedAt:    now,
    skillId:              draft.skillId,
    label:                draft.label || "Untitled skill",
    description:          draft.description || "",
    version:              draft.version || "1.0.0",
    seedPrompt:           draft.seedPrompt || "",
    dataPoints:           Array.isArray(draft.dataPoints) ? draft.dataPoints : [],
    improvedPrompt:       draft.improvedPrompt || "",
    parameters:           Array.isArray(draft.parameters) ? draft.parameters : [],
    outputFormat:         draft.outputFormat || "text",
    mutationPolicy:       draft.mutationPolicy || null,
    validatedAgainst:     "3.2",
    outdatedSinceVersion: null
  };

  // Validate via SkillSchema (strict shape).
  const result = SkillSchema.safeParse(candidate);
  if (!result.success) {
    return {
      ok:     false,
      errors: result.error.issues.map(i => ({
        path:    i.path.join("."),
        message: i.message,
        code:    i.code
      }))
    };
  }

  // Persist
  try {
    const all = readAll();
    all[result.data.skillId] = result.data;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch (e) {
    return { ok: false, errors: [{ message: "Persistence failed: " + e.message }] };
  }
  return { ok: true, skill: result.data };
}

export function loadV3Skills() {
  try {
    return readAll();
  } catch {
    return {};
  }
}

export function loadV3SkillById(skillId) {
  return readAll()[skillId] || null;
}

export function deleteV3Skill(skillId) {
  try {
    const all = readAll();
    if (!all[skillId]) return { ok: true };
    delete all[skillId];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function readAll() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === "object") ? parsed : {};
  } catch {
    return {};
  }
}
