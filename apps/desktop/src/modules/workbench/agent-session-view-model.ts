import type {
  AgentMemorySnapshot,
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
  ToolGroup,
  ToolPeek,
  WebResult,
  WorkbenchTabSummary
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

  if (event.kind === "memorySnapshot") {
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

  if (event.kind === "browserTargetUpdated") {
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

const toolKind = (tool: AgentToolActivity): ToolCall["kind"] => {
  const toolName = tool.name.toLowerCase();
  const input = toolInputRecord(tool);
  const action = stringField(input, "action");
  if (
    toolName === "workbench" ||
    toolName.startsWith("workbench.") ||
    toolName.startsWith("workbench_") ||
    action === "list_tabs" ||
    action === "read_tab" ||
    action === "read_workspace" ||
    action === "extract_tab_text"
  ) return "workbench";
  if (
    toolName === "websearch" ||
    toolName === "webfetch" ||
    toolName === "web_search" ||
    toolName === "web_fetch" ||
    toolName.startsWith("web.") ||
    toolName.startsWith("web_") ||
    toolName.startsWith("web-") ||
    toolName.includes("websearch") ||
    toolName.includes("webfetch") ||
    toolName.includes("web_search") ||
    toolName.includes("web_fetch")
  ) return "web";
  if (toolName === "lyra_lumen") return "web";
  if (
    toolName === "ls" ||
    toolName.includes("read") ||
    toolName.includes("open")
  ) return "read";
  if (
    toolName.includes("search") ||
    toolName.includes("grep") ||
    toolName.includes("glob")
  ) return "search";
  if (
    toolName.includes("bash") ||
    toolName.includes("shell") ||
    toolName.includes("command")
  ) return "shell";
  if (
    toolName.includes("patch") ||
    toolName.includes("edit") ||
    toolName.includes("write")
  ) return "edit";
  if (toolName.includes("todo")) return "task";
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

const parseJsonRecord = (value: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return asRecord(parsed);
  } catch {
    return null;
  }
};

const toolInputRecord = (tool: AgentToolActivity): Record<string, unknown> => {
  const input = asRecord(tool.input);
  const delta = stringField(input, "delta");
  if (delta !== undefined) {
    return parseJsonRecord(delta) ?? input;
  }
  return input;
};

const toolOutputText = (tool: AgentToolActivity): string => {
  const output = asRecord(tool.output);
  const content = output.content;
  if (typeof content === "string") return content;
  if (tool.output !== undefined) return JSON.stringify(tool.output, null, 2);
  return JSON.stringify(tool.input, null, 2);
};

type ParsedWebSearchOutput = {
  readonly query: string;
  readonly results: WebResult[];
};

type ParsedWebFetchOutput = {
  readonly url: string;
  readonly fetchedBytes: number;
  readonly title?: string;
  readonly preview?: string;
};

type ParsedWorkbenchDetails = Extract<ToolDetails, { type: "workbench" }>;
type ParsedLumenDetails = Extract<ToolDetails, { type: "lumen" }>;

type ParsedLumenElement = {
  readonly id: string;
  readonly role: string;
  readonly label: string;
};

const WEB_SEARCH_HEADER = "Search results for:";
const WEB_SEARCH_RESULT_HEADING = /^\s*\d+\.\s+\*\*(.+?)\*\*\s*$/u;
const WEB_FETCH_HEADER = /^Fetched\s+(https?:\/\/\S+)\s+\((\d+)\s+bytes\)\n\n([\s\S]*)$/u;
const LUMEN_ACTIONS = new Set([
  "map",
  "focus_scan",
  "act",
  "type",
  "press",
  "submit",
  "navigate",
  "read",
  "see",
  "wait"
]);
const LUMEN_OBSERVATION_HEADER =
  /^Observation\s+(\S+)\s+\(([^)]+)\)\s+for\s+(.+?)(?:\s+-\s+(https?:\/\/\S+))?$/u;
const LUMEN_ELEMENT_ROW =
  /^\[(.+?)\]\s+([^:]+):\s+"([^"]*)"(?:\s+\[[^\]]+\])?\s+at\s+\(([-\d]+),([-\d]+)\)\s+(\d+)x(\d+)$/u;
