// ============================================================================
// Lyra Agent UI — Style & Architecture Guards
// ============================================================================
//
// Runtime assertions that surface design-system violations during development.
// Guards only run in non-production builds and log warnings; they never throw
// so they can't break the app in edge cases. Integrate with a lint rule or
// CI step for production enforcement.

import { APP_CONFIG } from "../core/config";

const IS_DEV = import.meta.env?.DEV ?? false;

/** Tracks which messages have been warned to avoid spamming the console. */
const warnedOnce = new Set<string>();

function warnOnce(key: string, message: string) {
  if (warnedOnce.has(key)) return;
  warnedOnce.add(key);
  console.warn(`[lyra-guard] ${message}`);
}

/**
 * Style guard: ensure a length value uses a token-friendly scale.
 * Flags raw pixel values above 4px that aren't multiples of 2.
 */
export function assertSpacing(px: number, context: string): void {
  if (!IS_DEV) return;
  if (px > 4 && px % 2 !== 0) {
    warnOnce(
      `spacing-${context}-${px}`,
      `Non-even pixel spacing ${px}px used at ${context}. Prefer token values from tokens.css.`
    );
  }
}

/**
 * Architecture guard: flag when a component reaches into internals it
 * shouldn't. Called from suspect boundaries during development.
 */
export function assertBoundary(
  fromModule: string,
  toModule: string,
  allowed: string[]
): void {
  if (!IS_DEV) return;
  if (!allowed.includes(toModule)) {
    warnOnce(
      `boundary-${fromModule}-${toModule}`,
      `Module "${fromModule}" imports from "${toModule}" which is not in its allow-list.`
    );
  }
}

/**
 * Mock-data guard: remind the developer to swap mock providers before
 * shipping. Called once on first render from the root App.
 */
export function assertUsingRealData(usingMock: boolean): void {
  if (!IS_DEV) return;
  if (usingMock) {
    warnOnce(
      "using-mock",
      `${APP_CONFIG.name} is running with mock data. Replace MockDataProvider before production.`
    );
  }
}
