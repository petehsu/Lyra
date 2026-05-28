export type BrowserAgentCursorOverlayAction =
  | "observe"
  | "read"
  | "capture"
  | "wait"
  | "navigate"
  | "focus"
  | "act"
  | "type"
  | "press";

export type BrowserAgentCursorOverlayOptions = {
  readonly action: BrowserAgentCursorOverlayAction;
  readonly durationMs: number;
  readonly cursor?: {
    readonly x: number;
    readonly y: number;
  };
};

export const LYRA_AGENT_PAGE_CURSOR_HOST_ID = "__lyra_agent_page_cursor__";

const BIBATA_LEFT_PTR_PATH =
  "M201.163 133.54L201.149 133.528L201.134 133.515L91.6855 36.4935C86.5144 31.7659 81.4269 27.9549 76.5421 25.525C71.7671 23.1497 66.0861 21.5569 60.4133 23.1213C54.3118 24.8039 50.4875 29.4674 48.3639 34.759C46.3122 39.8715 45.4999 46.2787 45.4999 53.5383L45.4999 200.431V200.493L45.5008 200.555C45.6218 208.862 50.4279 217.843 55.9963 223.894C58.8934 227.043 62.5163 229.986 66.6704 231.742C70.9172 233.537 76.217 234.254 81.4691 231.884C85.7536 229.951 89.6754 226.055 92.8565 222.651C94.6841 220.695 96.8336 218.252 99.0355 215.749C100.71 213.847 102.414 211.91 104.03 210.126C112.189 201.122 121.346 192.286 132.161 187.407C143.013 182.511 155.809 181.375 167.963 181.146C170.959 181.089 173.85 181.087 176.65 181.085H176.663H176.686C179.447 181.083 182.164 181.081 184.662 181.019C189.231 180.906 194.643 180.609 198.777 178.88C208.711 174.723 210.972 163.838 210.753 156.445C210.521 148.596 207.57 139.272 201.163 133.54Z";

const normalizeScriptNumber = (value: number | undefined): number | null => {
  if (typeof value !== "number" || Number.isFinite(value) === false) {
    return null;
  }
  return Math.round(value);
};