const LUMEN_FOCUS_LINE = /^Focus\s+([^;]+);\s+active element:\s+(.+)$/u;
const LUMEN_FOCUSED_LINE = /^Focused\s+([^:]+):\s+"([^"]*)"$/u;
const LUMEN_TRAIL_LINE = /^\s+\d+\.\s+\[(.+?)\]\s+(.+)$/u;

const isHttpUrl = (value: string): boolean =>
  value.startsWith("https://") || value.startsWith("http://");

const isLyraLumenTool = (tool: AgentToolActivity): boolean =>
  tool.name.toLowerCase() === "lyra_lumen";

const compactText = (value: string): string =>
  value.replace(/\s+/gu, " ").trim();

const truncateText = (value: string, maxLength: number): string => {
  const compact = compactText(value);
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
};

const urlHost = (url: string | undefined): string | undefined => {
  if (url === undefined) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
};

const normalizeLumenAction = (value: string | undefined): string => {
  if (value === undefined) return "browser";
  const normalized = value.trim();
  if (normalized === "focusScan") return "focus_scan";
  return normalized.length === 0 ? "browser" : normalized;
};

const lumenTargetMode = (input: Record<string, unknown>): string =>
  stringField(input, "target", "targetMode") === "live" ? "live" : "isolated";

const lumenElementLabel = (input: Record<string, unknown>): string | undefined => {
  const elementId = input.element_id ?? input.elementId;
  if (typeof elementId === "string" && elementId.trim().length > 0) {
    return `element ${elementId.trim()}`;
  }
  if (typeof elementId === "number" && Number.isFinite(elementId)) {
    return `element ${Math.round(elementId)}`;
  }
  return undefined;
};

const lumenPointLabel = (input: Record<string, unknown>): string | undefined => {
  const point = asRecord(input.point);
  const x = typeof point.x === "number" ? point.x : Number.NaN;
  const y = typeof point.y === "number" ? point.y : Number.NaN;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return `point ${Math.round(x)},${Math.round(y)}`;
};

const parseLumenMapOutput = (output: string): {
  readonly observationId?: string;
  readonly strategy?: string;
  readonly title?: string;
  readonly url?: string;
  readonly elements: readonly ParsedLumenElement[];
} => {
  const [firstLine = "", ...rest] = output.trim().split(/\r?\n/u);
  const match = firstLine.match(LUMEN_OBSERVATION_HEADER);
  const elements = rest
    .map((line) => line.match(LUMEN_ELEMENT_ROW))
    .filter((item): item is RegExpMatchArray => item !== null)
    .map((item) => ({
      id: item[1] ?? "?",
      role: (item[2] ?? "element").trim(),
      label: (item[3] ?? "").trim()
    }));

  return {
    ...(match?.[1] === undefined ? {} : { observationId: match[1] }),
    ...(match?.[2] === undefined ? {} : { strategy: match[2] }),
    ...(match?.[3] === undefined ? {} : { title: match[3] }),
    ...(match?.[4] === undefined ? {} : { url: match[4] }),
    elements
  };
};

const parseLumenFocusOutput = (output: string): {
  readonly direction?: string;
  readonly activeElementId?: string;
  readonly focused?: string;
  readonly trail: readonly string[];
} => {
  const lines = output.trim().split(/\r?\n/u);
  const focusMatch = (lines[0] ?? "").match(LUMEN_FOCUS_LINE);
  const focusedMatch = lines
    .map((line) => line.match(LUMEN_FOCUSED_LINE))
    .find((item): item is RegExpMatchArray => item !== null);
  const trail = lines
    .map((line) => line.match(LUMEN_TRAIL_LINE))
    .filter((item): item is RegExpMatchArray => item !== null)
    .map((item) => item[2]?.trim() ?? "")
    .filter((label) => label.length > 0);

  return {
    ...(focusMatch?.[1] === undefined ? {} : { direction: focusMatch[1] }),
    ...(focusMatch?.[2] === undefined ? {} : { activeElementId: focusMatch[2] }),
    ...(focusedMatch === undefined
      ? {}
      : { focused: `${focusedMatch[1] ?? "element"}: ${focusedMatch[2] ?? ""}` }),
    trail
  };
};

