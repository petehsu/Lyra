import type {
  AgentMessage,
  AgentMessageBlock,
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
    toolsById.set(tool.id, tool);
  }

  return {
    ...incoming,
    messages: mergedMessages,
    tools: [...toolsById.values()]
  };
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const upsertTool = (
  tools: readonly AgentToolActivity[],
  tool: AgentToolActivity
): readonly AgentToolActivity[] => [
  ...tools.filter((existing) => existing.id !== tool.id),
  tool
];

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
      messages: session.messages.map((message) =>
        message.id === event.messageId
          ? {
              ...message,
              text: event.replace === true ? event.delta : `${message.text}${event.delta}`,
              blocks: appendTextDeltaToBlocks(
                message.blocks,
                event.blockId,
                event.delta,
                event.replace,
                message.text
              )
            }
          : message
      ),
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "toolStarted") {
    return {
      ...session,
      messages: event.messageId === undefined || event.messageId === null
        ? session.messages
        : session.messages.map((message) =>
            message.id === event.messageId
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
    return {
      ...session,
      turnStatus: ["completed"].includes(event.state)
        ? "finished"
        : ["failed_recoverable", "failed_terminal"].includes(event.state)
          ? "failed"
          : ["cancelled_by_user", "interrupted"].includes(event.state)
            ? "cancelled"
            : "running",
      activeTurnId: ["completed", "failed_terminal", "cancelled_by_user"].includes(event.state)
        ? null
        : event.turnId,
      follow: {
        running: !["completed", "failed_terminal", "cancelled_by_user"].includes(event.state),
        activity: event.state
      },
      updatedAt: new Date().toISOString()
    };
  }

  if (event.kind === "toolUpdated") {
    return {
      ...session,
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
