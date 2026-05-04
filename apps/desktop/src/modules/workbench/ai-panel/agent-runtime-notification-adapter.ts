import type {
  WorkbenchNotificationLevel,
  WorkbenchNotificationPublishRequest,
  WorkbenchNotificationTarget,
} from "../notifications/types";

type JsonRecord = Record<string, unknown>;

export type AgentRuntimeNotificationInput = {
  readonly method: string;
  readonly params?: JsonRecord;
  readonly createdAt?: number;
};

const AGENT_SOURCE = {
  id: "lyra-agent-runtime",
  title: "Lyra Agent",
  iconKey: "ai" as const,
};

const HIGH_FREQUENCY_METHODS = new Set([
  "item/agentMessage/delta",
  "item/plan/delta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/summaryPartAdded",
  "item/reasoning/textDelta",
  "item/commandExecution/outputDelta",
  "command/exec/outputDelta",
  "item/fileChange/outputDelta",
  "item/mcpToolCall/progress",
  "thread/tokenUsage/updated",
  "turn/diff/updated",
  "turn/plan/updated",
]);

const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const readRawString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const readNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const readBoolean = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

const asTitle = (method: string): string =>
  method
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[/:_-]+/u)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");

const stableIdPart = (value: string | null | undefined): string =>
  (value ?? "")
    .replace(/[^a-z0-9._:-]+/giu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 96);

const formatInteger = (value: number): string => {
  try {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
  } catch {
    return String(Math.round(value));
  }
};

const basename = (path: string): string => {
  const normalized = path.trim().replace(/\\/gu, "/");
  return normalized.split("/").filter(Boolean).at(-1) ?? normalized;
};

const extractThreadId = (params: JsonRecord): string | null => {
  const direct = readString(params.threadId) ?? readString(params.thread_id);
  if (direct !== null) {
    return direct;
  }
  const thread = isRecord(params.thread) ? params.thread : null;
  return thread === null ? null : readString(thread.id);
};

const extractTurnId = (params: JsonRecord): string | null => {
  const direct = readString(params.turnId) ?? readString(params.turn_id);
  if (direct !== null) {
    return direct;
  }
  const turn = isRecord(params.turn) ? params.turn : null;
  return turn === null ? null : readString(turn.id);
};

const extractItemId = (params: JsonRecord): string | null => {
  const direct =
    readString(params.itemId)
    ?? readString(params.item_id)
    ?? readString(params.processId)
    ?? readString(params.process_id)
    ?? readString(params.reviewId)
    ?? readString(params.review_id)
    ?? readString(params.sessionId)
    ?? readString(params.session_id)
    ?? readString(params.requestId)
    ?? readString(params.request_id);
  if (direct !== null) {
    return direct;
  }
  const item = isRecord(params.item) ? params.item : null;
  if (item !== null) {
    return readString(item.id);
  }
  const run = isRecord(params.run) ? params.run : null;
  return run === null ? null : readString(run.id);
};

const historyTarget = (threadId: string | null): WorkbenchNotificationTarget =>
  threadId === null
    ? { kind: "none" }
    : {
        kind: "app-tab",
        appId: "ai-history",
        appInstanceId: "ai-history-center",
        title: "AI History",
        iconKey: "ai-panel-history",
      };

const configFileTarget = (path: string): WorkbenchNotificationTarget => ({
  kind: "app-tab",
  appId: "file-editor",
  appInstanceId: `agent-config:${path}`,
  title: basename(path),
  iconKey: "file-editor-code",
  filePath: path,
});

const createBody = (...parts: readonly (string | null | undefined)[]): string | undefined => {
  const body = parts
    .map((part) => part?.trim() ?? "")
    .filter((part) => part.length > 0)
    .join("\n\n");
  return body.length === 0 ? undefined : body;
};

const errorMessage = (params: JsonRecord): string | null => {
  const error = isRecord(params.error) ? params.error : null;
  return (
    readString(error?.message)
    ?? readString(params.message)
    ?? readString(params.error)
  );
};

const statusLevel = (status: string | null, fallback: WorkbenchNotificationLevel): WorkbenchNotificationLevel => {
  const normalized = status?.toLowerCase() ?? "";
  if (
    normalized.includes("fail")
    || normalized.includes("denied")
    || normalized.includes("abort")
    || normalized.includes("timeout")
    || normalized.includes("cancel")
  ) {
    return "warning";
  }
  if (
    normalized.includes("ready")
    || normalized.includes("complete")
    || normalized.includes("success")
    || normalized.includes("approved")
  ) {
    return "success";
  }
  return fallback;
};

const readUsageTotal = (params: JsonRecord): number | null => {
  const tokenUsage = isRecord(params.tokenUsage) ? params.tokenUsage : null;
  const total = isRecord(tokenUsage?.total) ? tokenUsage.total : null;
  return total === null ? null : readNumber(total.totalTokens);
};