const lumenTitle = (tool: AgentToolActivity): string => {
  const input = toolInputRecord(tool);
  const action = normalizeLumenAction(stringField(input, "action"));
  switch (action) {
    case "map":
      return "Mapped browser elements";
    case "focus_scan":
      return "Scanned browser focus";
    case "act": {
      const interaction = stringField(input, "interaction") ?? "click";
      return `${interaction.replace(/_/gu, " ")} browser element`;
    }
    case "type":
      return "Typed in browser";
    case "press":
      return "Pressed browser key";
    case "submit":
      return "Submitted browser control";
    case "navigate":
      return "Navigated browser";
    case "read":
      return "Read browser text";
    case "see":
      return "Captured browser snapshot";
    case "wait":
      return "Waited in browser";
    default:
      return "Lyra Lumen";
  }
};

const toLumenDetails = (
  tool: AgentToolActivity,
  output: string,
  screenshot: string | undefined
): ParsedLumenDetails => {
  const input = toolInputRecord(tool);
  const action = normalizeLumenAction(stringField(input, "action"));
  const targetMode = lumenTargetMode(input);
  const chips = [targetMode];
  let excerpt: string | undefined;

  if (action === "map") {
    const parsed = parseLumenMapOutput(output);
    if (parsed.strategy !== undefined) chips.push(parsed.strategy);
    chips.push(`${parsed.elements.length} elements`);
    const host = urlHost(parsed.url);
    if (host !== undefined) chips.push(host);
    const labels = parsed.elements
      .map((element) => `${element.id} ${element.role} ${element.label}`)
      .filter((label) => label.trim().length > 0)
      .slice(0, 2);
    excerpt = labels.length > 0
      ? truncateText(labels.join(" / "), 120)
      : truncateText(parsed.title ?? output, 120);
  } else if (action === "focus_scan") {
    const parsed = parseLumenFocusOutput(output);
    chips.push(`${parsed.trail.length} tab stops`);
    if (parsed.activeElementId !== undefined) chips.push(`active ${parsed.activeElementId}`);
    excerpt = truncateText(parsed.focused ?? parsed.trail.slice(0, 2).join(" / ") ?? output, 120);
  } else if (action === "read") {
    const strategy = stringField(input, "strategy") ?? "focus";
    chips.push(strategy === "domFallback" ? "dom fallback" : "focus read");
    if (output.trim().length > 0) chips.push(`${output.length} chars`);
    excerpt = output.trim().length === 0 ? undefined : truncateText(output, 140);
  } else if (action === "see") {
    chips.push("visual fallback");
    excerpt = output.trim().length === 0 ? undefined : truncateText(output, 120);
  } else if (action === "type") {
    const text = stringField(input, "text") ?? "";
    chips.push(`${text.length} chars`);
    chips.push(lumenElementLabel(input) ?? "focused element");
    chips.push("chromium keyboard");
    excerpt = output.trim().length === 0 ? undefined : truncateText(output, 120);
  } else if (action === "act") {
    chips.push((stringField(input, "interaction") ?? "click").replace(/_/gu, " "));
    const target = lumenElementLabel(input) ?? lumenPointLabel(input);
    if (target !== undefined) chips.push(target);
    chips.push("chromium mouse");
    excerpt = output.trim().length === 0 ? undefined : truncateText(output, 120);
  } else if (action === "press" || action === "submit") {
    chips.push(stringField(input, "key") ?? (action === "submit" ? "Enter" : "key"));
    chips.push(lumenElementLabel(input) ?? "focused element");
    chips.push("chromium keyboard");
    excerpt = output.trim().length === 0 ? undefined : truncateText(output, 120);
  } else if (action === "navigate") {
    const url = stringField(input, "url");
    const host = urlHost(url);
    if (host !== undefined) chips.push(host);
    excerpt = truncateText(url ?? output, 120);
  } else if (action === "wait") {
    const timeout = input.timeout_ms ?? input.timeoutMs;
    if (typeof timeout === "number" && Number.isFinite(timeout)) {
      chips.push(`${Math.round(timeout)}ms`);
    }
    excerpt = output.trim().length === 0 ? undefined : truncateText(output, 120);
  } else if (LUMEN_ACTIONS.has(action)) {
    excerpt = output.trim().length === 0 ? undefined : truncateText(output, 120);
  }

  const peek: ToolPeek = {
    chips: [...new Set(chips.filter((chip) => chip.trim().length > 0))],
    ...(excerpt === undefined ? {} : { excerpt }),
    ...(screenshot === undefined
      ? {}
      : { thumbnail: { src: screenshot, alt: "Lyra Lumen snapshot" } })
  };

  return {
    type: "lumen",
    action,
    targetMode,
    peek,
    ...(output.trim().length === 0 ? {} : { text: output }),
    ...(screenshot === undefined ? {} : { screenshot })
  };
};

