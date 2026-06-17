// ============================================================================
// useAsciiFlicker — subtle random glyph flicker for the empty-state Lyra mark
// ============================================================================
//
// Drives a <pre>'s textContent directly (no React re-render) on a throttled
// requestAnimationFrame loop. Each tick rebuilds the frame FROM THE ORIGINAL art
// and overwrites only a tiny fraction of glyph cells with another character from
// the same palette, so the texture "shimmers" without ever drifting away from
// the logo. Cheap by construction:
//   - rAF auto-pauses in background tabs;
//   - throttled to ~11fps, so the string is rebuilt ~11x/second, not per frame;
//   - only non-space cells are eligible, and only ~1.5% change per tick;
//   - the whole effect only exists while the empty state is mounted.
// Honours prefers-reduced-motion by never starting the loop.

import { useEffect, type RefObject } from "react";

const FRAME_INTERVAL_MS = 90; // ~11 fps
const FLICKER_FRACTION = 0.015; // share of glyph cells mutated per tick

// The density ramp the logo is drawn from; replacements stay within it so the
// flicker reads as the same material.
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

    // Always render the static art first so non-animated paths still show it.
    element.textContent = source;
    if (prefersReducedMotion()) return;

    const chars = Array.from(source);
    // Indices of mutable (non-space, non-newline) cells, computed once.
    const glyphIndices: number[] = [];
    for (let i = 0; i < chars.length; i += 1) {
      const ch = chars[i]!;
      if (ch !== " " && ch !== "\n") glyphIndices.push(i);
    }
    if (glyphIndices.length === 0) return;

    const mutationsPerTick = Math.max(1, Math.round(glyphIndices.length * FLICKER_FRACTION));
    const frame = chars.slice();
    // Track which cells we dirtied last tick so we can restore them before the
    // next round — keeps the frame anchored to the original art.
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
