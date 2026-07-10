import type {
  AgentMessage,
  AgentMessageBlock,
  AgentRuntimeEvent,
  AgentSessionSnapshot,
  AgentToolActivity,
  AgentTurnStatus
} from "../../../shared/agent";

const messageRichness = (message: AgentMessage): number => {
  const blockCount = message.blocks?.length ?? 0;
  const textLength = message.text.length;
  const metadata = Object.keys(asRecord(message.metadata)).length;
  return blockCount * 1_000 + textLength + metadata * 10;
};

const chooseRicherMessage = (left: AgentMessage, right: AgentMessage): AgentMessage =>
  messageRichness(left) >= messageRichness(right) ? left : right;

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const toolOutputRichness = (tool: AgentToolActivity): number => {
  const output = asRecord(tool.output);
  const raw = asRecord(output.raw);
  const diff = typeof raw.diff === "string" ? raw.diff.length : 0;
  const content = typeof output.content === "string" ? output.content.length : 0;
  const preview = raw.preview === true ? 10_000 : 0;
  const changedFiles = Array.isArray(raw.changedFiles) ? raw.changedFiles.length : 0;
  const diffArtifact = asRecord(raw.diffArtifactRef);
  const artifactFacts = changedFiles > 0 || Object.keys(diffArtifact).length > 0 ? 20_000 : 0;
  return preview + artifactFacts + diff * 100 + Math.min(content, 5_000);
};

const isTerminalToolStatus = (status: AgentToolActivity["status"]): boolean =>
  status !== "running";

const mergeToolActivity = (
  existing: AgentToolActivity,
  incoming: AgentToolActivity
): AgentToolActivity => {
  if (isTerminalToolStatus(existing.status) && incoming.status === "running") {
    return existing;
  }
  const incomingOutputRichness = toolOutputRichness(incoming);
  const richerOutputSource =
    incoming.status !== "running" && incomingOutputRichness > 0
      ? incoming
      : toolOutputRichness(existing) > incomingOutputRichness
        ? existing
        : incoming;
  const output = richerOutputSource.output ?? incoming.output ?? existing.output;
  return {
    ...existing,
    ...incoming,
    ...(output === undefined ? {} : { output }),
    startedAt: existing.startedAt || incoming.startedAt,
    ...(incoming.finishedAt === undefined && existing.finishedAt !== undefined
      ? { finishedAt: existing.finishedAt }
      : {})
  };
};

export const normalizeAgentTurnStatus = (status: unknown): AgentTurnStatus => {
  if (status === "running") return "running";
  if (status === "cancelled") return "cancelled";
  return "idle";
};

export const normalizeAgentSessionSnapshot = (
  snapshot: AgentSessionSnapshot
): AgentSessionSnapshot => {
  const turnStatus = normalizeAgentTurnStatus(snapshot.turnStatus);
  const running = turnStatus === "running";
  return {
    ...snapshot,
    todos: snapshot.projectTodo?.todos ?? snapshot.todos,
    turnStatus,
    activeTurnId: running ? snapshot.activeTurnId ?? null : null,
    follow: {
      running: running ? snapshot.follow.running : false,
      activity: running ? snapshot.follow.activity ?? null : null
    }
  };
};

export const mergeRunningSessionSnapshot = (
  current: AgentSessionSnapshot,
  incoming: AgentSessionSnapshot
): AgentSessionSnapshot => {
  const normalizedIncoming = normalizeAgentSessionSnapshot(incoming);
  if (current.id !== normalizedIncoming.id) return normalizedIncoming;

  const incomingById = new Map(normalizedIncoming.messages.map((message) => [message.id, message]));
  const mergedMessages: AgentMessage[] = [];
  const seen = new Set<string>();

  for (const message of current.messages) {
    const replacement = incomingById.get(message.id);
    mergedMessages.push(
      replacement === undefined ? message : chooseRicherMessage(message, replacement)
    );
    seen.add(message.id);
  }
  for (const message of normalizedIncoming.messages) {
    if (!seen.has(message.id)) {
      mergedMessages.push(message);
      seen.add(message.id);
    }
  }

  const toolsById = new Map(current.tools.map((tool) => [tool.id, tool]));
  for (const tool of normalizedIncoming.tools) {
    const existing = toolsById.get(tool.id);
    toolsById.set(
      tool.id,
      existing === undefined ? tool : mergeToolActivity(existing, tool)
    );
  }

  return {
    ...normalizedIncoming,
    messages: mergedMessages,
    tools: [...toolsById.values()]
  };
};

const upsertTool = (
  tools: readonly AgentToolActivity[],
  tool: AgentToolActivity
): readonly AgentToolActivity[] => {
  const existing = tools.find((candidate) => candidate.id === tool.id);
  const nextTool = existing === undefined ? tool : mergeToolActivity(existing, tool);
  return [
    ...tools.filter((candidate) => candidate.id !== tool.id),
    nextTool
  ];
};