const parseWebSearchOutput = (output: string): ParsedWebSearchOutput | null => {
  const text = output.trim();
  if (!text.startsWith(WEB_SEARCH_HEADER)) return null;

  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  const query = lines[0]?.slice(WEB_SEARCH_HEADER.length).trim() ?? "";
  if (query.length === 0) return null;

  const results: WebResult[] = [];
  let index = 1;

  while (index < lines.length) {
    const heading = lines[index]?.trim() ?? "";
    const headingMatch = heading.match(WEB_SEARCH_RESULT_HEADING);
    if (headingMatch === null) {
      index += 1;
      continue;
    }

    const title = headingMatch[1]?.trim() ?? "";
    index += 1;
    while (index < lines.length && (lines[index]?.trim() ?? "").length === 0) {
      index += 1;
    }

    const url = lines[index]?.trim() ?? "";
    if (title.length === 0 || !isHttpUrl(url)) {
      continue;
    }
    index += 1;

    const snippetLines: string[] = [];
    while (index < lines.length) {
      const line = lines[index]?.trim() ?? "";
      if (line.match(WEB_SEARCH_RESULT_HEADING) !== null) break;
      if (line.length > 0) snippetLines.push(line);
      index += 1;
    }

    const snippet = snippetLines.join(" ").trim();
    results.push({
      title,
      url,
      ...(snippet.length === 0 ? {} : { snippet })
    });
  }

  return results.length === 0 ? null : { query, results };
};

const cleanFetchedContentLine = (line: string): string => {
  const trimmed = line.trim();
  return trimmed
    .replace(/^[-*]\s*/u, "")
    .replace(/^#{1,6}\s*/u, "")
    .trim();
};

const parseWebFetchOutput = (output: string): ParsedWebFetchOutput | null => {
  const match = output.trim().match(WEB_FETCH_HEADER);
  if (match === null) return null;

  const url = match[1] ?? "";
  const bytes = Number.parseInt(match[2] ?? "0", 10);
  const body = match[3] ?? "";
  const previewLines = body
    .split(/\r?\n/u)
    .map(cleanFetchedContentLine)
    .filter((line) => line.length > 0)
    .slice(0, 4);

  const title = previewLines[0];
  const preview = previewLines.slice(1).join("\n");

  return {
    url,
    fetchedBytes: Number.isFinite(bytes) ? bytes : 0,
    ...(title === undefined ? {} : { title }),
    ...(preview.length === 0 ? {} : { preview })
  };
};

const WORKBENCH_LIST_ROW =
  /^-\s+(.+?)\s+\[([^\]]+)\]\s+(.+?)\s+\(([^)]+)\)\s+flags=([^|]*?)(?:\s+\|\s*(.*))?$/u;
const WORKBENCH_TAB_HEADER = /^(.+?)\s+\[([^\]]+)\]\s+\(([^)]+)\)$/u;