const itemType = (params: JsonRecord): string | null => {
  const item = isRecord(params.item) ? params.item : null;
  return item === null ? null : readString(item.type);
};

const actionSummary = (value: unknown): string | null => {
  if (!isRecord(value)) {
    return null;
  }
  const type = readString(value.type);
  if (type === "command") {
    return readString(value.command);
  }
  if (type === "execve") {
    const program = readString(value.program);
    const argv = Array.isArray(value.argv)
      ? value.argv.filter((entry): entry is string => typeof entry === "string")
      : [];
    return [program, ...argv].filter(Boolean).join(" ").trim() || null;
  }
  if (type === "applyPatch") {
    const files = Array.isArray(value.files)
      ? value.files.filter((entry): entry is string => typeof entry === "string")
      : [];
    return files.length === 0 ? readString(value.cwd) : files.join(", ");
  }
  if (type === "networkAccess") {
    return readString(value.target) ?? readString(value.host);
  }
  if (type === "mcpToolCall") {
    return [readString(value.server), readString(value.toolName)]
      .filter((part): part is string => part !== null)
      .join(".");
  }
  return type;
};

const notificationShape = (
  method: string,
  params: JsonRecord
): {
  readonly title: string;
  readonly preview: string;
  readonly body?: string | undefined;
  readonly level: WorkbenchNotificationLevel;
  readonly target?: WorkbenchNotificationTarget;
} => {
  const threadId = extractThreadId(params);
  const target = historyTarget(threadId);

  switch (method) {
    case "runtime/lagged": {
      const skipped = readNumber(params.skipped) ?? 0;
      return {
        title: "Agent event stream lagged",
        preview: `Skipped ${formatInteger(skipped)} runtime events. The thread will be refreshed.`,
        level: "warning",
        target,
      };
    }
    case "runtime/startupFailed":
      return {
        title: "Agent runtime failed to start",
        preview: errorMessage(params) ?? "Lyra Agent runtime could not start.",
        level: "error",
        target,
      };
    case "runtime/disconnected":
      return {
        title: "Agent runtime disconnected",
        preview: errorMessage(params) ?? readString(params.message) ?? "Lyra Agent runtime disconnected.",
        level: "warning",
        target,
      };
    case "error":
      return {
        title: "Agent turn failed",
        preview: errorMessage(params) ?? "Lyra Agent reported an error.",
        body: readString(isRecord(params.error) ? params.error.additionalDetails : null) ?? undefined,
        level: readBoolean(params.willRetry) === true ? "warning" : "error",
        target,
      };
    case "warning":
      return {
        title: "Agent warning",
        preview: readString(params.message) ?? "Lyra Agent reported a warning.",
        level: "warning",
        target,
      };
    case "configWarning": {
      const path = readString(params.path);
      return {
        title: "Agent config warning",
        preview: readString(params.summary) ?? "Lyra Agent found a configuration warning.",
        body: createBody(readString(params.details), path === null ? null : `Config: ${path}`),
        level: "warning",
        target: path === null ? target : configFileTarget(path),
      };
    }
    case "deprecationNotice":
      return {
        title: "Agent deprecation notice",
        preview: readString(params.summary) ?? "A Lyra Agent feature is deprecated.",
        body: readString(params.details) ?? undefined,
        level: "warning",
        target,
      };
    case "model/rerouted": {
      const fromModel = readString(params.fromModel);
      const toModel = readString(params.toModel);
      return {
        title: "Agent model rerouted",
        preview:
          fromModel !== null && toModel !== null
            ? `${fromModel} -> ${toModel}`
            : "Lyra Agent rerouted the model for this turn.",
        body: readString(params.reason) ?? undefined,
        level: "info",
        target,
      };
    }
    case "thread/tokenUsage/updated": {
      const total = readUsageTotal(params);
      return {
        title: "Agent token usage updated",
        preview: total === null ? "Token usage changed." : `Total tokens: ${formatInteger(total)}`,
        level: "info",
        target,
      };
    }
    case "hook/started": {
      const run = isRecord(params.run) ? params.run : {};
      return {
        title: "Agent hook started",
        preview: readString(run.eventName) ?? readString(run.sourcePath) ?? "Hook execution started.",
        body: readString(run.sourcePath) ?? undefined,
        level: "info",
        target,
      };
    }
    case "hook/completed": {
      const run = isRecord(params.run) ? params.run : {};
      const status = readString(run.status);
      return {
        title: "Agent hook completed",
        preview: readString(run.statusMessage) ?? readString(run.eventName) ?? "Hook execution completed.",
        body: readString(run.sourcePath) ?? undefined,
        level: statusLevel(status, "info"),
        target,
      };
    }
    case "item/autoApprovalReview/started":
      return {
        title: "Agent auto-approval review started",
        preview: actionSummary(params.action) ?? "Lyra Agent started an auto-approval review.",
        level: "info",
        target,
      };
    case "item/autoApprovalReview/completed": {
      const review = isRecord(params.review) ? params.review : {};
      const status = readString(review.status);
      return {
        title: "Agent auto-approval review completed",
        preview:
          readString(review.rationale)
          ?? actionSummary(params.action)
          ?? "Lyra Agent completed an auto-approval review.",
        level: statusLevel(status, "info"),
        target,
      };
    }
    case "mcpServer/oauthLogin/completed":
      return {
        title: "MCP login completed",
        preview:
          readBoolean(params.success) === false
            ? readString(params.error) ?? `${readString(params.name) ?? "MCP server"} login failed.`
            : `${readString(params.name) ?? "MCP server"} login completed.`,
        level: readBoolean(params.success) === false ? "error" : "success",
        target,
      };
    case "mcpServer/startupStatus/updated": {
      const status = readString(params.status);
      return {
        title: "MCP server status updated",
        preview:
          readString(params.error)
          ?? `${readString(params.name) ?? "MCP server"} ${status ?? "status changed"}.`,
        level: statusLevel(status, "info"),
        target,
      };
    }
    case "windows/worldWritableWarning":
      return {
        title: "Windows sandbox warning",
        preview: "Some world-writable paths cannot be protected by the sandbox.",
        body: Array.isArray(params.samplePaths)
          ? params.samplePaths.filter((entry): entry is string => typeof entry === "string").join("\n")
          : undefined,
        level: "warning",
        target,
      };
    case "windowsSandbox/setupCompleted":
      return {
        title: "Windows sandbox setup completed",
        preview:
          readBoolean(params.success) === false
            ? readString(params.error) ?? "Windows sandbox setup failed."
            : "Windows sandbox setup completed.",
        level: readBoolean(params.success) === false ? "error" : "success",
        target,
      };
    case "thread/started":
      return {
        title: "Agent thread started",
        preview: readString(isRecord(params.thread) ? params.thread.preview : null) ?? "New Agent thread started.",
        level: "info",
        target,
      };
    case "thread/archived":
    case "thread/deleted":
    case "thread/unarchived":
    case "thread/closed":
      return {
        title: asTitle(method),
        preview: `Thread ${extractThreadId(params) ?? "unknown"} updated.`,
        level: "info",
        target,
      };
    case "turn/started":
    case "turn/completed":
      return {
        title: asTitle(method),
        preview: `Turn ${extractTurnId(params) ?? "unknown"} ${method.endsWith("started") ? "started" : "completed"}.`,
        level: method === "turn/completed"
          ? statusLevel(readString(isRecord(params.turn) ? params.turn.status : null), "success")
          : "info",
        target,
      };
    case "item/started":
    case "item/updated":
    case "item/completed":
      return {
        title: asTitle(method),
        preview: `${itemType(params) ?? "Item"} ${
          method === "item/completed" ? "completed" : method === "item/updated" ? "updated" : "started"
        }.`,
        level: method === "item/completed"
          ? statusLevel(readString(isRecord(params.item) ? params.item.status : null), "info")
          : "info",
        target,
      };
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/summaryPartAdded":
    case "item/reasoning/textDelta":
      return {
        title: "Agent reasoning updated",
        preview: readRawString(params.delta)?.trim() || "Reasoning content changed.",
        level: "info",
        target,
      };
    case "item/mcpToolCall/progress":
      return {
        title: "MCP tool progress",
        preview: readString(params.message) ?? "MCP tool call progressed.",
        level: "info",
        target,
      };
    default:
      return {
        title: asTitle(method) || "Agent runtime notification",
        preview:
          readString(params.message)
          ?? readString(params.summary)
          ?? readString(params.status)
          ?? "Agent runtime state changed.",
        level: "info",
        target,
      };
  }
};

