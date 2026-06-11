import type { AgentMessageBlock, AgentSessionSnapshot, AgentToolActivity } from "../../../shared/agent";
import type { ChatMessage, MessageBlock } from "../ai-panel/agent-chat-demo/core/types";
import { formatMessage, t } from "../ai-panel/agent-chat-demo/core/i18n";
import { toToolGroup } from "./tool-view-model";

export const formatAgentMessageTime = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23"
  }).format(date);
};

export const cleanSyntheticImageText = (text: string): string => {
  return text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed === "[image]") return false;
      if (trimmed.startsWith("[Attached image associated with the preceding tool result:")) return false;
      return true;
    })
    .join("\n")
    .trim();
};

const isAssistantToolPlaceholderText = (text: string): boolean => {
  const cleaned = cleanSyntheticImageText(text).trim();
  return cleaned === "..." || cleaned === "…";
};

const messageBody = (
  session: AgentSessionSnapshot,
  message: AgentSessionSnapshot["messages"][number],
  index: number
): string => {
  if (message.text.length > 0) return cleanSyntheticImageText(message.text);
  const isLastAssistant = message.role === "assistant" && index === session.messages.length - 1;
  return isLastAssistant && session.turnStatus === "running" ? "" : t("msg.noResponseText");
};

const timelineTimeMs = (value: string | undefined, fallback: number): number => {
  if (value === undefined) return fallback;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? fallback : parsed;
};

const latestToolActivities = (
  tools: readonly AgentToolActivity[]
): AgentToolActivity[] => {
  const seen = new Set<string>();
  const latest: AgentToolActivity[] = [];
  for (let index = tools.length - 1; index >= 0; index -= 1) {
    const tool = tools[index];
    if (tool === undefined || seen.has(tool.id)) continue;
    seen.add(tool.id);
    latest.push(tool);
  }
  return latest.reverse();
};

const isPendingAgentMessage = (message: ChatMessage): boolean =>
  message.author === "agent" &&
  message.blocks.length > 0 &&
  message.blocks.every((block) => block.type === "text" && block.body.trim().length === 0);

type LegacyAgentToolBlock = Extract<AgentMessageBlock, { type: "tool" }> & {
  readonly tool_id?: string;
};

const toolIdForBlock = (block: AgentMessageBlock): string | null => {
  if (block.type !== "tool") return null;
  return block.toolId ?? (block as LegacyAgentToolBlock).tool_id ?? null;
};

const chatBlocksForAgentMessage = (
  session: AgentSessionSnapshot,
  message: AgentSessionSnapshot["messages"][number],
  index: number,
  toolsById: ReadonlyMap<string, AgentToolActivity>,
  referencedToolIds: Set<string>
): MessageBlock[] => {
  const sourceBlocks = message.blocks ?? [];
  if (sourceBlocks.length === 0) {
    if (
      message.role === "assistant" &&
      message.text.trim().length === 0 &&
      !(index === session.messages.length - 1 && session.turnStatus === "running")
    ) {
      return [];
    }
    const body = messageBody(session, message, index);
    return [
      {
        type: "text",
        id: `${message.id}-text`,
        body
      }
    ];
  }

  const chatBlocks: MessageBlock[] = [];
  const hasAssistantToolBlock =
    message.role === "assistant" && sourceBlocks.some((block) => block.type === "tool");
  let pendingTools: AgentToolActivity[] = [];
  const flushTools = () => {
    if (pendingTools.length === 0) return;
    const group = toToolGroup(pendingTools, `${message.id}-tools-${chatBlocks.length}`);
    if (group !== null) {
      chatBlocks.push({
        type: "tools",
        id: `${group.id}-block`,
        group
      });
    }
    pendingTools = [];
  };

  for (const block of sourceBlocks) {
    if (block.type === "text") {
      if (
        hasAssistantToolBlock &&
        isAssistantToolPlaceholderText(block.text)
      ) {
        continue;
      }
      flushTools();
      const cleaned = cleanSyntheticImageText(block.text);
      if (cleaned.length > 0) {
        chatBlocks.push({
          type: "text",
          id: `${message.id}-${block.id}`,
          body: cleaned
        });
      }
      continue;
    }

    if (block.type === "image") {
      flushTools();
      chatBlocks.push({
        type: "image",
        id: `${message.id}-${block.id}`,
        image: {
          id: block.id,
          mediaType: block.mediaType,
          data: block.data,
          label: block.label ?? null,
          source: block.source ?? null,
          width: block.width ?? null,
          height: block.height ?? null
        }
      });
      continue;
    }

    const toolId = toolIdForBlock(block);
    const tool = toolId === null ? undefined : toolsById.get(toolId);
    if (tool !== undefined) {
      referencedToolIds.add(tool.id);
      pendingTools.push(tool);
    }
  }
  flushTools();

  if (chatBlocks.length > 0) return chatBlocks;
  if (
    message.role === "assistant" &&
    sourceBlocks.some((block) => block.type === "tool") &&
    message.text.trim().length === 0
  ) {
    return [];
  }
  const body = messageBody(session, message, index);
  if (body.trim().length === 0) {
    return [];
  }
  return [
    {
      type: "text",
      id: `${message.id}-text`,
      body
    }
  ];
};