const normalizeWorkbenchFlags = (flags: string | undefined): string[] => {
  if (flags === undefined) return [];
  return flags
    .split(",")
    .map((flag) => flag.trim())
    .filter((flag) => flag.length > 0 && flag !== "none");
};

const workbenchActionLabel = (action: string): string => {
  switch (action) {
    case "list_tabs":
      return "Workbench tabs";
    case "read_tab":
      return "Workbench tab";
    case "read_workspace":
      return "Workbench workspace";
    case "extract_tab_text":
      return "Workbench text";
    default:
      return "Workbench";
  }
};

const parseWorkbenchListOutput = (output: string): WorkbenchTabSummary[] | null => {
  const tabs = output
    .trim()
    .split(/\r?\n/u)
    .map((line) => line.match(WORKBENCH_LIST_ROW))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => {
      const url = (match[6] ?? "").trim();
      return {
        title: (match[1] ?? "Untitled").trim(),
        tabId: (match[2] ?? "-").trim(),
        kind: (match[3] ?? "tab").trim(),
        observationKind: (match[4] ?? "tab").trim(),
        flags: normalizeWorkbenchFlags(match[5]),
        ...(isHttpUrl(url) ? { url } : {})
      };
    });

  return tabs.length === 0 ? null : tabs;
};

const parseWorkbenchTabOutput = (output: string): WorkbenchTabSummary | null => {
  const normalized = output.trim();
  const [firstLine = "", ...restLines] = normalized.split(/\r?\n/u);
  const match = firstLine.match(WORKBENCH_TAB_HEADER);
  if (match === null) return null;
  const excerpt = restLines.join("\n").trim();
  return {
    title: (match[1] ?? "Untitled").trim(),
    tabId: (match[2] ?? "-").trim(),
    kind: (match[3] ?? "tab").trim(),
    flags: [],
    ...(excerpt.length === 0 ? {} : { excerpt })
  };
};

const parseWorkbenchWorkspaceOutput = (output: string): WorkbenchTabSummary[] | null => {
  const tabs = output
    .split(/\n\n---\n\n/u)
    .map(parseWorkbenchTabOutput)
    .filter((tab): tab is WorkbenchTabSummary => tab !== null);
  return tabs.length === 0 ? null : tabs;
};

const toWorkbenchDetails = (tool: AgentToolActivity, output: string): ParsedWorkbenchDetails => {
  const input = asRecord(tool.input);
  const action = stringField(input, "action") ?? "workbench";
  const label = workbenchActionLabel(action);

  if (action === "list_tabs") {
    const tabs = parseWorkbenchListOutput(output);
    return {
      type: "workbench",
      action,
      label,
      ...(tabs === null ? { text: output } : { tabs })
    };
  }

  if (action === "read_workspace") {
    const tabs = parseWorkbenchWorkspaceOutput(output);
    return {
      type: "workbench",
      action,
      label,
      ...(tabs === null ? { text: output } : { tabs })
    };
  }

  if (action === "read_tab") {
    const tab = parseWorkbenchTabOutput(output);
    return {
      type: "workbench",
      action,
      label,
      ...(tab === null
        ? { text: output }
        : {
            tab,
            ...(tab.excerpt === undefined ? {} : { excerpt: tab.excerpt })
          })
    };
  }

  return {
    type: "workbench",
    action,
    label,
    ...(output.trim().length === 0 ? {} : { text: output })
  };
};

