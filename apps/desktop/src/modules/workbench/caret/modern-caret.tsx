import { useCallback, useEffect, useRef, useState } from "react";

export type ModernCaretRect = {
  readonly left: number;
  readonly top: number;
  readonly height: number;
};

export type ModernTextRect = {
  readonly text: string;
  readonly left: number;
  readonly top: number;
  readonly height: number;
};

export type ModernCaretMotionTrail = {
  readonly token: number;
  readonly fromLeft: number;
  readonly fromTop: number;
  readonly fromHeight: number;
  readonly toLeft: number;
  readonly toTop: number;
  readonly toHeight: number;
  readonly angleDeg: number;
  readonly length: number;
  readonly distance: number;
  readonly speed: number;
};

const DEFAULT_CARET_LENGTH_PX = 18;
const DEFAULT_TEXTAREA_WIDTH_PX = 320;
const DEFAULT_TEXTAREA_FONT_SIZE_PX = 12;
const DEFAULT_TEXTAREA_LINE_HEIGHT_PX = 18;
const DEFAULT_TEXTAREA_PADDING_BLOCK_PX = 8;
const DEFAULT_TEXTAREA_PADDING_INLINE_PX = 12;
const MOTION_THRESHOLD_PX = 0.5;
const MOTION_RESTART_COOLDOWN_MS = 72;
const CARET_IDLE_DELAY_MS = 360;
const MOTION_TRAIL_MIN_LENGTH_PX = 12;
const MOTION_TRAIL_MAX_LENGTH_PX = 88;
const MOTION_TRAIL_SPEED_FACTOR = 38;
const CARET_PRESS_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Backspace",
  "Delete",
  "Home",
  "End",
  "PageUp",
  "PageDown"
]);

const readPx = (value: string, fallback: number): number => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const resolveCaretHeight = (lineHeight: number): number =>
  Math.min(DEFAULT_CARET_LENGTH_PX, Math.max(1, lineHeight));

export const createCaretMotionTrail = (
  previousRect: ModernCaretRect,
  nextRect: ModernCaretRect,
  elapsedMs: number,
  token: number
): ModernCaretMotionTrail | null => {
  const fromCenterX = previousRect.left;
  const fromCenterY = previousRect.top + previousRect.height / 2;
  const toCenterX = nextRect.left;
  const toCenterY = nextRect.top + nextRect.height / 2;
  const dx = toCenterX - fromCenterX;
  const dy = toCenterY - fromCenterY;
  const distance = Math.hypot(dx, dy);
  if (distance <= MOTION_THRESHOLD_PX) {
    return null;
  }

  const safeElapsedMs = Math.max(16, elapsedMs);
  const speed = distance / safeElapsedMs;
  const length = clamp(
    distance + nextRect.height * 0.72 + speed * MOTION_TRAIL_SPEED_FACTOR,
    Math.max(MOTION_TRAIL_MIN_LENGTH_PX, nextRect.height * 0.95),
    MOTION_TRAIL_MAX_LENGTH_PX
  );

  return {
    token,
    fromLeft: previousRect.left,
    fromTop: previousRect.top,
    fromHeight: previousRect.height,
    toLeft: nextRect.left,
    toTop: nextRect.top,
    toHeight: nextRect.height,
    angleDeg: Math.atan2(dy, dx) * (180 / Math.PI),
    length,
    distance,
    speed
  };
};

const approximateTextareaCaretRect = (
  prefix: string,
  contentWidth: number,
  fontSize: number,
  lineHeight: number,
  paddingTop: number,
  paddingRight: number,
  paddingLeft: number,
  scrollTop: number,
  scrollLeft: number
): ModernCaretRect => {
  const caretHeight = resolveCaretHeight(lineHeight);
  const availableWidth = Math.max(1, contentWidth - paddingLeft - paddingRight);
  const columnWidth = Math.max(fontSize * 0.62, 6);
  const wrapColumns = Math.max(1, Math.floor(availableWidth / columnWidth));
  let row = 0;
  let column = 0;

  for (const char of prefix.replaceAll("\r", "")) {
    if (char === "\n") {
      row += 1;
      column = 0;
      continue;
    }

    column += char === "\t" ? 2 : 1;
    while (column > wrapColumns) {
      row += 1;
      column -= wrapColumns;
    }
  }

  return {
    left: paddingLeft + column * columnWidth - scrollLeft,
    top: paddingTop + row * lineHeight - scrollTop + Math.max(0, (lineHeight - caretHeight) / 2),
    height: caretHeight
  };
};

