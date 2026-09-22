/**
 * useStreamingMessageText — React hook that reads streaming text from the
 * external StreamStore via useSyncExternalStore.
 *
 * The StreamStore pushes deltas into chunk arrays (O(1)) and commits joined
 * text once per IPC delivery batch. This hook subscribes to a specific
 * message and reads only the active text block.
 *
 * While a block is still in the stream store, that text wins over the short
 * session shell. After messageCommitted resets the store, `fallbackText` is
 * the finished sentence. An empty store before the first delta also uses
 * `fallbackText`, so the block never paints blank.
 */

import {
  useCallback,
  useRef,
  useSyncExternalStore
} from "react";

import { getStreamStore } from "../../../../agent-session-view-model/stream-store";

export type StreamingTextChoice = "fallback" | "store" | "concat";

// The session snapshot only keeps the first delta of a live block. The rest
// lives in the stream store until messageCommitted. Turning `streaming` off
// (the next sentence or tool started) must not drop that text back to the shell.
export const selectStreamingText = (
  fallbackText: string,
  storeText: string,
  replacesFallback: boolean
): StreamingTextChoice => {
  if (storeText.length === 0) return "fallback";
  if (replacesFallback) return "store";
  if (fallbackText.length === 0 || storeText.startsWith(fallbackText)) {
    return storeText.length >= fallbackText.length ? "store" : "fallback";
  }
  // The session shell can already contain this tail after messageCommitted.
  // Concatenating again would print the ending twice.
  if (fallbackText.endsWith(storeText)) return "fallback";
  return "concat";
};

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
    const storeText = store.getBlockText(messageId, blockId);
    const choice = selectStreamingText(
      fallbackText,
      storeText,
      store.blockReplacesFallback(messageId, blockId)
    );
    if (choice === "fallback") return fallbackText;
    if (choice === "store") return storeText;
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

export function useStreamingReasoningOpen(
  messageId: string,
  streaming: boolean
): boolean {
  const store = getStreamStore();
  const subscribe = useCallback(
    (callback: () => void): (() => void) => store.subscribe(messageId, callback),
    [messageId, store]
  );
  const getSnapshot = useCallback(
    (): boolean => streaming && store.isReasoningLive(messageId),
    [messageId, store, streaming]
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
