import { LYRA_AGENT_CURSOR } from "@lyra/icons/agent-cursor";

export type BrowserAgentCursorOverlayAction =
  | "observe"
  | "read"
  | "capture"
  | "wait"
  | "navigate"
  | "focus"
  | "scroll"
  | "act"
  | "type"
  | "press";

export type BrowserAgentCursorOverlayPhase =
  | "move"
  | "down"
  | "up"
  | "idle";

export type BrowserAgentCursorOverlayOptions = {
  readonly action: BrowserAgentCursorOverlayAction;
  readonly durationMs: number;
  readonly phase?: BrowserAgentCursorOverlayPhase;
  readonly hold?: boolean;
  readonly cursor?: {
    readonly x: number;
    readonly y: number;
  };
  readonly points?: readonly { readonly x: number; readonly y: number }[];
  readonly thought?: string;
};

export const LYRA_AGENT_PAGE_CURSOR_HOST_ID = "__lyra_agent_page_cursor__";

const normalizeScriptNumber = (value: number | undefined): number | null => {
  if (typeof value !== "number" || Number.isFinite(value) === false) {
    return null;
  }
  return Math.round(value);
};

export const buildAgentCursorOverlayScript = ({
  action,
  durationMs,
  phase = "idle",
  hold = false,
  cursor,
  points,
  thought = ""
}: BrowserAgentCursorOverlayOptions): string => {
  const payload = {
    action,
    phase,
    hold,
    thought: thought.slice(-1_200),
    durationMs: hold
      ? Math.max(3_000, Math.min(60_000, Math.round(durationMs)))
      : Math.max(500, Math.min(8_000, Math.round(durationMs))),
    x: normalizeScriptNumber(cursor?.x),
    y: normalizeScriptNumber(cursor?.y),
    points: (points ?? [])
      .map((point) => ({
        x: normalizeScriptNumber(point.x),
        y: normalizeScriptNumber(point.y)
      }))
      .filter((point): point is { x: number; y: number } => point.x !== null && point.y !== null)
      .slice(0, 16),
    hostId: LYRA_AGENT_PAGE_CURSOR_HOST_ID,
    path: LYRA_AGENT_CURSOR.path
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
            x: clamp(payload.x, 8, Math.max(8, viewportWidth - 48)),
            y: clamp(payload.y, 8, Math.max(8, viewportHeight - 48))
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
    host.dataset.lyraAgentPhase = payload.phase;
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
    host.style.transition = "opacity 120ms ease-out";
    if (!Number.isFinite(Number(host.dataset.lyraX)) || !Number.isFinite(Number(host.dataset.lyraY))) {
      host.style.transform = "translate3d(" + (explicitPoint.x - 6) + "px, " + (explicitPoint.y - 5) + "px, 0)";
      host.dataset.lyraX = String(explicitPoint.x);
      host.dataset.lyraY = String(explicitPoint.y);
    }

    const root = host.shadowRoot || (typeof host.attachShadow === "function" ? host.attachShadow({ mode: "open" }) : host);
    let wrap = root.querySelector("[data-lyra-agent-cursor-wrap]");
    const isNewWrap = !(wrap instanceof HTMLElement);
    if (isNewWrap) {
      wrap = document.createElement("div");
      wrap.setAttribute("data-lyra-agent-cursor-wrap", "true");
      wrap.style.position = "absolute";
      wrap.style.left = "0px";
      wrap.style.top = "0px";
      wrap.style.width = "52px";
      wrap.style.height = "52px";
      wrap.style.pointerEvents = "none";
      wrap.style.overflow = "visible";
    }
    wrap.style.transform = "none";
    let style = root.querySelector("[data-lyra-agent-cursor-style]");
    if (!(style instanceof HTMLStyleElement)) {
      style = document.createElement("style");
      style.setAttribute("data-lyra-agent-cursor-style", "true");
      root.appendChild(style);
    }
    style.textContent = ${JSON.stringify(LYRA_AGENT_CURSOR.keyframes)};
    let sway = wrap.querySelector("[data-lyra-agent-cursor-sway]");
    if (!(sway instanceof HTMLElement)) {
      sway = document.createElement("div");
      sway.setAttribute("data-lyra-agent-cursor-sway", "true");
      sway.style.position = "absolute";
      sway.style.left = "0px";
      sway.style.top = "0px";
      sway.style.width = "52px";
      sway.style.height = "52px";
      sway.style.pointerEvents = "none";
      while (wrap.firstChild) sway.appendChild(wrap.firstChild);
      wrap.appendChild(sway);
    }
    sway.style.transformOrigin = "21px 21px";
    const clickStillPlaying = () => {
      const started = Number(host.dataset.lyraClickAt);
      return Number.isFinite(started) && Date.now() - started < 180;
    };
    const setSway = (on) => {
      if (!on || clickStillPlaying()) return;
      sway.style.animation = ${JSON.stringify(LYRA_AGENT_CURSOR.sway)};
    };
    if (payload.phase === "down") {
      host.dataset.lyraClickAt = String(Date.now());
      sway.style.animation = ${JSON.stringify(LYRA_AGENT_CURSOR.click)};
    }
    let note = wrap.querySelector("[data-lyra-agent-cursor-thought]");
    if (!(note instanceof HTMLElement)) {
      note = document.createElement("div");
      note.setAttribute("data-lyra-agent-cursor-thought", "true");
      note.style.position = "absolute";
      note.style.left = "58px";
      note.style.top = "0px";
      note.style.width = "max-content";
      note.style.maxWidth = "220px";
      note.style.maxHeight = "88px";
      note.style.overflow = "auto";
      note.style.boxSizing = "content-box";
      note.style.padding = "8px 10px";
      note.style.borderRadius = "10px";
      note.style.background = "rgba(28, 28, 28, 0.92)";
      note.style.color = "rgba(244, 244, 244, 0.96)";
      note.style.font = "12px/1.4 sans-serif";
      note.style.whiteSpace = "pre-wrap";
      note.style.pointerEvents = "none";
      wrap.appendChild(note);
    }
    if (note.parentElement !== wrap) wrap.appendChild(note);
    const pageTone = () => {
      const probe = getComputedStyle(document.body || document.documentElement).backgroundColor || "";
      const parts = probe.match(/[\d.]+/g);
      if (!parts || parts.length < 3) return "dark";
      const [r, g, b] = parts.map(Number);
      const luminance = (r * 299 + g * 587 + b * 114) / 1000;
      return luminance > 160 ? "light" : "dark";
    };
    const paintTone = () => {
      if (pageTone() === "light") {
        note.style.background = "rgba(255, 255, 255, 0.94)";
        note.style.color = "rgba(28, 28, 28, 0.96)";
      } else {
        note.style.background = "rgba(28, 28, 28, 0.92)";
        note.style.color = "rgba(244, 244, 244, 0.96)";
      }
    };
    const layoutNote = (x, y) => {
      const body = note.textContent || "";
      note.style.width = "max-content";
      note.style.maxWidth = "220px";
      note.style.maxHeight = "88px";
      note.style.display = body.length > 0 ? "block" : "none";
      if (body.length === 0) return;
      const gap = 16;
      const cursor = 42;
      const width = note.offsetWidth;
      const height = note.offsetHeight;
      const originX = x - 6;
      const originY = y - 5;
      const fits = (left, top) => originX + left >= 8
        && originY + top >= 8
        && originX + left + width <= viewportWidth - 8
        && originY + top + height <= viewportHeight - 8;
      const spots = [
        [cursor + gap, 0],
        [-gap - width, 0],
        [0, cursor + gap],
        [0, -gap - height]
      ];
      let left = spots[0][0];
      let top = spots[0][1];
      const open = spots.find((spot) => fits(spot[0], spot[1]));
      if (open) {
        left = open[0];
        top = open[1];
      } else {
        if (originX + left + width > viewportWidth - 8) left = -gap - width;
        if (originX + left < 8) left = cursor + gap;
        if (originY + top + height > viewportHeight - 8) top = -gap - height;
        if (originY + top < 8) top = cursor + gap;
      }
      note.style.left = left + "px";
      note.style.top = top + "px";
      note.scrollTop = note.scrollHeight;
    };
    const placeNote = (x, y) => {
      note.textContent = payload.thought;
      paintTone();
      layoutNote(x, y);
    };
    host.__lyraPlaceThought = () => layoutNote(Number(host.dataset.lyraX), Number(host.dataset.lyraY));
    placeNote(explicitPoint.x, explicitPoint.y);
    const writeAt = (x, y) => {
      host.style.transition = "none";
      host.style.transform = "translate3d(" + (x - 6) + "px, " + (y - 5) + "px, 0)";
      host.dataset.lyraX = String(x);
      host.dataset.lyraY = String(y);
    };
    const glideTo = (x, y) => {
      const fromX = Number(host.dataset.lyraX);
      const fromY = Number(host.dataset.lyraY);
      const token = (Number(host.dataset.lyraGlide) || 0) + 1;
      host.dataset.lyraGlide = String(token);
      if (!Number.isFinite(fromX) || !Number.isFinite(fromY)) {
        writeAt(x, y);
        layoutNote(x, y);
        return Promise.resolve();
      }
      const dx = x - fromX;
      const dy = y - fromY;
      const dist = Math.hypot(dx, dy);
      if (dist < 10) {
        writeAt(x, y);
        layoutNote(x, y);
        return Promise.resolve();
      }
      const bend = Math.min(16, dist * 0.07);
      const side = host.dataset.lyraBend === "1" ? -1 : 1;
      host.dataset.lyraBend = side === 1 ? "1" : "0";
      const nx = -dy / dist;
      const ny = dx / dist;
      const c1x = fromX + dx * 0.33 + nx * bend * side;
      const c1y = fromY + dy * 0.33 + ny * bend * side;
      const c2x = fromX + dx * 0.72 + nx * bend * side * 0.45;
      const c2y = fromY + dy * 0.72 + ny * bend * side * 0.45;
      const duration = Math.min(280, Math.max(140, 110 + dist * 0.28));
      const started = performance.now();
      return new Promise((resolve) => {
        const frame = (now) => {
          if (Number(host.dataset.lyraGlide) !== token || !host.isConnected) {
            resolve();
            return;
          }
          const t = Math.min(1, (now - started) / duration);
          const e = 1 - Math.pow(1 - t, 3);
          const u = 1 - e;
          const px = u * u * u * fromX + 3 * u * u * e * c1x + 3 * u * e * e * c2x + e * e * e * x;
          const py = u * u * u * fromY + 3 * u * u * e * c1y + 3 * u * e * e * c2y + e * e * e * y;
          writeAt(px, py);
          layoutNote(px, py);
          if (t < 1) requestAnimationFrame(frame);
          else resolve();
        };
        requestAnimationFrame(frame);
      });
    };
    host.__lyraMoveCursor = glideTo;
    if (typeof window.__lyraAgentCursorSweep === "number") {
      window.clearTimeout(window.__lyraAgentCursorSweep);
    }
    const trail = Array.isArray(payload.points) ? payload.points : [];
    if (trail.length > 1) {
      setSway(true);
      let index = 0;
      const step = () => {
        if (!host.isConnected || index >= trail.length) return;
        const point = trail[index];
        index += 1;
        glideTo(point.x, point.y).then(() => {
          if (index < trail.length) step();
        });
      };
      step();
    } else {
      glideTo(explicitPoint.x, explicitPoint.y);
      if (payload.phase !== "down") setSway(true);
    }

    let aura = wrap.querySelector("[data-lyra-agent-cursor-aura]");
    if (!(aura instanceof HTMLElement)) {
      aura = document.createElement("div");
      aura.setAttribute("data-lyra-agent-cursor-aura", "true");
      aura.style.position = "absolute";
      aura.style.left = "-19px";
      aura.style.top = "-19px";
      aura.style.width = "90px";
      aura.style.height = "90px";
      aura.style.borderRadius = "999px";
      aura.style.background = ${JSON.stringify(LYRA_AGENT_CURSOR.aura)};
      aura.style.filter = "none";
      sway.appendChild(aura);
    }

    if (wrap.querySelector("svg") === null) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", "42");
      svg.setAttribute("height", "42");
      svg.setAttribute("viewBox", "0 0 256 256");
      svg.setAttribute("fill", "none");
      svg.style.position = "absolute";
      svg.style.left = "0px";
      svg.style.top = "0px";
      svg.style.overflow = "visible";
      svg.style.filter = "none";

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", payload.path);
      path.setAttribute("fill", ${JSON.stringify(LYRA_AGENT_CURSOR.fill)});
      path.setAttribute("stroke", ${JSON.stringify(LYRA_AGENT_CURSOR.stroke)});
      path.setAttribute("stroke-width", "17");
      path.setAttribute("stroke-linejoin", "round");
      svg.appendChild(path);
      sway.appendChild(svg);
    }

    if (isNewWrap) {
      root.appendChild(wrap);
    }


    if (typeof window.__lyraAgentCursorTimer === "number") {
      window.clearTimeout(window.__lyraAgentCursorTimer);
    }
    const safetyDurationMs = payload.hold
      ? payload.durationMs
      : Math.max(3_000, Math.min(10_000, payload.durationMs * 2));
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
    }, safetyDurationMs);

    return true;
  } catch (_error) {
    return false;
  }
})()
`;
};

export const buildAgentCursorThoughtScript = (thought: string): string => {
  const text = JSON.stringify(thought.slice(-1_200));
  const hostId = JSON.stringify(LYRA_AGENT_PAGE_CURSOR_HOST_ID);
  return `(() => {
    const host = document.getElementById(${hostId});
    const note = host instanceof HTMLElement
      ? host.shadowRoot?.querySelector("[data-lyra-agent-cursor-thought]")
      : null;
    if (!(note instanceof HTMLElement)) return false;
    const body = ${text};
    note.style.width = "max-content";
    note.style.maxWidth = "220px";
    note.style.maxHeight = "88px";
    note.style.display = body.length > 0 ? "block" : "none";
    note.textContent = body;
    if (typeof host.__lyraPlaceThought === "function") host.__lyraPlaceThought();
    else note.style.left = "58px";
    note.scrollTop = note.scrollHeight;
    return true;
  })()`;
};
