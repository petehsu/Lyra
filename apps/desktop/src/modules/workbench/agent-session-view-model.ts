import type {
  AgentMessageBlock,
  AgentSidePanelSnapshot,
  AgentRuntimeEvent,
  AgentSessionSnapshot,
  AgentToolActivity,
  JcodeModelsListResponse
} from "../../shared/agent";
import type {
  ChatMessage,
  ModelOption,
  SessionMeta,
  AgentSidePanel,
  MessageBlock,
  TodoItem,
  ToolCall,
  ToolDetails,
  ToolGroup
} from "./ai-panel/agent-chat-demo/core/types";
import { formatMessage, t } from "./ai-panel/agent-chat-demo/core/i18n";

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
    return event.snapshot.id === session.id ? event.snapshot : session;
  }

  if ("sessionId" in event && event.sessionId !== session.id) {
    return session;
  }

  if (event.kind === "messageAppended") {
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

  if (event.kind === "turnFailed") {
    return {
      ...session,
      turnStatus: "failed",
      activeTurnId: null,
      follow: { running: false, activity: null },
      updatedAt: new Date().toISOString()
    };
  }

  return session;
};

const toolKind = (tool: AgentToolActivity): ToolCall["kind"] => {
  if (
    tool.name === "ls" ||
    tool.name.includes("read") ||
    tool.name.includes("open")
  ) return "read";
  if (
    tool.name.includes("search") ||
    tool.name.includes("grep") ||
    tool.name.includes("glob")
  ) return "search";
  if (
    tool.name.includes("bash") ||
    tool.name.includes("shell") ||
    tool.name.includes("command")
  ) return "shell";
  if (
    tool.name.includes("patch") ||
    tool.name.includes("edit") ||
    tool.name.includes("write")
  ) return "edit";
  if (tool.name.includes("web")) return "web";
  if (tool.name.includes("todo")) return "task";
  return "thought";
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const stringField = (
  value: Record<string, unknown>,
  ...keys: readonly string[]
): string | undefined => {
  for (const key of keys) {
    const field = value[key];
    if (typeof field === "string" && field.trim().length > 0) return field;
  }
  return undefined;
};

const asArray = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value : [];

const parseJsonMaybe = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
};

const toolOutputText = (tool: AgentToolActivity): string => {
  const output = asRecord(tool.output);
  const content = output.content;
  if (typeof content === "string") return content;
  if (tool.output !== undefined) return JSON.stringify(tool.output, null, 2);
  return JSON.stringify(tool.input, null, 2);
};

const toToolDetails = (
  tool: AgentToolActivity,
  kind: ToolCall["kind"]
): ToolDetails => {
  const input = asRecord(tool.input);
  const output = toolOutputText(tool);
  if (kind === "read") {
    return {
      type: "read",
      file:
        stringField(input, "file_path", "filePath", "path", "target") ??
        tool.name,
      ...(output.trim().length === 0 ? {} : { preview: output })
    };
  }
  if (kind === "shell") {
    return {
      type: "shell",
      command: stringField(input, "command", "cmd") ?? tool.name,
      output,
      exitCode: asRecord(tool.output).error ? 1 : 0
    };
  }
  if (kind === "web") {
    return {
      type: "web",
      url: stringField(input, "url", "href") ?? tool.name,
      ...(output.trim().length === 0 ? {} : { summary: output })
    };
  }
  return {
    type: "text",
    body: output
  };
};

const toolStatus = (tool: AgentToolActivity): ToolCall["status"] => {
  if (tool.status === "running") return "running";
  if (tool.status === "failed") return "error";
  return "success";
};

const toToolCall = (tool: AgentToolActivity): ToolCall => {
  const kind = toolKind(tool);
  return {
    id: tool.id,
    kind,
    title: tool.label,
    status: toolStatus(tool),
    details: toToolDetails(tool, kind)
  };
};

const toToolGroup = (
  tools: readonly AgentToolActivity[],
  id = "lyra-agent-tools"
): ToolGroup | null => {
  if (tools.length === 0) return null;
  const running = tools.find((tool) => tool.status === "running");
  return {
    id,
    status: running === undefined ? "done" : "running",
    label: running?.label ?? t("tool.agentActivity"),
    hint: running === undefined
      ? formatMessage("tool.events", { count: tools.length })
      : t("tool.running"),
    ...(running === undefined ? {} : { currentCallId: running.id }),
    calls: tools.map(toToolCall)
  };
};

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

