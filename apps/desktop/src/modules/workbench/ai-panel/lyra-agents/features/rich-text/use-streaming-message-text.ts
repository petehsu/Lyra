/**
 * useStreamingMessageText — React hook that reads streaming text from the
 * external StreamStore via useSyncExternalStore.
 *
 * The StreamStore pushes deltas into chunk arrays (O(1)) and commits joined
 * text once per IPC delivery batch. This hook subscribes to a specific
 * message and reads only the active text block.
 *
 * When `streaming` is false (message finalized), returns `fallbackText` (from
 * messageCommitted) — the authoritative final text. When `streaming` is true
 * but the store has no accumulated text yet (e.g. initial render before the
 * first delta, or a re-render with pre-existing content), falls back to
 * `fallbackText` so the UI never shows empty content.
 */

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore
} from "react";

import { getStreamStore } from "../../../../agent-session-view-model/stream-store";

export function useStreamingMessageText(
  messageId: string,
  blockId: string | null,
  fallbackText: string,
  streaming: boolean
): string {
  const store = getStreamStore();

  const subscribe = useCallback(
    (callback: () => void): (() => void) => store.subscribe(messageId, callback),
    [messageId, store]
  );

  const getSnapshot = useCallback((): string => {
    if (!streaming) return fallbackText;
    const storeText = store.getBlockText(messageId, blockId);
    // If the store has accumulated text, use it. Otherwise fall back to the
    // prop so we never show empty content (covers initial render and
    // re-renders with pre-existing finalized content).
    if (storeText.length === 0) return fallbackText;
    if (store.blockReplacesFallback(messageId, blockId)) return storeText;
    if (fallbackText.length === 0 || storeText.startsWith(fallbackText)) return storeText;
    return `${fallbackText}${storeText}`;
  }, [blockId, fallbackText, messageId, store, streaming]);

  return useSyncExternalStore(subscribe, getSnapshot, () => fallbackText);
}

export function useStreamingBlockReplacementRevision(
  messageId: string,
  blockId: string | null,
  streaming: boolean
): number {
  const store = getStreamStore();
  const subscribe = useCallback(
    (callback: () => void): (() => void) => store.subscribe(messageId, callback),
    [messageId, store]
  );
  const getSnapshot = useCallback(
    () => streaming ? store.getBlockReplacementRevision(messageId, blockId) : 0,
    [blockId, messageId, store, streaming]
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => 0);
}

/**
 * Reasoning uses the same external-store path as visible text. Keeping this
 * subscription outside the session reducer avoids rebuilding the whole chat
 * snapshot for every reasoning token while still making the existing thinking
 * disclosure live as soon as the provider starts emitting it.
 */
export function useStreamingMessageReasoning(
  messageId: string,
  streaming: boolean
): string {
  const store = getStreamStore();
  const subscribe = useCallback(
    (callback: () => void): (() => void) => store.subscribe(messageId, callback),
    [messageId, store]
  );
  const getSnapshot = useCallback(
    (): string => streaming ? store.getMessageReasoning(messageId) : "",
    [messageId, store, streaming]
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => "");
}

const STREAM_BURST_IMMEDIATE_CHARS = 180;
const STREAM_BURST_MAX_FRAMES = 6;
const STREAM_BURST_MAX_MS = 200;

const safeSliceEnd = (text: string, requestedEnd: number): number => {
  const end = Math.min(requestedEnd, text.length);
  if (end <= 0 || end >= text.length) return end;
  const previous = text.charCodeAt(end - 1);
  return previous >= 0xd800 && previous <= 0xdbff ? end + 1 : end;
};

/**
 * Most providers deliver small token chunks and take the immediate path. Some
 * OpenAI-compatible endpoints buffer a whole paragraph (or the whole visible
 * answer) and then emit one large delta next to the final event. Reveal only
 * those bursts over a few frames so the final IPC batch cannot appear as an
 * all-at-once response. Completed Markdown blocks remain memoized by Streamdown.
 */
export function useSmoothStreamingText(
  targetText: string,
  streaming: boolean
): { readonly catchingUp: boolean; readonly text: string } {
  const participatedInStream = useRef(streaming);
  if (streaming) participatedInStream.current = true;
  const [text, setText] = useState(targetText);
  const burstRef = useRef<{
    framesLeft: number;
    startedAt: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (text === targetText) return;
    if (!participatedInStream.current || !targetText.startsWith(text)) {
      burstRef.current = null;
      setText(targetText);
      return;
    }
    const remaining = targetText.length - text.length;
    if (remaining <= STREAM_BURST_IMMEDIATE_CHARS) {
      burstRef.current = null;
      setText(targetText);
      return;
    }
    const burst = burstRef.current ?? {
      framesLeft: STREAM_BURST_MAX_FRAMES,
      startedAt: performance.now()
    };
    burstRef.current = burst;
    const frame = window.requestAnimationFrame(() => {
      setText((current) => {
        if (!targetText.startsWith(current)) return targetText;
        const nextRemaining = targetText.length - current.length;
        const expired = performance.now() - burst.startedAt >= STREAM_BURST_MAX_MS;
        if (expired || burst.framesLeft <= 1) {
          burstRef.current = null;
          return targetText;
        }
        const advance = Math.max(1, Math.ceil(nextRemaining / burst.framesLeft));
        burst.framesLeft -= 1;
        const end = safeSliceEnd(targetText, current.length + advance);
        return targetText.slice(0, end);
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [targetText, text]);

  const replacementPending = participatedInStream.current && !targetText.startsWith(text);
  return {
    catchingUp: participatedInStream.current && !replacementPending && text !== targetText,
    // Replacements must be visible in the same render that increments
    // Streamdown's document key; deferring them to the layout effect would let
    // the old same-length source occupy the new memoization generation.
    text: participatedInStream.current && !replacementPending ? text : targetText
  };
}