const toToolDetails = (
  tool: AgentToolActivity,
  kind: ToolCall["kind"]
): ToolDetails => {
  const input = asRecord(tool.input);
  const output = toolOutputText(tool);
  const outputRecord = asRecord(tool.output);
  const screenshotObj = asRecord(outputRecord.screenshot);
  const screenshot = typeof screenshotObj.data === "string"
    ? `data:${screenshotObj.mediaType || "image/png"};base64,${screenshotObj.data}`
    : undefined;

  if (isLyraLumenTool(tool)) {
    return toLumenDetails(tool, output, screenshot);
  }
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
    const webSearch = parseWebSearchOutput(output);
    const webFetch = webSearch === null ? parseWebFetchOutput(output) : null;
    return {
      type: "web",
      url: stringField(input, "url", "href") ?? webSearch?.results[0]?.url ?? webFetch?.url ?? tool.name,
      ...(webSearch === null
        ? (webFetch === null
            ? (output.trim().length === 0 ? {} : { summary: output })
            : {
                fetchedBytes: webFetch.fetchedBytes,
                ...(webFetch.title === undefined ? {} : { title: webFetch.title }),
                ...(webFetch.preview === undefined ? {} : { summary: webFetch.preview })
              })
        : { query: webSearch.query, results: webSearch.results }),
      screenshot
    };
  }
  if (kind === "workbench") {
    return toWorkbenchDetails(tool, output);
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
  const details = toToolDetails(tool, kind);
  const title = isLyraLumenTool(tool)
    ? lumenTitle(tool)
    : kind === "workbench"
      ? workbenchActionLabel(stringField(toolInputRecord(tool), "action") ?? "workbench")
      : tool.label === "Ran" || tool.label.trim().length === 0 ? tool.name : tool.label;
  return {
    id: tool.id,
    kind,
    title,
    status: toolStatus(tool),
    details
  };
};

