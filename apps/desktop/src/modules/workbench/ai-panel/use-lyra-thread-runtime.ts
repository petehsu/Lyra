import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AgentPendingInteraction,
  AgentRuntimeEvent,
  AgentSessionDetail,
  AgentToolCall,
  LyraClientRequestPayload,
  LyraDesktopApi,
} from "../../../shared/desktop-bridge";
import type {
  CommandApprovalResponse,
} from "../command-approval-bar";
import {
  mergePendingInteractionLists,
  sortPendingInteractions,
  toPendingInteractionPanel,
  type ActiveInteractionPanel,
  type InteractionTextBundle,
  type PendingInteractionPanel,
} from "./interaction/pending-interaction-mappers";
import {
  buildThreadTitle,
  lyraThreadToAgentDetail,
  readLyraThread,
  threadItemToToolCall,
  type LyraThread,
  type LyraThreadItem,
  type LyraTurn,
} from "./lyra-thread-adapter";
import type {
  OptimisticUserMessage,
} from "./view-helpers";

type JsonRecord = Record<string, unknown>;

export type LyraThreadRuntimeState = {
  readonly threads: readonly LyraThread[];
  readonly activeThreadId: string | null;
  readonly activeThread: LyraThread | null;
  readonly activeDetail: AgentSessionDetail | null;
  readonly optimisticUserMessages: readonly OptimisticUserMessage[];
  readonly liveToolCalls: readonly AgentToolCall[];
  readonly latestRuntimeEventByTurn: Readonly<Record<string, AgentRuntimeEvent>>;
  readonly pendingInteractions: readonly AgentPendingInteraction[];
  readonly pendingInteractionQueue: readonly PendingInteractionPanel[];
  readonly activeInteractionPanel: ActiveInteractionPanel;
  readonly activePendingInteraction: PendingInteractionPanel | null;
  readonly activeInteractionPosition: number;
  readonly activeInteractionId: string | null;
  readonly isLoadingThreads: boolean;
  readonly isLoadingThread: boolean;
  readonly isSending: boolean;
  readonly isStreamActive: boolean;
  readonly isInteractionSubmitting: boolean;
  readonly streamingTurnId: string | null;
  readonly streamingAssistantText: string;
  readonly finalizingTurnId: string | null;
  readonly runtimeError: string | null;
};

export type LyraThreadRuntimeActions = {
  readonly loadThreads: () => Promise<void>;
  readonly loadThread: (threadId: string) => Promise<void>;
  readonly createThread: (options?: RuntimeThreadOptions) => Promise<string>;
  readonly sendTurn: (input: string, options?: RuntimeThreadOptions) => Promise<void>;
  readonly interruptTurn: () => Promise<void>;
  readonly selectThread: (threadId: string | null) => void;
  readonly setActiveInteractionId: (interactionId: string | null) => void;
  readonly respondToCommandApproval: (response: CommandApprovalResponse) => Promise<void>;
  readonly respondToPlanQuestion: (
    payload: { readonly answers: Record<string, unknown>; readonly note?: string }
  ) => Promise<void>;
};

export type RuntimeThreadOptions = {
  readonly model?: string | undefined;
  readonly modelProvider?: string | null | undefined;
  readonly cwd?: string | null | undefined;
};

type UseLyraThreadRuntimeOptions = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly interactionTextLabels: InteractionTextBundle;
};

const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const readNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const normalizeStatus = (value: unknown): string =>
  readString(value)?.replace(/[_\s-]+/g, "").toLowerCase() ?? "";

const isThreadNotMaterializedError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /not materialized yet/i.test(message)
    || /includeTurns is unavailable before first user message/i.test(message);
};

const requestKeyOf = (requestId: string | number): string => String(requestId);

const createRequestPayload = (
  method: string,
  params: JsonRecord = {}
): LyraClientRequestPayload => ({ method, params });

const toRuntimeEvent = ({
  sessionId,
  turnId,
  phase,
  payload,
}: {
  readonly sessionId: string;
  readonly turnId: string;
  readonly phase: string;
  readonly payload: unknown;
}): AgentRuntimeEvent => ({
  sessionId,
  turnId,
  phase,
  payload,
  timestamp: Date.now(),
  toolOwner: "codex",
});