const applyMirrorStyle = (
  mirror: HTMLDivElement,
  style: CSSStyleDeclaration,
  contentWidth: number,
  lineHeight: number,
  paddingTop: number,
  paddingRight: number,
  paddingBottom: number,
  paddingLeft: number
): void => {
  mirror.style.position = "fixed";
  mirror.style.left = "0";
  mirror.style.top = "0";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.overflow = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.style.wordBreak = "break-word";
  mirror.style.boxSizing = "border-box";
  mirror.style.width = `${String(contentWidth)}px`;
  mirror.style.paddingTop = `${String(paddingTop)}px`;
  mirror.style.paddingRight = `${String(paddingRight)}px`;
  mirror.style.paddingBottom = `${String(paddingBottom)}px`;
  mirror.style.paddingLeft = `${String(paddingLeft)}px`;
  mirror.style.border = "0";
  mirror.style.fontFamily = style.fontFamily;
  mirror.style.fontSize = style.fontSize.length > 0 ? style.fontSize : `${String(DEFAULT_TEXTAREA_FONT_SIZE_PX)}px`;
  mirror.style.fontWeight = style.fontWeight;
  mirror.style.fontStyle = style.fontStyle;
  mirror.style.letterSpacing = style.letterSpacing;
  mirror.style.lineHeight = style.lineHeight.length > 0 ? style.lineHeight : `${String(lineHeight)}px`;
  mirror.style.textTransform = style.textTransform;
  mirror.style.textIndent = style.textIndent;
  mirror.style.textAlign = style.textAlign;
  mirror.style.direction = style.direction;
  mirror.style.tabSize = style.tabSize;
};

export const measureTextAreaTextRects = (
  textarea: HTMLTextAreaElement,
  content: string,
  start: number,
  end: number,
  maxAnimatedSegments = 8
): readonly ModernTextRect[] => {
  if (start >= end) {
    return [];
  }

  const style = window.getComputedStyle(textarea);
  const lineHeight = readPx(style.lineHeight, DEFAULT_TEXTAREA_LINE_HEIGHT_PX);
  const ownerDocument = textarea.ownerDocument;
  const mirror = ownerDocument.createElement("div");
  applyMirrorStyle(
    mirror,
    style,
    textarea.clientWidth > 0 ? textarea.clientWidth : Math.max(readPx(style.width, DEFAULT_TEXTAREA_WIDTH_PX), 1),
    lineHeight,
    readPx(style.paddingTop, DEFAULT_TEXTAREA_PADDING_BLOCK_PX),
    readPx(style.paddingRight, DEFAULT_TEXTAREA_PADDING_INLINE_PX),
    readPx(style.paddingBottom, DEFAULT_TEXTAREA_PADDING_BLOCK_PX),
    readPx(style.paddingLeft, DEFAULT_TEXTAREA_PADDING_INLINE_PX)
  );

  mirror.append(ownerDocument.createTextNode(content.slice(0, start)));
  const measuredNodes: Array<{ readonly text: string; readonly node: HTMLSpanElement }> = [];
  let animatedCount = 0;
  for (const char of content.slice(start, end)) {
    if (char === "\r") {
      continue;
    }
    if (char === "\n") {
      mirror.append(ownerDocument.createTextNode("\n"));
      continue;
    }
    if (animatedCount >= maxAnimatedSegments) {
      mirror.append(ownerDocument.createTextNode(char));
      continue;
    }
    const node = ownerDocument.createElement("span");
    node.textContent = char === " " ? "\u00a0" : char;
    mirror.append(node);
    measuredNodes.push({ text: char, node });
    animatedCount += 1;
  }
  ownerDocument.body.append(mirror);
  const mirrorRect = mirror.getBoundingClientRect();
  const results = measuredNodes.map(({ text, node }) => {
    const nodeRect = node.getBoundingClientRect();
    return {
      text,
      left: nodeRect.left - mirrorRect.left - textarea.scrollLeft,
      top: nodeRect.top - mirrorRect.top - textarea.scrollTop,
      height: nodeRect.height > 0 ? nodeRect.height : lineHeight
    };
  });
  mirror.remove();
  return results;
};

