import type { AgentMessageBlock, AgentSessionSnapshot, AgentToolActivity } from "../../../shared/agent";
import type { ChatMessage, MessageBlock } from "../ai-panel/lyra-agents/core/types";
import { formatMessage, t } from "../ai-panel/lyra-agents/core/i18n";
import { isInternalRuntimeFallbackText } from "../ai-panel/lyra-agents/core/turn-failure-message";
import { parseTranscriptCitationsFromMetadata } from "../ai-panel/lyra-agents/features/chat/message-citation";
import { parseFileAttachmentsFromMetadata } from "../ai-panel/lyra-agents/features/chat/composer-file";
import { parseInlineImagesFromMetadata } from "../ai-panel/lyra-agents/features/chat/composer-image";
import { parsePageCitationsFromMetadata } from "../ai-panel/lyra-agents/features/chat/page-citation";

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

const INTERNAL_PROTOCOL_MARKERS = [
  "[Tool call:",
  "[Tool result ref:",
  "[Image omitted:",
  "[Tool output truncated"
] as const;

const stripInternalProtocolMarkers = (text: string): string => {
  let output = text;
  for (const marker of INTERNAL_PROTOCOL_MARKERS) {
    const lower = marker.toLowerCase();
    let searchFrom = 0;
    while (searchFrom < output.length) {
      const haystack = output.slice(searchFrom).toLowerCase();
      const relative = haystack.indexOf(lower);
      if (relative < 0) break;
      const start = searchFrom + relative;
      const end = output.indexOf("]", start);
      output = end < 0 ? output.slice(0, start) : `${output.slice(0, start)}${output.slice(end + 1)}`;
      searchFrom = start;
    }
  }
  // Collapse runs of spaces/tabs *within* each line, but preserve newlines so
  // markdown block structure (headings, lists, code fences, paragraphs) survives
  // before it reaches the renderer. A blanket `replace(/\s+/g, " ")` here would
  // flatten every newline into a space, turning multi-block assistant markdown
  // into one undifferentiated paragraph.
  return output
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .trim();
};

export const visibleAssistantText = (text: string): string => {
  const visible = stripInternalProtocolMarkers(cleanSyntheticImageText(text));
  return isInternalRuntimeFallbackText(visible) ? "" : visible;
};

const isAssistantToolPlaceholderText = (text: string): boolean => {
  const cleaned = visibleAssistantText(text);
  return cleaned === "..." || cleaned === "…";
};

const looksLikeSyntheticToolNarration = (text: string): boolean => {
  const cleaned = visibleAssistantText(text);
  if (cleaned.length === 0) return false;
  const segments = cleaned.split(" · ").map((segment) => segment.trim());
  if (segments.length === 0) return false;
  return segments.every((segment) => /^[\w-]+(\.[\w-]+)+$/.test(segment));
};

const isLastAssistantMessage = (
  session: AgentSessionSnapshot,
  message: AgentSessionSnapshot["messages"][number],
  index: number
): boolean => message.role === "assistant" && index === session.messages.length - 1;

const shouldRetainPendingAssistantShell = (
  session: AgentSessionSnapshot,
  message: AgentSessionSnapshot["messages"][number],
  index: number
): boolean =>
  isLastAssistantMessage(session, message, index) && session.turnStatus === "running";

const messageBody = (
  session: AgentSessionSnapshot,
  message: AgentSessionSnapshot["messages"][number],
  index: number
): string => {
  const visible = visibleAssistantText(message.text);
  if (visible.length > 0) return visible;
  return shouldRetainPendingAssistantShell(session, message, index) ? "" : "";
};

const emptyPendingTextBlock = (
  message: AgentSessionSnapshot["messages"][number]
): MessageBlock => ({
  type: "text",
  id: `${message.id}-text`,
  body: ""
});

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

const isUiHiddenAgentMessage = (metadata: unknown): boolean => {
  if (metadata === null || typeof metadata !== "object") return false;
  return (metadata as { readonly uiHidden?: boolean }).uiHidden === true;
};

type LegacyAgentToolBlock = Extract<AgentMessageBlock, { type: "tool" }> & {
  readonly tool_id?: string;
};

const toolIdForBlock = (block: AgentMessageBlock): string | null => {
  if (block.type !== "tool") return null;
  return block.toolId ?? (block as LegacyAgentToolBlock).tool_id ?? null;
};

