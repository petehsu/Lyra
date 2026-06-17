import type { ChatMessage } from "../../core/types";
import {
  CHAT_MESSAGE_FALLBACK_HEIGHT_PX,
  CHAT_PLAIN_TEXT_FONT,
  CHAT_PLAIN_TEXT_LINE_HEIGHT_PX,
  CHAT_PLAIN_TEXT_VERTICAL_PADDING_PX
} from "./chat-layout-constants";
import { estimatePlainTextHeight } from "./pre-measure";

export const estimateMessageSlotHeight = (
  message: ChatMessage,
  contentWidth: number,
  fallbackHeight = CHAT_MESSAGE_FALLBACK_HEIGHT_PX
): number => {
  const estimate = estimatePlainTextHeight(message, {
    font: CHAT_PLAIN_TEXT_FONT,
    contentWidth,
    lineHeight: CHAT_PLAIN_TEXT_LINE_HEIGHT_PX,
    verticalPadding: CHAT_PLAIN_TEXT_VERTICAL_PADDING_PX
  });
  return estimate ?? fallbackHeight;
};