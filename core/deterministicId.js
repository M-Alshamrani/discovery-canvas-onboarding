// core/deterministicId.js — deterministic id generation.
//
// Generates a stable id from a (kind, ...inputs) tuple: the same inputs
// always produce the same id. Dependency-free and synchronous. Used where a
// record needs a repeatable id (for example a saved skill) so re-running the
// same operation does not mint a brand-new id each time.
//
// The output shape must stay stable: records already saved carry ids minted
// by this exact algorithm, so changing it would orphan them.
//
// Algorithm: an FNV-1a 32-bit hash computed four times with different seeds,
// concatenated into a 128-bit value carved into a UUID v8 (custom) shape:
//
//   xxxxxxxx-xxxx-8xxx-xxxx-xxxxxxxxxxxx
//                ^ version 8 marker (custom)
//
// FNV-1a is enough at this scale; the 128-bit composite is collision-safe
// well past the number of ids the app mints. No Web Crypto dependency.

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME  = 0x01000193;
const SEED_BYTES = ["A", "B", "C", "D"];

function fnv1a32(str, seed) {
  let h = (FNV_OFFSET ^ seed.charCodeAt(0)) >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h ^ str.charCodeAt(i)) >>> 0);
    // FNV_PRIME multiplication; Math.imul keeps it in 32-bit signed range
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h;
}

function toHex8(n) {
  return n.toString(16).padStart(8, "0");
}

// generateDeterministicId(kind, ...inputs) — every input contributes to
// the hash; same (kind, inputs) tuple always produces the same id.
export function generateDeterministicId(kind, ...inputs) {
  const payload = [kind, ...inputs.map(i => i == null ? "<null>" : String(i))].join("\x1f");
  const h0 = fnv1a32(payload, SEED_BYTES[0]);
  const h1 = fnv1a32(payload, SEED_BYTES[1]);
  const h2 = fnv1a32(payload, SEED_BYTES[2]);
  const h3 = fnv1a32(payload, SEED_BYTES[3]);
  const hex = toHex8(h0) + toHex8(h1) + toHex8(h2) + toHex8(h3);
  // Carve into UUID v8 (custom) shape with version nibble forced to 8.
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    "8" + hex.slice(13, 16),                    // version 8
    ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20),  // variant 10xx
    hex.slice(20, 32)
  ].join("-");
}