const messageBody = (
  session: AgentSessionSnapshot,
  message: AgentSessionSnapshot["messages"][number],
  index: number
): string => {
  if (message.text.length > 0) return message.text;
  const isLastAssistant = message.role === "assistant" && index === session.messages.length - 1;
  return isLastAssistant && session.turnStatus === "running" ? "" : t("msg.noResponseText");
};

const sameMessageInstant = (left: string | undefined, right: string | undefined): boolean => {
  if (left === undefined || right === undefined) return false;
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) return left === right;
  return leftTime === rightTime;
};

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
  tools: readonly AgentToolActivity[],
  toolsById: ReadonlyMap<string, AgentToolActivity>,
  referencedToolIds: Set<string>
): MessageBlock[] => {
  const sourceBlocks = message.blocks ?? [];
  if (sourceBlocks.length === 0) {
    const legacyTimestampTools =
      message.role === "assistant" && message.text.trim().length === 0
        ? tools.filter((tool) =>
            !referencedToolIds.has(tool.id) &&
            sameMessageInstant(tool.startedAt, message.createdAt)
          )
        : [];
    const legacyGroup = toToolGroup(
      legacyTimestampTools,
      `${message.id}-legacy-tools`
    );
    if (legacyGroup !== null) {
      legacyTimestampTools.forEach((tool) => referencedToolIds.add(tool.id));
      return [
        {
          type: "tools",
          id: `${legacyGroup.id}-block`,
          group: legacyGroup
        }
      ];
    }
    if (
      message.role === "assistant" &&
      message.text.trim().length === 0 &&
      !(index === session.messages.length - 1 && session.turnStatus === "running")
    ) {
      return [];
    }
    return [
      {
        type: "text",
        id: `${message.id}-text`,
        body: messageBody(session, message, index)
      }
    ];
  }

  const chatBlocks: MessageBlock[] = [];
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
      flushTools();
      if (block.text.trim().length > 0) {
        chatBlocks.push({
          type: "text",
          id: `${message.id}-${block.id}`,
          body: block.text
        });
      }
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
  return [
    {
      type: "text",
      id: `${message.id}-text`,
      body: messageBody(session, message, index)
    }
  ];
};

export const agentSessionToChatMessages = (
  session: AgentSessionSnapshot | null,
  options: { readonly failedTurnMessage?: string | null } = {}
): ChatMessage[] => {
  if (session === null) return [];
  const toolsById = new Map(session.tools.map((tool) => [tool.id, tool]));
  const referencedToolIds = new Set<string>();
  const messages: ChatMessage[] = session.messages.map<ChatMessage>((message, index) => {
    const formattedTime = formatAgentMessageTime(message.createdAt);
    return {
      id: message.id,
      author: message.role === "user" ? "user" : "agent",
      ...(formattedTime === undefined ? {} : { time: formattedTime }),
      ...(message.rollback === undefined || message.rollback === null
        ? {}
        : { rollback: message.rollback }),
      blocks: chatBlocksForAgentMessage(
        session,
        message,
        index,
        session.tools,
        toolsById,
        referencedToolIds
      )
    };
  }).filter((message) => message.blocks.length > 0);
  const lastMessage = session.messages.at(-1);
  if (session.turnStatus === "failed" && lastMessage?.role === "user") {
    const errorDetail = options.failedTurnMessage?.trim();
    const formattedTime = formatAgentMessageTime(session.updatedAt);
    messages.push({
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
    });
  }
  const orphanTools = session.tools.filter((tool) => !referencedToolIds.has(tool.id));
  const group = toToolGroup(orphanTools);
  if (group !== null) {
    messages.push({
      id: "lyra-agent-tool-message",
      author: "agent",
      blocks: [
        {
          type: "tools",
          id: "lyra-agent-tools-block",
          group
        }
      ]
    });
  }
  if (
    session.follow.running &&
    (lastMessage === undefined || lastMessage.role !== "assistant")
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
  return messages;
};

export const agentSessionToSessionMeta = (
  session: AgentSessionSnapshot | null
): SessionMeta => {
  const workingDir = normalizeSessionWorkingDir(session?.workingDir);
  const projectBound = session?.projectBound ?? false;
  return {
    title: session?.title ?? "Lyra Agent",
    project: projectBound ? projectNameFromWorkingDir(workingDir) : "",
    workingDir,
    projectBound,
    automation: session?.automation ?? null,
    totalAdditions: 0,
    totalDeletions: 0
  };
};

export const agentSessionToSidePanel = (
  session: AgentSessionSnapshot | null
): AgentSidePanel | null => {
  if (session?.sidePanel === undefined || session.sidePanel.pages.length === 0) {
    return null;
  }
  return sidePanelSnapshotToViewModel(session.sidePanel);
};

const sidePanelSnapshotToViewModel = (
  snapshot: AgentSidePanelSnapshot
): AgentSidePanel => ({
  focusedPageId: snapshot.focusedPageId ?? null,
  pages: snapshot.pages.map((page) => ({
    id: page.id,
    title: page.title,
    content: page.content,
    updatedAtMs: page.updatedAtMs
  }))
});

const normalizeSessionWorkingDir = (value: string | null | undefined): string | null => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length === 0 ? null : trimmed;
};

