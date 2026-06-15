// services/memoizeOne.js
//
// Single-cache memoization. Caches the last (args, result) pair. If the
// next call's args are equal-by-the-equality-fn to the previous args,
// returns the cached result; otherwise re-computes. Behaviorally
// identical to the npm `memoize-one` package, vendored inline to avoid
// another import-map entry.
//
// Default equality is shallow strict-equality across all args. Pass a
// custom equality to compare args differently (e.g. first arg by
// reference, second by deep shape).
//
// Contract:
//   - First call computes + caches.
//   - Subsequent call with isEqual(args, prevArgs) === true returns the
//     cached result without re-running fn.
//   - Subsequent call with isEqual === false re-computes + replaces cache.

function defaultIsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function memoizeOne(fn, isEqual = defaultIsEqual) {
  let prevArgs = null;
  let prevResult = null;
  let hasCached = false;
  return function memoized(...args) {
    if (hasCached && isEqual(args, prevArgs)) {
      return prevResult;
    }
    prevResult = fn.apply(this, args);
    prevArgs = args;
    hasCached = true;
    return prevResult;
  };
}