export const measureTextAreaCaretRect = (textarea: HTMLTextAreaElement): ModernCaretRect | null => {
  const selectionStart = textarea.selectionStart;
  const selectionEnd = textarea.selectionEnd;
  if (selectionStart === null || selectionEnd === null || selectionStart !== selectionEnd) {
    return null;
  }

  const style = window.getComputedStyle(textarea);
  const fontSize = readPx(style.fontSize, DEFAULT_TEXTAREA_FONT_SIZE_PX);
  const lineHeight = readPx(style.lineHeight, DEFAULT_TEXTAREA_LINE_HEIGHT_PX);
  const paddingTop = readPx(style.paddingTop, DEFAULT_TEXTAREA_PADDING_BLOCK_PX);
  const paddingRight = readPx(style.paddingRight, DEFAULT_TEXTAREA_PADDING_INLINE_PX);
  const paddingBottom = readPx(style.paddingBottom, DEFAULT_TEXTAREA_PADDING_BLOCK_PX);
  const paddingLeft = readPx(style.paddingLeft, DEFAULT_TEXTAREA_PADDING_INLINE_PX);
  const contentWidth =
    textarea.clientWidth > 0
      ? textarea.clientWidth
      : Math.max(readPx(style.width, DEFAULT_TEXTAREA_WIDTH_PX), 1);
  const prefix = textarea.value.slice(0, selectionStart);
  const caretHeight = resolveCaretHeight(lineHeight);
  const ownerDocument = textarea.ownerDocument;
  const mirror = ownerDocument.createElement("div");
  const marker = ownerDocument.createElement("span");
  applyMirrorStyle(
    mirror,
    style,
    contentWidth,
    lineHeight,
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft
  );
  mirror.append(ownerDocument.createTextNode(prefix));
  marker.textContent = textarea.value.slice(selectionStart) || "\u200b";
  mirror.append(marker);
  ownerDocument.body.append(mirror);
  const mirrorRect = mirror.getBoundingClientRect();
  const markerRects = marker.getClientRects() as DOMRectList & { readonly 0?: DOMRect };
  const markerRect = markerRects.item?.(0) ?? markerRects[0] ?? marker.getBoundingClientRect();
  mirror.remove();

  if (mirrorRect.width === 0 && mirrorRect.height === 0 && markerRect.width === 0 && markerRect.height === 0) {
    return approximateTextareaCaretRect(
      prefix,
      contentWidth,
      fontSize,
      lineHeight,
      paddingTop,
      paddingRight,
      paddingLeft,
      textarea.scrollTop,
      textarea.scrollLeft
    );
  }

  return {
    left: markerRect.left - mirrorRect.left - textarea.scrollLeft,
    top: markerRect.top - mirrorRect.top - textarea.scrollTop + Math.max(0, (lineHeight - caretHeight) / 2),
    height: caretHeight
  };
};

export const measureElementCaretRect = (element: HTMLElement, container: HTMLElement): ModernCaretRect | null => {
  const style = window.getComputedStyle(element);
  const styledLeft = readPx(style.left, readPx(element.style.left, 0));
  const styledTop = readPx(style.top, readPx(element.style.top, 0));
  if (styledLeft < -1000 || styledTop < -1000) {
    return null;
  }

  const styledHeight = Math.max(
    readPx(style.height, 0),
    readPx(element.style.height, DEFAULT_TEXTAREA_LINE_HEIGHT_PX)
  );
  const elementRect = element.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const hasLayout =
    elementRect.width !== 0 ||
    elementRect.height !== 0 ||
    containerRect.width !== 0 ||
    containerRect.height !== 0;
  const lineHeight = hasLayout && elementRect.height > 0 ? elementRect.height : styledHeight;
  const caretHeight = resolveCaretHeight(lineHeight);
  const left = hasLayout ? elementRect.left - containerRect.left : styledLeft;
  const topBase = hasLayout ? elementRect.top - containerRect.top : styledTop;

  return {
    left,
    top: topBase + Math.max(0, (lineHeight - caretHeight) / 2),
    height: caretHeight
  };
};

