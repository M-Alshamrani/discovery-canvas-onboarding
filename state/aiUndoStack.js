// state/aiUndoStack.js
//
// Undo stack for AI mutations. Snapshots the engagement object before
// every AI mutation; undo restores it via setActiveEngagement. The
// engagement is immutable per commit (every commitAction returns a new
// reference), so a snapshot is a retained reference plus a JSON
// round-trip to harden against external mutation.
//
// The "Undo last AI change" header chip calls undoLast(). The stack
// persists to localStorage; snapshots that fail EngagementSchema
// validation on restore are silently dropped. Bounded to MAX_DEPTH
// entries (oldest dropped on overflow) and cleared on session reset.

import { getActiveEngagement, setActiveEngagement } from "./engagementStore.js";
import { EngagementSchema } from "../schema/engagement.js";
// setActiveEngagement already emits to its subscribers and drives the
// save-state machine through engagementStore's persistence, so no
// separate change event is needed here.

var MAX_DEPTH   = 10;
var STORAGE_KEY = "ai_undo_v1";

var stack = loadFromStorage();   // [{ label, snapshot, timestamp }]
var listeners = [];

export function onUndoChange(fn) {
  listeners.push(fn);
  return function unsubscribe() { listeners = listeners.filter(function(l) { return l !== fn; }); };
}

function notify() { listeners.forEach(function(fn) { try { fn(); } catch (e) { /* don't let UI errors break the stack */ } }); }

// push(label, optionalSnapshot) — captures the current engagement before
// an AI commit. The caller MUST push BEFORE the commit so that undo
// restores the pre-commit state. The optional snapshot argument lets
// tests inject a specific snapshot for deterministic rollback.
export function push(label, optionalSnapshot) {
  var snap = optionalSnapshot || cloneEngagement();
  stack.push({
    label:     typeof label === "string" ? label : "AI change",
    snapshot:  snap,
    timestamp: Date.now()
  });
  while (stack.length > MAX_DEPTH) stack.shift();
  persistToStorage();
  notify();
}

export function undoLast() {
  if (stack.length === 0) return null;
  var entry = stack.pop();
  try {
    if (entry.snapshot) {
      // Validate the snapshot before installing — guards against stale
      // or malformed snapshots left in localStorage.
      var validation = EngagementSchema.safeParse(entry.snapshot);
      if (validation.success) {
        setActiveEngagement(validation.data);
      } else {
        console.warn("[aiUndoStack] undoLast: snapshot schema-invalid; skipping restore");
      }
    }
    persistToStorage();
    // No explicit save pulse here: setActiveEngagement above already
    // routes through the store's persistence and marks the save.
  } catch (e) {
    console.error("[aiUndoStack] undoLast failed:", e);
  }
  notify();
  return entry;
}

// Reverse every stacked entry in one shot. Restores the snapshot at the
// bottom of the stack (the oldest — the state before any tracked AI
// changes), then clears the stack.
export function undoAll() {
  if (stack.length === 0) return 0;
  var count = stack.length;
  var oldest = stack[0];
  try {
    if (oldest.snapshot) {
      var validation = EngagementSchema.safeParse(oldest.snapshot);
      if (validation.success) {
        setActiveEngagement(validation.data);
      } else {
        console.warn("[aiUndoStack] undoAll: oldest snapshot schema-invalid; skipping restore");
      }
    }
    stack = [];
    persistToStorage();
    // setActiveEngagement above already marks the save via the store.
  } catch (e) {
    console.error("[aiUndoStack] undoAll failed:", e);
  }
  notify();
  return count;
}

export function canUndo() { return stack.length > 0; }

export function peekLabel() {
  if (stack.length === 0) return null;
  return stack[stack.length - 1].label;
}

export function depth() { return stack.length; }

export function recentLabels(maxCount) {
  var limit = typeof maxCount === "number" ? maxCount : stack.length;
  return stack.slice(-limit).reverse().map(function(e) { return e.label || "AI change"; });
}

export function clear() {
  if (stack.length === 0) return;
  stack = [];
  persistToStorage();
  notify();
}

export function _resetForTests() { stack = []; persistToStorage(); notify(); }

function cloneEngagement() {
  // The engagement object is immutable (every commitAction returns a new
  // reference), so we could retain the reference directly. We JSON
  // round-trip for two reasons:
  //   (a) to harden against any external code that mutates a returned
  //       engagement;
  //   (b) the snapshot persists to localStorage as JSON anyway, so
  //       round-tripping at push time matches the persistence shape.
  try {
    var eng = getActiveEngagement();
    return eng ? JSON.parse(JSON.stringify(eng)) : null;
  } catch (e) { return null; }
}

function persistToStorage() {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stack));
  } catch (e) {
    /* quota exceeded / disabled — best-effort; in-memory still works */
  }
}

function loadFromStorage() {
  try {
    if (typeof localStorage === "undefined") return [];
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    var parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    while (parsed.length > MAX_DEPTH) parsed.shift();
    return parsed.filter(function(e) {
      return e && typeof e === "object" && e.snapshot && typeof e.snapshot === "object";
    });
  } catch (e) { return []; }
}