export const agentSessionToChatMessages = (
  session: AgentSessionSnapshot | null,
  options: {
    readonly failedTurnMessage?: string | null;
    readonly messageLimitFromEnd?: number | null;
  } = {}
): ChatMessage[] => {
  if (session === null) return [];

  const sessionTools = latestToolActivities(session.tools);
  const toolsById = new Map(sessionTools.map((tool) => [tool.id, tool]));
  const referencedToolIds = new Set<string>();
  const messageLimit = typeof options.messageLimitFromEnd === "number" &&
    Number.isFinite(options.messageLimitFromEnd)
    ? Math.max(0, Math.floor(options.messageLimitFromEnd))
    : null;
  const sourceMessageStartIndex = messageLimit === null || messageLimit >= session.messages.length
    ? 0
    : Math.max(0, session.messages.length - messageLimit);
  const sourceMessages = sourceMessageStartIndex === 0
    ? session.messages
    : session.messages.slice(sourceMessageStartIndex);

  // 1. Map raw AgentMessages to ChatMessages
  const timedMessages = sourceMessages
    .map((message, index) => {
      const originalIndex = sourceMessageStartIndex + index;
      const formattedTime = formatAgentMessageTime(message.createdAt);
      const hasToolBlock = message.blocks?.some((b) => b.type === "tool") ?? false;
      const author = (message.role === "user" && !hasToolBlock) ? "user" : "agent";
      const chatMessage: ChatMessage = {
        id: message.id,
        author,
        ...(formattedTime === undefined ? {} : { time: formattedTime }),
        ...(message.rollback === undefined || message.rollback === null
          ? {}
          : { rollback: message.rollback }),
        blocks: chatBlocksForAgentMessage(
          session,
          message,
          originalIndex,
          toolsById,
          referencedToolIds
        )
      };
      return {
        message: chatMessage,
        atMs: timelineTimeMs(message.createdAt, originalIndex),
        sequence: originalIndex
      };
    })
    .filter((item) => item.message.blocks.length > 0);

  const lastMessage = session.messages.at(-1);
  if (session.turnStatus === "failed" && lastMessage?.role === "user") {
    const errorDetail = options.failedTurnMessage?.trim();
    const formattedTime = formatAgentMessageTime(session.updatedAt);
    timedMessages.push({
      message: {
        id: `${session.id}-turn-failed`,
        author: "agent",
        ...(formattedTime === undefined ? {} : { time: formattedTime }),
        blocks: [
          {
            type: "text",
            id: `${session.id}-turn-failed-text`,
            body: errorDetail === undefined || errorDetail.length === 0
              ? t("msg.turnFailedNoResponse")
              : formatMessage("msg.turnFailedWithReason", { message: errorDetail })
          }
        ]
      },
      atMs: timelineTimeMs(session.updatedAt, session.messages.length),
      sequence: session.messages.length
    });
  }

  const firstVisibleMessage = sourceMessages[0];
  const firstVisibleAtMs = firstVisibleMessage === undefined
    ? null
    : timelineTimeMs(firstVisibleMessage.createdAt, sourceMessageStartIndex);
  const orphanTools = sessionTools
    .filter((tool) => !referencedToolIds.has(tool.id))
    .filter((tool) => (
      messageLimit === null ||
      firstVisibleAtMs === null ||
      timelineTimeMs(tool.startedAt, 0) >= firstVisibleAtMs
    ));
  orphanTools.forEach((tool, index) => {
    const group = toToolGroup([tool], `lyra-agent-tools-${tool.id}`);
    if (group === null) return;
    const formattedTime = formatAgentMessageTime(tool.startedAt);
    timedMessages.push({
      message: {
        id: `lyra-agent-tool-message-${tool.id}`,
        author: "agent",
        ...(formattedTime === undefined ? {} : { time: formattedTime }),
        blocks: [
          {
            type: "tools",
            id: `${group.id}-block`,
            group
          }
        ]
      },
      atMs: timelineTimeMs(tool.startedAt, session.messages.length + index),
      sequence: session.messages.length + index
    });
  });

  timedMessages.sort((left, right) => {
    if (left.atMs !== right.atMs) return left.atMs - right.atMs;
    return left.sequence - right.sequence;
  });

  const messages = timedMessages.map((item) => item.message);

  if (
    session.follow.running &&
    !messages.some((message) => isPendingAgentMessage(message))
  ) {
    messages.push({
      id: "lyra-agent-loading",
      author: "agent",
      blocks: [
        {
          type: "text",
          id: "lyra-agent-loading-text",
          body: ""
        }
      ]
    });
  }

  // 2. Merge pass on ChatMessages to combine consecutive agent messages and unify tool groups
  const finalMessages: ChatMessage[] = [];
  for (const msg of messages) {
    if (finalMessages.length > 0) {
      const prev = finalMessages[finalMessages.length - 1];
      if (
        prev !== undefined &&
        prev.author === msg.author &&
        prev.author === "agent" &&
        !isPendingAgentMessage(prev) &&
        !isPendingAgentMessage(msg)
      ) {
        // Merge blocks and combine consecutive tool groups
        const nextBlocks = [...prev.blocks];
        for (const block of msg.blocks) {
          const lastBlock = nextBlocks[nextBlocks.length - 1];
          if (lastBlock?.type === "tools" && block.type === "tools") {
            const combinedCalls = [...lastBlock.group.calls, ...block.group.calls];
            const running = combinedCalls.find((c) => c.status === "running");
            nextBlocks[nextBlocks.length - 1] = {
              ...lastBlock,
              group: {
                ...lastBlock.group,
                status: running === undefined ? "done" : "running",
                label: running?.title ?? lastBlock.group.label,
                hint: running === undefined
                  ? formatMessage("tool.events", { count: combinedCalls.length })
                  : t("tool.running"),
                ...(running === undefined ? {} : { currentCallId: running.id }),
                calls: combinedCalls
              }
            };
          } else {
            nextBlocks.push(block);
          }
        }

        const prevRollback = prev.rollback ?? undefined;
        const nextRollback = msg.rollback ?? prevRollback;
        finalMessages[finalMessages.length - 1] = {
          ...prev,
          blocks: nextBlocks,
          ...(nextRollback === undefined ? {} : { rollback: nextRollback })
        };
        continue;
      }
    }
    finalMessages.push(msg);
  }

  return finalMessages;
};
