export type ChatLoadGovernorConfig = {
  readonly initialBudgetViewportRatio: number;
  readonly loadBudgetViewportRatio: number;
  readonly minBudgetViewportRatio: number;
  readonly maxBudgetViewportRatio: number;
  readonly smoothFrameMs: number;
  readonly jankFrameMs: number;
  readonly fastPrependMs: number;
  readonly slowPrependMs: number;
  readonly increaseFactor: number;
  readonly decreaseFactor: number;
  readonly frameSampleSize: number;
  readonly minMultiplier: number;
  readonly maxMultiplier: number;
};

export type ChatLoadGovernor = {
  readonly recordFrameDelta: (deltaMs: number) => void;
  readonly recordPrependDuration: (durationMs: number) => void;
  readonly shouldDeferLoad: (isLayoutResizing: boolean) => boolean;
  readonly requestInitialBudget: (viewportHeightPx: number) => number;
  readonly requestLoadBudget: (viewportHeightPx: number) => number;
  readonly reset: () => void;
  /** Exposed for tests. */
  readonly multiplier: () => number;
};

const percentile = (values: readonly number[], ratio: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((sorted.length - 1) * ratio))
  );
  return sorted[index] ?? 0;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const createChatLoadGovernor = (
  config: ChatLoadGovernorConfig
): ChatLoadGovernor => {
  let budgetMultiplier = 1;
  const frameDeltas: number[] = [];

  const clampMultiplier = (): void => {
    budgetMultiplier = clamp(
      budgetMultiplier,
      config.minMultiplier,
      config.maxMultiplier
    );
  };

  const rebalanceFromFrames = (): void => {
    if (frameDeltas.length < 8) return;
    const p95 = percentile(frameDeltas, 0.95);
    if (p95 > config.jankFrameMs) {
      budgetMultiplier *= config.decreaseFactor;
    } else if (p95 < config.smoothFrameMs) {
      budgetMultiplier *= config.increaseFactor;
    }
    clampMultiplier();
  };

  const rebalanceFromPrepend = (durationMs: number): void => {
    if (durationMs > config.slowPrependMs) {
      budgetMultiplier *= config.decreaseFactor;
    } else if (durationMs < config.fastPrependMs) {
      budgetMultiplier *= config.increaseFactor;
    }
    clampMultiplier();
  };

  const budgetForRatio = (viewportHeightPx: number, ratio: number): number => {
    const viewport = Math.max(0, viewportHeightPx);
    const scaled = viewport * ratio * budgetMultiplier;
    const minBudget = viewport * config.minBudgetViewportRatio;
    const maxBudget = viewport * config.maxBudgetViewportRatio;
    return Math.round(clamp(scaled, minBudget, maxBudget));
  };

  return {
    recordFrameDelta(deltaMs) {
      if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
      frameDeltas.push(deltaMs);
      if (frameDeltas.length > config.frameSampleSize) {
        frameDeltas.shift();
      }
      rebalanceFromFrames();
    },
    recordPrependDuration(durationMs) {
      if (!Number.isFinite(durationMs) || durationMs < 0) return;
      rebalanceFromPrepend(durationMs);
    },
    shouldDeferLoad(isLayoutResizing) {
      return isLayoutResizing;
    },
    requestInitialBudget(viewportHeightPx) {
      return budgetForRatio(viewportHeightPx, config.initialBudgetViewportRatio);
    },
    requestLoadBudget(viewportHeightPx) {
      return budgetForRatio(viewportHeightPx, config.loadBudgetViewportRatio);
    },
    reset() {
      budgetMultiplier = 1;
      frameDeltas.length = 0;
    },
    multiplier() {
      return budgetMultiplier;
    }
  };
};