const appendTextDeltaToBlocks = (
  blocks: readonly AgentMessageBlock[] | undefined,
  blockId: string | null | undefined,
  delta: string,
  replace = false,
  fallbackText = ""
): readonly AgentMessageBlock[] => {
  const currentBlocks = [...(blocks ?? [])];
  if (currentBlocks.length === 0) {
    return [
      {
        type: "text",
        id: blockId ?? "text-0",
        text: replace ? delta : `${fallbackText}${delta}`
      }
    ];
  }
  const lastBlock = currentBlocks[currentBlocks.length - 1];
  const targetBlockId = blockId ?? (lastBlock?.type === "text" ? lastBlock.id : undefined);

  if (targetBlockId !== undefined) {
    let found = false;
    const nextBlocks = currentBlocks.map((block) => {
      if (block.type !== "text" || block.id !== targetBlockId) return block;
      found = true;
      return {
        ...block,
        text: replace ? delta : `${block.text}${delta}`
      };
    });
    if (found) return nextBlocks;
  }

  return [
    ...currentBlocks,
    {
      type: "text",
      id: targetBlockId ?? `text-${currentBlocks.length}`,
      text: delta
    }
  ];
};

const ensureExistingTextBlock = (
  blocks: readonly AgentMessageBlock[] | undefined,
  text: string
): readonly AgentMessageBlock[] => {
  const currentBlocks = [...(blocks ?? [])];
  if (text.length === 0) return currentBlocks;
  if (currentBlocks.some((block) => block.type === "text" && block.text.length > 0)) {
    return currentBlocks;
  }
  const firstBlock = currentBlocks[0];
  if (firstBlock?.type === "text") {
    return [
      { ...firstBlock, text },
      ...currentBlocks.slice(1)
    ];
  }
  return [
    { type: "text", id: "text-0", text },
    ...currentBlocks
  ];
};

const appendReasoningDeltaToBlocks = (
  blocks: readonly AgentMessageBlock[] | undefined,
  blockId: string | null | undefined,
  delta: string,
  fallbackText = ""
): readonly AgentMessageBlock[] => {
  const currentBlocks = [...ensureExistingTextBlock(blocks, fallbackText)];
  const lastBlock = currentBlocks[currentBlocks.length - 1];
  const targetBlockId = blockId ?? (lastBlock?.type === "thinking" ? lastBlock.id : undefined);
  if (targetBlockId !== undefined) {
    let found = false;
    const nextBlocks = currentBlocks.map((block) => {
      if (block.type !== "thinking" || block.id !== targetBlockId) return block;
      found = true;
      return {
        ...block,
        text: `${block.text}${delta}`,
        status: "thinking" as const
      };
    });
    if (found) return nextBlocks;
  }
  return [
    ...currentBlocks,
    {
      type: "thinking",
      id: targetBlockId ?? `thinking-${currentBlocks.length}`,
      text: delta,
      status: "thinking"
    }
  ];
};

type LegacyAgentToolBlock = Extract<AgentMessageBlock, { type: "tool" }> & {
  readonly tool_id?: string;
};

type AgentSnapshotMessage = AgentSessionSnapshot["messages"][number];

const toolIdForBlock = (block: AgentMessageBlock): string | null => {
  if (block.type !== "tool") return null;
  return block.toolId ?? (block as LegacyAgentToolBlock).tool_id ?? null;
};

const lastAssistantMessageId = (
  messages: AgentSessionSnapshot["messages"]
): string | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant") {
      return message.id;
    }
  }
  return null;
};

const appendToolBlockToMessage = (
  blocks: readonly AgentMessageBlock[] | undefined,
  toolId: string,
  fallbackText = ""
): readonly AgentMessageBlock[] => {
  const currentBlocks = [...ensureExistingTextBlock(blocks, fallbackText)];
  if (currentBlocks.some((block) => block.type === "tool" && toolIdForBlock(block) === toolId)) {
    return currentBlocks;
  }
  return [
    ...currentBlocks,
    {
      type: "tool",
      id: `tool-${toolId}`,
      toolId
    }
  ];
};

const messageHasToolBlock = (
  message: AgentSnapshotMessage,
  toolId: string
): boolean =>
  (message.blocks ?? []).some((block) =>
    block.type === "tool" && toolIdForBlock(block) === toolId
  );

const toolLinkedMessageId = (
  messages: readonly AgentSnapshotMessage[],
  toolId: string
): string | null =>
  messages.find((message) => messageHasToolBlock(message, toolId))?.id ?? null;

const ensureToolBlockLinkedToMessage = (
  messages: readonly AgentSnapshotMessage[],
  messageId: string | null,
  toolId: string
): readonly AgentSnapshotMessage[] => {
  if (messageId === null || toolLinkedMessageId(messages, toolId) !== null) {
    return messages;
  }
  return messages.map((message) =>
    message.id === messageId
      ? {
          ...message,
          blocks: appendToolBlockToMessage(message.blocks, toolId, message.text)
        }
      : message
  );
};

const upsertMessagePreservingOrder = (
  messages: readonly AgentSnapshotMessage[],
  message: AgentSnapshotMessage
): readonly AgentSnapshotMessage[] => {
  const existingIndex = messages.findIndex((existing) => existing.id === message.id);
  if (existingIndex < 0) {
    return [...messages, message];
  }
  return messages.map((existing, index) => index === existingIndex ? message : existing);
};