type UseCaretMotionStateOptions = {
  readonly enabled?: boolean;
  readonly activityKey?: number;
  readonly idleDelayMs?: number;
  readonly suppressMotion?: boolean;
};

type UseCaretPressStateOptions = {
  readonly enabled?: boolean;
  readonly onActivity?: () => void;
};

export const isCaretPressKey = (key: string): boolean => CARET_PRESS_KEYS.has(key);

export const useCaretPressState = ({
  enabled = true,
  onActivity
}: UseCaretPressStateOptions = {}): {
  readonly pressed: boolean;
  readonly pressKey: (key: string, repeat?: boolean) => void;
  readonly releaseKey: (key: string) => void;
  readonly resetPressed: () => void;
} => {
  const pressedKeysRef = useRef(new Set<string>());
  const pressedRef = useRef(false);
  const [pressed, setPressed] = useState(false);

  const updatePressed = useCallback((next: boolean): void => {
    pressedRef.current = next;
    setPressed(next);
  }, []);

  const notifyActivity = useCallback((): void => {
    onActivity?.();
  }, [onActivity]);

  const resetPressed = useCallback((): void => {
    if (pressedKeysRef.current.size === 0 && pressedRef.current === false) {
      return;
    }
    pressedKeysRef.current.clear();
    updatePressed(false);
    notifyActivity();
  }, [notifyActivity, updatePressed]);

  const pressKey = useCallback((key: string, repeat = false): void => {
    if (!isCaretPressKey(key)) {
      return;
    }

    const pressedKeys = pressedKeysRef.current;
    if (repeat && pressedKeys.has(key)) {
      notifyActivity();
      return;
    }
    if (pressedKeys.has(key)) {
      return;
    }

    pressedKeys.add(key);
    updatePressed(true);
    notifyActivity();
  }, [notifyActivity, updatePressed]);

  const releaseKey = useCallback((key: string): void => {
    if (!isCaretPressKey(key)) {
      return;
    }

    const pressedKeys = pressedKeysRef.current;
    if (pressedKeys.has(key) === false) {
      return;
    }

    pressedKeys.delete(key);
    if (pressedKeys.size > 0) {
      notifyActivity();
      return;
    }

    updatePressed(false);
    notifyActivity();
  }, [notifyActivity, updatePressed]);

  useEffect(() => {
    if (enabled) {
      return;
    }

    pressedKeysRef.current.clear();
    updatePressed(false);
  }, [enabled]);

  useEffect(() => {
    return () => {
      pressedKeysRef.current.clear();
      pressedRef.current = false;
    };
  }, []);

  return {
    pressed,
    pressKey,
    releaseKey,
    resetPressed
  };
};

export const useCaretMotionState = (
  rect: ModernCaretRect | null,
  {
    enabled = true,
    activityKey = 0,
    idleDelayMs = CARET_IDLE_DELAY_MS,
    suppressMotion = false
  }: UseCaretMotionStateOptions = {}
): {
  readonly motionToken: number;
  readonly isIdle: boolean;
  readonly motionTrail: ModernCaretMotionTrail | null;
} => {
  const previousRectRef = useRef<ModernCaretRect | null>(null);
  const previousEnabledRef = useRef(enabled);
  const previousActivityKeyRef = useRef(activityKey);
  const lastMotionAtRef = useRef(0);
  const lastTrailAtRef = useRef(0);
  const idleTimerRef = useRef<number | null>(null);
  const motionTokenRef = useRef(0);
  const motionTrailTokenRef = useRef(0);
  const [motionToken, setMotionToken] = useState(0);
  const [isIdle, setIsIdle] = useState(false);
  const [motionTrail, setMotionTrail] = useState<ModernCaretMotionTrail | null>(null);

  useEffect(() => {
    return () => {
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (enabled === false || rect === null) {
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      previousRectRef.current = rect;
      previousEnabledRef.current = enabled;
      previousActivityKeyRef.current = activityKey;
      setIsIdle(false);
      setMotionTrail(null);
      return;
    }

    const previousRect = previousRectRef.current;
    const becameEnabled = previousEnabledRef.current === false;
    const moved =
      previousRect !== null && (
        Math.abs(previousRect.left - rect.left) > MOTION_THRESHOLD_PX ||
        Math.abs(previousRect.top - rect.top) > MOTION_THRESHOLD_PX
      );
    const activityChanged = previousActivityKeyRef.current !== activityKey;
    if (moved || activityChanged || becameEnabled) {
      const now = performance.now();
      if (moved && previousRect !== null) {
        motionTrailTokenRef.current += 1;
        setMotionTrail(createCaretMotionTrail(
          previousRect,
          rect,
          lastTrailAtRef.current > 0 ? now - lastTrailAtRef.current : MOTION_RESTART_COOLDOWN_MS,
          motionTrailTokenRef.current
        ));
        lastTrailAtRef.current = now;
      } else {
        setMotionTrail(null);
      }
      if (suppressMotion === false) {
        if (now - lastMotionAtRef.current >= MOTION_RESTART_COOLDOWN_MS) {
          motionTokenRef.current += 1;
          lastMotionAtRef.current = now;
          setMotionToken(motionTokenRef.current);
        }
      }
      setIsIdle(false);
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
      }
      idleTimerRef.current = window.setTimeout(() => {
        setIsIdle(true);
        idleTimerRef.current = null;
      }, idleDelayMs);
    } else if (previousRect === null) {
      setIsIdle(false);
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
      }
      idleTimerRef.current = window.setTimeout(() => {
        setIsIdle(true);
        idleTimerRef.current = null;
      }, idleDelayMs);
    }

    previousRectRef.current = rect;
    previousEnabledRef.current = enabled;
    previousActivityKeyRef.current = activityKey;
  }, [activityKey, enabled, idleDelayMs, rect?.left, rect?.top, suppressMotion]);

  return {
    motionToken,
    isIdle,
    motionTrail
  };
};

