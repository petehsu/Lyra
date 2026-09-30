import type { ChatMessage, MessageBlock } from "../../core/types";
import { selectStreamingText } from "../rich-text/use-streaming-message-text";

/** Model rounds share a bubble, but reasoning remains owned by its source response. */
export const withStreamingReasoning = (
  message: ChatMessage,
  reasoning: string,
  open: boolean
): readonly MessageBlock[] => {
  if (reasoning.length === 0) return message.blocks;
  const sourceMessageId = message.streamingMessageId ?? message.id;
  const persistedIndex = message.blocks.findLastIndex((block) => block.type === "thinking"
    && (block.sourceMessageId ?? message.id) === sourceMessageId);
  if (persistedIndex >= 0) {
    const persisted = message.blocks[persistedIndex];
    if (persisted?.type !== "thinking" || persisted.status === "done") return message.blocks;
    // Loading an active session gives us a prefix, not a completed thought.
    // Keep its identity (and disclosure state) while the store supplies either
    // the complete stream or the tail received after loading the snapshot.
    const choice = persisted.body.startsWith(reasoning)
      ? "fallback"
      : selectStreamingText(persisted.body, reasoning, false);
    const body = choice === "fallback" ? persisted.body
      : choice === "store" ? reasoning : `${persisted.body}${reasoning}`;
    const status = open ? "running" : "done";
    if (body === persisted.body && status === persisted.status) return message.blocks;
    return message.blocks.map((block, index) => index === persistedIndex
      ? { ...persisted, body, status } : block);
  }

  // Insert before this response's visible text, not before earlier tool rounds.
  const textIndex = message.blocks.findIndex((block) => block.type === "text"
    && (block.sourceMessageId ?? message.id) === sourceMessageId);
  const index = textIndex < 0 ? message.blocks.length : textIndex;
  return [
    ...message.blocks.slice(0, index),
    {
      type: "thinking", id: `${sourceMessageId}-streaming-thinking`, sourceMessageId,
      body: reasoning, status: open ? "running" : "done"
    },
    ...message.blocks.slice(index)
  ];
};
