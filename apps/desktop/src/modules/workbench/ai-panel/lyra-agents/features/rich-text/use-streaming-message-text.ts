/**
 * useStreamingMessageText — React hook that reads streaming text from the
 * external StreamStore via useSyncExternalStore.
 *
 * The StreamStore pushes deltas into chunk arrays (O(1)) and commits joined
 * text at most once per animation frame (~60fps). This hook subscribes to a
 * specific message and re-renders only when that message's committed text
 * changes — not on every delta.
 *
 * When `streaming` is false (message finalized), returns `fallbackText` (from
 * messageCommitted) — the authoritative final text. When `streaming` is true
 * but the store has no accumulated text yet (e.g. initial render before the
 * first delta, or a re-render with pre-existing content), falls back to
 * `fallbackText` so the UI never shows empty content.
 */

import { useSyncExternalStore } from "react";

import { getStreamStore } from "../../../../agent-session-view-model/stream-store";

export function useStreamingMessageText(
  messageId: string,
  fallbackText: string,
  streaming: boolean
): string {
  const store = getStreamStore();

  const subscribe = (callback: () => void): (() => void) =>
    store.subscribe(messageId, callback);

  const getSnapshot = (): string => {
    if (!streaming) return fallbackText;
    const storeText = store.getMessageText(messageId);
    // If the store has accumulated text, use it. Otherwise fall back to the
    // prop so we never show empty content (covers initial render and
    // re-renders with pre-existing finalized content).
    return storeText.length > 0 ? storeText : fallbackText;
  };

  return useSyncExternalStore(subscribe, getSnapshot, () => fallbackText);
}