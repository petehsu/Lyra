import type {
  AgentMessageBlock,
  AgentSessionSnapshot,
  AgentToolActivity,
  OmaMessageMetadata
} from "../../../shared/agent";
import type { ChatMessage, MessageBlock } from "../ai-panel/lyra-agents/core/types";
import { formatMessage, t, formatTime } from "@workbench/i18n";
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
  return formatTime(date.getTime());
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

const thinkingBlockStatus = (
  status: "thinking" | "done" | null | undefined
): "running" | "done" => status === "thinking" ? "running" : "done";

const timelineTimeMs = (value: string | undefined, fallback: number): number => {
  if (value === undefined) return fallback;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? fallback : parsed;
};

const realTimeMs = (value: string | undefined): number | null => {
  if (value === undefined) return null;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
};

const realToolEndTimeMs = (tool: AgentToolActivity): number | null =>
  realTimeMs(tool.finishedAt) ?? realTimeMs(tool.startedAt);

const realWorkRangeForMessage = (
  message: AgentSessionSnapshot["messages"][number],
  toolsById: ReadonlyMap<string, AgentToolActivity>
): { readonly startMs: number; readonly endMs: number } | null => {
  const times: number[] = [];
  const messageTime = realTimeMs(message.createdAt);
  if (messageTime !== null) {
    times.push(messageTime);
  }
  for (const block of message.blocks ?? []) {
    const toolId = toolIdForBlock(block);
    const tool = toolId === null ? undefined : toolsById.get(toolId);
    if (tool === undefined) continue;
    const startedAt = realTimeMs(tool.startedAt);
    const finishedAt = realToolEndTimeMs(tool);
    if (startedAt !== null) times.push(startedAt);
    if (finishedAt !== null) times.push(finishedAt);
  }
  if (times.length === 0) return null;
  return {
    startMs: Math.min(...times),
    endMs: Math.max(...times)
  };
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

// Backend compression inserts a role:"system" message whose text is a JSON
// payload (summary, compressedMessageIds, …). Rendered as a visible divider.
const isCompressedContextBlock = (metadata: unknown): boolean => {
  if (metadata === null || typeof metadata !== "object") return false;
  return (metadata as { readonly kind?: string }).kind === "compressed-context-block";
};

const isApiErrorAgentMessage = (metadata: unknown): boolean => {
  if (metadata === null || typeof metadata !== "object") return false;
  return (metadata as { readonly isApiError?: boolean }).isApiError === true;
};

const parseOmaMetadata = (metadata: unknown): OmaMessageMetadata | null => {
  if (metadata === null || typeof metadata !== "object") return null;
  const oma = (metadata as { readonly oma?: unknown }).oma;
  return oma !== null && typeof oma === "object" ? (oma as OmaMessageMetadata) : null;
};

const sameOmaMessageThread = (left: ChatMessage, right: ChatMessage): boolean => {
  const leftOma = left.oma ?? null;
  const rightOma = right.oma ?? null;
  if (leftOma === null && rightOma === null) return true;
  return (
    leftOma?.channelId === rightOma?.channelId &&
    leftOma?.senderAgentId === rightOma?.senderAgentId
  );
};

type LegacyAgentToolBlock = Extract<AgentMessageBlock, { type: "tool" }> & {
  readonly tool_id?: string;
};

const toolIdForBlock = (block: AgentMessageBlock): string | null => {
  if (block.type !== "tool") return null;
  return block.toolId ?? (block as LegacyAgentToolBlock).tool_id ?? null;
};

const isClarificationTool = (tool: AgentToolActivity): boolean =>
  tool.name === "clarification" || tool.name === "lyra_clarification_ask";

const mergeToolBlocks = (
  left: Extract<MessageBlock, { type: "tools" }>,
  right: Extract<MessageBlock, { type: "tools" }>
): Extract<MessageBlock, { type: "tools" }> => {
  // Deduplicate by call id so a single tool can never render as two cards. A
  // streaming-preview activity and its final execution share the same
  // tool_call_id; without this they would both survive the concat and the diff
  // card would appear twice (once above the assistant text, once below). The
  // later occurrence wins so the final result replaces the running preview.
  const callsById = new Map<string, (typeof left.group.calls)[number]>();
  for (const call of [...left.group.calls, ...right.group.calls]) {
    callsById.set(call.id, call);
  }
  const combinedCalls = [...callsById.values()];
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
      ...(message.reasoningContent?.trim()
        ? [{
            type: "thinking" as const,
            id: `${message.id}-thinking`,
            body: message.reasoningContent,
            status: thinkingBlockStatus(message.reasoningStatus)
          }]
        : []),
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
    if (block.type === "thinking") {
      flushTools();
      if (block.text.trim().length > 0) {
        chatBlocks.push({
          type: "thinking",
          id: `${message.id}-${block.id}`,
          body: block.text,
          status: thinkingBlockStatus(block.status)
        });
      }
      continue;
    }

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
    if (tool !== undefined && !isClarificationTool(tool)) {
      pendingTools.push(tool);
    }
  }
  flushTools();

  if (message.reasoningContent?.trim() && !sourceBlocks.some((block) => block.type === "thinking")) {
    chatBlocks.unshift({
      type: "thinking",
      id: `${message.id}-thinking`,
      body: message.reasoningContent,
      status: thinkingBlockStatus(message.reasoningStatus)
    });
  }
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
    ...(message.reasoningContent?.trim()
      ? [{
          type: "thinking" as const,
          id: `${message.id}-thinking`,
          body: message.reasoningContent,
          status: thinkingBlockStatus(message.reasoningStatus)
        }]
      : []),
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
  const omaAgentsById = new Map(
    (session.oma?.agents ?? []).map((agent) => [agent.id, agent])
  );
  const omaChannelKindsById = new Map(
    (session.oma?.channels ?? []).map((channel) => [channel.id, channel.kind])
  );
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
      if (isCompressedContextBlock(message.metadata)) {
        // Render compression block as a visible "context compressed" divider.
        // Storage retains all original messages (marked excludeFromProviderContext);
        // this block is the visual boundary between compressed and live context.
        const compressedIds = (message.metadata as { readonly compressedMessageIds?: unknown }).compressedMessageIds;
        const count = Array.isArray(compressedIds) ? compressedIds.length : 0;
        const originalIndex = sourceMessageStartIndex + index;
        const formattedTime = formatAgentMessageTime(message.createdAt);
        let summaryText = "";
        try {
          const parsed = JSON.parse(message.text ?? "");
          summaryText = typeof parsed.summary === "string" ? parsed.summary : "";
        } catch {
          // text is not JSON — leave summaryText empty
        }
        const dividerMessage: ChatMessage = {
          id: message.id,
          author: "agent",
          isContextCompressed: true,
          ...(formattedTime === undefined ? {} : { time: formattedTime }),
          blocks: [{
            type: "text",
            id: `${message.id}-text`,
            body: summaryText || formatMessage("lyra-agents-message.contextCompressed", { count })
          }]
        };
        return [{
          message: dividerMessage,
          atMs: timelineTimeMs(message.createdAt, originalIndex),
          sequence: originalIndex,
          workStartMs: null,
          workEndMs: null
        }];
      }
      const originalIndex = sourceMessageStartIndex + index;
      const formattedTime = formatAgentMessageTime(message.createdAt);
      const hasToolBlock = message.blocks?.some((b) => b.type === "tool") ?? false;
      const author = (message.role === "user" && !hasToolBlock) ? "user" : "agent";
      const transcriptCitations = parseTranscriptCitationsFromMetadata(message.metadata);
      const pageCitations = parsePageCitationsFromMetadata(message.metadata);
      const inlineImages = parseInlineImagesFromMetadata(message.metadata);
      const fileAttachments = parseFileAttachmentsFromMetadata(message.metadata);
      const oma = parseOmaMetadata(message.metadata);
      const omaSender = author === "agent" && typeof oma?.senderAgentId === "string"
        && omaChannelKindsById.get(oma.channelId ?? "") === "group"
        ? omaAgentsById.get(oma.senderAgentId)
        : undefined;
      const isApiError = author === "agent" && isApiErrorAgentMessage(message.metadata);
      const chatMessage: ChatMessage = {
        id: message.id,
        author,
        ...(oma === null ? {} : { oma }),
        ...(omaSender === undefined ? {} : {
          omaSenderName: omaSender.name,
          omaSenderAvatar: omaSender.avatar.value,
          omaSenderAvatarSrc: omaSender.avatar.src ?? null,
          omaSenderAgentId: omaSender.agentId
        }),
        ...(isApiError ? { isApiError: true } : {}),
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
      const workRange = author === "agent"
        ? realWorkRangeForMessage(message, toolsById)
        : null;
      const workDurationMs =
        workRange !== null && workRange.endMs > workRange.startMs
          ? workRange.endMs - workRange.startMs
          : undefined;
      const item = {
        message: workDurationMs === undefined
          ? chatMessage
          : { ...chatMessage, workDurationMs },
        atMs: timelineTimeMs(message.createdAt, originalIndex),
        sequence: originalIndex,
        workStartMs: workRange?.startMs ?? null,
        workEndMs: workRange?.endMs ?? null
      };
      return item.message.blocks.length > 0 ? [item] : [];
    });

  // Older snapshots and some runtime adapters keep tool activity only in the
  // session-level `tools` list. Preserve those completed records even when the
  // assistant message does not contain an explicit tool block, and place them
  // at their real timeline position instead of appending them to the end.
  const linkedToolIds = collectLinkedToolIds(timedMessages.map((item) => item.message));
  const visibleStartMs = sourceMessageStartIndex === 0
    ? null
    : realTimeMs(sourceMessages[0]?.createdAt);
  sessionTools.forEach((tool, index) => {
    if (
      linkedToolIds.has(tool.id)
      || tool.status === "running"
      || isClarificationTool(tool)
      || (
        visibleStartMs !== null
        && (realTimeMs(tool.startedAt) ?? realToolEndTimeMs(tool) ?? visibleStartMs) < visibleStartMs
      )
    ) {
      return;
    }
    const group = toToolGroup([tool], `lyra-orphan-tool-${tool.id}`);
    if (group === null) return;
    const startMs = realTimeMs(tool.startedAt);
    const endMs = realToolEndTimeMs(tool);
    timedMessages.push({
      message: {
        id: `lyra-orphan-tool-${tool.id}`,
        author: "agent",
        blocks: [{
          type: "tools",
          id: `lyra-orphan-tool-${tool.id}-block`,
          group
        }],
        ...(startMs !== null && endMs !== null && endMs > startMs
          ? { workDurationMs: endMs - startMs }
          : {})
      },
      atMs: startMs ?? endMs ?? timelineTimeMs(undefined, session.messages.length + index),
      sequence: session.messages.length + index,
      workStartMs: startMs,
      workEndMs: endMs
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

  const finalItems: typeof timedMessages = [];
  for (const item of timedMessages) {
    const msg = item.message;
    if (finalItems.length > 0) {
      const prevItem = finalItems[finalItems.length - 1];
      if (prevItem === undefined) {
        finalItems.push(item);
        continue;
      }
      const prev = prevItem.message;
      if (
        prev.author === msg.author &&
        prev.author === "agent" &&
        !isPendingAgentMessage(prev) &&
        !isPendingAgentMessage(msg) &&
        sameOmaMessageThread(prev, msg)
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
        const workStartMs = prevItem.workStartMs === null
          ? item.workStartMs
          : item.workStartMs === null
            ? prevItem.workStartMs
            : Math.min(prevItem.workStartMs, item.workStartMs);
        const workEndMs = prevItem.workEndMs === null
          ? item.workEndMs
          : item.workEndMs === null
            ? prevItem.workEndMs
            : Math.max(prevItem.workEndMs, item.workEndMs);
        const workDurationMs =
          workStartMs !== null && workEndMs !== null && workEndMs > workStartMs
            ? workEndMs - workStartMs
            : undefined;
        finalItems[finalItems.length - 1] = {
          ...prevItem,
          message: {
            ...prev,
            blocks: nextBlocks,
            ...(workDurationMs === undefined ? {} : { workDurationMs }),
            ...(nextRollback === undefined ? {} : { rollback: nextRollback })
          },
          workStartMs,
          workEndMs
        };
        continue;
      }
    }
    finalItems.push(item);
  }

  const finalMessages = finalItems.map((item) => item.message);
  return attachEphemeralRunningTools(session, finalMessages);
};

const collectLinkedToolIds = (messages: readonly ChatMessage[]): Set<string> => {
  const linked = new Set<string>();
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.type !== "tools") continue;
      for (const call of block.group.calls) {
        linked.add(call.id);
      }
    }
  }
  return linked;
};