const requestKindFromMethod = (method: string): AgentPendingInteraction["kind"] | null => {
  if (method === "item/commandExecution/requestApproval") {
    return "command_execution_approval";
  }
  if (method === "item/fileChange/requestApproval") {
    return "file_change_approval";
  }
  if (method === "item/permissions/requestApproval") {
    return "permissions_approval";
  }
  if (method === "item/tool/requestUserInput") {
    return "tool_user_input";
  }
  if (method === "mcpServer/elicitation/request") {
    return "mcp_elicitation";
  }
  return null;
};

const normalizeRequestPayload = (
  method: string,
  params: JsonRecord
): JsonRecord => {
  if (method === "item/commandExecution/requestApproval") {
    return {
      ...params,
      toolName: "terminal.exec",
      input: {
        command: readString(params.command) ?? "",
        cwd: readString(params.cwd) ?? undefined,
      },
      metadata: {
        command: readString(params.command) ?? "",
        riskLevel: "medium",
      },
    };
  }
  if (method === "item/fileChange/requestApproval") {
    return {
      ...params,
      toolName: "filesystem.write",
      input: {
        path: readString(params.grantRoot) ?? "",
      },
      metadata: {
        riskLevel: "medium",
      },
    };
  }
  if (method === "item/permissions/requestApproval") {
    return {
      ...params,
      toolName: "permissions.request",
      input: {
        permissions: params.permissions,
      },
      metadata: {
        riskLevel: "medium",
      },
    };
  }
  return params;
};

const interactionFromServerRequest = (
  requestId: string | number,
  method: string,
  params: JsonRecord
): AgentPendingInteraction | null => {
  const kind = requestKindFromMethod(method);
  if (kind === null) {
    return null;
  }
  const key = requestKeyOf(requestId);
  const now = Date.now();
  const sessionId = readString(params.threadId) ?? "unknown-thread";
  const turnId = readString(params.turnId) ?? "unknown-turn";
  return {
    id: key,
    sessionId,
    turnId,
    kind,
    status: "pending",
    payload: {
      requestId: key,
      codexMethod: method,
      raw: normalizeRequestPayload(method, params),
    },
    createdAt: now,
    updatedAt: now,
  };
};

const findThreadTurn = (
  thread: LyraThread | null,
  turnId: string
): LyraTurn | null =>
  thread?.turns.find((turn) => turn.id === turnId) ?? null;

const responseValueToAnswerStrings = (value: unknown): readonly string[] => {
  if (isRecord(value)) {
    const optionLabel = readString(value.label);
    const freeValue = readString(value.value);
    return [freeValue ?? optionLabel].filter((entry): entry is string => entry !== null);
  }
  const direct = readString(value);
  return direct === null ? [] : [direct];
};

const commandDecisionToCodex = (decision: CommandApprovalResponse["decision"]): string => {
  if (decision === "allow_always") {
    return "acceptForSession";
  }
  if (decision === "deny") {
    return "decline";
  }
  return "accept";
};

