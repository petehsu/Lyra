"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { HERO_PIXEL_SIZE, heroPixelCovered, heroPixelResponse } from "@/lib/hero-pixels";

gsap.registerPlugin(useGSAP);

/** A static dither into the next section, with a small, local pointer response.
 * One cached canvas, not thousands of DOM nodes or a perpetual particle loop.
 */
export function HeroPixelTransition() {
  const ref = useRef<HTMLCanvasElement>(null);
  useGSAP(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const cache = document.createElement("canvas");
    const cached = cache.getContext("2d");
    if (!cached) return;
    const surface = canvas.closest(".hero-site-story") ?? canvas;
    const pointer = { x: -1000, y: -1000, strength: 0 };
    const media = matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");
    let width = 0, height = 0, ratio = 1, columns = 0, rows = 0;
    let paper = "", visible = true, pending = 0;
    const size = HERO_PIXEL_SIZE;
    const render = () => {
      pending = 0;
      context.clearRect(0, 0, width, height);
      context.drawImage(cache, 0, 0, width, height);
      if (pointer.strength < 0.001 || !visible) return;
      // Only inspect cells within the 76px pointer footprint.
      const left = Math.max(0, Math.floor((pointer.x - 76) / size));
      const right = Math.min(columns, Math.ceil((pointer.x + 76) / size));
      const top = Math.max(0, Math.floor((pointer.y - 76) / size));
      const bottom = Math.min(rows, Math.ceil((pointer.y + 76) / size));
      context.fillStyle = paper;
      for (let row = top; row < bottom; row++) for (let col = left; col < right; col++) {
        if (!heroPixelCovered(col, row, rows)) continue;
        const x = col * size, y = row * size;
        const distance = Math.hypot(x + size / 2 - pointer.x, y + size / 2 - pointer.y);
        const scale = heroPixelResponse(distance, y / height, pointer.strength);
        if (scale === 1) continue;
        context.clearRect(x, y, size, size);
        const inset = size * (1 - scale) / 2;
        context.fillRect(x + inset, y + inset, size * scale, size * scale);
      }
    };
    const queue = () => { if (!pending && visible) pending = requestAnimationFrame(render); };
    // Three reusable tweens; movement never allocates one tween per square.
    const xTo = gsap.quickTo(pointer, "x", { duration: 0.16, ease: "power2.out", onUpdate: queue });
    const yTo = gsap.quickTo(pointer, "y", { duration: 0.16, ease: "power2.out", onUpdate: queue });
    const strengthTo = gsap.quickTo(pointer, "strength", { duration: 0.55, ease: "power2.out", onUpdate: queue });
    const stop = () => {
      xTo.tween.pause(); yTo.tween.pause(); strengthTo.tween.pause();
      pointer.strength = 0;
      cancelAnimationFrame(pending); pending = 0;
      render();
    };
    const rebuild = () => {
      width = canvas.clientWidth; height = canvas.clientHeight;
      if (!width || !height) return;
      ratio = Math.min(devicePixelRatio || 1, 2);
      canvas.width = cache.width = Math.ceil(width * ratio);
      canvas.height = cache.height = Math.ceil(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      cached.setTransform(ratio, 0, 0, ratio, 0, 0);
      columns = Math.ceil(width / size); rows = Math.ceil(height / size);
      paper = getComputedStyle(canvas).color;
      cached.fillStyle = paper;
      for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
        if (heroPixelCovered(col, row, rows)) cached.fillRect(col * size, row * size, size, size);
      }
      // One continuous fill seals fractional-DPR seams between the last cells.
      cached.fillRect(0, (rows - 2) * size, width, height - (rows - 2) * size);
      stop();
      canvas.dataset.ready = "true";
    };
    const move = (event: PointerEvent) => {
      if (!media.matches || !visible || event.pointerType !== "mouse") return;
      const bounds = canvas.getBoundingClientRect();
      if (event.clientY < bounds.top || event.clientY > bounds.bottom || event.clientX < bounds.left || event.clientX > bounds.right) {
        leave();
        return;
      }
      const x = (event.clientX - bounds.left) * width / bounds.width;
      const y = (event.clientY - bounds.top) * height / bounds.height;
      if (pointer.strength === 0) { pointer.x = x; pointer.y = y; }
      xTo(x); yTo(y); strengthTo(1);
    };
    const leave = () => {
      // Ordinary scrolling must not wake a canvas that was already at rest.
      if (pointer.strength > 0 || strengthTo.tween.isActive()) strengthTo(0);
    };
    const visibility = () => { if (document.hidden) stop(); };
    const resize = new ResizeObserver(rebuild);
    resize.observe(canvas);
    const theme = new MutationObserver(rebuild);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (!visible) stop();
    });
    intersection.observe(canvas);
    surface.addEventListener("pointermove", move as EventListener, { passive: true });
    surface.addEventListener("pointerleave", leave);
    window.addEventListener("scroll", leave, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    media.addEventListener("change", stop);
    rebuild();
    return () => {
      resize.disconnect(); theme.disconnect(); intersection.disconnect();
      surface.removeEventListener("pointermove", move as EventListener);
      surface.removeEventListener("pointerleave", leave);
      window.removeEventListener("scroll", leave);
      document.removeEventListener("visibilitychange", visibility);
      media.removeEventListener("change", stop);
      cancelAnimationFrame(pending);
      delete canvas.dataset.ready;
    };
  }, { scope: ref });
  return <canvas ref={ref} className="hero-pixel-transition" aria-hidden="true" />;
}
