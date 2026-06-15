// ui/skillBuilderOpener.js — thin redirect shim.
//
// The canonical home for skill authoring is Settings → Skills builder
// pill. This shim is a single chokepoint so call sites (the chat
// right-rail "+ Author new skill" affordance in CanvasChatOverlay; topbar
// wiring in app.js if it ever returns) don't have to know the exact route
// — they call openSkillBuilderOverlay() and we drive them to Settings.

import { closeOverlay } from "./components/Overlay.js";

export async function openSkillBuilderOverlay() {
  // When the Canvas AI Assistant chat is already open, pass sidePanel:true
  // so Settings opens as a side-panel and the chat persists alongside.
  // When the chat is NOT open (e.g. a future invocation from the topbar),
  // default to full-layout: closeOverlay() defensively, then
  // openSettingsModal() without sidePanel:true.
  var chatOpen = !!document.querySelector(".overlay[data-kind='canvas-chat']");

  if (!chatOpen) {
    // No chat to preserve — close anything else that might be open
    // and mount Settings full-screen.
    try { closeOverlay(); } catch (_e) { /* no-op if nothing's open */ }
  }
  // If chat IS open: do NOT call closeOverlay(); Overlay.js stack will
  // push Settings as the side-panel right pane while chat shrinks left.

  try {
    const mod = await import("./views/SettingsModal.js");
    mod.openSettingsModal({ section: "skills", sidePanel: chatOpen });
  } catch (e) {
    // Last-resort visible fallback — should never happen in a
    // properly-built container, but if it does we want the user to
    // see SOMETHING instead of a silent no-op.
    var fallback = document.createElement("div");
    fallback.setAttribute("role", "alert");
    fallback.style.cssText = "position:fixed;top:20px;left:50%;transform:translateX(-50%);" +
                             "z-index:9999;padding:16px 24px;background:#FEE2E2;" +
                             "border:1px solid #FCA5A5;border-radius:8px;color:#7f1d1d;" +
                             "font:13px Inter,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,0.15);";
    fallback.textContent = "Couldn't open Settings: " + (e && e.message || e);
    document.body.appendChild(fallback);
    setTimeout(function() { try { fallback.remove(); } catch (_e2) {} }, 4000);
  }
}
