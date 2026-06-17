import type { ChatMessage } from "../../core/types";
import { estimateMessageSlotHeight } from "./estimate-message-slot-height";

export type MessageWindowPlanConfig = {
  readonly minRevealCount: number;
  readonly maxRevealCount: number;
  readonly messageGapPx: number;
  readonly fallbackHeightPx: number;
  readonly contentWidthPx: number;
};

export const createMessageWindowPlanConfig = (
  contentWidthPx: number,
  options: {
    readonly minRevealCount: number;
    readonly maxRevealCount: number;
    readonly messageGapPx: number;
    readonly fallbackHeightPx: number;
  }
): MessageWindowPlanConfig => ({
  contentWidthPx,
  ...options
});

const estimateHeight = (
  message: ChatMessage,
  config: MessageWindowPlanConfig
): number =>
  estimateMessageSlotHeight(message, config.contentWidthPx, config.fallbackHeightPx);

/** How many latest messages to render for an initial height budget. */
export const planRevealCountFromEnd = (
  messages: readonly ChatMessage[],
  heightBudgetPx: number,
  config: MessageWindowPlanConfig
): number => {
  if (messages.length === 0 || heightBudgetPx <= 0) return 0;

  let accumulated = 0;
  let count = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const gap = count > 0 ? config.messageGapPx : 0;
    accumulated += gap + estimateHeight(messages[index]!, config);
    count += 1;
    if (accumulated >= heightBudgetPx && count >= config.minRevealCount) break;
    if (count >= config.maxRevealCount) break;
  }

  const minVisible = Math.min(messages.length, config.minRevealCount);
  return Math.min(messages.length, Math.max(count, minVisible));
};

/** How many older hidden messages to prepend for a load-earlier budget. */
export const planAdditionalRevealCount = (
  messages: readonly ChatMessage[],
  currentVisibleCount: number,
  heightBudgetPx: number,
  config: MessageWindowPlanConfig
): number => {
  const total = messages.length;
  const visible = Math.min(total, Math.max(0, currentVisibleCount));
  const hidden = total - visible;
  if (hidden <= 0 || heightBudgetPx <= 0) return 0;

  let accumulated = 0;
  let count = 0;
  const firstHiddenIndex = total - visible - 1;
  for (let index = firstHiddenIndex; index >= 0; index -= 1) {
    const gap = count > 0 ? config.messageGapPx : 0;
    accumulated += gap + estimateHeight(messages[index]!, config);
    count += 1;
    if (accumulated >= heightBudgetPx && count >= config.minRevealCount) break;
    if (count >= config.maxRevealCount) break;
  }

  const minBatch = Math.min(hidden, config.minRevealCount);
  return Math.min(hidden, Math.max(count, minBatch));
};