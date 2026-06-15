// ui/components/DemoBanner.js
//
// Shared "Demo mode" banner. Mounted at the top of every left-panel view
// when session.isDemo === true so the demo signal follows the user across
// the workshop instead of vanishing after Tab 1.
//
// Styling lives in styles.css under .demo-mode-banner; this module is just
// the render helper.

export function renderDemoBanner(target) {
  if (!target || typeof target.appendChild !== "function") return null;
  var b = document.createElement("div");
  b.className = "demo-mode-banner";
  b.innerHTML = "<strong>Demo mode</strong> , You're viewing example data. Edit any field across the workshop to start your own session, then save to file.";
  target.appendChild(b);
  return b;
}
