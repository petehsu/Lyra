"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { LYRA_AGENT_CURSOR as cursor } from "@lyra/icons/agent-cursor";
import { createCursorIdleState, isWebCursorSurfaceActive } from "@/lib/workbench-cursor";

/** Human-controlled pointer using the desktop agent's shared visual identity. */
export function SiteAgentCursor({ scope }: { readonly scope: RefObject<HTMLElement | null> }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const visualRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    const host = hostRef.current;
    const visual = visualRef.current;
    const frame = scope.current?.querySelector<HTMLElement>(".real-workbench-frame");
    const surface = frame?.querySelector<HTMLElement>(".real-workbench-site-viewport");
    if (!host || !visual || !frame || !surface) return;
    const media = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let point: { x: number; y: number } | null = null;
    let lastX = Number.NaN;
    let lastY = Number.NaN;
    let pending = 0;
    let needsHitTest = false;
    let click: Animation | null = null;
    let active = false;
    const idle = createCursorIdleState(value => { host.dataset.idle = String(value); }, {
      now: () => performance.now(),
      schedule: (callback, ms) => window.setTimeout(callback, ms),
      cancel: id => window.clearTimeout(id)
    });

    const show = (next: boolean) => {
      if (active === next) return;
      active = next;
      host.dataset.active = String(next);
      if (next) frame.dataset.agentCursorActive = "true";
      else {
        delete frame.dataset.agentCursorActive;
        idle.stop();
        click?.cancel();
      }
    };
    const hide = () => {
      cancelAnimationFrame(pending);
      pending = 0;
      point = null;
      needsHitTest = false;
      lastX = lastY = Number.NaN;
      idle.stop();
      show(false);
    };
    const update = () => {
      pending = 0;
      if (!point || !media.matches || !isWebCursorSurfaceActive(frame.dataset.siteActive, frame.dataset.modalOpen) || document.hidden) {
        hide();
        return;
      }
      // Pointer events already identify the web surface. Only scrolling or
      // layout changes need a fresh hit-test for a stationary pointer.
      if (needsHitTest) {
        needsHitTest = false;
        const target = document.elementFromPoint(point.x, point.y);
        if (!target || !surface.contains(target)) { hide(); return; }
      }
      const moved = point.x !== lastX || point.y !== lastY;
      const entering = !active;
      if (moved) {
        host.style.transform = `translate3d(${point.x - cursor.hotspot.x}px, ${point.y - cursor.hotspot.y}px, 0)`;
        lastX = point.x;
        lastY = point.y;
        click?.cancel();
      }
      show(true);
      if (moved || entering) idle.move();
    };
    const queue = () => { if (point && !pending) pending = requestAnimationFrame(update); };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || !media.matches || !isWebCursorSurfaceActive(frame.dataset.siteActive, frame.dataset.modalOpen)) {
        hide();
        return;
      }
      point = { x: event.clientX, y: event.clientY };
      queue();
    };
    const recheck = () => { if (point) { needsHitTest = true; queue(); } };
    const blur = () => { if (!document.hasFocus()) hide(); };
    const down = (event: PointerEvent) => {
      if (!active || event.pointerType !== "mouse" || event.button !== 0 || reducedMotion.matches) return;
      click?.cancel();
      click = visual.animate([
        { transform: "scale(1)" },
        { transform: "scale(0.8)", offset: 0.35 },
        { transform: "scale(1)" }
      ], { duration: 150, easing: "linear" });
    };
    const keyboard = (event: KeyboardEvent) => { if (event.key === "Tab") hide(); };
    const tabObserver = new MutationObserver(() => {
      if (!isWebCursorSurfaceActive(frame.dataset.siteActive, frame.dataset.modalOpen)) hide();
      else recheck();
    });
    tabObserver.observe(frame, { attributes: true, attributeFilter: ["data-site-active", "data-modal-open"] });
    const sizeObserver = new ResizeObserver(recheck);
    sizeObserver.observe(surface);
    surface.addEventListener("pointerenter", move, { passive: true });
    surface.addEventListener("pointermove", move, { passive: true });
    surface.addEventListener("pointerdown", down, { passive: true });
    surface.addEventListener("pointerleave", hide, { passive: true });
    surface.addEventListener("pointercancel", hide, { passive: true });
    document.addEventListener("keydown", keyboard);
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("blur", blur);
    window.addEventListener("scroll", recheck, { passive: true });
    window.addEventListener("resize", recheck, { passive: true });
    window.addEventListener("lyra:workbench-geometry", recheck);
    media.addEventListener("change", recheck);
    return () => {
      hide();
      click?.cancel();
      tabObserver.disconnect();
      sizeObserver.disconnect();
      surface.removeEventListener("pointerenter", move);
      surface.removeEventListener("pointermove", move);
      surface.removeEventListener("pointerdown", down);
      surface.removeEventListener("pointerleave", hide);
      surface.removeEventListener("pointercancel", hide);
      document.removeEventListener("keydown", keyboard);
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("blur", blur);
      window.removeEventListener("scroll", recheck);
      window.removeEventListener("resize", recheck);
      window.removeEventListener("lyra:workbench-geometry", recheck);
      media.removeEventListener("change", recheck);
    };
  }, [mounted, scope]);
  if (!mounted) return null;
  // Outside the transformed camera: fixed coordinates must stay screen-space.
  return createPortal(
    <div ref={hostRef} className="site-agent-cursor" aria-hidden="true" data-active="false">
      <style>{cursor.keyframes}</style>
      <div ref={visualRef} className="site-agent-cursor-visual">
        <span className="site-agent-cursor-aura" style={{ background: cursor.aura }} />
        <svg width={cursor.size} height={cursor.size} viewBox="0 0 256 256" fill="none">
          <path d={cursor.path} fill={cursor.fill} stroke={cursor.stroke} strokeWidth={cursor.strokeWidth} strokeLinejoin="round" />
        </svg>
      </div>
    </div>,
    document.body
  );
}
