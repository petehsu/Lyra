import type {
  AiChatMode,
  AiChatSession,
  AiChatSessionSummary,
  AiChatToken
} from "../../../../shared/ai";
import type { WorkbenchFeedbackPublishRequest } from "../../feedback";
import type {
  SidebarComposerFileToken,
  SidebarComposerMode,
  SidebarComposerToken
} from "../../sidebar/types";
import type { AiPanelMessage } from "../chat-types";
import type {
  AiPanelHistoryItem,
  AiPanelSession,
  AiPanelSessionPlacement
} from "../types";

const createId = (prefix: string): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
};

const toSidebarMode = (value: AiChatMode | string): SidebarComposerMode =>
  value === "agent" || value === "oma" ? value : "chat";

const toSidebarToken = (token: AiChatToken): SidebarComposerToken => {
  if (token.kind === "text") {
    return token;
  }
  const baseToken: SidebarComposerFileToken = {
    kind: "file",
    name: token.name,
    entryKind: token.entryKind,
    source: token.source
  };
  if (token.path !== undefined && token.iconKind !== undefined) {
    return {
      ...baseToken,
      path: token.path,
      iconKind: token.iconKind as Exclude<SidebarComposerFileToken["iconKind"], undefined>
    };
  }
  if (token.path !== undefined) {
    return {
      ...baseToken,
      path: token.path
    };
  }
  if (token.iconKind !== undefined) {
    return {
      ...baseToken,
      iconKind: token.iconKind as Exclude<SidebarComposerFileToken["iconKind"], undefined>
    };
  }
  return baseToken;
};

const isRenderableMessageRole = (
  role: AiChatSession["messages"][number]["role"]
): role is "user" | "assistant" => role === "user" || role === "assistant";

export const createDraftSessionId = (): string => createId("ai-session");

export const formatHistoryTime = (timestamp: number): string => {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(timestamp);
  } catch {
    return new Date(timestamp).toLocaleString();
  }
};

export const arraysEqual = (left: readonly string[], right: readonly string[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
};

export const resolveFeedbackCodeFromError = (
  error: unknown
): WorkbenchFeedbackPublishRequest["code"] => {
  const message = error instanceof Error ? error.message : `${error ?? ""}`;
  const normalized = message.toLowerCase();
  if (normalized.includes("permission") || normalized.includes("denied")) {
    return "ai.runtime.permission_denied";
  }
  if (normalized.includes("timeout") || normalized.includes("timed out")) {
    return "ai.runtime.timeout";
  }
  return "ai.runtime.error";
};

export const createDraftSession = (
  defaultTitle: string,
  id = createDraftSessionId(),
  placement: AiPanelSessionPlacement = "sidebar-draft"
): AiPanelSession => ({
  id,
  title: defaultTitle,
  updatedAt: Date.now(),
  historySummary: "",
  mode: "chat",
  activeTurnId: null,
  placement,
  messages: [],
  isReplying: false,
  quotedMessage: null,
  questionFlow: null,
  changeApprovalView: null,
  runtimeItems: [],
  activeRuntimeItemId: null
});

const toPanelMessages = (session: AiChatSession): readonly AiPanelMessage[] =>
  session.messages
    .filter((message) => isRenderableMessageRole(message.role))
    .map((message) => {
      const role: AiPanelMessage["role"] = message.role === "user" ? "user" : "assistant";
      if (message.tokens === undefined) {
        return {
          id: message.id,
          role,
          mode: toSidebarMode(message.mode),
          content: message.content,
          createdAt: message.createdAt,
          isPending: message.status === "pending" || message.status === "streaming"
        };
      }
      return {
        id: message.id,
        role,
        mode: toSidebarMode(message.mode),
        content: message.content,
        createdAt: message.createdAt,
        isPending: message.status === "pending" || message.status === "streaming",
        tokens: message.tokens.map(toSidebarToken)
      };
    });

export const mergeNativeSession = (
  nativeSession: AiChatSession,
  existing: AiPanelSession | undefined,
  placement?: AiPanelSessionPlacement
): AiPanelSession => ({
  id: nativeSession.id,
  title: nativeSession.title,
  updatedAt: nativeSession.updatedAt,
  historySummary: nativeSession.summary,
  mode: toSidebarMode(nativeSession.mode),
  activeTurnId: nativeSession.activeTurnId,
  placement: placement ?? existing?.placement ?? "sidebar-draft",
  messages: toPanelMessages(nativeSession),
  isReplying: nativeSession.activeTurnId !== null,
  quotedMessage: existing?.quotedMessage ?? null,
  questionFlow: null,
  changeApprovalView: existing?.changeApprovalView ?? null,
  runtimeItems: existing?.runtimeItems ?? [],
  activeRuntimeItemId: existing?.activeRuntimeItemId ?? null
});

export const summarizeSession = (session: AiPanelSession): AiChatSessionSummary => ({
  id: session.id,
  title: session.title,
  updatedAt: session.updatedAt,
  summary: session.historySummary,
  mode: session.mode
});

export const upsertSummary = (
  current: readonly AiChatSessionSummary[],
  summary: AiChatSessionSummary
): readonly AiChatSessionSummary[] => {
  const next = current.filter((entry) => entry.id !== summary.id);
  return [...next, summary].sort((left, right) => right.updatedAt - left.updatedAt);
};

export const buildHistoryItems = (
  activeSessionId: string,
  summaries: readonly AiChatSessionSummary[],
  sessions: readonly AiPanelSession[],
  workspaceSessionIds: readonly string[]
): readonly AiPanelHistoryItem[] => {
  const merged = new Map<string, AiChatSessionSummary>();
  for (const summary of summaries) {
    merged.set(summary.id, summary);
  }
  for (const session of sessions) {
    if (session.id === activeSessionId) {
      continue;
    }
    if (session.messages.length === 0 && session.historySummary.length === 0) {
      continue;
    }
    merged.set(session.id, summarizeSession(session));
  }

  return Array.from(merged.values())
    .filter((summary) => summary.id !== activeSessionId)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map((summary) => ({
      id: summary.id,
      title: summary.title,
      updatedAt: formatHistoryTime(summary.updatedAt),
      summary: summary.summary,
      isOpenInWorkspace: workspaceSessionIds.includes(summary.id)
    }));
};
