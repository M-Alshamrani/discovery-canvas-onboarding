// core/skillStore.js
//
// User-defined AI skills. Each skill is bound to one tab, runs against
// the full session plus a tab-specific context object, and renders its
// result into the tab's right panel. Stored in localStorage under
// `ai_skills_v1`. The shape is intentionally MCP-compatible (name +
// description + schema-like bindings) so skills can later be exposed as
// MCP tools to other agents without a rewrite.
//
// The seed skill data lives in core/seedSkills.js and is re-exported here
// as seedSkills().

import { seedSkills as seedSkillsImpl } from "./seedSkills.js";
import { emitSkillsChanged } from "./skillsEvents.js";

const STORAGE_KEY = "ai_skills_v1";

export const SKILL_TABS = ["context", "current", "desired", "gaps", "reporting"];

// Output-behavior model. responseFormat says what shape the AI returns;
// applyPolicy says how its output is applied to the session.
export const RESPONSE_FORMATS = ["text-brief", "json-scalars", "json-commands"];
export const APPLY_POLICIES   = ["show-only", "confirm-per-field", "confirm-all", "auto"];

// Legacy output modes, superseded by applyPolicy. Retained only so
// normalizeSkill can migrate older saved skills via the map below.
export const OUTPUT_MODES = ["suggest", "apply-on-confirm", "auto-apply"];
var LEGACY_OUTPUT_MODE_TO_APPLY_POLICY = {
  "suggest":          "show-only",
  "apply-on-confirm": "confirm-per-field",
  "auto-apply":       "auto"
};

function uid() { return "skill-" + Math.random().toString(36).slice(2, 10); }
function now() { return new Date().toISOString(); }

// Re-exported from core/seedSkills.js; see that file for the library.
export function seedSkills() { return seedSkillsImpl(); }

// Load the user's saved skills from localStorage. A fresh install returns
// an empty library; the seed skills are not auto-installed (users author
// their own via the Skill Builder). Corrupt or non-array storage also
// returns [] rather than silently falling back to the seed library.
export function loadSkills() {
  try {
    var raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    var parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeSkill).filter(Boolean);
  } catch (e) {
    return [];
  }
}

export function saveSkills(skills) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(skills || []));
    return true;
  } catch (e) { return false; }
}

// Narrow shape validation. Returns null for an unusable skill (no name or
// no promptTemplate). Unknown fields are preserved so future versions can
// add metadata without breaking older saves.
function normalizeSkill(s) {
  if (!s || typeof s !== "object") return null;
  if (typeof s.name !== "string" || !s.name.trim()) return null;
  if (typeof s.promptTemplate !== "string") return null;
  var tabId = SKILL_TABS.indexOf(s.tabId) >= 0 ? s.tabId : "context";

  // Output schema: the allowlist of fields the AI may propose updates to.
  var outputSchema = Array.isArray(s.outputSchema) ? s.outputSchema.filter(function(e) {
    return e && typeof e.path === "string" && e.path.length > 0;
  }) : [];

  // Resolve responseFormat: honor a valid one, otherwise default from
  // whether an output schema is present.
  var responseFormat = RESPONSE_FORMATS.indexOf(s.responseFormat) >= 0
    ? s.responseFormat
    : (outputSchema.length > 0 ? "json-scalars" : "text-brief");

  var applyPolicy;
  if (APPLY_POLICIES.indexOf(s.applyPolicy) >= 0) {
    applyPolicy = s.applyPolicy;
  } else if (typeof s.outputMode === "string" && LEGACY_OUTPUT_MODE_TO_APPLY_POLICY[s.outputMode]) {
    applyPolicy = LEGACY_OUTPUT_MODE_TO_APPLY_POLICY[s.outputMode];
  } else {
    applyPolicy = (responseFormat === "json-scalars") ? "confirm-per-field" : "show-only";
  }

  var providerKey = (typeof s.providerKey === "string" && s.providerKey.length > 0)
    ? s.providerKey : null;

  // Spread the original first so unknown fields survive, then override the
  // known ones with the normalized values.
  return Object.assign({}, s, {
    id:             s.id || uid(),
    tabId:          tabId,
    responseFormat: responseFormat,
    applyPolicy:    applyPolicy,
    outputSchema:   outputSchema,
    providerKey:    providerKey,
    deployed:       s.deployed !== false,
    systemPrompt:   typeof s.systemPrompt === "string" ? s.systemPrompt : "",
    description:    typeof s.description  === "string" ? s.description  : "",
    createdAt:      s.createdAt || now(),
    updatedAt:      s.updatedAt || now()
  });
}

// CRUD helpers used by the Skill Builder. Each emits a skills-changed
// event so subscribers (e.g. the per-tab AI dropdown) re-render without
// requiring a tab switch.
export function addSkill(props) {
  var skill = normalizeSkill(Object.assign({ id: uid(), createdAt: now(), updatedAt: now() }, props));
  if (!skill) throw new Error("addSkill: skill is invalid (need name + promptTemplate)");
  var list = loadSkills();
  list.push(skill);
  saveSkills(list);
  emitSkillsChanged("skill-add", skill.name);
  return skill;
}

export function updateSkill(id, patch) {
  var list = loadSkills();
  var idx = list.findIndex(function(s) { return s.id === id; });
  if (idx < 0) throw new Error("updateSkill: '" + id + "' not found");
  var next = normalizeSkill(Object.assign({}, list[idx], patch, { id: list[idx].id, updatedAt: now() }));
  if (!next) throw new Error("updateSkill: resulting skill is invalid");
  list[idx] = next;
  saveSkills(list);
  emitSkillsChanged("skill-update", next.name);
  return next;
}

export function deleteSkill(id) {
  var list = loadSkills();
  var hit  = list.find(function(s) { return s.id === id; });
  var next = list.filter(function(s) { return s.id !== id; });
  saveSkills(next);
  emitSkillsChanged("skill-delete", (hit && hit.name) || id);
}

// Query helpers.
export function skillsForTab(tabId, opts) {
  var onlyDeployed = !opts || opts.onlyDeployed !== false;
  return loadSkills().filter(function(s) {
    return s.tabId === tabId && (!onlyDeployed || s.deployed);
  });
}

export function getSkill(id) {
  return loadSkills().find(function(s) { return s.id === id; }) || null;
}
