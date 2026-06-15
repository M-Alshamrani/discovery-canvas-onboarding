// state/chatMemory.js
//
// Per-engagement chat-transcript persistence. The localStorage key is
// `dell-canvas-chat::<engagementId>`, so each engagement has its own
// transcript and switching engagements yields a fresh chat. Rolling-
// window summarization collapses older turns into one synthetic PRIOR
// CONTEXT system message once the transcript exceeds
// CHAT_TRANSCRIPT_WINDOW messages.
//
// The persistence shape carries only { role, content, at, provenance? }
// per message; anything else (notably API keys or OAuth tokens) is
// stripped at the saveTranscript boundary.

// The handshake-strip helper is shared with chatService and the chat
// overlay's streaming path so all three strip the same way.
import { stripHandshake } from "../services/chatHandshake.js";

export const CHAT_TRANSCRIPT_WINDOW = 30;
export const CHAT_TRANSCRIPT_TOKEN_BUDGET = 12000;
export const TRANSCRIPT_KEY_PREFIX = "dell-canvas-chat::";

function emptyTranscript() {
  return { messages: [], summary: null };
}

// loadTranscript(engagementId) → { messages, summary }
//
// The handshake prefix can leak into a persisted assistant message and
// would reappear on reload. We strip it here at load time (using the
// same shared helper) so older transcripts heal automatically.
export function loadTranscript(engagementId) {
  if (!engagementId) return emptyTranscript();
  try {
    const raw = localStorage.getItem(TRANSCRIPT_KEY_PREFIX + engagementId);
    if (!raw) return emptyTranscript();
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.messages)) return emptyTranscript();
    return {
      messages: parsed.messages.map(m => {
        if (m && m.role === "assistant" && typeof m.content === "string") {
          return Object.assign({}, m, { content: stripHandshake(m.content) });
        }
        return m;
      }),
      summary:  parsed.summary || null
    };
  } catch (_e) {
    // Corrupt entry: treat as empty rather than bubbling, so the chat
    // surface recovers gracefully.
    return emptyTranscript();
  }
}

// saveTranscript(engagementId, transcript) → void
export function saveTranscript(engagementId, transcript) {
  if (!engagementId) return;
  if (!transcript || !Array.isArray(transcript.messages)) return;
  try {
    // Strip to the safe shape — only role, content, at, and optional
    // provenance survive. Anything else (API keys, internal bookkeeping)
    // is dropped.
    const safe = {
      messages: transcript.messages.map(m => {
        const out = {
          role:    m.role,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
          at:      m.at || new Date().toISOString()
        };
        if (m.provenance) out.provenance = m.provenance;
        return out;
      }),
      summary: transcript.summary || null
    };
    localStorage.setItem(TRANSCRIPT_KEY_PREFIX + engagementId, JSON.stringify(safe));
  } catch (e) {
    console.warn("[chatMemory] saveTranscript failed:", e && e.message);
  }
}

// clearTranscript(engagementId) → void
export function clearTranscript(engagementId) {
  if (!engagementId) return;
  try {
    localStorage.removeItem(TRANSCRIPT_KEY_PREFIX + engagementId);
  } catch (e) {
    console.warn("[chatMemory] clearTranscript failed:", e && e.message);
  }
}

// summarizeIfNeeded(transcript) → transcript'
//
// When transcript.messages.length > CHAT_TRANSCRIPT_WINDOW, collapses
// the oldest (length - (window - 1)) messages into one synthetic
// { role: "system", content: "PRIOR CONTEXT: ..." } message so the
// post-summary length is exactly CHAT_TRANSCRIPT_WINDOW.
//
// Summarization is deterministic: role plus truncated content for each
// collapsed message, joined with " | ". Being deterministic, it is
// idempotent — re-running on an already-summarized transcript whose
// length equals the window returns the input unchanged.
export function summarizeIfNeeded(transcript) {
  if (!transcript || !Array.isArray(transcript.messages)) return transcript;
  const msgs = transcript.messages;
  if (msgs.length <= CHAT_TRANSCRIPT_WINDOW) return transcript;

  const keepFromIndex = msgs.length - (CHAT_TRANSCRIPT_WINDOW - 1);
  const toCollapse    = msgs.slice(0, keepFromIndex);
  const kept          = msgs.slice(keepFromIndex);

  const summaryText = "PRIOR CONTEXT: " + toCollapse
    .map(m => "[" + m.role + "] " + (m.content || "").slice(0, 200))
    .join(" | ");

  return {
    messages: [
      { role: "system", content: summaryText, at: new Date().toISOString() },
      ...kept
    ],
    summary: transcript.summary || null
  };
}

// _resetForTests — removes every chat-memory key from localStorage.
// Test-harness use only, between describe blocks.
export function _resetForTests() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(TRANSCRIPT_KEY_PREFIX) === 0) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch (_e) { /* swallow per S14 */ }
}
