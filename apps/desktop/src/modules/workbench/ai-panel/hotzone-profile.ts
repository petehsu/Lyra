export type AiHotzoneKey = "message-thread" | "task-card" | "input-composer";

type AiHotzoneMetrics = {
  calls: number;
  totalMs: number;
  maxMs: number;
  lastMs: number;
  updatedAt: number;
};

export type AiHotzoneSnapshot = {
  readonly enabled: boolean;
  readonly zones: Readonly<Record<AiHotzoneKey, {
    readonly calls: number;
    readonly totalMs: number;
    readonly averageMs: number;
    readonly maxMs: number;
    readonly lastMs: number;
    readonly share: number;
    readonly updatedAt: number;
  }>>;
};

const HOTZONE_KEYS: readonly AiHotzoneKey[] = [
  "message-thread",
  "task-card",
  "input-composer"
] as const;

const createMetrics = (): AiHotzoneMetrics => ({
  calls: 0,
  totalMs: 0,
  maxMs: 0,
  lastMs: 0,
  updatedAt: Date.now()
});

const state: Record<AiHotzoneKey, AiHotzoneMetrics> = {
  "message-thread": createMetrics(),
  "task-card": createMetrics(),
  "input-composer": createMetrics()
};

let profilingEnabled = true;

const nowMs = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const recordHotzoneDuration = (zone: AiHotzoneKey, durationMs: number): void => {
  if (Number.isFinite(durationMs) === false || durationMs < 0) {
    return;
  }
  const metrics = state[zone];
  metrics.calls += 1;
  metrics.totalMs += durationMs;
  metrics.lastMs = durationMs;
  metrics.maxMs = Math.max(metrics.maxMs, durationMs);
  metrics.updatedAt = Date.now();
};

export const measureAiHotzone = <T>(zone: AiHotzoneKey, run: () => T): T => {
  if (profilingEnabled === false) {
    return run();
  }
  const startMs = nowMs();
  try {
    return run();
  } finally {
    recordHotzoneDuration(zone, nowMs() - startMs);
  }
};

export const resetAiHotzoneProfile = (): void => {
  for (const key of HOTZONE_KEYS) {
    state[key] = createMetrics();
  }
};

export const setAiHotzoneProfilingEnabled = (enabled: boolean): void => {
  profilingEnabled = enabled;
};

export const getAiHotzoneSnapshot = (): AiHotzoneSnapshot => {
  const totalDuration = HOTZONE_KEYS.reduce((sum, key) => sum + state[key].totalMs, 0);
  const zones = HOTZONE_KEYS.reduce<Record<AiHotzoneKey, {
    calls: number;
    totalMs: number;
    averageMs: number;
    maxMs: number;
    lastMs: number;
    share: number;
    updatedAt: number;
  }>>((accumulator, key) => {
    const metrics = state[key];
    accumulator[key] = {
      calls: metrics.calls,
      totalMs: metrics.totalMs,
      averageMs: metrics.calls > 0 ? metrics.totalMs / metrics.calls : 0,
      maxMs: metrics.maxMs,
      lastMs: metrics.lastMs,
      share: totalDuration > 0 ? metrics.totalMs / totalDuration : 0,
      updatedAt: metrics.updatedAt
    };
    return accumulator;
  }, {
    "message-thread": {
      calls: 0,
      totalMs: 0,
      averageMs: 0,
      maxMs: 0,
      lastMs: 0,
      share: 0,
      updatedAt: Date.now()
    },
    "task-card": {
      calls: 0,
      totalMs: 0,
      averageMs: 0,
      maxMs: 0,
      lastMs: 0,
      share: 0,
      updatedAt: Date.now()
    },
    "input-composer": {
      calls: 0,
      totalMs: 0,
      averageMs: 0,
      maxMs: 0,
      lastMs: 0,
      share: 0,
      updatedAt: Date.now()
    }
  });

  return {
    enabled: profilingEnabled,
    zones
  };
};

declare global {
  interface Window {
    __lyraAiHotzones?: {
      readonly getSnapshot: () => AiHotzoneSnapshot;
      readonly reset: () => void;
      readonly setEnabled: (enabled: boolean) => void;
    };
  }
}

if (typeof window !== "undefined") {
  window.__lyraAiHotzones = {
    getSnapshot: getAiHotzoneSnapshot,
    reset: resetAiHotzoneProfile,
    setEnabled: setAiHotzoneProfilingEnabled
  };
}