export const mapAgentRuntimeNotificationToWorkbenchNotification = ({
  method,
  params = {},
  createdAt,
}: AgentRuntimeNotificationInput): WorkbenchNotificationPublishRequest => {
  const shape = notificationShape(method, params);
  const isHighFrequency = HIGH_FREQUENCY_METHODS.has(method);
  const threadId = extractThreadId(params) ?? "global";
  const turnId = extractTurnId(params) ?? "";
  const itemId = extractItemId(params) ?? "";
  const keyText = isHighFrequency
    ? ""
    : (
        readString(params.summary)
        ?? readString(params.message)
        ?? readString(params.path)
        ?? readString(params.name)
        ?? shape.preview
      );
  const id = [
    "agent-runtime",
    stableIdPart(method),
    stableIdPart(threadId),
    stableIdPart(turnId),
    stableIdPart(itemId),
    stableIdPart(keyText),
  ]
    .filter((part) => part.length > 0)
    .join(":");

  return {
    id,
    title: shape.title,
    preview: shape.preview,
    ...(shape.body === undefined ? {} : { body: shape.body }),
    level: shape.level,
    source: AGENT_SOURCE,
    target: shape.target ?? historyTarget(extractThreadId(params)),
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(isHighFrequency ? { previewBehavior: "silent" as const } : {}),
  };
};
