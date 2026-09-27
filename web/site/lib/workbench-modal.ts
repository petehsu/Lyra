/** Cut only the desktop's empty browser slot out of #app. Radix dialog portals
 * are body siblings, so their backdrop, shadow and focus trap stay untouched.
 */
export function workbenchModalCutout(bounds: { left: number; top: number; right: number; bottom: number }) {
  const { left, top, right, bottom } = bounds;
  if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return "none";
  return `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${left}px ${top}px, ${right}px ${top}px, ${right}px ${bottom}px, ${left}px ${bottom}px, ${left}px ${top}px)`;
}

/** Same-origin compositing, not a copy of the dialog. The real iframe owns
 * modal interaction; the website remains rendered underneath its clear slot.
 */
export function createWorkbenchModalBridge(document: Document, frame: HTMLElement, surface: HTMLElement) {
  const style = document.createElement("style");
  style.textContent = `
    html[data-site-modal-composite="true"],
    html[data-site-modal-composite="true"] body { background: transparent !important; }
    html[data-site-modal-composite="true"] #app { clip-path: var(--site-modal-cutout); }
  `;
  document.head.append(style);
  const root = document.documentElement;
  const set = (element: HTMLElement, property: string, value: string) => {
    if (element.style.getPropertyValue(property) !== value) element.style.setProperty(property, value);
  };
  const reset = () => {
    if (frame.dataset.modalOpen !== "false") frame.dataset.modalOpen = "false";
    if (root.hasAttribute("data-site-modal-composite")) root.removeAttribute("data-site-modal-composite");
    if (surface.inert) surface.inert = false;
    surface.style.removeProperty("filter");
    surface.style.removeProperty("opacity");
  };
  return {
    sync(workspace: Element | null, siteActive: boolean) {
      // Keep compositing during the closing animation, until the portal leaves.
      const overlay = document.querySelector(".lyra-ui-dialog-overlay");
      const open = !!overlay?.getClientRects().length;
      if (!open) { reset(); return; }
      if (siteActive && workspace) {
        if (root.dataset.siteModalComposite !== "true") {
          // Opacity must blend against the same app background as the native
          // chrome, not the darker desktop wallpaper behind the parent frame.
          set(frame, "--workbench-modal-base", document.defaultView?.getComputedStyle(document.body).backgroundColor || "var(--paper)");
        }
        const bounds = workspace.getBoundingClientRect();
        set(root, "--site-modal-cutout", workbenchModalCutout(bounds));
        if (root.dataset.siteModalComposite !== "true") root.dataset.siteModalComposite = "true";
      } else if (root.hasAttribute("data-site-modal-composite")) {
        root.removeAttribute("data-site-modal-composite");
      }
      if (frame.dataset.modalOpen !== "true") frame.dataset.modalOpen = "true";
      if (!surface.inert) surface.inert = true;
      const blurred = document.querySelector(".lyra-root-modal-open .lyra-main");
      const unit = blurred && document.defaultView?.getComputedStyle(blurred).getPropertyValue("--lyra-unit-15").trim();
      set(surface, "filter", blurred ? `blur(${unit || "15px"}) saturate(1.08)` : "none");
      set(surface, "opacity", blurred ? "0.72" : "1");
    },
    destroy() {
      reset();
      root.style.removeProperty("--site-modal-cutout");
      frame.style.removeProperty("--workbench-modal-base");
      style.remove();
    }
  };
}
