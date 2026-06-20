import type {
  AgentMessage,
  AgentMessageBlock,
  AgentRenderDocument,
  AgentRuntimeEvent,
  AgentSessionSnapshot,
  AgentToolActivity
} from "../../../shared/agent";

const messageRichness = (message: AgentMessage): number => {
  const blockCount = message.blocks?.length ?? 0;
  const textLength = message.text.length;
  return blockCount * 1_000 + textLength;
};

const chooseRicherMessage = (left: AgentMessage, right: AgentMessage): AgentMessage =>
  messageRichness(left) >= messageRichness(right) ? left : right;

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const toolActivityRichness = (tool: AgentToolActivity): number => {
  const output = asRecord(tool.output);
  const raw = asRecord(output.raw);
  const diff = typeof raw.diff === "string" ? raw.diff.length : 0;
  const content = typeof output.content === "string" ? output.content.length : 0;
  const running = tool.status === "running" ? 1_000_000 : 0;
  const preview = raw.preview === true ? 10_000 : 0;
  return running + preview + diff * 100 + Math.min(content, 5_000);
};

const chooseRicherTool = (left: AgentToolActivity, right: AgentToolActivity): AgentToolActivity =>
  toolActivityRichness(left) >= toolActivityRichness(right) ? left : right;

export const mergeRunningSessionSnapshot = (
  current: AgentSessionSnapshot,
  incoming: AgentSessionSnapshot
): AgentSessionSnapshot => {
  if (current.id !== incoming.id) return incoming;

  const incomingById = new Map(incoming.messages.map((message) => [message.id, message]));
  const mergedMessages: AgentMessage[] = [];
  const seen = new Set<string>();

  for (const message of current.messages) {
    const replacement = incomingById.get(message.id);
    mergedMessages.push(
      replacement === undefined ? message : chooseRicherMessage(message, replacement)
    );
    seen.add(message.id);
  }
  for (const message of incoming.messages) {
    if (!seen.has(message.id)) {
      mergedMessages.push(message);
      seen.add(message.id);
    }
  }

  const toolsById = new Map(current.tools.map((tool) => [tool.id, tool]));
  for (const tool of incoming.tools) {
    const existing = toolsById.get(tool.id);
    toolsById.set(
      tool.id,
      existing === undefined ? tool : chooseRicherTool(existing, tool)
    );
  }

  return {
    ...incoming,
    messages: mergedMessages,
    tools: [...toolsById.values()]
  };
};

const upsertTool = (
  tools: readonly AgentToolActivity[],
  tool: AgentToolActivity
): readonly AgentToolActivity[] => [
  ...tools.filter((existing) => existing.id !== tool.id),
  tool
];

const applyRenderToTextBlocks = (
  blocks: readonly AgentMessageBlock[],
  blockId: string | null | undefined,
  renderDocument: AgentRenderDocument | undefined,
  renderRevision: number | undefined
): readonly AgentMessageBlock[] => {
  if (renderDocument === undefined) {
    return blocks;
  }
  const targetBlockId = blockId ?? "text-0";
  return blocks.map((block) => {
    if (block.type !== "text" || block.id !== targetBlockId) {
      return block;
    }
    return {
      ...block,
      renderDocument,
      ...(renderRevision === undefined ? {} : { renderRevision })
    };
  });
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
  let lastTextBlockId: string | undefined;
  for (let index = currentBlocks.length - 1; index >= 0; index -= 1) {
    const block = currentBlocks[index];
    if (block?.type === "text") {
      lastTextBlockId = block.id;
      break;
    }
  }
  const targetBlockId = blockId ?? lastTextBlockId;

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

type LegacyAgentToolBlock = Extract<AgentMessageBlock, { type: "tool" }> & {
  readonly tool_id?: string;
};

const toolIdForBlock = (block: AgentMessageBlock): string | null => {
  if (block.type !== "tool") return null;
  return block.toolId ?? (block as LegacyAgentToolBlock).tool_id ?? null;
};

const lastAssistantMessageId = (
  messages: readonly AgentSessionSnapshot["messages"]
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
  toolId: string
): readonly AgentMessageBlock[] => {
  const currentBlocks = [...(blocks ?? [])];
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

export const applyAgentRuntimeEventToSnapshot = (
  session: AgentSessionSnapshot,
  event: AgentRuntimeEvent
): AgentSessionSnapshot => {
  if (event.kind === "sessionSnapshot") {
    if (event.snapshot.id !== session.id) return session;
    return session.turnStatus === "running"
      ? mergeRunningSessionSnapshot(session, event.snapshot)
      : event.snapshot;
  }

  if ("sessionId" in event && event.sessionId !== session.id) {
    return session;
  }

  if (event.kind === "messageCommitted") {
    return {
      ...session,
      messages: [
        ...session.messages.filter((message) => message.id !== event.message.id),
        event.message
      ],
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
        const blocks = applyRenderToTextBlocks(
          appendTextDeltaToBlocks(
            message.blocks,
            event.blockId,
            event.delta,
            event.replace,
            message.text
          ),
          event.blockId,
          event.renderDocument,
          event.renderRevision
        );
        return {
          ...message,
          text: event.replace === true ? event.delta : `${message.text}${event.delta}`,
          blocks,
          ...(event.renderDocument === undefined
            ? {}
            : { renderDocument: event.renderDocument }),
          ...(event.renderRevision === undefined
            ? {}
            : { renderRevision: event.renderRevision })
        };
      }),
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "toolStarted") {
    const targetMessageId = event.messageId ?? lastAssistantMessageId(session.messages);
    return {
      ...session,
      messages: targetMessageId === null
        ? session.messages
        : session.messages.map((message) =>
            message.id === targetMessageId
              ? {
                  ...message,
                  blocks: appendToolBlockToMessage(message.blocks, event.tool.id)
                }
              : message
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
    const terminalTurnStates = [
      "completed",
      "failed_terminal",
      "cancelled_by_user",
      "cancelled",
      "interrupted"
    ];
    const cancelledTurnStates = ["cancelled_by_user", "cancelled", "interrupted"];
    return {
      ...session,
      turnStatus: ["completed"].includes(event.state)
        ? "finished"
        : ["failed_recoverable", "failed_terminal"].includes(event.state)
          ? "failed"
          : cancelledTurnStates.includes(event.state)
            ? "cancelled"
            : "running",
      activeTurnId: terminalTurnStates.includes(event.state) ? null : event.turnId,
      follow: {
        running: !terminalTurnStates.includes(event.state),
        activity: event.state
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
      messages: targetMessageId === null || targetMessageId === undefined
        ? session.messages
        : session.messages.map((message) =>
            message.id === targetMessageId
              ? {
                  ...message,
                  blocks: appendToolBlockToMessage(message.blocks, event.tool.id)
                }
              : message
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

  if (event.kind === "followStateChanged") {
    return {
      ...session,
      follow: event.follow,
      turnStatus: event.follow.running ? "running" : session.turnStatus,
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "turnFinished") {
    return {
      ...session,
      turnStatus: event.status,
      activeTurnId: null,
      follow: { running: false, activity: null },
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "turnCompleted") {
    return {
      ...session,
      turnStatus: "finished",
      activeTurnId: null,
      follow: { running: false, activity: null },
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "turnFailed") {
    return {
      ...session,
      turnStatus: "failed",
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
