import { useEffect, type RefObject } from "react";

const FRAME_INTERVAL_MS = 90; // ~11 fps
const FLICKER_FRACTION = 0.015; // share of glyph cells mutated per tick
const PALETTE = "#%*+-.:=@";

const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function useAsciiFlicker(
  ref: RefObject<HTMLElement | null>,
  source: string
): void {
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;

    element.textContent = source;
    if (prefersReducedMotion()) return;

    const chars = Array.from(source);
    const glyphIndices: number[] = [];
    for (let i = 0; i < chars.length; i += 1) {
      const ch = chars[i]!;
      if (ch !== " " && ch !== "\n") glyphIndices.push(i);
    }
    if (glyphIndices.length === 0) return;

    const mutationsPerTick = Math.max(1, Math.round(glyphIndices.length * FLICKER_FRACTION));
    const frame = chars.slice();
    let dirtied: number[] = [];
    let rafId = 0;
    let lastTickAt = 0;

    const tick = (now: number) => {
      rafId = requestAnimationFrame(tick);
      if (now - lastTickAt < FRAME_INTERVAL_MS) return;
      lastTickAt = now;

      for (const index of dirtied) frame[index] = chars[index]!;
      dirtied = [];
      for (let n = 0; n < mutationsPerTick; n += 1) {
        const index = glyphIndices[Math.floor(Math.random() * glyphIndices.length)]!;
        frame[index] = PALETTE[Math.floor(Math.random() * PALETTE.length)]!;
        dirtied.push(index);
      }
      element.textContent = frame.join("");
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      element.textContent = source;
    };
  }, [ref, source]);
}
