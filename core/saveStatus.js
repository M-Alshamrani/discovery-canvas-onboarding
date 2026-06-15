// core/saveStatus.js
//
// Tracks the topbar save-status indicator state. Subscribers repaint the
// status line via onStatusChange whenever the status changes.
//
// State machine:
//   "idle"   -> no session yet (fresh canvas, customer.name empty)
//   "saving" -> transient pulse around a session change + writeback
//   "saved"  -> last writeback succeeded; savedAt = timestamp
//   "demo"   -> session is a demo (overrides "saved")
//
// The session store calls markSaved() after each successful localStorage
// write; the session-change emitter calls markSaving() first, so the
// visible state pulses to "Saving..." and then snaps to "Saved".

var listeners = [];
var status    = "idle";
var savedAt   = 0;

export function getStatus() {
  return { status: status, savedAt: savedAt };
}

export function markIdle() {
  status  = "idle";
  savedAt = 0;
  notify();
}

export function markSaving() {
  status = "saving";
  notify();
}

export function markSaved(opts) {
  var isDemo = !!(opts && opts.isDemo);
  status  = isDemo ? "demo" : "saved";
  savedAt = Date.now();
  notify();
}

export function onStatusChange(fn) {
  if (typeof fn !== "function") return function() {};
  listeners.push(fn);
  return function unsubscribe() {
    listeners = listeners.filter(function(l) { return l !== fn; });
  };
}

export function _resetForTests() {
  listeners = [];
  status    = "idle";
  savedAt   = 0;
}

function notify() {
  var snapshot = { status: status, savedAt: savedAt };
  listeners.slice().forEach(function(fn) {
    try { fn(snapshot); }
    catch (e) { /* swallow */ }
  });
}