const mergeToolBlocks = (
  left: Extract<MessageBlock, { type: "tools" }>,
  right: Extract<MessageBlock, { type: "tools" }>
): Extract<MessageBlock, { type: "tools" }> => {
  const combinedCalls = [...left.group.calls, ...right.group.calls];
  const running = combinedCalls.find((call) => call.status === "running");
  return {
    ...left,
    group: {
      ...left.group,
      status: running === undefined ? "done" : "running",
      label: running?.title ?? left.group.label,
      hint: running === undefined
        ? formatMessage("tool.events", { count: combinedCalls.length })
        : t("tool.running"),
      ...(running === undefined ? {} : { currentCallId: running.id }),
      calls: combinedCalls
    }
  };
};

const appendToolBlock = (blocks: MessageBlock[], toolBlock: Extract<MessageBlock, { type: "tools" }>): MessageBlock[] => {
  const lastBlock = blocks[blocks.length - 1];
  if (lastBlock?.type === "tools") {
    return [...blocks.slice(0, -1), mergeToolBlocks(lastBlock, toolBlock)];
  }
  return [...blocks, toolBlock];
};

const chatBlocksForAgentMessage = (
  session: AgentSessionSnapshot,
  message: AgentSessionSnapshot["messages"][number],
  index: number,
  toolsById: ReadonlyMap<string, AgentToolActivity>
): MessageBlock[] => {
  const sourceBlocks = message.blocks ?? [];
  if (sourceBlocks.length === 0) {
    if (
      message.role === "assistant" &&
      visibleAssistantText(message.text).length === 0 &&
      !shouldRetainPendingAssistantShell(session, message, index)
    ) {
      return [];
    }
    const body = messageBody(session, message, index);
    if (body.length === 0) {
      return shouldRetainPendingAssistantShell(session, message, index)
        ? [emptyPendingTextBlock(message)]
        : [];
    }
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
    const anchorToolId = pendingTools[0]?.id ?? "tools";
    const group = toToolGroup(pendingTools, `${message.id}-tool-group-${anchorToolId}`);
    if (group !== null) {
      chatBlocks.push({
        type: "tools",
        id: `${message.id}-tool-group-${anchorToolId}-block`,
        group
      });
    }
    pendingTools = [];
  };

  for (const block of sourceBlocks) {
    if (block.type === "text") {
      if (
        hasAssistantToolBlock &&
        (isAssistantToolPlaceholderText(block.text) ||
          looksLikeSyntheticToolNarration(block.text))
      ) {
        continue;
      }
      flushTools();
      const cleaned = visibleAssistantText(block.text);
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
  if (body.length === 0) {
    return shouldRetainPendingAssistantShell(session, message, index)
      ? [emptyPendingTextBlock(message)]
      : [];
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
    readonly messageLimitFromEnd?: number | null;
  } = {}
): ChatMessage[] => {
  if (session === null) return [];

  const sessionTools = latestToolActivities(session.tools);
  const toolsById = new Map(sessionTools.map((tool) => [tool.id, tool]));
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

  const timedMessages = sourceMessages
    .flatMap((message, index) => {
      if (isUiHiddenAgentMessage(message.metadata)) {
        return [];
      }
      const originalIndex = sourceMessageStartIndex + index;
      const formattedTime = formatAgentMessageTime(message.createdAt);
      const hasToolBlock = message.blocks?.some((b) => b.type === "tool") ?? false;
      const author = (message.role === "user" && !hasToolBlock) ? "user" : "agent";
      const transcriptCitations = parseTranscriptCitationsFromMetadata(message.metadata);
      const pageCitations = parsePageCitationsFromMetadata(message.metadata);
      const inlineImages = parseInlineImagesFromMetadata(message.metadata);
      const fileAttachments = parseFileAttachmentsFromMetadata(message.metadata);
      const chatMessage: ChatMessage = {
        id: message.id,
        author,
        ...(formattedTime === undefined ? {} : { time: formattedTime }),
        ...(transcriptCitations.length === 0 ? {} : { transcriptCitations }),
        ...(pageCitations.length === 0 ? {} : { pageCitations }),
        ...(inlineImages.length === 0 ? {} : { inlineImages }),
        ...(fileAttachments.length === 0 ? {} : { fileAttachments }),
        ...(message.rollback === undefined || message.rollback === null
          ? {}
          : { rollback: message.rollback }),
        blocks: chatBlocksForAgentMessage(
          session,
          message,
          originalIndex,
          toolsById
        )
      };
      const item = {
        message: chatMessage,
        atMs: timelineTimeMs(message.createdAt, originalIndex),
        sequence: originalIndex
      };
      return item.message.blocks.length > 0 ? [item] : [];
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
        let nextBlocks = [...prev.blocks];
        for (const block of msg.blocks) {
          if (block.type === "tools") {
            nextBlocks = appendToolBlock(nextBlocks, block);
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