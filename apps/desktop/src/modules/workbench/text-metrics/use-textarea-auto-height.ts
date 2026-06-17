import {
  useLayoutEffect,
  type RefObject
} from "react";

import { estimateTextareaHeight } from "./estimate-textarea";

export const TEXTAREA_AUTO_HEIGHT_MIN_PX = 64;
export const TEXTAREA_AUTO_HEIGHT_MAX_PX = 200;

const readLineHeightPx = (style: CSSStyleDeclaration): number => {
  const parsed = Number.parseFloat(style.lineHeight);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  const fontSize = Number.parseFloat(style.fontSize);
  if (Number.isFinite(fontSize)) {
    return Math.round(fontSize * 1.55);
  }
  return 22;
};

export const syncTextareaAutoHeight = (
  el: HTMLTextAreaElement,
  value: string,
  bounds: {
    readonly minHeight?: number;
    readonly maxHeight?: number;
  } = {}
): void => {
  const minHeight = bounds.minHeight ?? TEXTAREA_AUTO_HEIGHT_MIN_PX;
  const maxHeight = bounds.maxHeight ?? TEXTAREA_AUTO_HEIGHT_MAX_PX;
  const style = getComputedStyle(el);
  const paddingX =
    Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
  const paddingY =
    Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
  const contentWidth = Math.max(0, el.clientWidth - paddingX);
  const height = estimateTextareaHeight(value, {
    font: style.font,
    contentWidth,
    lineHeight: readLineHeightPx(style),
    verticalPadding: paddingY,
    minHeight,
    maxHeight
  });
  el.style.height = `${height}px`;
  el.style.overflowY = height >= maxHeight ? "auto" : "hidden";
};

/** Drive textarea auto-height from workbench/text-metrics (no DOM content-height reads). */
export const useTextareaAutoHeight = (
  value: string,
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  enabled = true
): void => {
  useLayoutEffect(() => {
    if (!enabled) return;
    const el = textareaRef.current;
    if (!el) return;

    const syncHeight = (): void => {
      syncTextareaAutoHeight(el, value);
    };

    syncHeight();
    const observer = new ResizeObserver(syncHeight);
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, textareaRef, value]);
};