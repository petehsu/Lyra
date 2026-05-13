import { useCallback, useEffect, useMemo, useReducer } from "react";

import type {
  AgentRuntimeEvent,
  AgentSessionSnapshot,
  AgentToolActivity
} from "../../../shared/agent";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import {
  createEmptyDataProviderValue,
  type AgentDecisionItem,
  type AgentPermissionItem,
  type DataProviderValue
} from "./data-provider";

type State = {
  readonly session: AgentSessionSnapshot | null;
  readonly decisions: readonly AgentDecisionItem[];
  readonly permissions: readonly AgentPermissionItem[];
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
  decisions: [],
  permissions: [],
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

  if (event.kind === "messageAppended") {
    const session = state.session;
    if (session === null) return state;
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
    const session = state.session;
    if (session === null) return state;
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
    const session = state.session;
    if (session === null) return state;
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
    const session = state.session;
    if (session === null) return state;
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
    const session = state.session;
    if (session === null) return state;
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

  if (event.kind === "decisionRequired") {
    return {
      ...state,
      decisions: [
        ...state.decisions.filter((decision) => decision.id !== event.decisionId),
        { id: event.decisionId, title: event.title, detail: event.detail }
      ]
    };
  }

  if (event.kind === "permissionRequired") {
    return {
      ...state,
      permissions: [
        ...state.permissions.filter((permission) => permission.id !== event.permissionId),
        { id: event.permissionId, title: event.title, detail: event.detail }
      ]
    };
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

export const useLyraAgentDataProvider = (
  desktopApi: LyraDesktopApi | null
): DataProviderValue => {
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
    const sessionId = state.session?.id ?? lastAgentSessionId;
    await desktopApi.agent.sendTurn({
      sessionId,
      text: trimmed,
      providerProfileId: "lyra-default"
    });
  }, [desktopApi, state.session?.id]);

  const cancel = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const sessionId = state.session?.id ?? lastAgentSessionId;
    if (sessionId === null) return;
    await desktopApi.agent.cancelTurn({ sessionId });
  }, [desktopApi, state.session?.id]);

  const submitDecisions = useCallback<DataProviderValue["submitDecisions"]>(async (decision) => {
    if (desktopApi?.agent === undefined || state.session === null) return;
    await desktopApi.agent.submitDecision({
      sessionId: state.session.id,
      ...decision
    });
  }, [desktopApi, state.session]);

  const approvePermission = useCallback<DataProviderValue["approvePermission"]>(async (permission) => {
    if (desktopApi?.agent === undefined || state.session === null) return;
    await desktopApi.agent.respondPermission({
      sessionId: state.session.id,
      permissionId: permission.permissionId,
      allowed: true
    });
  }, [desktopApi, state.session]);

  const denyPermission = useCallback<DataProviderValue["denyPermission"]>(async (permission) => {
    if (desktopApi?.agent === undefined || state.session === null) return;
    await desktopApi.agent.respondPermission({
      sessionId: state.session.id,
      permissionId: permission.permissionId,
      allowed: false
    });
  }, [desktopApi, state.session]);

  return useMemo(() => {
    if (desktopApi?.agent === undefined) {
      return createEmptyDataProviderValue({
        sendMessage,
        cancel,
        submitDecisions,
        approvePermission,
        denyPermission
      });
    }
    return {
      session: state.session,
      messages: state.session?.messages ?? [],
      toolGroups: state.session?.tools ?? [],
      todos: state.session?.follow.activity === undefined || state.session?.follow.activity === null
        ? []
        : [state.session.follow.activity],
      diffFiles: [],
      decisions: state.decisions,
      permissions: state.permissions,
      follow: state.session?.follow ?? { running: state.loading, activity: state.loading ? "Connecting" : null },
      busy: state.loading || state.session?.turnStatus === "running",
      error: state.error,
      sendMessage,
      cancel,
      submitDecisions,
      approvePermission,
      denyPermission
    };
  }, [
    approvePermission,
    cancel,
    denyPermission,
    desktopApi,
    sendMessage,
    state.decisions,
    state.error,
    state.loading,
    state.permissions,
    state.session,
    submitDecisions
  ]);
};
