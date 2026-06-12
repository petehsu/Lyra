// ============================================================================
// Lyra Agents — Runtime Configuration
// ============================================================================
//
// Central place for non-visual constants. Anything you might want to tune
// (timings, thresholds, limits) lives here rather than being hard-coded in
// components. When integrating with a real backend, most of these can be
// overridden through environment variables.

export const APP_CONFIG = {
  /** Product name shown in the About page and document title. */
  name: "Lyra Agents",

  /** Maximum viewport width of the main chat column. */
  maxColumnWidth: 820,

  /** Heights used by the fixed top chrome (header, pills). */
  headerHeight: 36,

  /** Scroll behavior. */
  scroll: {
    /** Distance (px) from bottom considered "at bottom". */
    atBottomThreshold: 8,
    /** Distance (px) from top that triggers loading older messages. */
    topLoadThreshold: 48,
    /** Scroll delta (px) → full decision panel open/close transition. */
    decisionPanelRange: 150,
    /** Min delta to consider a scroll event (ignores layout jitter). */
    ignoreDeltaBelow: 3,
  },

  /** Progressive message rendering. Runtime context remains complete; this only limits UI work. */
  messageWindow: {
    /** Number of latest messages rendered when a long thread is opened. */
    initialCount: 12,
    /** Number of older messages prepended each time the user reaches the top. */
    batchCount: 16,
  },

  /** Streaming text playback speed. */
  streaming: {
    charsPerTick: 3,
    tickIntervalMs: 25,
  },

  /** Tool-execution simulation intervals used by local previews and tests. */
  simulation: {
    toolStepIntervalMs: 700,
    editTickIntervalMs: 900,
  },
} as const;

export type AppConfig = typeof APP_CONFIG;
