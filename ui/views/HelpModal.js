// ui/views/HelpModal.js — contextual help modal.
// Usage:
//   import { helpButton } from "../views/HelpModal.js";
//   mainCard.appendChild(helpButton("gaps"));

import { HELP_CONTENT } from "../../core/helpContent.js";
import { helpIcon }     from "../icons.js";

/** Build a `?` button that opens HelpModal for the given content key. */
export function helpButton(contentKey) {
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "help-icon-btn";
  btn.setAttribute("aria-label", "Help: " + (HELP_CONTENT[contentKey]?.title || contentKey));
  btn.setAttribute("title", "Help");
  btn.appendChild(helpIcon());
  btn.addEventListener("click", function(e) {
    e.stopPropagation();
    showHelp(contentKey);
  });
  return btn;
}

/** Open (or replace) the help modal with content for the given key. */
export function showHelp(contentKey) {
  closeExisting();

  var content = HELP_CONTENT[contentKey];
  if (!content) return;

  var overlay = document.createElement("div");
  overlay.id = "help-modal";
  overlay.className = "dialog-overlay help-modal-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "help-modal-title");

  var box = document.createElement("div");
  box.className = "dialog-box help-modal-box";

  var head = document.createElement("div");
  head.className = "help-modal-head";

  var title = document.createElement("h2");
  title.className = "help-modal-title";
  title.id = "help-modal-title";
  title.textContent = content.title;
  head.appendChild(title);

  var closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "help-modal-close";
  closeBtn.setAttribute("aria-label", "Close help");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", close);
  head.appendChild(closeBtn);

  box.appendChild(head);

  var list = document.createElement("ul");
  list.className = "help-modal-list";
  content.body.forEach(function(line) {
    var li = document.createElement("li");
    li.textContent = line;
    list.appendChild(li);
  });
  box.appendChild(list);

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  overlay.addEventListener("click", function(e) {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", handleEsc);

  function handleEsc(e) {
    if (e.key === "Escape") close();
  }
  function close() {
    overlay.remove();
    document.removeEventListener("keydown", handleEsc);
  }
}

function closeExisting() {
  var existing = document.getElementById("help-modal");
  if (existing) existing.remove();
}
