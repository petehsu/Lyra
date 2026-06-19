// ============================================================================
// use-message-height-table — React binding for the chat virtualization heights
// ============================================================================
//
// Owns the MessageHeightStore plus a single shared ResizeObserver that measures
// each mounted message slot (measure-on-render). Exposes a `measureRef` callback
// to attach to slots, prefix-sum readers, and a version counter that bumps when a
// height changes so the list can re-window.
//
// CRITICAL correctness rule: when a slot ABOVE the current scroll position grows
// (e.g. an image or mermaid finishes rendering), we compensate scrollTop by the
// delta so the viewport content does not jump. This is what makes async-height
// content safe under virtualization.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { subscribeLayoutResizeEnd } from "../../../../shell/layout-resize-end";
import { getIsLayoutResizing } from "../../../../shell/use-panel-layout";
import {
  createMessageHeightStore,
  offsetOfIndex,
  totalHeight as totalHeightOf,
  type MessageHeightStore
} from "./message-height-table";

export type MessageHeightTable = {
  /** Ref callback factory: attach `measureRef(id)` to each rendered slot. */
  measureRef: (id: string) => (element: HTMLElement | null) => void;
  /** Seed an estimated height (used only until a real measurement arrives). */
  setEstimate: (id: string, height: number) => void;
  /** Best-known height for a message. */
  heightOf: (id: string) => number;
  /** Offset of `index` from the top, summing best-known heights. */
  offsetOf: (ids: readonly string[], index: number) => number;
  /** Total height of `ids`. */
  total: (ids: readonly string[]) => number;
  /** Drop heights for ids no longer present. */
  retain: (ids: readonly string[]) => void;
  /** Bumps whenever a measured height changes; use as an effect/memo dep. */
  version: number;
  /** Direct store access for advanced prefix-sum helpers. */
  store: MessageHeightStore;
};

export const useMessageHeightTable = (
  scrollRef: RefObject<HTMLElement | null>,
  fallbackHeight: number,
  orderedIdsRef: RefObject<readonly string[]>,
  gapBetweenItems = 0,
  /** During panel drag, only these message ids may update measured heights. */
  measurableDuringResizeRef?: RefObject<ReadonlySet<string> | null>
): MessageHeightTable => {
  const storeRef = useRef<MessageHeightStore>();
  if (storeRef.current === undefined) {
    storeRef.current = createMessageHeightStore();
  }
  const store = storeRef.current;

  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const deferredBumpRef = useRef(false);

  // id <-> element bookkeeping for the shared ResizeObserver.
  const elementToId = useRef(new WeakMap<Element, string>());
  const idToElement = useRef(new Map<string, HTMLElement>());

  const observerRef = useRef<ResizeObserver | null>(null);
  if (observerRef.current === null && typeof ResizeObserver !== "undefined") {
    observerRef.current = new ResizeObserver((entries) => {
      let changed = false;
      let scrollCompensation = 0;
      const scrollEl = scrollRef.current;
      const scrollTop = scrollEl?.scrollTop ?? 0;
      const ids = orderedIdsRef.current ?? [];

      const resizing = getIsLayoutResizing();
      const measurableDuringResize = measurableDuringResizeRef?.current ?? null;

      for (const entry of entries) {
        const id = elementToId.current.get(entry.target);
        if (id === undefined) continue;
        if (
          resizing &&
          measurableDuringResize !== null &&
          !measurableDuringResize.has(id)
        ) {
          continue;
        }
        const contentHeight = entry.contentRect?.height ?? 0;
        const measuredHeight =
          contentHeight > 0
            ? contentHeight
            : (entry.target as HTMLElement).getBoundingClientRect().height;
        const height = Math.round(measuredHeight);
        const prev = store.heightOf(id, fallbackHeight);
        if (!store.setMeasured(id, height)) continue;
        changed = true;
        // If this slot sits entirely above the current scroll position, its
        // height delta would shift everything below it (including the viewport).
        // Compensate scrollTop by the delta to keep content visually anchored.
        const index = ids.indexOf(id);
        if (index >= 0) {
          const itemTop = offsetOfIndex(store, ids, index, fallbackHeight, gapBetweenItems);
          // itemTop here is computed AFTER the new height is stored, but offset
          // of preceding items is unaffected by this item's own height, so it is
          // the item's true top. Anchor when the item ends above the viewport.
          const itemBottomBefore = itemTop + prev;
          if (itemBottomBefore <= scrollTop) {
            scrollCompensation += height - prev;
          }
        }
      }

      if (scrollCompensation !== 0 && scrollEl !== null) {
        scrollEl.scrollTop = scrollTop + scrollCompensation;
      }
      if (!changed) return;
      if (resizing && measurableDuringResize === null) {
        deferredBumpRef.current = true;
        return;
      }
      bump();
    });
  }

  useEffect(() => {
    const unsubscribe = subscribeLayoutResizeEnd(() => {
      if (!deferredBumpRef.current) return;
      deferredBumpRef.current = false;
      bump();
    });
    return unsubscribe;
  }, [bump]);

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      idToElement.current.clear();
    };
  }, []);

  const measureRef = useCallback(
    (id: string) => (element: HTMLElement | null): void => {
      const observer = observerRef.current;
      const previous = idToElement.current.get(id);
      if (previous !== undefined && previous !== element) {
        observer?.unobserve(previous);
        elementToId.current.delete(previous);
        idToElement.current.delete(id);
      }
      if (element === null) return;
      idToElement.current.set(id, element);
      elementToId.current.set(element, id);
      observer?.observe(element);
    },
    []
  );

  const setEstimate = useCallback((id: string, height: number): void => {
    store.setEstimate(id, height);
  }, [store]);

  const heightOf = useCallback((id: string): number => {
    return store.heightOf(id, fallbackHeight);
  }, [store, fallbackHeight]);

  const offsetOf = useCallback((ids: readonly string[], index: number): number => {
    return offsetOfIndex(store, ids, index, fallbackHeight, gapBetweenItems);
  }, [gapBetweenItems, store, fallbackHeight]);

  const total = useCallback((ids: readonly string[]): number => {
    return totalHeightOf(store, ids, fallbackHeight, gapBetweenItems);
  }, [gapBetweenItems, store, fallbackHeight]);

  const retain = useCallback((ids: readonly string[]): void => {
    store.retain(ids);
  }, [store]);

  return useMemo(
    () => ({ measureRef, setEstimate, heightOf, offsetOf, total, retain, version, store }),
    [measureRef, setEstimate, heightOf, offsetOf, total, retain, version, store]
  );
};