/** Surface in-flight tools before the assistant message gains explicit tool blocks. */
const attachEphemeralRunningTools = (
  session: AgentSessionSnapshot,
  messages: readonly ChatMessage[]
): ChatMessage[] => {
  if (session.turnStatus !== "running") {
    return [...messages];
  }

  const runningTools = latestToolActivities(session.tools).filter(
    (tool) => tool.status === "running" && !isClarificationTool(tool)
  );
  if (runningTools.length === 0) {
    return [...messages];
  }

  const linkedToolIds = collectLinkedToolIds(messages);
  const orphanTools = runningTools.filter((tool) => !linkedToolIds.has(tool.id));
  if (orphanTools.length === 0) {
    return [...messages];
  }

  const group = toToolGroup(orphanTools, "lyra-ephemeral-running-tools");
  if (group === null) {
    return [...messages];
  }

  const toolBlock: Extract<MessageBlock, { type: "tools" }> = {
    type: "tools",
    id: "lyra-ephemeral-running-tools-block",
    group
  };

  let targetIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.author === "agent") {
      targetIndex = index;
      break;
    }
  }

  if (targetIndex < 0) {
    return [
      ...messages,
      {
        id: "lyra-agent-running-tools",
        author: "agent",
        blocks: [toolBlock]
      }
    ];
  }

  return messages.map((message, index) => {
    if (index !== targetIndex) return message;
    return {
      ...message,
      blocks: appendToolBlock(message.blocks, toolBlock)
    };
  });
};
