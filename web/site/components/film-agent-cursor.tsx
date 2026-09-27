"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { LYRA_AGENT_CURSOR as cursor } from "@lyra/icons/agent-cursor";
import { createCursorIdleState } from "@/lib/workbench-cursor";
import { isFilmCursorMessage } from "@/lib/film-cursor";

/** Outside both iframe and camera transforms: keep the actual desktop size. */
export function FilmAgentCursor({ frame, revision }: {
  readonly frame: RefObject<HTMLIFrameElement | null>;
  readonly revision: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!mounted || !host.current) return;
    const element = host.current;
    const idle = createCursorIdleState(value => { element.dataset.idle = String(value); }, {
      now: () => performance.now(),
      schedule: (callback, delay) => window.setTimeout(callback, delay),
      cancel: id => window.clearTimeout(id)
    });
    let point: { x: number; y: number } | null = null;
    let pending = 0;
    const hide = () => {
      if (point) frame.current?.contentWindow?.postMessage({ type: "lyra-film-cursor-reset" }, location.origin);
      point = null;
      cancelAnimationFrame(pending);
      pending = 0;
      idle.stop();
      element.dataset.active = "false";
    };
    const draw = () => {
      pending = 0;
      const iframe = frame.current;
      if (!point || !iframe || iframe.inert || document.hidden) { hide(); return; }
      const rect = iframe.getBoundingClientRect();
      const x = rect.left + point.x * rect.width;
      const y = rect.top + point.y * rect.height;
      if (x < 0 || x > innerWidth || y < 0 || y > innerHeight) { hide(); return; }
      element.style.transform = `translate3d(${x - cursor.hotspot.x}px, ${y - cursor.hotspot.y}px, 0)`;
      element.dataset.active = "true";
    };
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || !isFilmCursorMessage(event.data)) return;
      if (!event.data.active) { hide(); return; }
      point = { x: event.data.x, y: event.data.y };
      idle.move();
      if (!pending) pending = requestAnimationFrame(draw);
    };
    const keyboard = (event: KeyboardEvent) => { if (event.key === "Tab") hide(); };
    window.addEventListener("message", receive);
    window.addEventListener("blur", hide);
    window.addEventListener("scroll", hide, { passive: true });
    window.addEventListener("resize", hide);
    window.addEventListener("pointermove", hide, { passive: true });
    document.addEventListener("visibilitychange", hide);
    document.addEventListener("keydown", keyboard);
    return () => {
      hide();
      window.removeEventListener("message", receive);
      window.removeEventListener("blur", hide);
      window.removeEventListener("scroll", hide);
      window.removeEventListener("resize", hide);
      window.removeEventListener("pointermove", hide);
      document.removeEventListener("visibilitychange", hide);
      document.removeEventListener("keydown", keyboard);
    };
  }, [mounted, frame, revision]);
  if (!mounted) return null;
  return createPortal(<div ref={host} className="site-agent-cursor film-agent-cursor" aria-hidden="true" data-active="false">
    <style>{cursor.keyframes}</style>
    <div className="site-agent-cursor-visual">
      <span className="site-agent-cursor-aura" style={{ background: cursor.aura }} />
      <svg width={cursor.size} height={cursor.size} viewBox="0 0 256 256" fill="none">
        <path d={cursor.path} fill={cursor.fill} stroke={cursor.stroke} strokeWidth={cursor.strokeWidth} strokeLinejoin="round" />
      </svg>
    </div>
  </div>, document.body);
}
