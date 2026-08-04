import type { LspDocumentRequest } from "../../shared/desktop-bridge";
import type { DownloadManagerTask } from "../../shared/download-manager";
import type {
  LyraRuntimeClient,
  RuntimeEventListener,
  RuntimeRequestHandler
} from "../runtime-client";
import { RUNTIME_CLIENT_LIFECYCLE_EVENT } from "../runtime-client";
import type {
  RuntimeActivity,
  RuntimeActivityKind,
  RuntimeUpdateCoordinator
} from "./coordinator";

export type RuntimeActivityTrackingClient = {
  readonly client: LyraRuntimeClient;
  readonly replayLspDocuments: (
    activities?: readonly RuntimeActivity[]
  ) => Promise<void>;
  readonly dispose: () => void;
};

const AGENT_START_METHODS = new Set([
  "agent.turn.start",
  "agent.turn.send",
  "agent.turn.resume",
  "agent.action.improve",
  "agent.action.refactor",
  "agent.action.review",
  "agent.action.judge",
  "agent.action.poke"
]);

const DOWNLOAD_START_METHODS = new Set([
  "download.enqueue",
  "download.resume",
  "download.resume_all",
  "download.retry",
  "download.import_external_browser"
]);

const TERMINAL_METHODS = new Set(["terminal.sessions.create"]);
const LSP_DOCUMENT_METHODS = new Set([
  "lsp.documents.open",
  "lsp.documents.change",
  "lsp.documents.save"
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const agentTurnId = (value: unknown): string | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const sessionId = readString(value.sessionId);
  const turnId = readString(value.turnId);
  return sessionId === undefined || turnId === undefined
    ? undefined
    : `${sessionId}:${turnId}`;
};

const terminalSessionId = (value: unknown): string | undefined =>
  isRecord(value) ? readString(value.sessionId) : undefined;

const lspDocumentId = (value: unknown): string | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const sessionId = readString(value.sessionId);
  const filePath = readString(value.filePath);
  return sessionId === undefined || filePath === undefined
    ? undefined
    : `${sessionId}\u0000${filePath}`;
};

const isLspDocumentRequest = (value: unknown): value is LspDocumentRequest =>
  isRecord(value)
  && readString(value.sessionId) !== undefined
  && readString(value.filePath) !== undefined
  && readString(value.languageId) !== undefined
  && typeof value.content === "string"
  && typeof value.version === "number"
  && Number.isFinite(value.version);

const isDownloadTask = (value: unknown): value is DownloadManagerTask =>
  isRecord(value)
  && readString(value.id) !== undefined
  && typeof value.state === "string";

const isDownloadActive = (task: DownloadManagerTask): boolean =>
  task.state === "downloading" || task.postProcessingState === "running";

const admissionKindForMethod = (method: string): RuntimeActivityKind | undefined => {
  if (AGENT_START_METHODS.has(method)) {
    return "agent-turn";
  }
  if (TERMINAL_METHODS.has(method)) {
    return "terminal-session";
  }
  if (DOWNLOAD_START_METHODS.has(method)) {
    return "download-task";
  }
  if (LSP_DOCUMENT_METHODS.has(method)) {
    return "lsp-document";
  }
  return undefined;
};

