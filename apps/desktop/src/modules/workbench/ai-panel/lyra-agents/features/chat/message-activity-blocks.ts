import type { ChatMessage, MessageBlock } from "../../core/types";

/** Model rounds share a bubble, but reasoning remains owned by its source response. */
export const withStreamingReasoning = (
  message: ChatMessage,
  reasoning: string,
  open: boolean
): readonly MessageBlock[] => {
  if (reasoning.length === 0) return message.blocks;
  const sourceMessageId = message.streamingMessageId ?? message.id;
  const persisted = message.blocks.some((block) => block.type === "thinking"
    && (block.sourceMessageId ?? message.id) === sourceMessageId);
  if (persisted) return message.blocks;

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
