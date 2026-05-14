import { useCallback, useEffect, useMemo, useReducer } from "react";

import type {
  AgentRuntimeEvent,
  AgentSessionSnapshot,
  AgentToolActivity
} from "../../../shared/agent";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { SettingsAiModel } from "../settings-ai";
import type {
  ChatMessage,
  DiffFileEntry,
  PermissionRequest,
  SessionMeta,
  TodoItem,
  ToolCall,
  ToolGroup
} from "./agent-chat-demo/core/types";
import {
  createDataProviderValue,
  type CreateDataProviderValueInput
} from "./agent-chat-demo/data/createDataProviderValue";

type State = {
  readonly session: AgentSessionSnapshot | null;
  readonly error: string | null;
  readonly loading: boolean;
};

type Action =
  | { readonly type: "loading" }
  | { readonly type: "snapshot"; readonly snapshot: AgentSessionSnapshot }
  | { readonly type: "event"; readonly event: AgentRuntimeEvent }
  | { readonly type: "error"; readonly message: string };

let lastAgentSessionId: string | null = null;

const initialState: State = {
  session: null,
  error: null,
  loading: true
};

const upsertTool = (
  tools: readonly AgentToolActivity[],
  tool: AgentToolActivity
): readonly AgentToolActivity[] => [
  ...tools.filter((existing) => existing.id !== tool.id),
  tool
];

const applyEvent = (state: State, event: AgentRuntimeEvent): State => {
  if (event.kind === "sessionSnapshot") {
    lastAgentSessionId = event.snapshot.id;
    return {
      ...state,
      session: event.snapshot,
      loading: false,
      error: null
    };
  }

  if (state.session !== null && "sessionId" in event && event.sessionId !== state.session.id) {
    return state;
  }

  const session = state.session;
  if (session === null) {
    return state;
  }

  if (event.kind === "messageAppended") {
    return {
      ...state,
      session: {
        ...session,
        messages: [
          ...session.messages.filter((message) => message.id !== event.message.id),
          event.message
        ],
        updatedAt: new Date().toISOString()
      }
    };
  }

  if (event.kind === "messageDelta") {
    return {
      ...state,
      session: {
        ...session,
        messages: session.messages.map((message) =>
          message.id === event.messageId
            ? { ...message, text: `${message.text}${event.delta}` }
            : message
        ),
        updatedAt: new Date().toISOString()
      }
    };
  }

  if (event.kind === "toolStarted" || event.kind === "toolFinished") {
    return {
      ...state,
      session: {
        ...session,
        tools: upsertTool(session.tools, event.tool),
        updatedAt: new Date().toISOString()
      }
    };
  }

  if (event.kind === "followStateChanged") {
    return {
      ...state,
      session: {
        ...session,
        follow: event.follow,
        turnStatus: event.follow.running ? "running" : session.turnStatus,
        updatedAt: new Date().toISOString()
      }
    };
  }

  if (event.kind === "turnFinished") {
    return {
      ...state,
      session: {
        ...session,
        turnStatus: event.status,
        activeTurnId: null,
        follow: { running: false, activity: null },
        updatedAt: new Date().toISOString()
      }
    };
  }

  if (event.kind === "turnFailed") {
    return { ...state, error: event.message };
  }

  return state;
};

const reducer = (state: State, action: Action): State => {
  if (action.type === "loading") return { ...state, loading: true, error: null };
  if (action.type === "snapshot") {
    lastAgentSessionId = action.snapshot.id;
    return { ...state, session: action.snapshot, loading: false, error: null };
  }
  if (action.type === "event") return applyEvent(state, action.event);
  return { ...state, loading: false, error: action.message };
};

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const toolKind = (tool: AgentToolActivity): ToolCall["kind"] => {
  if (tool.name.includes("read")) return "read";
  if (tool.name.includes("search")) return "search";
  if (tool.name.includes("shell") || tool.name.includes("command")) return "shell";
  return "thought";
};

const toToolCall = (tool: AgentToolActivity): ToolCall => ({
  id: tool.id,
  kind: toolKind(tool),
  title: tool.label,
  status: tool.status === "running" ? "running" : tool.status === "failed" ? "error" : "success",
  details: {
    type: "text",
    body: JSON.stringify(tool.output ?? tool.input, null, 2)
  }
});

const toToolGroup = (tools: readonly AgentToolActivity[]): ToolGroup | null => {
  if (tools.length === 0) return null;
  const running = tools.find((tool) => tool.status === "running");
  return {
    id: "lyra-agent-tools",
    status: running === undefined ? "done" : "running",
    label: running?.label ?? "Agent activity",
    hint: running === undefined ? `${tools.length} tool events` : "Running...",
    ...(running === undefined ? {} : { currentCallId: running.id }),
    calls: tools.map(toToolCall)
  };
};

