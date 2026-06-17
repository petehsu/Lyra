import { APP_CONFIG } from "../../core/config";
import type { ChatMessage } from "../../core/types";
import {
  lastIndexEndingAtOrAbove,
  offsetOfIndex,
  type MessageHeightStore
} from "./message-height-table";
import { CHAT_MESSAGE_GAP_PX } from "./chat-layout-constants";

export const STICKY_ANCHOR_TOP_OFFSET_PX = 18;

/**
 * Content-space Y (px from the first message top inside `.lyra-agents-chat-inner`)
 * of the sticky anchor line — mirrors `scrollTop + offset` in the old DOM test.
 */
export const stickyTopEdgeInContent = (
  scrollTop: number,
  listContentStart: number
): number => scrollTop - listContentStart + STICKY_ANCHOR_TOP_OFFSET_PX;

export const nextStickyMessageId = (
  store: MessageHeightStore,
  ids: readonly string[],
  messages: readonly ChatMessage[],
  scrollTop: number,
  listContentStart: number,
  currentStickyMessageId: string | null,
  fallbackHeight: number,
  gapBetweenItems = CHAT_MESSAGE_GAP_PX
): string | null => {
  const topEdge = stickyTopEdgeInContent(scrollTop, listContentStart);
  const isUser = (index: number): boolean => messages[index]?.author === "user";

  const previousUserIndex = lastIndexEndingAtOrAbove(
    store,
    ids,
    topEdge,
    fallbackHeight,
    isUser,
    gapBetweenItems
  );
  if (previousUserIndex >= 0) {
    return ids[previousUserIndex] ?? null;
  }

  if (scrollTop <= APP_CONFIG.scroll.topLoadThreshold) {
    return null;
  }

  if (currentStickyMessageId !== null) {
    const stickyIndex = ids.indexOf(currentStickyMessageId);
    if (stickyIndex >= 0) {
      const stickyBottom =
        offsetOfIndex(store, ids, stickyIndex, fallbackHeight, gapBetweenItems) +
        store.heightOf(ids[stickyIndex]!, fallbackHeight);
      if (stickyBottom > topEdge) {
        return null;
      }
    }
  }

  return currentStickyMessageId !== null &&
    messages.some((message) => message.id === currentStickyMessageId)
    ? currentStickyMessageId
    : null;
};