export const useCaretMotionToken = (rect: ModernCaretRect | null, enabled = true): number => {
  const state = useCaretMotionState(rect, { enabled });
  return state.motionToken;
};

type ModernCaretOverlayProps = {
  readonly rect: ModernCaretRect | null;
  readonly focused: boolean;
  readonly blinking?: boolean;
  readonly pressed?: boolean;
  readonly motionToken: number;
  readonly motionTrail?: ModernCaretMotionTrail | null;
  readonly className?: string;
};

export const ModernCaretOverlay = ({
  rect,
  focused,
  blinking = focused,
  pressed = false,
  motionToken,
  motionTrail = null,
  className
}: ModernCaretOverlayProps) => {
  if (rect === null) {
    return null;
  }

  const classes = [
    "lyra-modern-caret",
    focused ? "lyra-modern-caret-focused" : "",
    focused && blinking ? "lyra-modern-caret-blinking" : "",
    pressed ? "lyra-modern-caret-pressed" : "",
    motionToken > 0 ? "lyra-modern-caret-bump" : "",
    className ?? ""
  ]
    .filter((value) => value.length > 0)
    .join(" ");

  return (
    <>
      {motionTrail === null ? null : (
        <>
          <span
            key={`trail-${String(motionTrail.token)}`}
            aria-hidden="true"
            className="lyra-modern-caret-trail"
            style={{
              left: `calc(${String(motionTrail.toLeft)}px + var(--lyra-modern-caret-offset-x, 0px))`,
              top: `calc(${String(motionTrail.toTop + motionTrail.toHeight / 2)}px + var(--lyra-modern-caret-offset-y, 0px))`,
              width: `${String(motionTrail.length)}px`,
              transform: `translate(-100%, -50%) rotate(${String(motionTrail.angleDeg)}deg)`
            }}
          />
          <span
            key={`echo-${String(motionTrail.token)}`}
            aria-hidden="true"
            className="lyra-modern-caret-echo"
            style={{
              left: `calc(${String(motionTrail.fromLeft)}px + var(--lyra-modern-caret-offset-x, 0px))`,
              top: `calc(${String(motionTrail.fromTop)}px + var(--lyra-modern-caret-offset-y, 0px))`,
              height: `${String(motionTrail.fromHeight)}px`
            }}
          />
        </>
      )}
      <span
        key={motionToken}
        aria-hidden="true"
        className={classes}
        style={{
          left: `calc(${String(rect.left)}px + var(--lyra-modern-caret-offset-x, 0px))`,
          top: `calc(${String(rect.top)}px + var(--lyra-modern-caret-offset-y, 0px))`,
          height: `${String(rect.height)}px`
        }}
      />
    </>
  );
};
