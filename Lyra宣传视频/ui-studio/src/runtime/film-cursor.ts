/** Forward only pointer geometry, not app state, to the screen-space cursor. */
export function installFilmCursor() {
  let point: { x: number; y: number } | null = null;
  let active = false;
  let lastX = -1;
  let lastY = -1;
  let pending = 0;
  const media = matchMedia("(hover: hover) and (pointer: fine)");
  const surface = () => document.querySelector<HTMLElement>(".opening-sequence-browser-surface");
  const hide = () => {
    point = null;
    if (active) {
      active = false;
      surface()?.removeAttribute("data-agent-cursor-active");
      window.parent.postMessage({ type: "lyra-film-cursor", active: false }, location.origin);
    }
  };
  const refresh = () => {
    if (!point) return;
    const page = surface();
    const hit = document.elementFromPoint(point.x, point.y);
    const inside = media.matches && !document.hidden && !!page && !!hit && page.contains(hit);
    if (!inside) {
      if (active) {
        active = false;
        page?.removeAttribute("data-agent-cursor-active");
        window.parent.postMessage({ type: "lyra-film-cursor", active: false }, location.origin);
      }
      return;
    }
    if (active && point.x === lastX && point.y === lastY) return;
    active = true;
    lastX = point.x;
    lastY = point.y;
    page.dataset.agentCursorActive = "true";
    window.parent.postMessage({ type: "lyra-film-cursor", active: true, x: point.x / innerWidth, y: point.y / innerHeight }, location.origin);
  };
  const move = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") { hide(); return; }
    point = { x: event.clientX, y: event.clientY };
    if (!pending) pending = requestAnimationFrame(() => { pending = 0; refresh(); });
  };
  const reset = (event: MessageEvent) => {
    if (event.source === window.parent && event.origin === location.origin && event.data?.type === "lyra-film-cursor-reset") hide();
  };
  window.addEventListener("message", reset);
  document.addEventListener("pointermove", move, { passive: true });
  document.documentElement.addEventListener("pointerleave", hide);
  window.addEventListener("blur", hide);
  document.addEventListener("visibilitychange", hide);
  return {
    // Called after the director moves the scene, so a stationary pointer cannot
    // remain an agent cursor when a settings card replaces the website.
    refresh,
    dispose() {
      hide();
      cancelAnimationFrame(pending);
      document.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", hide);
      window.removeEventListener("blur", hide);
      window.removeEventListener("message", reset);
      document.removeEventListener("visibilitychange", hide);
    }
  };
}