const projectNameFromWorkingDir = (workingDir: string | null): string => {
  if (workingDir === null) return "";
  const segments = workingDir.split(/[\\/]+/).filter(Boolean);
  return segments.at(-1) ?? workingDir;
};

const todoStatus = (raw: unknown): TodoItem["status"] => {
  if (typeof raw !== "string") return "pending";
  const value = raw.trim().toLowerCase();
  if (["completed", "complete", "done", "success", "succeeded"].includes(value)) return "done";
  if (["in_progress", "running", "active", "current", "working"].includes(value)) return "running";
  return "pending";
};

const todoTitle = (value: Record<string, unknown>, fallback: string): string =>
  stringField(value, "title", "text", "task", "content", "description", "label") ?? fallback;

const extractTodosFromUnknown = (value: unknown, sourceId: string): TodoItem[] => {
  const parsed = parseJsonMaybe(value);
  if (Array.isArray(parsed)) {
    return parsed
      .map((item, index) => {
        const record = asRecord(item);
        const title = todoTitle(record, formatMessage("todo.fallback", { index: index + 1 }));
        return {
          id: stringField(record, "id") ?? `${sourceId}-${index}`,
          title,
          status: todoStatus(record.status ?? record.state)
        };
      })
      .filter((todo) => todo.title.trim().length > 0);
  }

  const record = asRecord(parsed);
  for (const key of ["todos", "tasks", "items", "plan"]) {
    const nested = record[key];
    if (Array.isArray(nested)) {
      return extractTodosFromUnknown(nested, sourceId);
    }
  }
  const content = record.content;
  if (typeof content === "string" && content !== value) {
    return extractTodosFromUnknown(content, sourceId);
  }
  return [];
};

export const agentSessionToTodos = (
  session: AgentSessionSnapshot | null
): TodoItem[] => {
  if (session === null) return [];
  const todos = new Map<string, TodoItem>();
  for (const tool of session.tools) {
    if (!tool.name.toLowerCase().includes("todo") && !tool.label.toLowerCase().includes("todo")) {
      const outputRecord = asRecord(tool.output);
      const content = outputRecord.content;
      const inputCandidates = asArray(asRecord(tool.input).todos);
      if (inputCandidates.length === 0 && typeof content !== "string") continue;
    }
    for (const todo of [
      ...extractTodosFromUnknown(tool.input, `${tool.id}-input`),
      ...extractTodosFromUnknown(tool.output, `${tool.id}-output`)
    ]) {
      todos.set(todo.id, todo);
    }
  }
  return [...todos.values()];
};

export const jcodeModelsToModelOptions = (
  state: JcodeModelsListResponse | null
): ModelOption[] =>
  (state?.models ?? [])
    .filter((model) =>
      model.available &&
      (
        (model.provider ?? "").trim().length > 0 ||
        (model.providerKey ?? "").trim().length > 0 ||
        (model.apiMethod ?? "").trim().length > 0
      )
    )
    .map((model) => ({
      id: model.id,
      label: model.label,
      model: model.model,
      provider: model.provider ?? model.providerKey ?? null,
      detail: model.detail ?? model.apiMethod ?? null,
      available: model.available
    }));
