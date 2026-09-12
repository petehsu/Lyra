import { useCallback, useEffect, useRef, useState } from "react";

export interface AutoScrollOptions {
  working: boolean;
  onUserInteracted?: () => void;
  overflowAnchor?: "none" | "auto" | "dynamic";
  bottomThreshold?: number;
}

export interface AutoScrollHandle {
  setScrollElement: (el: HTMLElement | null) => void;
  setContentElement: (el: HTMLElement | null) => void;
  handleScroll: () => void;
  handleWheel: (event: { deltaY: number; target: EventTarget | null }) => void;
  handleInteraction: () => void;
  pause: () => void;
  resume: () => void;
  follow: () => void;
  userScrolled: () => boolean;
}

const AUTO_SCROLL_MARK_MS = 1500;
const SETTLE_MS = 300;

export function useAutoScroll(options: AutoScrollOptions): AutoScrollHandle {
  const working = options.working;
  const bottomThreshold = options.bottomThreshold ?? 10;
  const overflowAnchor = options.overflowAnchor ?? "dynamic";
  const onUserInteracted = options.onUserInteracted;

  const scrollRef = useRef<HTMLElement | null>(null);
  const [contentEl, setContentEl] = useState<HTMLElement | null>(null);
  const userScrolledRef = useRef(false);
  const settlingRef = useRef(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const autoRef = useRef<{ top: number; time: number } | undefined>(undefined);
  const workingRef = useRef(working);
  const onUserInteractedRef = useRef(onUserInteracted);
  const overflowAnchorRef = useRef(overflowAnchor);
  const bottomThresholdRef = useRef(bottomThreshold);

  workingRef.current = working;
  onUserInteractedRef.current = onUserInteracted;
  overflowAnchorRef.current = overflowAnchor;
  bottomThresholdRef.current = bottomThreshold;

  const active = useCallback(() => workingRef.current || settlingRef.current, []);

  const distanceFromBottom = (el: HTMLElement) =>
    el.scrollHeight - el.clientHeight - el.scrollTop;

  const canScroll = (el: HTMLElement) => el.scrollHeight - el.clientHeight > 1;

  const updateOverflowAnchor = useCallback((el: HTMLElement) => {
    const mode = overflowAnchorRef.current;
    if (mode === "none") {
      el.style.overflowAnchor = "none";
      return;
    }
    if (mode === "auto") {
      el.style.overflowAnchor = "auto";
      return;
    }
    el.style.overflowAnchor = userScrolledRef.current ? "auto" : "none";
  }, []);

  const markAuto = (el: HTMLElement) => {
    autoRef.current = {
      top: Math.max(0, el.scrollHeight - el.clientHeight),
      time: Date.now()
    };
    if (autoTimerRef.current !== undefined) {
      clearTimeout(autoTimerRef.current);
    }
    autoTimerRef.current = setTimeout(() => {
      autoRef.current = undefined;
      autoTimerRef.current = undefined;
    }, AUTO_SCROLL_MARK_MS);
  };

  const isAuto = (el: HTMLElement) => {
    const auto = autoRef.current;
    if (auto === undefined) return false;
    if (Date.now() - auto.time > AUTO_SCROLL_MARK_MS) {
      autoRef.current = undefined;
      return false;
    }
    const bottom = Math.max(0, el.scrollHeight - el.clientHeight);
    return Math.abs(el.scrollTop - auto.top) < 2 && Math.abs(auto.top - bottom) < 2;
  };

  const scrollToBottomNow = (behavior: ScrollBehavior) => {
    const el = scrollRef.current;
    if (el === null) return;
    const top = Math.max(0, el.scrollHeight - el.clientHeight);
    markAuto(el);
    if (Math.abs(el.scrollTop - top) < 2) return;
    if (behavior === "smooth") {
      el.scrollTo({ top, behavior });
      return;
    }
    el.scrollTop = top;
  };

  const scrollToBottom = useCallback((force: boolean) => {
    if (!force && !active()) return;
    if (force && userScrolledRef.current) {
      userScrolledRef.current = false;
    }
    const el = scrollRef.current;
    if (el === null) return;
    if (!force && userScrolledRef.current) return;
    const distance = distanceFromBottom(el);
    if (distance < 2) {
      markAuto(el);
      updateOverflowAnchor(el);
      return;
    }
    scrollToBottomNow("auto");
    updateOverflowAnchor(el);
  }, [active, updateOverflowAnchor]);

  const stop = useCallback(() => {
    const el = scrollRef.current;
    if (el === null) return;
    if (!canScroll(el)) {
      if (userScrolledRef.current) {
        userScrolledRef.current = false;
        updateOverflowAnchor(el);
      }
      return;
    }
    if (userScrolledRef.current) return;
    userScrolledRef.current = true;
    updateOverflowAnchor(el);
    onUserInteractedRef.current?.();
  }, [updateOverflowAnchor]);

  const handleWheel = useCallback((event: { deltaY: number; target: EventTarget | null }) => {
    if (event.deltaY >= 0) return;
    const el = scrollRef.current;
    const target = event.target instanceof Element ? event.target : undefined;
    const nested = target?.closest("[data-scrollable]");
    if (el !== null && nested !== null && nested !== undefined && nested !== el) return;
    stop();
  }, [stop]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el === null) return;
    if (!canScroll(el)) {
      if (userScrolledRef.current) {
        userScrolledRef.current = false;
        updateOverflowAnchor(el);
      }
      return;
    }
    if (distanceFromBottom(el) < bottomThresholdRef.current) {
      if (userScrolledRef.current) {
        userScrolledRef.current = false;
        updateOverflowAnchor(el);
      }
      return;
    }
    if (!userScrolledRef.current && isAuto(el)) {
      scrollToBottom(false);
      return;
    }
    stop();
  }, [scrollToBottom, stop, updateOverflowAnchor]);

  const handleInteraction = useCallback(() => {
    if (!active()) return;
    const selection = window.getSelection();
    if (selection !== null && selection.toString().length > 0) {
      stop();
    }
  }, [active, stop]);

  const setScrollElement = useCallback((el: HTMLElement | null) => {
    scrollRef.current = el;
    if (el !== null) updateOverflowAnchor(el);
  }, [updateOverflowAnchor]);

  const setContentElement = useCallback((el: HTMLElement | null) => {
    setContentEl(el);
  }, []);

  useEffect(() => {
    if (contentEl === null) return;
    const observer = new ResizeObserver(() => {
      const el = scrollRef.current;
      if (el !== null && !canScroll(el)) {
        if (userScrolledRef.current) {
          userScrolledRef.current = false;
          updateOverflowAnchor(el);
        }
        return;
      }
      if (!active()) return;
      if (userScrolledRef.current) return;
      scrollToBottom(false);
    });
    observer.observe(contentEl);
    return () => observer.disconnect();
  }, [active, contentEl, scrollToBottom, updateOverflowAnchor]);

  useEffect(() => {
    settlingRef.current = false;
    if (settleTimerRef.current !== undefined) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = undefined;
    }
    if (working) {
      if (!userScrolledRef.current) scrollToBottom(true);
      return;
    }
    settlingRef.current = true;
    settleTimerRef.current = setTimeout(() => {
      settlingRef.current = false;
    }, SETTLE_MS);
    return () => {
      if (settleTimerRef.current !== undefined) {
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = undefined;
      }
    };
  }, [scrollToBottom, working]);

  useEffect(() => () => {
    if (autoTimerRef.current !== undefined) {
      clearTimeout(autoTimerRef.current);
    }
    if (settleTimerRef.current !== undefined) {
      clearTimeout(settleTimerRef.current);
    }
  }, []);

  const resume = useCallback(() => {
    if (userScrolledRef.current) userScrolledRef.current = false;
    scrollToBottom(true);
  }, [scrollToBottom]);

  const follow = useCallback(() => {
    scrollToBottom(false);
  }, [scrollToBottom]);

  const userScrolled = useCallback(() => userScrolledRef.current, []);

  return {
    setScrollElement,
    setContentElement,
    handleScroll,
    handleWheel,
    handleInteraction,
    pause: stop,
    resume,
    follow,
    userScrolled
  };
}
