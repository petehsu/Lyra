import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import type {
  JcodeModelsListResponse,
  AgentRuntimeEvent,
  AgentSessionSnapshot
} from "../../../shared/agent";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { SettingsAiModel } from "../settings-ai";
import type {
  ComposerModelControls,
  DiffFileEntry,
  PermissionRequest
} from "./agent-chat-demo/core/types";
import { setLocale, t, type Locale } from "./agent-chat-demo/core/i18n";
import {
  createDataProviderValue,
  type CreateDataProviderValueInput
} from "./agent-chat-demo/data/createDataProviderValue";
import {
  agentSessionToChatMessages,
  agentSessionToSidePanel,
  agentSessionToSessionMeta,
  agentSessionToTodos,
  applyAgentRuntimeEventToSnapshot,
  jcodeModelsToModelOptions
} from "../agent-session-view-model";

type State = {
  readonly session: AgentSessionSnapshot | null;
  readonly error: string | null;
  readonly turnError: string | null;
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
  turnError: null,
  loading: true
};

const applyEvent = (state: State, event: AgentRuntimeEvent): State => {
  if (event.kind === "sessionSnapshot") {
    if (state.session !== null && event.snapshot.id !== state.session.id) {
      return state;
    }
    lastAgentSessionId = event.snapshot.id;
    return {
      ...state,
      session: event.snapshot,
      loading: false,
      turnError: event.snapshot.turnStatus === "failed" ? state.turnError : null,
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

  if (event.kind === "turnFailed") {
    return {
      ...state,
      session: applyAgentRuntimeEventToSnapshot(session, event),
      turnError: event.message,
      error: null
    };
  }

  return {
    ...state,
    session: applyAgentRuntimeEventToSnapshot(session, event)
  };
};

const reducer = (state: State, action: Action): State => {
  if (action.type === "loading") return { ...state, loading: true, error: null, turnError: null };
  if (action.type === "snapshot") {
    lastAgentSessionId = action.snapshot.id;
    return {
      ...state,
      session: action.snapshot,
      loading: false,
      error: null,
      turnError: action.snapshot.turnStatus === "failed" ? state.turnError : null
    };
  }
  if (action.type === "event") return applyEvent(state, action.event);
  return { ...state, loading: false, error: action.message };
};

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const runtimeEventSessionId = (event: AgentRuntimeEvent): string | null => {
  if ("sessionId" in event) return event.sessionId;
  if (event.kind === "sessionSnapshot") return event.snapshot.id;
  return null;
};

export const useLyraAgentDataProvider = (
  desktopApi: LyraDesktopApi | null,
  settingsAiModel?: SettingsAiModel,
  activeSessionId?: string | null,
  onActiveSessionChange?: (sessionId: string) => void,
  onRequestProjectBind?: (currentPath?: string) => Promise<string | null>,
  onOpenProjectTree?: (request: {
    readonly sessionId: string;
    readonly workingDir: string;
  }) => Promise<void> | void,
  onOpenSelfDevLab?: (request: {
    readonly parentSessionId: string | null;
  }) => Promise<void> | void,
  onOpenOvernightLab?: (request: {
    readonly parentSessionId: string | null;
  }) => Promise<void> | void,
  onOpenModelSettings?: () => Promise<void> | void,
  locale?: Locale
): {
  readonly data: ReturnType<typeof createDataProviderValue>;
  readonly followRunning: boolean;
  readonly followActivity: string | null;
  readonly error: string | null;
  readonly cancel: () => Promise<void>;
} => {
  if (locale !== undefined) {
    setLocale(locale);
  }

  const [state, dispatch] = useReducer(reducer, initialState);
  const [modelState, setModelState] = useState<JcodeModelsListResponse | null>(null);
  const [modelBusy, setModelBusy] = useState<"refresh" | "switch" | null>(null);
  const currentSessionIdRef = useRef<string | null>(lastAgentSessionId);
  const modelConfigSignature = useMemo(() => {
    const config = settingsAiModel?.jcodeConfig?.config as {
      provider?: unknown;
      providers?: unknown;
    } | undefined;
    return JSON.stringify({
      provider: config?.provider ?? null,
      providers: config?.providers ?? null,
      accountsDefaultProvider: settingsAiModel?.jcodeAccounts?.defaultProvider ?? null,
      accountsDefaultModel: settingsAiModel?.jcodeAccounts?.defaultModel ?? null
    });
  }, [settingsAiModel?.jcodeAccounts, settingsAiModel?.jcodeConfig]);

  useEffect(() => {
    currentSessionIdRef.current = state.session?.id ?? null;
  }, [state.session?.id]);

  useEffect(() => {
    if (desktopApi?.agent === undefined) {
      dispatch({ type: "error", message: t("runtime.desktopBridgeUnavailable") });
      return;
    }
    let disposed = false;
    dispatch({ type: "loading" });
    const agentApi = desktopApi.agent;
    const requestedSessionId = activeSessionId ?? lastAgentSessionId;
    currentSessionIdRef.current = requestedSessionId;
    const unsubscribe = agentApi.onEvent((event) => {
      const eventSessionId = runtimeEventSessionId(event);
      if (eventSessionId !== null && currentSessionIdRef.current !== eventSessionId) {
        return;
      }
      dispatch({ type: "event", event });
      if (event.kind === "turnFinished" || event.kind === "turnFailed") {
        void agentApi.readSession({ sessionId: event.sessionId })
          .then((snapshot) => {
            if (disposed || currentSessionIdRef.current !== snapshot.id) return;
            dispatch({ type: "snapshot", snapshot });
          })
          .catch(() => undefined);
      }
    });

    void agentApi.readSession({ sessionId: requestedSessionId })
      .catch((error: unknown) => {
        if (requestedSessionId === null) {
          return agentApi.createSession({ title: "Lyra Agent" });
        }
        throw error;
      })
      .then((snapshot) => {
        if (disposed) return;
        currentSessionIdRef.current = snapshot.id;
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
  }, [activeSessionId, desktopApi, locale]);

  useEffect(() => {
    if (desktopApi?.agent === undefined || state.session === null) return;
    let disposed = false;
    void desktopApi.agent.listJcodeModels({ sessionId: state.session.id })
      .then((response) => {
        if (!disposed) setModelState(response);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [desktopApi, modelConfigSignature, state.session?.id]);

  useEffect(() => {
    if (state.session === null) return;
    onActiveSessionChange?.(state.session.id);
  }, [onActiveSessionChange, state.session?.id]);

  const sendMessage = useCallback(async (text: string): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    await desktopApi.agent.sendTurn({
      sessionId: state.session?.id ?? lastAgentSessionId,
      text: trimmed
    });
  }, [desktopApi, state.session?.id]);

  const cancel = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const sessionId = state.session?.id ?? lastAgentSessionId;
    if (sessionId === null) return;
    await desktopApi.agent.cancelTurn({ sessionId });
  }, [desktopApi, state.session?.id]);

  const previewRollback = useCallback(async (messageId: string) => {
    if (desktopApi?.agent === undefined || state.session === null) {
      return {
        sessionId: "",
        messageId,
        available: false,
        removedMessageCount: 0,
        changedFiles: [],
        unavailableReason: "No active agent session."
      };
    }
    return desktopApi.agent.previewRollback({
      sessionId: state.session.id,
      messageId
    });
  }, [desktopApi, state.session]);

  const rollbackMessage = useCallback(async (messageId: string): Promise<void> => {
    if (desktopApi?.agent === undefined || state.session === null) return;
    const response = await desktopApi.agent.restoreRollback({
      sessionId: state.session.id,
      messageId,
      mode: "taskAndWorkspace"
    });
    dispatch({ type: "snapshot", snapshot: response.snapshot });
  }, [desktopApi, state.session]);

  const createSession = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    dispatch({ type: "loading" });
    setModelState(null);
    try {
      const request =
        state.session?.projectBound === true && typeof state.session.workingDir === "string"
          ? { title: "Lyra Agent", workingDir: state.session.workingDir }
          : { title: "Lyra Agent" };
      const snapshot = await desktopApi.agent.createSession(request);
      dispatch({ type: "snapshot", snapshot });
    } catch (error: unknown) {
      dispatch({ type: "error", message: toErrorMessage(error) });
    }
  }, [desktopApi, state.session?.projectBound, state.session?.workingDir]);

  const bindProject = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined || onRequestProjectBind === undefined) return;
    const currentPath =
      state.session?.projectBound === true && typeof state.session.workingDir === "string"
        ? state.session.workingDir
        : undefined;
    const selectedPath = await onRequestProjectBind(currentPath);
    if (selectedPath === null) return;
    const snapshot = await desktopApi.agent.bindProject({
      sessionId: state.session?.id ?? lastAgentSessionId,
      workingDir: selectedPath
    });
    dispatch({ type: "snapshot", snapshot });
  }, [
    desktopApi,
    onRequestProjectBind,
    state.session?.id,
    state.session?.projectBound,
    state.session?.workingDir
  ]);

  const openProjectTree = useCallback(async (): Promise<void> => {
    if (
      state.session?.projectBound !== true ||
      typeof state.session.workingDir !== "string" ||
      state.session.workingDir.trim().length === 0
    ) {
      return;
    }
    await onOpenProjectTree?.({
      sessionId: state.session.id,
      workingDir: state.session.workingDir
    });
  }, [
    onOpenProjectTree,
    state.session?.id,
    state.session?.projectBound,
    state.session?.workingDir
  ]);

  const openSelfDevLab = useCallback(async (): Promise<void> => {
    await onOpenSelfDevLab?.({
      parentSessionId: state.session?.id ?? lastAgentSessionId
    });
  }, [onOpenSelfDevLab, state.session?.id]);

  const openOvernightLab = useCallback(async (): Promise<void> => {
    await onOpenOvernightLab?.({
      parentSessionId: state.session?.id ?? lastAgentSessionId
    });
  }, [onOpenOvernightLab, state.session?.id]);

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

  const currentSessionId = state.session?.id ?? lastAgentSessionId;

  const switchModel = useCallback(async (modelId: string): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const trimmed = modelId.trim();
    if (trimmed.length === 0) return;
    setModelBusy("switch");
    try {
      setModelState(await desktopApi.agent.switchJcodeModel({
        sessionId: currentSessionId,
        model: trimmed
      }));
    } finally {
      setModelBusy(null);
    }
  }, [currentSessionId, desktopApi]);

  const refreshModels = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    setModelBusy("refresh");
    try {
      setModelState(await desktopApi.agent.refreshJcodeModels({ sessionId: currentSessionId }));
    } finally {
      setModelBusy(null);
    }
  }, [currentSessionId, desktopApi]);

  const openModelSettings = useCallback(async (): Promise<void> => {
    await onOpenModelSettings?.();
  }, [onOpenModelSettings]);

  const updateReasoningEffort = useCallback(async (value: string): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    setModelBusy("switch");
    try {
      setModelState(await desktopApi.agent.updateJcodeProviderOptions({
        sessionId: currentSessionId,
        reasoningEffort: value
      }));
    } finally {
      setModelBusy(null);
    }
  }, [currentSessionId, desktopApi]);

  const updateServiceTier = useCallback(async (value: string): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    setModelBusy("switch");
    try {
      setModelState(await desktopApi.agent.updateJcodeProviderOptions({
        sessionId: currentSessionId,
        serviceTier: value
      }));
    } finally {
      setModelBusy(null);
    }
  }, [currentSessionId, desktopApi]);

  const runImprove = useCallback(async (options?: {
    planOnly?: boolean;
    focus?: string | null;
  }): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    await desktopApi.agent.runImprove({
      sessionId: currentSessionId,
      planOnly: options?.planOnly ?? false,
      focus: options?.focus ?? null
    });
  }, [currentSessionId, desktopApi]);

  const runRefactor = useCallback(async (options?: {
    planOnly?: boolean;
    focus?: string | null;
  }): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    await desktopApi.agent.runRefactor({
      sessionId: currentSessionId,
      planOnly: options?.planOnly ?? false,
      focus: options?.focus ?? null
    });
  }, [currentSessionId, desktopApi]);

  const pokeTodos = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    await desktopApi.agent.triggerPoke({ sessionId: currentSessionId });
  }, [currentSessionId, desktopApi]);

  const runReview = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const response = await desktopApi.agent.runReview({ sessionId: currentSessionId });
    const snapshot = await desktopApi.agent.readSession({ sessionId: response.sessionId });
    dispatch({ type: "snapshot", snapshot });
  }, [currentSessionId, desktopApi]);

  const runJudge = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const response = await desktopApi.agent.runJudge({ sessionId: currentSessionId });
    const snapshot = await desktopApi.agent.readSession({ sessionId: response.sessionId });
    dispatch({ type: "snapshot", snapshot });
  }, [currentSessionId, desktopApi]);

  const runSubagent = useCallback(async (options: {
    prompt: string;
    subagentType?: string | null;
    model?: string | null;
    continueSessionId?: string | null;
  }): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const response = await desktopApi.agent.runSubagent({
      sessionId: currentSessionId,
      prompt: options.prompt,
      subagentType: options.subagentType ?? null,
      model: options.model ?? null,
      continueSessionId: options.continueSessionId ?? null
    });
    dispatch({ type: "snapshot", snapshot: response.snapshot });
  }, [currentSessionId, desktopApi]);

  const askSideQuestion = useCallback(async (question: string): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    await desktopApi.agent.runBtw({ sessionId: currentSessionId, question });
  }, [currentSessionId, desktopApi]);

  const splitSession = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const response = await desktopApi.agent.splitSession({ sessionId: currentSessionId });
    dispatch({ type: "snapshot", snapshot: response.snapshot });
  }, [currentSessionId, desktopApi]);

  const transferSession = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const response = await desktopApi.agent.transferSession({ sessionId: currentSessionId });
    dispatch({ type: "snapshot", snapshot: response.snapshot });
  }, [currentSessionId, desktopApi]);

  const compactContext = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const response = await desktopApi.agent.compactSession({ sessionId: currentSessionId });
    dispatch({ type: "snapshot", snapshot: response.snapshot });
  }, [currentSessionId, desktopApi]);

  const openGoals = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    await desktopApi.agent.openGoals({ sessionId: currentSessionId });
    if (currentSessionId !== null) {
      const snapshot = await desktopApi.agent.readSession({ sessionId: currentSessionId });
      dispatch({ type: "snapshot", snapshot });
    }
  }, [currentSessionId, desktopApi]);

  const resumeGoal = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    await desktopApi.agent.resumeGoal({ sessionId: currentSessionId });
    if (currentSessionId !== null) {
      const snapshot = await desktopApi.agent.readSession({ sessionId: currentSessionId });
      dispatch({ type: "snapshot", snapshot });
    }
  }, [currentSessionId, desktopApi]);

  const updateAutomation = useCallback(async (settings: {
    subagentModel?: string | null;
    autoreviewEnabled?: boolean | null;
    autojudgeEnabled?: boolean | null;
  }): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const response = await desktopApi.agent.updateSessionAutomation({
      sessionId: currentSessionId,
      ...settings
    });
    dispatch({ type: "snapshot", snapshot: response.snapshot });
  }, [currentSessionId, desktopApi]);

  const data = useMemo(() => {
    const modelControls: ComposerModelControls | null = modelState === null ? null : {
      currentModel: modelState.currentModel,
      currentProvider: modelState.currentProvider,
      models: jcodeModelsToModelOptions(modelState),
      reasoningEffort: {
        current: modelState.reasoningEffort.current ?? null,
        options: [...modelState.reasoningEffort.options],
        supported: modelState.reasoningEffort.supported
      },
      serviceTier: {
        current: modelState.serviceTier.current ?? null,
        options: [...modelState.serviceTier.options],
        supported: modelState.serviceTier.supported
      },
      isRefreshing: modelBusy === "refresh",
      isSwitching: modelBusy === "switch",
      switchModel,
      refreshModels,
      openModelSettings,
      updateReasoningEffort,
      updateServiceTier
    };
    const input: CreateDataProviderValueInput = {
      session: agentSessionToSessionMeta(state.session),
      messages: agentSessionToChatMessages(state.session, { failedTurnMessage: state.turnError }),
      todos: agentSessionToTodos(state.session),
      diffFiles: [] satisfies DiffFileEntry[],
      decisions: [],
      permissions: [] satisfies PermissionRequest[],
      modelControls,
      openModelSettings,
      sidePanel: agentSessionToSidePanel(state.session),
      sendMessage,
      cancelTurn: cancel,
      previewRollback,
      rollbackMessage,
      createSession,
      bindProject,
      openProjectTree,
      openSelfDevLab,
      openOvernightLab,
      runImprove,
      runRefactor,
      pokeTodos,
      runReview,
      runJudge,
      runSubagent,
      askSideQuestion,
      splitSession,
      transferSession,
      compactContext,
      openGoals,
      resumeGoal,
      updateAutomation,
      submitDecisions,
      approvePermission,
      denyPermission,
      isMock: false,
      isTurnRunning: state.session?.follow.running ?? state.loading
    };
    return createDataProviderValue(input);
  }, [
    approvePermission,
    bindProject,
    cancel,
    createSession,
    denyPermission,
    openModelSettings,
    openProjectTree,
    openSelfDevLab,
    openOvernightLab,
    modelBusy,
    modelState,
    previewRollback,
    refreshModels,
    rollbackMessage,
    runImprove,
    runRefactor,
    runReview,
    runSubagent,
    sendMessage,
    state.session,
    state.loading,
    runJudge,
    askSideQuestion,
    compactContext,
    openGoals,
    resumeGoal,
    splitSession,
    transferSession,
    updateAutomation,
    pokeTodos,
    submitDecisions,
    switchModel,
    updateReasoningEffort,
    updateServiceTier,
    locale
  ]);

  return {
    data,
    followRunning: state.session?.follow.running ?? state.loading,
    followActivity: state.session?.follow.activity ?? (state.loading ? t("runtime.connecting") : null),
    error: state.error,
    cancel
  };
};