export const applyAgentRuntimeEventToSnapshot = (
  session: AgentSessionSnapshot,
  event: AgentRuntimeEvent
): AgentSessionSnapshot => {
  if (event.kind === "sessionSnapshot") {
    if (event.snapshot.id !== session.id) return session;
    return mergeRunningSessionSnapshot(session, event.snapshot);
  }

  if ("sessionId" in event && event.sessionId !== session.id) {
    return session;
  }

  if (event.kind === "messageCommitted") {
    return {
      ...session,
      messages: upsertMessagePreservingOrder(session.messages, event.message),
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "messageDelta") {
    return {
      ...session,
      messages: session.messages.map((message) => {
        if (message.id !== event.messageId) {
          return message;
        }
        const blocks = appendTextDeltaToBlocks(
          message.blocks,
          event.blockId,
          event.delta,
          event.replace,
          message.text
        );
        return {
          ...message,
          text: event.replace === true ? event.delta : `${message.text}${event.delta}`,
          blocks
        };
      }),
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "messageReasoningDelta") {
    return {
      ...session,
      messages: session.messages.map((message) => {
        if (message.id !== event.messageId) return message;
        const blocks = appendReasoningDeltaToBlocks(
          message.blocks,
          event.blockId,
          event.delta,
          message.text
        );
        return {
          ...message,
          reasoningContent: `${message.reasoningContent ?? ""}${event.delta}`,
          reasoningStatus: "thinking",
          blocks
        };
      }),
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "toolStarted") {
    const targetMessageId = event.messageId ?? lastAssistantMessageId(session.messages);
    return {
      ...session,
      messages: ensureToolBlockLinkedToMessage(
        session.messages,
        targetMessageId,
        event.tool.id
      ),
      tools: upsertTool(session.tools, event.tool),
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "toolFinished") {
    return {
      ...session,
      tools: upsertTool(session.tools, event.tool),
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "memoryUpdated") {
    return {
      ...session,
      memory: event.snapshot,
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "turnStarted" || event.kind === "turnStateChanged") {
    const state = event.state as string;
    const terminalTurnStates = ["completed", "cancelled_by_user", "cancelled", "interrupted"];
    const cancelledTurnStates = ["cancelled_by_user", "cancelled", "interrupted"];
    return {
      ...session,
      turnStatus: state === "completed"
        ? "idle"
        : cancelledTurnStates.includes(state)
            ? "cancelled"
            : "running",
      activeTurnId: terminalTurnStates.includes(state) ? null : event.turnId,
      follow: {
        running: !terminalTurnStates.includes(state),
        activity: terminalTurnStates.includes(state) ? null : event.state
      },
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "toolUpdated") {
    const targetMessageId = event.tool.status === "running"
      ? lastAssistantMessageId(session.messages)
      : null;
    return {
      ...session,
      messages: ensureToolBlockLinkedToMessage(
        session.messages,
        targetMessageId,
        event.tool.id
      ),
      tools: upsertTool(session.tools, event.tool),
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "todoUpdated") {
    return {
      ...session,
      todos: event.todos,
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "planUpdated" || event.kind === "planReviewRequested") {
    return {
      ...session,
      plan: event.plan,
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "planReviewResolved") {
    return {
      ...session,
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "projectTodoUpdated") {
    return {
      ...session,
      projectTodo: event.todo,
      todos: event.todo.todos,
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "followStateChanged") {
    const running = event.follow.running;
    return {
      ...session,
      follow: event.follow,
      turnStatus: running
        ? "running"
        : session.turnStatus === "cancelled"
          ? "cancelled"
          : "idle",
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "turnFinished") {
    return {
      ...session,
      turnStatus: event.status === "cancelled" ? "cancelled" : "idle",
      activeTurnId: null,
      follow: { running: false, activity: null },
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "turnCompleted") {
    return {
      ...session,
      turnStatus: "idle",
      activeTurnId: null,
      follow: { running: false, activity: null },
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "turnFailed") {
    return {
      ...session,
      turnStatus: "idle",
      activeTurnId: null,
      follow: { running: false, activity: null },
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "turnInterrupted") {
    return {
      ...session,
      turnStatus: "cancelled",
      activeTurnId: null,
      follow: { running: false, activity: null },
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "browserActivityChanged") {
    const currentMemory = session.memory ?? null;
    const nextTarget = asRecord(event.target);
    return {
      ...session,
      memory: currentMemory === null
        ? currentMemory
        : {
            ...currentMemory,
            activeBrowserTargets: [
              ...currentMemory.activeBrowserTargets.filter((target) => {
                const record = asRecord(target);
                return record.browserTargetId !== nextTarget.browserTargetId;
              }),
              nextTarget
            ]
          },
      follow: {
        running: true,
        activity: "browser"
      },
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "clarificationResolved") {
    const currentMemory = session.memory ?? null;
    return {
      ...session,
      memory: currentMemory === null
        ? currentMemory
        : {
            ...currentMemory,
            activeClarification: null
          },
      updatedAt: new Date().toISOString()
    };
  }

  return session;
};