export const createRuntimeActivityTrackingClient = (
  runtimeClient: LyraRuntimeClient,
  coordinator: RuntimeUpdateCoordinator
): RuntimeActivityTrackingClient => {
  const lspDocuments = new Map<string, LspDocumentRequest>();
  const finishedAgentTurns = new Set<string>();
  const exitedTerminalSessions = new Set<string>();
  let recoveryInFlight: Promise<void> | null = null;
  let disposed = false;

  const rememberFinished = (values: Set<string>, id: string): void => {
    values.add(id);
    if (values.size > 1_024) {
      const oldest = values.values().next();
      if (!oldest.done) {
        values.delete(oldest.value);
      }
    }
  };

  const markAgentResult = (result: unknown): void => {
    if (!isRecord(result) || result.status !== "running") {
      return;
    }
    const id = agentTurnId(result);
    if (id !== undefined) {
      if (finishedAgentTurns.delete(id)) {
        return;
      }
      coordinator.markActive({
        kind: "agent-turn",
        id,
        restartable: false
      });
    }
  };

  const syncDownloadTask = (task: DownloadManagerTask): void => {
    if (isDownloadActive(task)) {
      coordinator.markActive({
        kind: "download-task",
        id: task.id,
        restartable: false
      });
    } else {
      coordinator.markIdle("download-task", task.id);
    }
  };

  const syncDownloadValue = (value: unknown): void => {
    if (!isRecord(value)) {
      return;
    }
    if (Array.isArray(value.tasks)) {
      const seen = new Set<string>();
      for (const task of value.tasks) {
        if (isDownloadTask(task)) {
          seen.add(task.id);
          syncDownloadTask(task);
        }
      }
      for (const activity of coordinator.readStatus().blockers) {
        if (activity.kind === "download-task" && !seen.has(activity.id)) {
          coordinator.markIdle(activity.kind, activity.id);
        }
      }
      return;
    }
    if (isDownloadTask(value)) {
      syncDownloadTask(value);
    }
  };

  const trackLspDocument = (request: LspDocumentRequest): void => {
    const id = lspDocumentId(request);
    if (id === undefined) {
      return;
    }
    const snapshot = { ...request };
    lspDocuments.set(id, snapshot);
    coordinator.markActive({
      kind: "lsp-document",
      id,
      restartable: true,
      metadata: snapshot
    });
  };

  const replayDocuments = async (
    activities = coordinator.readStatus().restartable
  ): Promise<void> => {
    const documents = activities
      .filter((activity) => activity.kind === "lsp-document")
      .map((activity) => activity.metadata)
      .filter(isLspDocumentRequest)
      .sort((left, right) => {
        const leftId = lspDocumentId(left) ?? "";
        const rightId = lspDocumentId(right) ?? "";
        return leftId.localeCompare(rightId);
      });
    for (const document of documents) {
      await runtimeClient.request<void>("lsp.documents.open", document);
      trackLspDocument(document);
    }
  };

  const recoverAfterReconnect = (): void => {
    if (disposed || recoveryInFlight !== null) {
      return;
    }
    recoveryInFlight = (async () => {
      await replayDocuments();
      const downloads = await runtimeClient.request<unknown>("download.list", {});
      syncDownloadValue(downloads);
    })()
      .catch((error) => {
        console.warn("[lyra-runtime] failed to restore activity after reconnect", error);
      })
      .finally(() => {
        recoveryInFlight = null;
      });
  };

  const handleRuntimeEvent = (eventName: string, payload: unknown): void => {
    if (eventName === RUNTIME_CLIENT_LIFECYCLE_EVENT && isRecord(payload)) {
      if (payload.kind === "disconnected") {
        coordinator.clearKind("agent-turn");
        coordinator.clearKind("terminal-session");
        coordinator.clearKind("download-task");
        finishedAgentTurns.clear();
        exitedTerminalSessions.clear();
      } else if (payload.kind === "connected" && payload.recovered === true) {
        recoverAfterReconnect();
      }
      return;
    }

    if (eventName === "agent.runtime" && isRecord(payload)) {
      const id = agentTurnId(payload);
      if (id === undefined) {
        return;
      }
      const kind = readString(payload.kind);
      const state = readString(payload.state);
      if (
        kind === "turnFinished"
        || kind === "turnFailed"
        || kind === "turnInterrupted"
        || kind === "turnCompleted"
        || (kind === "turnStateChanged"
          && (state === "completed"
            || state === "cancelled"
            || state === "cancelled_by_user"
            || state === "interrupted"))
      ) {
        rememberFinished(finishedAgentTurns, id);
        coordinator.markIdle("agent-turn", id);
      } else if (kind === "turnStarted" || kind === "turnRecovered") {
        coordinator.markActive({ kind: "agent-turn", id, restartable: false });
      }
      return;
    }

    if (eventName === "terminal.runtime" && isRecord(payload)) {
      if (payload.kind === "exit") {
        const id = terminalSessionId(payload);
        if (id !== undefined) {
          rememberFinished(exitedTerminalSessions, id);
          coordinator.markIdle("terminal-session", id);
        }
      }
      return;
    }

    if (eventName === "download.runtime" && isRecord(payload)) {
      if (payload.kind === "snapshot") {
        syncDownloadValue(payload.snapshot);
      } else if (payload.kind === "task-updated") {
        syncDownloadValue(payload.task);
      } else if (payload.kind === "task-removed") {
        const taskId = readString(payload.taskId);
        if (taskId !== undefined) {
          coordinator.markIdle("download-task", taskId);
        }
      }
    }
  };

  const unsubscribeTracker = runtimeClient.subscribe(handleRuntimeEvent);

  const trackedRequest = async <T>(method: string, payload: unknown): Promise<T> => {
    const admissionKind = admissionKindForMethod(method);
    if (admissionKind !== undefined) {
      coordinator.assertAdmission(admissionKind);
    }

    const lspMutationRequest = LSP_DOCUMENT_METHODS.has(method) && isLspDocumentRequest(payload)
      ? payload
      : undefined;
    const lspId = lspDocumentId(payload);
    const previousLspDocument = lspId === undefined
      ? undefined
      : lspDocuments.get(lspId);
    const lspMutation = lspMutationRequest !== undefined;
    const lspClose = method === "lsp.documents.close" && lspId !== undefined;
    if (lspMutationRequest !== undefined && lspId !== undefined) {
      coordinator.markActive({
        kind: "lsp-document",
        id: lspId,
        restartable: false,
        metadata: { ...lspMutationRequest }
      });
    } else if (lspClose) {
      coordinator.markActive({
        kind: "lsp-document",
        id: lspId,
        restartable: false,
        ...(previousLspDocument === undefined
          ? {}
          : { metadata: previousLspDocument })
      });
    }

    try {
      const result = await runtimeClient.request<T>(method, payload);
      if (AGENT_START_METHODS.has(method)) {
        markAgentResult(result);
      } else if (method === "terminal.sessions.create") {
        const id = terminalSessionId(result);
        if (id !== undefined) {
          if (!exitedTerminalSessions.delete(id)) {
            coordinator.markActive({
              kind: "terminal-session",
              id,
              restartable: false
            });
          }
        }
      } else if (method === "terminal.sessions.close") {
        const id = terminalSessionId(payload);
        if (id !== undefined) {
          coordinator.markIdle("terminal-session", id);
        }
      } else if (method.startsWith("download.")) {
        syncDownloadValue(result);
      } else if (lspMutationRequest !== undefined) {
        trackLspDocument(lspMutationRequest);
      } else if (lspClose) {
        lspDocuments.delete(lspId);
        coordinator.markIdle("lsp-document", lspId);
      }
      return result;
    } catch (error) {
      if (lspMutation || lspClose) {
        if (previousLspDocument === undefined || lspId === undefined) {
          if (lspId !== undefined) {
            coordinator.markIdle("lsp-document", lspId);
          }
        } else {
          trackLspDocument(previousLspDocument);
        }
      }
      if (
        method === "terminal.sessions.close"
        && error instanceof Error
        && /session not found/iu.test(error.message)
      ) {
        const id = terminalSessionId(payload);
        if (id !== undefined) {
          coordinator.markIdle("terminal-session", id);
        }
      }
      throw error;
    }
  };

  const client: LyraRuntimeClient = {
    request: trackedRequest,
    registerRequestHandler: (method: string, handler: RuntimeRequestHandler) => {
      runtimeClient.registerRequestHandler(method, handler);
    },
    unregisterRequestHandler: (method: string) => {
      runtimeClient.unregisterRequestHandler(method);
    },
    subscribe: (listener: RuntimeEventListener) => runtimeClient.subscribe(listener),
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      unsubscribeTracker();
      coordinator.clearKind("agent-turn");
      coordinator.clearKind("terminal-session");
      coordinator.clearKind("download-task");
      coordinator.clearKind("lsp-document");
      lspDocuments.clear();
      finishedAgentTurns.clear();
      exitedTerminalSessions.clear();
    }
  };

  return {
    client,
    replayLspDocuments: replayDocuments,
    dispose: client.dispose
  };
};