export const useLyraThreadRuntime = ({
  desktopApi,
  interactionTextLabels,
}: UseLyraThreadRuntimeOptions): {
  readonly state: LyraThreadRuntimeState;
  readonly actions: LyraThreadRuntimeActions;
} => {
  const lyraApi = desktopApi?.lyra ?? null;
  const [threads, setThreads] = useState<readonly LyraThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [activeThread, setActiveThread] = useState<LyraThread | null>(null);
  const [optimisticUserMessages, setOptimisticUserMessages] = useState<readonly OptimisticUserMessage[]>([]);
  const [liveToolCalls, setLiveToolCalls] = useState<readonly AgentToolCall[]>([]);
  const [latestRuntimeEventByTurn, setLatestRuntimeEventByTurn] = useState<Readonly<Record<string, AgentRuntimeEvent>>>({});
  const [pendingInteractions, setPendingInteractions] = useState<readonly AgentPendingInteraction[]>([]);
  const [serverRequestIds, setServerRequestIds] = useState<Readonly<Record<string, string | number>>>({});
  const [activeInteractionId, setActiveInteractionId] = useState<string | null>(null);
  const [isLoadingThreads, setIsLoadingThreads] = useState(false);
  const [isLoadingThread, setIsLoadingThread] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isStreamActive, setIsStreamActive] = useState(false);
  const [isInteractionSubmitting, setIsInteractionSubmitting] = useState(false);
  const [streamingTurnId, setStreamingTurnId] = useState<string | null>(null);
  const [streamingAssistantText, setStreamingAssistantText] = useState("");
  const [finalizingTurnId, setFinalizingTurnId] = useState<string | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const activeThreadRef = useRef<LyraThread | null>(null);
  const activeThreadIdRef = useRef<string | null>(null);
  const streamingTurnIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeThreadRef.current = activeThread;
  }, [activeThread]);

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    streamingTurnIdRef.current = streamingTurnId;
  }, [streamingTurnId]);

  const activeDetail = useMemo(
    () => activeThread === null ? null : lyraThreadToAgentDetail(activeThread),
    [activeThread]
  );

  const loadThreads = useCallback(async (): Promise<void> => {
    if (lyraApi === null) {
      setThreads([]);
      setActiveThreadId(null);
      setActiveThread(null);
      return;
    }
    setIsLoadingThreads(true);
    try {
      const response = await lyraApi.request<{ data?: readonly unknown[] }>(createRequestPayload("thread/list", {
        limit: 100,
        sortKey: "updated_at",
        sortDirection: "desc",
        archived: false,
        modelProviders: [],
      }));
      const nextThreads = Array.isArray(response.data)
        ? response.data.map(readLyraThread).filter((thread): thread is LyraThread => thread !== null)
        : [];
      setThreads(nextThreads);
      setActiveThreadId((current) => current ?? nextThreads[0]?.id ?? null);
      setRuntimeError(null);
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoadingThreads(false);
    }
  }, [lyraApi]);

  const loadThread = useCallback(async (threadId: string): Promise<void> => {
    if (lyraApi === null || threadId.trim().length === 0) {
      return;
    }
    setIsLoadingThread(true);
    try {
      const response = await lyraApi.request<{ thread?: unknown }>(createRequestPayload("thread/read", {
        threadId,
        includeTurns: true,
      }));
      const nextThread = readLyraThread(response.thread);
      if (nextThread !== null) {
        setActiveThread(nextThread);
        setThreads((current) => {
          const next = current.some((thread) => thread.id === nextThread.id)
            ? current.map((thread) => thread.id === nextThread.id ? nextThread : thread)
            : [nextThread, ...current];
          return [...next].sort((left, right) => right.updatedAt - left.updatedAt);
        });
      }
      setRuntimeError(null);
    } catch (error) {
      if (isThreadNotMaterializedError(error)) {
        setRuntimeError(null);
        return;
      }
      setRuntimeError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoadingThread(false);
    }
  }, [lyraApi]);

  const selectThread = useCallback((threadId: string | null): void => {
    setActiveThreadId(threadId);
    setOptimisticUserMessages([]);
    setStreamingAssistantText("");
    setStreamingTurnId(null);
    setFinalizingTurnId(null);
    setLiveToolCalls([]);
  }, []);

  const createThread = useCallback(async (options: RuntimeThreadOptions = {}): Promise<string> => {
    if (lyraApi === null) {
      throw new Error("Lyra runtime unavailable");
    }
    const response = await lyraApi.request<{ thread?: unknown }>(createRequestPayload("thread/start", {
      ...(options.model !== undefined && options.model.trim().length > 0 ? { model: options.model.trim() } : {}),
      ...(options.modelProvider === null || options.modelProvider === undefined || options.modelProvider.trim().length === 0
        ? {}
        : { modelProvider: options.modelProvider.trim() }),
      ...(options.cwd === null || options.cwd === undefined || options.cwd.trim().length === 0
        ? {}
        : { cwd: options.cwd.trim() }),
      persistExtendedHistory: true,
    }));
    const thread = readLyraThread(response.thread);
    if (thread === null) {
      throw new Error("thread/start did not return a thread");
    }
    setThreads((current) => [thread, ...current.filter((entry) => entry.id !== thread.id)]);
    setActiveThreadId(thread.id);
    setActiveThread(thread);
    setRuntimeError(null);
    return thread.id;
  }, [lyraApi]);

  const sendTurn = useCallback(async (
    input: string,
    options: RuntimeThreadOptions = {}
  ): Promise<void> => {
    if (lyraApi === null) {
      return;
    }
    const text = input.trim();
    if (text.length === 0) {
      return;
    }
    setIsSending(true);
    setRuntimeError(null);
    const createdAt = Date.now();
    const optimisticId = `optimistic:${createdAt.toString()}`;
    setOptimisticUserMessages((current) => [
      ...current,
      {
        id: optimisticId,
        role: "user",
        content: text,
        createdAt,
        optimistic: true,
      },
    ]);
    try {
      const threadId = activeThreadIdRef.current ?? await createThread(options);
      const response = await lyraApi.request<{ turn?: unknown }>(createRequestPayload("turn/start", {
        threadId,
        input: [
          {
            type: "text",
            text,
            textElements: [],
          },
        ],
        ...(options.model !== undefined && options.model.trim().length > 0 ? { model: options.model.trim() } : {}),
        ...(options.cwd === null || options.cwd === undefined || options.cwd.trim().length === 0
          ? {}
          : { cwd: options.cwd.trim() }),
      }));
      const turnId = isRecord(response.turn) ? readString(response.turn.id) : null;
      if (turnId !== null) {
        const event = toRuntimeEvent({
          sessionId: threadId,
          turnId,
          phase: "accepted",
          payload: { threadId, turnId },
        });
        setStreamingTurnId(turnId);
        setIsStreamActive(true);
        setLatestRuntimeEventByTurn((current) => ({ ...current, [turnId]: event }));
      }
    } catch (error) {
      setIsSending(false);
      setIsStreamActive(false);
      setOptimisticUserMessages((current) => current.filter((message) => message.id !== optimisticId));
      setRuntimeError(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }, [createThread, lyraApi]);

  const interruptTurn = useCallback(async (): Promise<void> => {
    if (lyraApi === null || activeThreadIdRef.current === null || streamingTurnIdRef.current === null) {
      return;
    }
    try {
      await lyraApi.request(createRequestPayload("turn/interrupt", {
        threadId: activeThreadIdRef.current,
        turnId: streamingTurnIdRef.current,
      }));
      setIsStreamActive(false);
      setIsSending(false);
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
    }
  }, [lyraApi]);

  const resolveInteraction = useCallback(async (
    interactionId: string,
    result: unknown
  ): Promise<void> => {
    if (lyraApi === null) {
      return;
    }
    const requestId = serverRequestIds[interactionId] ?? interactionId;
    setIsInteractionSubmitting(true);
    try {
      await lyraApi.resolveServerRequest({ requestId, result });
      setPendingInteractions((current) => current.filter((interaction) => interaction.id !== interactionId));
      setServerRequestIds((current) => {
        const next = { ...current };
        delete next[interactionId];
        return next;
      });
      setActiveInteractionId((current) => current === interactionId ? null : current);
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsInteractionSubmitting(false);
    }
  }, [lyraApi, serverRequestIds]);

  const rejectInteraction = useCallback(async (
    interactionId: string,
    message = "Rejected by Lyra desktop"
  ): Promise<void> => {
    if (lyraApi === null) {
      return;
    }
    const requestId = serverRequestIds[interactionId] ?? interactionId;
    setIsInteractionSubmitting(true);
    try {
      await lyraApi.rejectServerRequest({
        requestId,
        error: {
          code: -32000,
          message,
        },
      });
      setPendingInteractions((current) => current.filter((interaction) => interaction.id !== interactionId));
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsInteractionSubmitting(false);
    }
  }, [lyraApi, serverRequestIds]);

  const respondToCommandApproval = useCallback(async (
    response: CommandApprovalResponse
  ): Promise<void> => {
    const interaction = pendingInteractions.find((entry) => entry.id === response.requestId) ?? null;
    if (interaction === null) {
      return;
    }
    if (response.decision === "deny" && interaction.kind === "mcp_elicitation") {
      await rejectInteraction(interaction.id);
      return;
    }
    if (interaction.kind === "file_change_approval") {
      await resolveInteraction(interaction.id, { decision: commandDecisionToCodex(response.decision) });
      return;
    }
    if (interaction.kind === "permissions_approval") {
      const raw = isRecord(interaction.payload.raw) ? interaction.payload.raw : {};
      if (response.decision === "deny") {
        await rejectInteraction(interaction.id);
        return;
      }
      await resolveInteraction(interaction.id, {
        permissions: raw.permissions ?? {},
        scope: "turn",
      });
      return;
    }
    await resolveInteraction(interaction.id, { decision: commandDecisionToCodex(response.decision) });
  }, [pendingInteractions, rejectInteraction, resolveInteraction]);

  const respondToPlanQuestion = useCallback(async (
    payload: { readonly answers: Record<string, unknown>; readonly note?: string }
  ): Promise<void> => {
    const activeId = activeInteractionId ?? pendingInteractions[0]?.id ?? null;
    if (activeId === null) {
      return;
    }
    const interaction = pendingInteractions.find((entry) => entry.id === activeId) ?? null;
    if (interaction === null) {
      return;
    }
    if (interaction.kind === "mcp_elicitation") {
      await resolveInteraction(interaction.id, {
        action: "accept",
        content: payload.answers,
      });
      return;
    }
    const answers = Object.fromEntries(
      Object.entries(payload.answers).map(([id, value]) => [
        id,
        { answers: responseValueToAnswerStrings(value) },
      ])
    );
    await resolveInteraction(interaction.id, { answers });
  }, [activeInteractionId, pendingInteractions, resolveInteraction]);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    if (activeThreadId === null) {
      setActiveThread(null);
      return;
    }
    void loadThread(activeThreadId);
  }, [activeThreadId, loadThread]);

  useEffect(() => {
    if (lyraApi === null) {
      return;
    }
    return lyraApi.onEvent((event) => {
      if (event.kind === "startup_failed") {
        setRuntimeError(event.error.message);
        return;
      }
      if (event.kind === "disconnected") {
        setRuntimeError(event.message ?? event.error?.message ?? "Lyra runtime disconnected");
        setIsStreamActive(false);
        setIsSending(false);
        return;
      }
      if (event.kind === "ready") {
        setRuntimeError(null);
        return;
      }
      if (event.kind === "request") {
        const request = isRecord(event.request) ? event.request : null;
        const requestId = request?.id;
        const method = readString(request?.method);
        const params = isRecord(request?.params) ? request.params : {};
        if ((typeof requestId !== "string" && typeof requestId !== "number") || method === null) {
          return;
        }
        const interaction = interactionFromServerRequest(requestId, method, params);
        if (interaction === null) {
          return;
        }
        setPendingInteractions((current) => mergePendingInteractionLists(current, [interaction]));
        setServerRequestIds((current) => ({ ...current, [interaction.id]: requestId }));
        setActiveInteractionId((current) => current ?? interaction.id);
        setIsInteractionSubmitting(false);
        setIsStreamActive(true);
        return;
      }
      if (event.kind !== "notification") {
        return;
      }
      const notification = isRecord(event.notification) ? event.notification : null;
      const method = readString(notification?.method);
      const params = isRecord(notification?.params) ? notification.params : {};
      if (method === null) {
        return;
      }
      if (method === "thread/started") {
        const thread = readLyraThread(params.thread);
        if (thread !== null) {
          setThreads((current) => [thread, ...current.filter((entry) => entry.id !== thread.id)]);
          setActiveThreadId(thread.id);
          setActiveThread(thread);
        }
        return;
      }
      if (method === "turn/started") {
        const threadId = readString(params.threadId);
        const turn = isRecord(params.turn) ? params.turn : null;
        const turnId = turn === null ? null : readString(turn.id);
        if (threadId !== null && turnId !== null) {
          setStreamingTurnId(turnId);
          setStreamingAssistantText("");
          setIsSending(false);
          setIsStreamActive(true);
          setFinalizingTurnId(null);
          setLatestRuntimeEventByTurn((current) => ({
            ...current,
            [turnId]: toRuntimeEvent({
              sessionId: threadId,
              turnId,
              phase: "started",
              payload: params,
            }),
          }));
          setOptimisticUserMessages([]);
          if (threadId === activeThreadIdRef.current) {
            void loadThread(threadId);
          }
        }
        return;
      }
      if (method === "item/agentMessage/delta") {
        const threadId = readString(params.threadId);
        const turnId = readString(params.turnId);
        const delta = typeof params.delta === "string" ? params.delta : "";
        if (threadId !== null && turnId !== null && threadId === activeThreadIdRef.current) {
          setStreamingTurnId(turnId);
          setIsStreamActive(true);
          setStreamingAssistantText((current) => current + delta);
          setLatestRuntimeEventByTurn((current) => ({
            ...current,
            [turnId]: toRuntimeEvent({
              sessionId: threadId,
              turnId,
              phase: "assistant_delta",
              payload: { delta },
            }),
          }));
        }
        return;
      }
      if (method === "item/started" || method === "item/completed") {
        const threadId = readString(params.threadId);
        const turnId = readString(params.turnId);
        const item = isRecord(params.item) && readString(params.item.type) !== null
          ? params.item as LyraThreadItem
          : null;
        if (threadId !== null && turnId !== null && item !== null) {
          const turn = findThreadTurn(activeThreadRef.current, turnId) ?? {
            id: turnId,
            status: method === "item/started" ? "inProgress" : "completed",
            items: [],
          };
          const thread = activeThreadRef.current ?? {
            id: threadId,
            preview: "",
            modelProvider: "lyra",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            turns: [],
          };
          const call = threadItemToToolCall(thread, turn, item, 0);
          if (call !== null) {
            setLiveToolCalls((current) => {
              const next = current.filter((entry) => entry.id !== call.id);
              return [...next, call].slice(-48);
            });
          }
        }
        return;
      }
      if (method === "turn/completed") {
        const threadId = readString(params.threadId);
        const turn = isRecord(params.turn) ? params.turn : null;
        const turnId = turn === null ? streamingTurnIdRef.current : readString(turn.id);
        setIsSending(false);
        setIsStreamActive(false);
        setStreamingAssistantText("");
        setStreamingTurnId(null);
        if (turnId !== null) {
          setFinalizingTurnId(turnId);
          setLatestRuntimeEventByTurn((current) => ({
            ...current,
            [turnId]: toRuntimeEvent({
              sessionId: threadId ?? activeThreadIdRef.current ?? "unknown-thread",
              turnId,
              phase: normalizeStatus(turn?.status) === "failed" ? "failed" : "completed",
              payload: params,
            }),
          }));
        }
        if (threadId !== null) {
          void loadThread(threadId);
          void loadThreads();
        }
        return;
      }
      if (method === "serverRequest/resolved") {
        const requestId = readString(params.requestId) ?? readNumber(params.requestId)?.toString() ?? null;
        if (requestId !== null) {
          setPendingInteractions((current) => current.filter((interaction) => interaction.id !== requestId));
          setActiveInteractionId((current) => current === requestId ? null : current);
        }
        return;
      }
      if (
        method === "thread/name/updated"
        || method === "thread/status/changed"
        || method === "memory/trimmed"
        || method === "memory/shared/updated"
        || method === "memory/frozen/updated"
        || method === "memory/promptCache/updated"
      ) {
        const threadId = readString(params.threadId);
        if (threadId !== null && threadId === activeThreadIdRef.current) {
          void loadThread(threadId);
        }
        void loadThreads();
      }
    });
  }, [loadThread, loadThreads, lyraApi]);

  const pendingInteractionQueue = useMemo(
    () =>
      sortPendingInteractions(pendingInteractions)
        .map((interaction) => toPendingInteractionPanel(interaction, interactionTextLabels))
        .filter((panel): panel is PendingInteractionPanel => panel !== null),
    [interactionTextLabels, pendingInteractions]
  );
  const activePendingInteraction = useMemo(
    () =>
      activeInteractionId === null
        ? pendingInteractionQueue[0] ?? null
        : pendingInteractionQueue.find((panel) => panel.request.id === activeInteractionId) ?? pendingInteractionQueue[0] ?? null,
    [activeInteractionId, pendingInteractionQueue]
  );
  const activeInteractionPanel = activePendingInteraction;
  const activeInteractionPosition = activePendingInteraction === null
    ? 0
    : pendingInteractionQueue.findIndex((panel) => panel.request.id === activePendingInteraction.request.id) + 1;

  return {
    state: {
      threads,
      activeThreadId,
      activeThread,
      activeDetail,
      optimisticUserMessages,
      liveToolCalls,
      latestRuntimeEventByTurn,
      pendingInteractions,
      pendingInteractionQueue,
      activeInteractionPanel,
      activePendingInteraction,
      activeInteractionPosition,
      activeInteractionId,
      isLoadingThreads,
      isLoadingThread,
      isSending,
      isStreamActive,
      isInteractionSubmitting,
      streamingTurnId,
      streamingAssistantText,
      finalizingTurnId,
      runtimeError,
    },
    actions: {
      loadThreads,
      loadThread,
      createThread,
      sendTurn,
      interruptTurn,
      selectThread,
      setActiveInteractionId,
      respondToCommandApproval,
      respondToPlanQuestion,
    },
  };
};
