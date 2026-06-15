// services/chatHandshake.js
//
// Single source of truth for the first-turn handshake regex constants,
// shared by chatService, chatMemory, and the chat overlay so the
// streaming-time onToken path can re-strip incremental tokens (without
// this, the handshake can briefly leak on screen when a model repeats
// it on a later turn).
//
// Two regexes:
//
//   HANDSHAKE_RE — strict, anchored, captures the sha. Used by
//   chatService.streamChat to detect and validate the first line of the
//   first response. Anchored to the start so it only matches the
//   intended first-turn position.
//
//   HANDSHAKE_STRIP_RE — permissive, global, strips any occurrence
//   anywhere in the response. Tolerates leading whitespace and an
//   optional opening bracket (some models drop the brackets). Applied
//   to the visible response unconditionally, at streaming time in the
//   overlay's onToken handler, and when loading a stored transcript.
//
// stripHandshake(text) is the canonical strip helper: applies
// HANDSHAKE_STRIP_RE then trims leading whitespace. Idempotent and
// cheap; returns the cleaned text. Every caller uses this one function
// so the contract surfaces in exactly one place.

export const HANDSHAKE_RE       = /^\s*\[contract-ack\s+v3\.0\s+sha=([0-9a-f]{8})\]\s*\n?/i;
export const HANDSHAKE_STRIP_RE = /(?:^|[\s*_>])\[?\s*contract-ack\s+v3\.0\s+sha=[0-9a-f]{8}\s*\]?\s*\n?/gi;

export function stripHandshake(text) {
  if (typeof text !== "string" || text.length === 0) return text;
  return text.replace(HANDSHAKE_STRIP_RE, "").replace(/^\s+/, "");
}
