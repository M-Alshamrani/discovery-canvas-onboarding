// state/engagementStore.js
//
// Active-engagement source-of-truth. A single in-memory engagement
// object + pub/sub + localStorage persistence with rehydrate-on-boot.
//
// Persistence:
//   - Every state change persists to localStorage.v3_engagement_v1.
//   - Module load rehydrates from that key, validating through
//     EngagementSchema.safeParse(...). Failure → wipe + log + start
//     fresh (corrupt-cache safety).
//   - The bridge's customer-shallow-merge keeps working: the rehydrated
//     engagement comes back, the latest customer patch applies on top,
//     gaps/drivers/etc. survive across reload.
//
// Invariants:
//   - never expose the engagement by deep reference for write
//   - never mutate engagement state outside action functions
//   - never persist transient computed state (selector caches, view-models)
//   - no module other than engagementStore reads or writes the
//     v3_engagement_v1 localStorage key

import { EngagementSchema } from "../schema/engagement.js";
// This store is the canonical save-status driver. _persist's try/catch
// around localStorage.setItem decides which signal to send: success ->
// markSaved; failure (quota/private-mode) -> leave status as "saving"
// so the stuck "Saving..." pulse is itself the diagnostic that
// persistence is broken.
import { markSaved } from "../core/saveStatus.js";
// Reference-integrity scrubber. Runs at engagement-load time (rehydrate
// path) so any cross-reference orphans in the persisted JSON (gap.driverId
// pointing at a removed driver, gap.affectedEnvironments[] containing a
// placeholder UUID, etc.) are dropped/repaired before the engagement is
// installed. UI label resolvers get clean data; raw UUIDs stop leaking
// into user-visible surfaces.
import { scrubEngagementOrphans } from "../core/engagementIntegrity.js";

const STORAGE_KEY = "v3_engagement_v1";

let _active = null;
const _subs = new Set();

// Module-load rehydrate. Best-effort; a corrupt cache wipes + starts
// fresh so a single bad localStorage entry can never brick boot.
_rehydrateFromStorage();

export function getActiveEngagement() {
  return _active;
}

export function setActiveEngagement(eng) {
  _active = eng;
  _persist();
  _emit();
}

export function subscribeActiveEngagement(fn) {
  _subs.add(fn);
  return function unsubscribe() { _subs.delete(fn); };
}

function _emit() {
  _subs.forEach(fn => {
    try { fn(_active); }
    catch (e) { console.error("[engagementStore] subscriber threw:", e); }
  });
}

// _persist · write the active engagement to localStorage. Wrapped in
// try/catch so quota-exceeded / disabled-storage failures degrade
// silently to in-memory-only — chat keeps working, only the
// rehydrate-after-reload promise is lost.
function _persist() {
  try {
    if (_active === null || _active === undefined) {
      try { localStorage.removeItem(STORAGE_KEY); } catch (_e) { /* ignore */ }
      return;
    }
    const json = JSON.stringify(_active);
    localStorage.setItem(STORAGE_KEY, json);
    // Fire markSaved on every successful localStorage write so the
    // header capsule transitions out of the "Saving..." pulse. The
    // isDemo flag is carried from engagement.meta so demo sessions get
    // the "demo" status pill instead of the standard "Saved" pill.
    try {
      const isDemo = !!(_active.meta && _active.meta.isDemo);
      markSaved({ isDemo: isDemo });
    } catch (_e) { /* defensive · markSaved must never throw on the persist path */ }
  } catch (e) {
    // Quota-exceeded / private-mode / disabled-storage. Log once and
    // continue — the in-memory state is still authoritative for this
    // session. Deliberately do NOT call markSaved on the failure path;
    // the stuck "Saving..." pulse is the diagnostic signal that
    // persistence has broken (the user can still save-to-file).
    console.warn("[engagementStore] _persist failed:", e && e.message || e);
  }
}

// _rehydrateFromStorage · read + parse + validate + install.
// Returns true on success, false on miss / malformed / schema-invalid.
// Exported with the underscore-prefix internal naming so tests can
// drive it explicitly. Production code should NOT call this; the
// module-load self-call covers the boot path.
export function _rehydrateFromStorage() {
  let raw;
  try { raw = localStorage.getItem(STORAGE_KEY); }
  catch (e) {
    console.warn("[engagementStore] _rehydrateFromStorage: localStorage.getItem failed:", e && e.message || e);
    return false;
  }
  if (raw === null || raw === undefined || raw === "") return false;

  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) {
    console.warn("[engagementStore] rehydrate: malformed JSON; wiping cache and starting fresh");
    try { localStorage.removeItem(STORAGE_KEY); } catch (_e) { /* ignore */ }
    return false;
  }

  const result = EngagementSchema.safeParse(parsed);
  if (!result.success) {
    console.warn("[engagementStore] rehydrate: schema-invalid; wiping cache and starting fresh");
    try { localStorage.removeItem(STORAGE_KEY); } catch (_e) { /* ignore */ }
    return false;
  }

  // Scrub cross-reference orphans before installing the rehydrated
  // engagement. Pure function; no-op fast path when nothing needs
  // scrubbing (returns input by reference). Runs once per rehydrate,
  // not on every commit (the commit path already validates via schema).
  _active = scrubEngagementOrphans(result.data);
  // Don't emit on rehydrate — subscribers haven't subscribed yet at
  // module load, and a synthetic emit would be misleading anyway. The
  // first real emit will be the first user action (or the bridge's
  // customer-merge after session-changed).
  return true;
}

// commitAction(actionFn, ...args)
// Wraps an action function. The action runs against the active
// engagement, returns { ok, engagement, errors? }; on success the
// store swaps to the new immutable engagement and emits to subs.
// On validation failure, the active engagement is unchanged and
// no emit fires; the caller receives the result and surfaces errors.
export function commitAction(actionFn, ...args) {
  if (!_active) {
    throw new Error("commitAction: no active engagement; call setActiveEngagement first");
  }
  const result = actionFn(_active, ...args);
  if (result && result.ok === false) {
    return result;
  }
  const next = (result && result.engagement) ? result.engagement : result;
  if (next === _active) return result;
  _active = next;
  _persist();
  _emit();
  return result;
}

// _resetForTests · used between describe blocks to avoid pollution.
//
// Default behavior (no arg) clears BOTH in-memory state AND the
// persisted localStorage entry — required for cross-describe-block
// isolation.
//
// _resetForTests({ keepStorage: true }) clears only in-memory state,
// preserving localStorage so a test can simulate a page reload (drop
// in-memory, then call _rehydrateFromStorage explicitly).
export function _resetForTests(opts) {
  _active = null;
  _subs.clear();
  if (!opts || !opts.keepStorage) {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_e) { /* ignore */ }
  }
}