const toToolGroup = (
  tools: readonly AgentToolActivity[],
  id = "lyra-agent-tools"
): ToolGroup | null => {
  if (tools.length === 0) return null;
  const calls = tools.map(toToolCall);
  const running = tools.find((tool) => tool.status === "running");
  const runningCall = running === undefined
    ? undefined
    : calls.find((call) => call.id === running.id);
  return {
    id,
    status: running === undefined ? "done" : "running",
    label: runningCall?.title ?? running?.label ?? t("tool.agentActivity"),
    hint: running === undefined
      ? formatMessage("tool.events", { count: tools.length })
      : t("tool.running"),
    ...(running === undefined ? {} : { currentCallId: running.id }),
    calls
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

const sameMessageInstant = (left: string | undefined, right: string | undefined): boolean => {
  if (left === undefined || right === undefined) return false;
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) return left === right;
  return leftTime === rightTime;
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

const timelinePayload = (
  item: AgentMemorySnapshot["timelineProjection"][number]
): Record<string, unknown> => asRecord(item.payloadJson);

const textFromTimelinePayload = (
  item: AgentMemorySnapshot["timelineProjection"][number]
): string => {
  const text = timelinePayload(item).text;
  return typeof text === "string" ? text : "";
};

const turnStatusFromMemory = (memory: AgentMemorySnapshot): AgentSessionSnapshot["turnStatus"] => {
  const active = [...memory.runtimeTurns].reverse().find((turn) =>
    !["completed", "failed_terminal", "cancelled_by_user"].includes(turn.state)
  );
  if (active === undefined) return memory.status === "failed" ? "failed" : "idle";
  if (active.state === "interrupted") return "cancelled";
  if (active.state === "failed_recoverable" || active.state === "failed_terminal") return "failed";
  return "running";
};

const toolFromTimelineItem = (
  item: AgentMemorySnapshot["timelineProjection"][number]
): AgentToolActivity | null => {
  if (item.kind !== "tool_result" && item.kind !== "tool_call") return null;
  const payload = timelinePayload(item);
  const name = typeof payload.name === "string" ? payload.name : "tool";
  const statusRaw = typeof payload.status === "string" ? payload.status : "success";
  const status: AgentToolActivity["status"] =
    statusRaw === "running"
      ? "running"
      : statusRaw === "cancelled"
        ? "cancelled"
        : statusRaw.startsWith("failed") || statusRaw === "timed_out_partial"
          ? "failed"
          : "completed";
  const toolCallId = typeof payload.toolCallId === "string" ? payload.toolCallId : item.eventId;
  return {
    id: toolCallId,
    name,
    label: typeof payload.label === "string" ? payload.label : name,
    status,
    input: asRecord(payload.input),
    output: payload.output,
    startedAt: item.createdAtIso,
    ...(status === "running" ? {} : { finishedAt: item.createdAtIso })
  };
};

const messageFromTimelineItem = (
  item: AgentMemorySnapshot["timelineProjection"][number]
): AgentSessionSnapshot["messages"][number] | null => {
  if (item.role !== "user" && item.role !== "assistant") return null;
  const text = textFromTimelinePayload(item);
  return {
    id: item.eventId,
    role: item.role,
    text,
    blocks: text.trim().length === 0
      ? []
      : [{
          type: "text",
          id: `${item.eventId}-text`,
          text
        }],
    createdAt: item.createdAtIso,
    rollback: null
  };
};

const todoFromMemoryValue = (value: unknown, index: number): AgentSessionSnapshot["todos"][number] | null => {
  const record = asRecord(value);
  const content = stringField(record, "content", "title") ?? "";
  if (content.trim().length === 0) return null;
  return {
    id: stringField(record, "id") ?? `todo-${index}`,
    content,
    status: stringField(record, "status") ?? "pending",
    priority: stringField(record, "priority") ?? "normal",
    blockedBy: Array.isArray(record.blockedBy)
      ? record.blockedBy.filter((item): item is string => typeof item === "string")
      : []
  };
};

const sessionWithMemoryProjection = (
  session: AgentSessionSnapshot
): AgentSessionSnapshot => {
  const memory = session.memory;
  if (memory === undefined || memory === null || memory.timelineProjection.length === 0) {
    return session;
  }
  const messages = memory.timelineProjection
    .map(messageFromTimelineItem)
    .filter((message): message is AgentSessionSnapshot["messages"][number] => message !== null);
  const tools = memory.timelineProjection
    .map(toolFromTimelineItem)
    .filter((tool): tool is AgentToolActivity => tool !== null);
  const todos = memory.activeTodos
    .map(todoFromMemoryValue)
    .filter((todo): todo is AgentSessionSnapshot["todos"][number] => todo !== null);
  const activeTurn = [...memory.runtimeTurns].reverse().find((turn) =>
    !["completed", "failed_terminal", "cancelled_by_user"].includes(turn.state)
  );
  return {
    ...session,
    messages,
    tools: tools.length === 0 ? session.tools : tools,
    todos,
    turnStatus: turnStatusFromMemory(memory),
    activeTurnId: activeTurn?.runtimeTurnId ?? null,
    follow: {
      running: activeTurn !== undefined,
      activity: activeTurn?.state ?? null
    }
  };
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
  options: { readonly failedTurnMessage?: string | null } = {}
): ChatMessage[] => {
  if (session === null) return [];

  const sessionTools = latestToolActivities(session.tools);
  const toolsById = new Map(sessionTools.map((tool) => [tool.id, tool]));
  const referencedToolIds = new Set<string>();

  // 1. Map raw AgentMessages to ChatMessages
  const timedMessages = session.messages
    .map((message, index) => {
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
          index,
          sessionTools,
          toolsById,
          referencedToolIds
        )
      };
      return {
        message: chatMessage,
        atMs: timelineTimeMs(message.createdAt, index),
        sequence: index
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

  const orphanTools = sessionTools.filter((tool) => !referencedToolIds.has(tool.id));
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
    updatedAtMs: page.updatedAtMs,
    filePath: page.filePath,
    format: page.format,
    source: page.source
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
  if (["completed", "complete", "done", "success", "succeeded", "cancelled", "canceled"].includes(value)) return "done";
  if (["in_progress", "running", "active", "current", "working"].includes(value)) return "running";
  return "pending";
};

export const agentSessionToTodos = (
  session: AgentSessionSnapshot | null
): TodoItem[] => {
  if (session === null) return [];
  session = sessionWithMemoryProjection(session);
  return session.todos
    .map((todo, index) => ({
      id: todo.id,
      title: todo.content.trim().length > 0
        ? todo.content
        : formatMessage("todo.fallback", { index: index + 1 }),
      status: todoStatus(todo.status)
    }))
    .filter((todo) => todo.title.trim().length > 0);
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