export const buildAgentCursorOverlayScript = ({
  action,
  durationMs,
  cursor
}: BrowserAgentCursorOverlayOptions): string => {
  const payload = {
    action,
    durationMs: Math.max(500, Math.min(8_000, Math.round(durationMs))),
    x: normalizeScriptNumber(cursor?.x),
    y: normalizeScriptNumber(cursor?.y),
    hostId: LYRA_AGENT_PAGE_CURSOR_HOST_ID,
    path: BIBATA_LEFT_PTR_PATH
  };

  return `
(() => {
  try {
    const payload = ${JSON.stringify(payload)};
    const mount = document.body || document.documentElement;
    if (!mount) return false;

    const clamp = (value, min, max) => Math.max(min, Math.min(max, Math.round(value)));
    const viewportWidth = Math.max(1, Math.round(window.innerWidth || document.documentElement.clientWidth || 1));
    const viewportHeight = Math.max(1, Math.round(window.innerHeight || document.documentElement.clientHeight || 1));
    const fallbackPoint = () => {
      const active = document.activeElement;
      if (active instanceof Element) {
        const rect = active.getBoundingClientRect();
        if (
          Number.isFinite(rect.left)
          && Number.isFinite(rect.top)
          && rect.width > 0
          && rect.height > 0
          && rect.bottom >= 0
          && rect.right >= 0
          && rect.top <= viewportHeight
          && rect.left <= viewportWidth
        ) {
          return {
            x: clamp(rect.left + rect.width / 2, 0, viewportWidth),
            y: clamp(rect.top + rect.height / 2, 0, viewportHeight)
          };
        }
      }
      return {
        x: clamp(viewportWidth / 2, 0, viewportWidth),
        y: clamp(viewportHeight / 2, 0, viewportHeight)
      };
    };
    const explicitPoint =
      Number.isFinite(payload.x) && Number.isFinite(payload.y)
        ? {
            x: clamp(payload.x, 0, viewportWidth),
            y: clamp(payload.y, 0, viewportHeight)
          }
        : fallbackPoint();

    let host = document.getElementById(payload.hostId);
    if (!(host instanceof HTMLElement)) {
      host = document.createElement("div");
      host.id = payload.hostId;
      host.setAttribute("aria-hidden", "true");
      mount.appendChild(host);
    }
    host.dataset.lyraAgentAction = payload.action;
    host.style.position = "fixed";
    host.style.left = "0px";
    host.style.top = "0px";
    host.style.width = "52px";
    host.style.height = "52px";
    host.style.pointerEvents = "none";
    host.style.zIndex = "2147483647";
    host.style.opacity = "1";
    host.style.contain = "layout style";
    host.style.overflow = "visible";
    host.style.willChange = "transform, opacity";
    host.style.transform = "translate3d(" + (explicitPoint.x - 6) + "px, " + (explicitPoint.y - 5) + "px, 0)";

    const root = host.shadowRoot || (typeof host.attachShadow === "function" ? host.attachShadow({ mode: "open" }) : host);
    while (root.firstChild) {
      root.removeChild(root.firstChild);
    }

    const wrap = document.createElement("div");
    wrap.style.position = "absolute";
    wrap.style.left = "0px";
    wrap.style.top = "0px";
    wrap.style.width = "52px";
    wrap.style.height = "52px";
    wrap.style.pointerEvents = "none";
    wrap.style.transformOrigin = "6px 5px";
    wrap.style.overflow = "visible";

    const aura = document.createElement("div");
    aura.style.position = "absolute";
    aura.style.left = "-19px";
    aura.style.top = "-19px";
    aura.style.width = "90px";
    aura.style.height = "90px";
    aura.style.borderRadius = "999px";
    aura.style.background = "radial-gradient(circle, rgba(68, 210, 255, 0.36) 0%, rgba(85, 130, 255, 0.18) 38%, rgba(85, 130, 255, 0) 72%)";
    aura.style.filter = "blur(2px)";

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "42");
    svg.setAttribute("height", "42");
    svg.setAttribute("viewBox", "0 0 256 256");
    svg.setAttribute("fill", "none");
    svg.style.position = "absolute";
    svg.style.left = "0px";
    svg.style.top = "0px";
    svg.style.overflow = "visible";
    svg.style.filter =
      "drop-shadow(0 1px 2px rgba(0, 0, 0, 0.72)) drop-shadow(0 0 12px rgba(57, 201, 255, 0.72))";

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", payload.path);
    path.setAttribute("fill", "rgba(248, 252, 255, 0.98)");
    path.setAttribute("stroke", "rgba(35, 118, 255, 0.98)");
    path.setAttribute("stroke-width", "17");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);

    wrap.appendChild(aura);
    wrap.appendChild(svg);
    root.appendChild(wrap);

    const baseTransform = host.style.transform;
    if (typeof host.animate === "function") {
      host.animate(
        [
          { transform: baseTransform + " scale(0.92)", opacity: "0.78" },
          { transform: baseTransform + " scale(1)", opacity: "1" }
        ],
        { duration: 160, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
      );
    }
    if (typeof aura.animate === "function") {
      aura.animate(
        [
          { transform: "scale(0.86)", opacity: "0.58" },
          { transform: "scale(1.08)", opacity: "1" }
        ],
        { duration: 860, easing: "ease-in-out", iterations: Infinity, direction: "alternate" }
      );
    }

    if (typeof window.__lyraAgentCursorTimer === "number") {
      window.clearTimeout(window.__lyraAgentCursorTimer);
    }
    window.__lyraAgentCursorTimer = window.setTimeout(() => {
      const remove = () => {
        if (host.parentNode) {
          host.parentNode.removeChild(host);
        }
      };
      if (typeof host.animate === "function") {
        const fade = host.animate(
          [
            { opacity: "1", transform: host.style.transform },
            { opacity: "0", transform: host.style.transform }
          ],
          { duration: 140, easing: "ease-out" }
        );
        fade.onfinish = remove;
        window.setTimeout(remove, 220);
        return;
      }
      remove();
    }, payload.durationMs);

    return true;
  } catch (_error) {
    return false;
  }
})()
`;
};
