import { useEffect, useRef, useState } from "react";

const DEFAULT_SHOW_DELAY_MS = 120;
const DEFAULT_MIN_VISIBLE_MS = 180;

type UseLoadingVisibilityOptions = {
  readonly showDelayMs?: number;
  readonly minVisibleMs?: number;
};

const normalizeDuration = (value: number | undefined, fallback: number): number => {
  if (value === undefined || Number.isFinite(value) === false) {
    return fallback;
  }
  return Math.max(0, Math.round(value));
};

const clearTimer = (timerRef: { current: number | null }) => {
  if (timerRef.current === null) {
    return;
  }
  window.clearTimeout(timerRef.current);
  timerRef.current = null;
};

export const useLoadingVisibility = (
  isLoading: boolean,
  options: UseLoadingVisibilityOptions = {}
): boolean => {
  const showDelayMs = normalizeDuration(options.showDelayMs, DEFAULT_SHOW_DELAY_MS);
  const minVisibleMs = normalizeDuration(options.minVisibleMs, DEFAULT_MIN_VISIBLE_MS);

  const [isVisible, setIsVisible] = useState(false);
  const showTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const visibleSinceRef = useRef<number | null>(null);

  useEffect(() => () => {
    clearTimer(showTimerRef);
    clearTimer(hideTimerRef);
  }, []);

  useEffect(() => {
    if (isLoading) {
      clearTimer(hideTimerRef);

      if (isVisible) {
        return;
      }

      clearTimer(showTimerRef);
      if (showDelayMs === 0) {
        visibleSinceRef.current = Date.now();
        setIsVisible(true);
        return;
      }

      showTimerRef.current = window.setTimeout(() => {
        showTimerRef.current = null;
        visibleSinceRef.current = Date.now();
        setIsVisible(true);
      }, showDelayMs);
      return;
    }

    clearTimer(showTimerRef);

    if (isVisible === false) {
      visibleSinceRef.current = null;
      return;
    }

    const visibleSince = visibleSinceRef.current ?? Date.now();
    const elapsed = Date.now() - visibleSince;
    const remainingVisible = Math.max(0, minVisibleMs - elapsed);
    clearTimer(hideTimerRef);

    if (remainingVisible === 0) {
      visibleSinceRef.current = null;
      setIsVisible(false);
      return;
    }

    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      visibleSinceRef.current = null;
      setIsVisible(false);
    }, remainingVisible);
  }, [isLoading, isVisible, minVisibleMs, showDelayMs]);

  return isVisible;
};
