import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import type { AiPanelThreadRenderRow } from "./thread-render-model";

export type AiPanelThreadVirtualRow = {
  readonly row: AiPanelThreadRenderRow;
  readonly index: number;
  readonly top: number;
};

const DEFAULT_ROW_HEIGHT = 156;
const VIRTUAL_OVERSCAN_ROWS = 6;

export const useAiPanelThreadVirtualRows = (
  viewportRef: RefObject<HTMLDivElement>,
  rows: readonly AiPanelThreadRenderRow[]
) => {
  const rowHeightsRef = useRef<ReadonlyMap<string, number>>(new Map());
  const resizeObserversRef = useRef<ReadonlyMap<string, ResizeObserver>>(new Map());
  const [viewport, setViewport] = useState({ height: 0, scrollTop: 0 });
  const [measurementVersion, setMeasurementVersion] = useState(0);

  useEffect(() => {
    const viewportElement = viewportRef.current;
    if (viewportElement === null) {
      return;
    }
    const updateViewport = (): void => {
      setViewport({
        height: viewportElement.clientHeight,
        scrollTop: viewportElement.scrollTop,
      });
    };
    updateViewport();
    viewportElement.addEventListener("scroll", updateViewport, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateViewport);
    observer?.observe(viewportElement);
    return () => {
      viewportElement.removeEventListener("scroll", updateViewport);
      observer?.disconnect();
    };
  }, [viewportRef]);

  useEffect(() => () => {
    for (const observer of resizeObserversRef.current.values()) {
      observer.disconnect();
    }
    resizeObserversRef.current = new Map();
  }, []);

  const offsets = useMemo(() => {
    const nextOffsets: number[] = [];
    let total = 0;
    for (const row of rows) {
      nextOffsets.push(total);
      total += rowHeightsRef.current.get(row.key) ?? DEFAULT_ROW_HEIGHT;
    }
    return { offsets: nextOffsets, totalHeight: total };
  }, [measurementVersion, rows]);

  const virtualRows = useMemo<readonly AiPanelThreadVirtualRow[]>(() => {
    if (rows.length === 0) {
      return [];
    }
    const viewportBottom = viewport.scrollTop + viewport.height;
    let startIndex = 0;
    while (
      startIndex < rows.length - 1 &&
      offsets.offsets[startIndex + 1] !== undefined &&
      offsets.offsets[startIndex + 1]! < viewport.scrollTop
    ) {
      startIndex += 1;
    }
    let endIndex = startIndex;
    while (
      endIndex < rows.length - 1 &&
      (offsets.offsets[endIndex] ?? 0) < viewportBottom
    ) {
      endIndex += 1;
    }
    startIndex = Math.max(0, startIndex - VIRTUAL_OVERSCAN_ROWS);
    endIndex = Math.min(rows.length - 1, endIndex + VIRTUAL_OVERSCAN_ROWS);
    const visible: AiPanelThreadVirtualRow[] = [];
    for (let index = startIndex; index <= endIndex; index += 1) {
      const row = rows[index];
      if (row === undefined) {
        continue;
      }
      visible.push({
        row,
        index,
        top: offsets.offsets[index] ?? 0,
      });
    }
    return visible;
  }, [offsets, rows, viewport.height, viewport.scrollTop]);

  const measureRow = useCallback((rowKey: string, node: HTMLDivElement | null): void => {
    const existingObserver = resizeObserversRef.current.get(rowKey);
    if (existingObserver !== undefined) {
      existingObserver.disconnect();
      const nextObservers = new Map(resizeObserversRef.current);
      nextObservers.delete(rowKey);
      resizeObserversRef.current = nextObservers;
    }
    if (node === null) {
      return;
    }
    const updateHeight = (): void => {
      const nextHeight = Math.max(1, Math.ceil(node.getBoundingClientRect().height));
      if (rowHeightsRef.current.get(rowKey) === nextHeight) {
        return;
      }
      const nextHeights = new Map(rowHeightsRef.current);
      nextHeights.set(rowKey, nextHeight);
      rowHeightsRef.current = nextHeights;
      setMeasurementVersion((current) => current + 1);
    };
    updateHeight();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(updateHeight);
      observer.observe(node);
      const nextObservers = new Map(resizeObserversRef.current);
      nextObservers.set(rowKey, observer);
      resizeObserversRef.current = nextObservers;
    }
  }, []);

  const firstTop = virtualRows[0]?.top ?? 0;
  const lastVirtualRow = virtualRows[virtualRows.length - 1] ?? null;
  const renderedBottom = lastVirtualRow === null
    ? 0
    : lastVirtualRow.top + (rowHeightsRef.current.get(lastVirtualRow.row.key) ?? DEFAULT_ROW_HEIGHT);

  return {
    virtualRows,
    topSpacerHeight: firstTop,
    bottomSpacerHeight: Math.max(0, offsets.totalHeight - renderedBottom),
    measureRow,
  };
};
