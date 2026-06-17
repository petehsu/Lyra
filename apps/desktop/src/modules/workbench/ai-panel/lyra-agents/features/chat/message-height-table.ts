// ============================================================================
// message-height-table — pure prefix-sum height bookkeeping for chat virtualization
// ============================================================================
//
// Single source of truth for each message's rendered height and the derived
// total scroll height / per-item offsets. Kept free of React and DOM so the
// arithmetic (which replaces live `scrollHeight` reads in the virtualized list)
// can be unit-tested directly. The React hook in use-message-height-table.ts
// wires a ResizeObserver to feed measured heights in.

/** Heights closer than this are treated as equal (sub-pixel layout jitter). */
export const HEIGHT_EPSILON_PX = 0.5;

export type MessageHeightStore = {
  /**
   * Record a measured height for a message. Returns true if the stored value
   * changed beyond HEIGHT_EPSILON_PX (i.e. a re-layout is warranted).
   */
  setMeasured: (id: string, height: number) => boolean;
  /** Seed an estimated height used only until a real measurement arrives. */
  setEstimate: (id: string, height: number) => void;
  /** Best-known height: measured if present, else estimate, else `fallback`. */
  heightOf: (id: string, fallback: number) => number;
  /** True once a real (non-estimated) measurement exists for `id`. */
  hasMeasured: (id: string) => boolean;
  /** Drop entries whose ids are not in `keep` (prevents unbounded growth). */
  retain: (keep: Iterable<string>) => void;
};

export const createMessageHeightStore = (): MessageHeightStore => {
  const measured = new Map<string, number>();
  const estimated = new Map<string, number>();

  return {
    setMeasured(id, height) {
      const next = Math.max(0, height);
      const prev = measured.get(id);
      if (prev !== undefined && Math.abs(prev - next) <= HEIGHT_EPSILON_PX) {
        return false;
      }
      measured.set(id, next);
      // A real measurement supersedes any estimate.
      estimated.delete(id);
      return true;
    },
    setEstimate(id, height) {
      if (measured.has(id)) return;
      estimated.set(id, Math.max(0, height));
    },
    heightOf(id, fallback) {
      const m = measured.get(id);
      if (m !== undefined) return m;
      const e = estimated.get(id);
      if (e !== undefined) return e;
      return fallback;
    },
    hasMeasured(id) {
      return measured.has(id);
    },
    retain(keep) {
      const keepSet = keep instanceof Set ? keep : new Set(keep);
      for (const id of measured.keys()) {
        if (!keepSet.has(id)) measured.delete(id);
      }
      for (const id of estimated.keys()) {
        if (!keepSet.has(id)) estimated.delete(id);
      }
    }
  };
};

/**
 * Offset (in px) of item `index` from the top of the list — the sum of the
 * heights of every item before it. `index` is clamped to [0, ids.length].
 */
export const offsetOfIndex = (
  store: MessageHeightStore,
  ids: readonly string[],
  index: number,
  fallback: number,
  gapBetweenItems = 0
): number => {
  const end = Math.max(0, Math.min(index, ids.length));
  let offset = 0;
  for (let i = 0; i < end; i += 1) {
    offset += store.heightOf(ids[i]!, fallback);
    if (gapBetweenItems > 0 && i < ids.length - 1) {
      offset += gapBetweenItems;
    }
  }
  return offset;
};

/** Total height of the whole list (includes gaps between items). */
export const totalHeight = (
  store: MessageHeightStore,
  ids: readonly string[],
  fallback: number,
  gapBetweenItems = 0
): number => offsetOfIndex(store, ids, ids.length, fallback, gapBetweenItems);

/**
 * Index of the last item whose bottom edge is at or above `edge` (content-space
 * px). Returns -1 when no item ends before `edge`. Mirrors the old
 * `getBoundingClientRect().bottom <= containerTop + offset` sticky test.
 */
export const lastIndexEndingAtOrAbove = (
  store: MessageHeightStore,
  ids: readonly string[],
  edge: number,
  fallback: number,
  predicate?: (index: number) => boolean,
  gapBetweenItems = 0
): number => {
  let offset = 0;
  let result = -1;
  for (let i = 0; i < ids.length; i += 1) {
    const bottom = offset + store.heightOf(ids[i]!, fallback);
    if (bottom <= edge) {
      if (predicate === undefined || predicate(i)) {
        result = i;
      }
    } else {
      break;
    }
    offset = bottom;
    if (gapBetweenItems > 0 && i < ids.length - 1) {
      offset += gapBetweenItems;
    }
  }
  return result;
};

/**
 * Index of the first item that intersects the viewport range [top, bottom]
 * (content-space px), and the last such item. Used to pick the render window.
 * Returns [0, -1] for an empty list.
 */
export const visibleIndexRange = (
  store: MessageHeightStore,
  ids: readonly string[],
  top: number,
  bottom: number,
  fallback: number,
  gapBetweenItems = 0
): readonly [number, number] => {
  if (ids.length === 0) return [0, -1];
  let offset = 0;
  let first = -1;
  let last = -1;
  for (let i = 0; i < ids.length; i += 1) {
    const height = store.heightOf(ids[i]!, fallback);
    const itemTop = offset;
    const itemBottom = offset + height;
    if (itemBottom > top && itemTop < bottom) {
      if (first === -1) first = i;
      last = i;
    }
    if (itemTop >= bottom) break;
    offset = itemBottom;
    if (gapBetweenItems > 0 && i < ids.length - 1) {
      offset += gapBetweenItems;
    }
  }
  if (first === -1) {
    // Viewport is past the end (e.g. during fast scroll); clamp to last item.
    return [ids.length - 1, ids.length - 1];
  }
  return [first, last];
};