const toMessages = (session: AgentSessionSnapshot | null): ChatMessage[] => {
  if (session === null) return [];
  const messages: ChatMessage[] = session.messages.map((message) => ({
    id: message.id,
    author: message.role === "user" ? "user" : "agent",
    time: message.createdAt,
    blocks: [
      {
        type: "text",
        id: `${message.id}-text`,
        body: message.text.length === 0 ? "..." : message.text
      }
    ]
  }));
  const group = toToolGroup(session.tools);
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
  return messages;
};

const toSessionMeta = (session: AgentSessionSnapshot | null): SessionMeta => ({
  title: session?.title ?? "Lyra Agent",
  project: session?.follow.running ? (session.follow.activity ?? "Running") : "Lyra",
  totalAdditions: 0,
  totalDeletions: 0
});

const toTodos = (session: AgentSessionSnapshot | null): TodoItem[] => {
  const activity = session?.follow.activity;
  if (activity === undefined || activity === null) return [];
  return [{
    id: "follow-activity",
    title: activity,
    status: session?.follow.running ? "running" : "done"
  }];
};

export const useLyraAgentDataProvider = (
  desktopApi: LyraDesktopApi | null,
  settingsAiModel?: SettingsAiModel
): {
  readonly data: ReturnType<typeof createDataProviderValue>;
  readonly followRunning: boolean;
  readonly followActivity: string | null;
  readonly error: string | null;
  readonly cancel: () => Promise<void>;
} => {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    if (desktopApi?.agent === undefined) {
      dispatch({ type: "error", message: "Lyra desktop bridge is unavailable." });
      return;
    }
    let disposed = false;
    dispatch({ type: "loading" });
    const agentApi = desktopApi.agent;
    const unsubscribe = agentApi.onEvent((event) => {
      dispatch({ type: "event", event });
    });

    void agentApi.readSession({ sessionId: lastAgentSessionId })
      .catch(() => agentApi.createSession({ title: "Lyra Agent" }))
      .then((snapshot) => {
        if (disposed) return;
        dispatch({ type: "snapshot", snapshot });
      })
      .catch((error: unknown) => {
        if (disposed) return;
        dispatch({ type: "error", message: toErrorMessage(error) });
      });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [desktopApi]);

  const sendMessage = useCallback(async (text: string): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    const defaultProfile = settingsAiModel?.profiles.find((profile) => profile.id === settingsAiModel.defaultProfileId)
      ?? null;
    const providerProfile = settingsAiModel === undefined
      ? null
      : (defaultProfile?.runtimeSupported === true
          ? defaultProfile
          : settingsAiModel.profiles.find((profile) => profile.runtimeSupported) ?? null);
    if (settingsAiModel !== undefined && providerProfile === null) {
      dispatch({
        type: "error",
        message: "Configure a runtime-supported AI profile before sending an Agent turn."
      });
      return;
    }
    await desktopApi.agent.sendTurn({
      sessionId: state.session?.id ?? lastAgentSessionId,
      text: trimmed,
      providerProfileId: providerProfile?.id ?? "lyra-default",
      providerProfile
    });
  }, [desktopApi, settingsAiModel?.defaultProfileId, settingsAiModel?.profiles, state.session?.id]);

  const cancel = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const sessionId = state.session?.id ?? lastAgentSessionId;
    if (sessionId === null) return;
    await desktopApi.agent.cancelTurn({ sessionId });
  }, [desktopApi, state.session?.id]);

  const submitDecisions = useCallback(async (_answers: Record<string, string>) => {
    if (desktopApi?.agent === undefined || state.session === null) return;
    await desktopApi.agent.submitDecision({
      sessionId: state.session.id,
      decisionId: "agent-chat-demo-decision",
      accepted: true
    });
  }, [desktopApi, state.session]);

  const approvePermission = useCallback(async (id: string) => {
    if (desktopApi?.agent === undefined || state.session === null) return;
    await desktopApi.agent.respondPermission({
      sessionId: state.session.id,
      permissionId: id,
      allowed: true
    });
  }, [desktopApi, state.session]);

  const denyPermission = useCallback(async (id: string) => {
    if (desktopApi?.agent === undefined || state.session === null) return;
    await desktopApi.agent.respondPermission({
      sessionId: state.session.id,
      permissionId: id,
      allowed: false
    });
  }, [desktopApi, state.session]);

  const data = useMemo(() => {
    const input: CreateDataProviderValueInput = {
      session: toSessionMeta(state.session),
      messages: toMessages(state.session),
      todos: toTodos(state.session),
      diffFiles: [] satisfies DiffFileEntry[],
      decisions: [],
      permissions: [] satisfies PermissionRequest[],
      sendMessage,
      submitDecisions,
      approvePermission,
      denyPermission,
      isMock: false
    };
    return createDataProviderValue(input);
  }, [
    approvePermission,
    denyPermission,
    sendMessage,
    state.session,
    submitDecisions
  ]);

  return {
    data,
    followRunning: state.session?.follow.running ?? state.loading,
    followActivity: state.session?.follow.activity ?? (state.loading ? "Connecting" : null),
    error: state.error,
    cancel
  };
};
