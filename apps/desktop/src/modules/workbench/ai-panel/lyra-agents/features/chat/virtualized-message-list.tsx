import { useLayoutEffect, useMemo, type ReactNode } from "react";

import type { ChatMessage } from "../../core/types";
import {
  CHAT_MESSAGE_FALLBACK_HEIGHT_PX,
  CHAT_MESSAGE_GAP_PX,
  CHAT_PLAIN_TEXT_FONT,
  CHAT_PLAIN_TEXT_LINE_HEIGHT_PX,
  CHAT_PLAIN_TEXT_VERTICAL_PADDING_PX,
  CHAT_VIRTUAL_OVERSCAN
} from "./chat-layout-constants";
import { offsetOfIndex, totalHeight, visibleIndexRange } from "./message-height-table";
import { estimatePlainTextHeight } from "./pre-measure";
import type { MessageHeightTable } from "./use-message-height-table";

export type VirtualizedMessageListProps = {
  readonly messages: readonly ChatMessage[];
  readonly heightTable: MessageHeightTable;
  /** Viewport top in list content coordinates (scrollTop - listContentStart). */
  readonly viewportTop: number;
  readonly viewportHeight: number;
  readonly fallbackHeight?: number;
  readonly messageGapPx?: number;
  readonly overscan?: number;
  readonly contentWidth?: number;
  /** Keep these messages mounted even when outside the current viewport window. */
  readonly pinnedMessageIds?: readonly string[];
  /** When true, pinned ids outside the viewport are not force-mounted. */
  readonly ignoreOffScreenPins?: boolean;
  readonly renderMessage: (message: ChatMessage) => ReactNode;
};

export const VirtualizedMessageList = ({
  messages,
  heightTable,
  viewportTop,
  viewportHeight,
  fallbackHeight = CHAT_MESSAGE_FALLBACK_HEIGHT_PX,
  messageGapPx = CHAT_MESSAGE_GAP_PX,
  overscan = CHAT_VIRTUAL_OVERSCAN,
  contentWidth = 560,
  pinnedMessageIds,
  ignoreOffScreenPins = false,
  renderMessage
}: VirtualizedMessageListProps) => {
  const ids = useMemo(() => messages.map((message) => message.id), [messages]);

  useLayoutEffect(() => {
    heightTable.retain(ids);
    const preMeasureConfig = {
      font: CHAT_PLAIN_TEXT_FONT,
      contentWidth,
      lineHeight: CHAT_PLAIN_TEXT_LINE_HEIGHT_PX,
      verticalPadding: CHAT_PLAIN_TEXT_VERTICAL_PADDING_PX
    };
    for (const message of messages) {
      if (heightTable.store.hasMeasured(message.id)) continue;
      const estimate =
        estimatePlainTextHeight(message, preMeasureConfig) ?? fallbackHeight;
      heightTable.setEstimate(message.id, estimate);
    }
  }, [contentWidth, fallbackHeight, heightTable, messages, ids]);

  const { firstIndex, lastIndex, topSpacer, bottomSpacer } = useMemo(() => {
    const store = heightTable.store;

    if (messages.length === 0) {
      return { firstIndex: 0, lastIndex: -1, topSpacer: 0, bottomSpacer: 0 };
    }

    const viewportBottom = viewportHeight <= 0
      ? Number.POSITIVE_INFINITY
      : viewportTop + viewportHeight;

    const [first, last] = visibleIndexRange(
      store,
      ids,
      viewportTop,
      viewportBottom,
      fallbackHeight,
      messageGapPx
    );
    let start = Math.max(0, first - overscan);
    let end = Math.min(messages.length - 1, last + overscan);

    if (
      !ignoreOffScreenPins &&
      pinnedMessageIds !== undefined &&
      pinnedMessageIds.length > 0
    ) {
      for (const pinnedId of pinnedMessageIds) {
        const pinnedIndex = ids.indexOf(pinnedId);
        if (pinnedIndex < 0) continue;
        start = Math.min(start, Math.max(0, pinnedIndex - overscan));
        end = Math.max(end, Math.min(messages.length - 1, pinnedIndex + overscan));
      }
    }

    const listTotal = totalHeight(store, ids, fallbackHeight, messageGapPx);
    const top = offsetOfIndex(store, ids, start, fallbackHeight, messageGapPx);
    const bottomStart = offsetOfIndex(store, ids, end + 1, fallbackHeight, messageGapPx);

    return {
      firstIndex: start,
      lastIndex: end,
      topSpacer: top,
      bottomSpacer: Math.max(0, listTotal - bottomStart)
    };
  }, [
    fallbackHeight,
    heightTable.store,
    heightTable.version,
    ids,
    messageGapPx,
    messages.length,
    overscan,
    ignoreOffScreenPins,
    pinnedMessageIds,
    viewportHeight,
    viewportTop
  ]);

  if (messages.length === 0) {
    return null;
  }

  const visibleMessages = messages.slice(firstIndex, lastIndex + 1);

  return (
    <>
      {topSpacer > 0 ? (
        <div
          className="lyra-agents-chat-virtual-spacer"
          aria-hidden="true"
          style={{ height: topSpacer, flexShrink: 0 }}
        />
      ) : null}
      {visibleMessages.map((message) => (
        <div
          key={message.id}
          ref={heightTable.measureRef(message.id)}
          className="lyra-agents-chat-message-slot"
          data-chat-message-id={message.id}
          data-chat-message-author={message.author}
        >
          {renderMessage(message)}
        </div>
      ))}
      {bottomSpacer > 0 ? (
        <div
          className="lyra-agents-chat-virtual-spacer"
          aria-hidden="true"
          style={{ height: bottomSpacer, flexShrink: 0 }}
        />
      ) : null}
    </>
  );
};