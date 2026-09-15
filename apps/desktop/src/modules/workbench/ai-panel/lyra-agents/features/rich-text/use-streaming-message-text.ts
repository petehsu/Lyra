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
  const concatCacheRef = useRef<{ fallbackText: string; storeText: string; value: string }>({
    fallbackText: "",
    storeText: "",
    value: ""
  });

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
    // useSyncExternalStore requires a stable snapshot. Concatenating on every
    // read would look like a new value every render and spin the UI at 100% CPU.
    const cache = concatCacheRef.current;
    if (cache.fallbackText === fallbackText && cache.storeText === storeText) {
      return cache.value;
    }
    const value = `${fallbackText}${storeText}`;
    concatCacheRef.current = { fallbackText, storeText, value };
    return value;
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

// Live token bursts stay glued to the stream. A whole-paragraph dump is
// revealed across ~200ms (Zed StreamingTextBuffer) instead of popping in.
const STREAM_IMMEDIATE_CHARS = 96;
const STREAM_CATCHUP_MS = 200;
const STREAM_FRAME_MS = 16;

const safeSliceEnd = (text: string, requestedEnd: number): number => {
  const end = Math.min(requestedEnd, text.length);
  if (end <= 0 || end >= text.length) return end;
  const previous = text.charCodeAt(end - 1);
  return previous >= 0xd800 && previous <= 0xdbff ? end + 1 : end;
};

/**
 * Most providers deliver small token chunks and take the immediate path. Some
 * OpenAI-compatible endpoints buffer a whole paragraph (or the whole visible
 * answer) and then emit one large delta next to the final event. Drain that
 * backlog over ~200ms of animation frames so it reads as flowing text instead
 * of a dump. Completed Markdown blocks remain memoized by Streamdown.
 */
export function useSmoothStreamingText(
  targetText: string,
  streaming: boolean
): { readonly catchingUp: boolean; readonly text: string } {
  const participatedInStream = useRef(streaming);
  if (streaming) participatedInStream.current = true;
  const [text, setText] = useState(targetText);

  useLayoutEffect(() => {
    if (text === targetText) return;
    if (!participatedInStream.current || !targetText.startsWith(text)) {
      setText(targetText);
      return;
    }
    const remaining = targetText.length - text.length;
    if (remaining <= STREAM_IMMEDIATE_CHARS) {
      setText(targetText);
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      setText((current) => {
        if (!targetText.startsWith(current)) return targetText;
        const left = targetText.length - current.length;
        if (left <= STREAM_IMMEDIATE_CHARS) return targetText;
        const ticks = Math.max(1, Math.ceil(STREAM_CATCHUP_MS / STREAM_FRAME_MS));
        const advance = Math.max(1, Math.ceil(left / ticks));
        return targetText.slice(0, safeSliceEnd(targetText, current.length + advance));
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
