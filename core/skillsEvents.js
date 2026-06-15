// core/skillsEvents.js
//
// Tiny pub/sub for "skill registry has changed" notifications. The per-tab
// AI-skill dropdown subscribes so it auto-refreshes when skills are added,
// updated, deployed/undeployed, or deleted, instead of only re-deriving on
// tab activation.
//
// Mirrors the shape of core/sessionEvents.js deliberately: one bus per
// concern, a well-known reason set, and a handler that never throws out of
// the bus.
//
// Reasons emitted by skillStore:
//   addSkill     → "skill-add"          (label = skill name)
//   updateSkill  → "skill-update"       (label = skill name)
//   deleteSkill  → "skill-delete"       (label = skill id)
//   saveSkills   → "skill-replace-all"  (bulk reset / import)

var listeners = [];

// Subscribe to skills-changed events. Returns an unsubscribe function.
export function onSkillsChanged(fn) {
  if (typeof fn !== "function") return function() {};
  listeners.push(fn);
  return function unsubscribe() {
    listeners = listeners.filter(function(l) { return l !== fn; });
  };
}

// Emit a skills-changed event. `reason` identifies the caller for
// debugging/telemetry; `label` is a human-readable identifier (e.g. the
// skill name) so a future subscriber could flash a toast.
export function emitSkillsChanged(reason, label) {
  var evt = { reason: reason || "unknown", label: label || "" };
  listeners.slice().forEach(function(fn) {
    try { fn(evt); }
    catch (e) { /* never let a handler throw out of the bus */ }
  });
}

// Test-only reset.
export function _resetForTests() { listeners = []; }
