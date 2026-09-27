// Keep the renderer's actual accordion behavior. Nothing else in the scripted
// desktop is visitor-editable; synthetic director clicks still reach the app.
export const FILM_TOOL_TOGGLES = [
  ".lyra-agents-tool-group-head[aria-expanded]",
  ".lyra-agents-tool-call-head[aria-expanded]",
  ".lyra-agents-tool-call-twist[aria-expanded]",
  ".lyra-agents-fold-line",
  ".lyra-agents-message-process-fold-head[aria-expanded]"
].join(",");

export function installFilmInteractions() {
  const focusable = 'button, a[href], input, textarea, select, [tabindex], [contenteditable="true"]';
  const reconcile = (root: HTMLElement) => {
    const elements = [...root.querySelectorAll<HTMLElement>(focusable)];
    if (root.matches(focusable)) elements.push(root);
    elements.forEach(element => {
      const allowed = element.matches(FILM_TOOL_TOGGLES);
      if (allowed) element.dataset.filmToolToggle = "true";
      else delete element.dataset.filmToolToggle;
      const tabIndex = allowed ? 0 : -1;
      if (element.tabIndex !== tabIndex) element.tabIndex = tabIndex;
    });
  };
  const guard = (event: Event) => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    if (event instanceof KeyboardEvent && event.key === "Tab") return;
    if (!event.target.closest(FILM_TOOL_TOGGLES)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  // Streaming text does not create controls. Only inspect new element subtrees,
  // never scan the whole desktop on every token or terminal update.
  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node instanceof HTMLElement) reconcile(node);
    }
  });
  observer.observe(document.getElementById("app")!, { childList: true, subtree: true });
  reconcile(document.getElementById("app")!);
  document.addEventListener("click", guard, true);
  document.addEventListener("keydown", guard, true);
  return () => {
    observer.disconnect();
    document.removeEventListener("click", guard, true);
    document.removeEventListener("keydown", guard, true);
  };
}
