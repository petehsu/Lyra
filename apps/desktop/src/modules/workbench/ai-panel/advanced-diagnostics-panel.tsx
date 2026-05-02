import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Database,
  ListTree,
  MemoryStick,
  Pause,
  Play,
  RefreshCw,
  Terminal,
  X
} from "lucide-react";

import type { GlobalDialogOpenRequest } from "../global-dialog";
import { createTranslator, type WorkbenchLocale } from "../i18n";
import type {
  AgentAdvancedElicitationResponse,
  AgentAdvancedMemoryMode,
  AgentAdvancedRuntimeActions
} from "./use-ai-panel-surface-runtime";

type AdvancedDiagnosticsPanelProps = {
  readonly locale: WorkbenchLocale;
  readonly activeThreadId: string | null;
  readonly actions: AgentAdvancedRuntimeActions;
  readonly openDialog?: ((request: GlobalDialogOpenRequest) => void) | undefined;
  readonly onClose: () => void;
};

type StatusState =
  | { readonly kind: "idle" }
  | { readonly kind: "success"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const readStringArray = (value: unknown): readonly string[] =>
  isRecord(value) && Array.isArray(value.data)
    ? value.data.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];

const readDataArray = (value: unknown): readonly unknown[] =>
  isRecord(value) && Array.isArray(value.data) ? value.data : [];

const previewJson = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const truncate = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}...`;

export const AdvancedDiagnosticsPanel = ({
  locale,
  activeThreadId,
  actions,
  openDialog,
  onClose
}: AdvancedDiagnosticsPanelProps) => {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const [loadedThreads, setLoadedThreads] = useState<readonly string[]>([]);
  const [collaborationModes, setCollaborationModes] = useState<readonly unknown[]>([]);
  const [turns, setTurns] = useState<readonly unknown[]>([]);
  const [shellCommand, setShellCommand] = useState("");
  const [itemsJson, setItemsJson] = useState("[\n  \n]");
  const [status, setStatus] = useState<StatusState>({ kind: "idle" });
  const [isLoading, setIsLoading] = useState(false);
  const hasActiveThread = activeThreadId !== null && activeThreadId.trim().length > 0;

  const runRequest = useCallback(async (
    operation: () => Promise<unknown>,
    successMessage = t("ai.advancedRequestSucceeded")
  ): Promise<void> => {
    setIsLoading(true);
    setStatus({ kind: "idle" });
    try {
      await operation();
      setStatus({ kind: "success", message: successMessage });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  const refreshRuntime = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setStatus({ kind: "idle" });
    try {
      const [loadedResponse, modesResponse] = await Promise.all([
        actions.listLoadedThreads(),
        actions.listCollaborationModes()
      ]);
      setLoadedThreads(readStringArray(loadedResponse));
      setCollaborationModes(readDataArray(modesResponse));
      setStatus({ kind: "success", message: t("ai.advancedRequestSucceeded") });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setIsLoading(false);
    }
  }, [actions, t]);

  useEffect(() => {
    void refreshRuntime();
  }, [refreshRuntime]);

  const loadTurns = useCallback(async (): Promise<void> => {
    if (!hasActiveThread || activeThreadId === null) {
      return;
    }
    await runRequest(async () => {
      const response = await actions.listThreadTurns(activeThreadId);
      setTurns(readDataArray(response));
    });
  }, [actions, activeThreadId, hasActiveThread, runRequest]);

  const setMemoryMode = useCallback(async (mode: AgentAdvancedMemoryMode): Promise<void> => {
    if (!hasActiveThread || activeThreadId === null) {
      return;
    }
    await runRequest(async () => {
      await actions.setThreadMemoryMode(activeThreadId, mode);
    });
  }, [actions, activeThreadId, hasActiveThread, runRequest]);

  const updateElicitation = useCallback(async (
    operation: (threadId: string) => Promise<AgentAdvancedElicitationResponse>
  ): Promise<void> => {
    if (!hasActiveThread || activeThreadId === null) {
      return;
    }
    setIsLoading(true);
    setStatus({ kind: "idle" });
    try {
      const response = await operation(activeThreadId);
      setStatus({
        kind: "success",
        message: `${t("ai.advancedElicitation")}: ${String(response.count ?? 0)}`
      });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setIsLoading(false);
    }
  }, [activeThreadId, hasActiveThread, t]);

  const confirmDangerousAction = useCallback((request: GlobalDialogOpenRequest): boolean => {
    if (openDialog === undefined) {
      setStatus({ kind: "error", message: t("ai.advancedConfirmationUnavailable") });
      return false;
    }
    openDialog(request);
    return true;
  }, [openDialog, t]);

  const confirmShellCommand = useCallback((): void => {
    if (!hasActiveThread || activeThreadId === null) {
      return;
    }
    const command = shellCommand.trim();
    if (command.length === 0) {
      return;
    }
    confirmDangerousAction({
      title: t("ai.advancedConfirmShellTitle"),
      description: t("ai.advancedConfirmShellDescription"),
      source: {
        title: truncate(command, 120),
        subtitle: activeThreadId,
        iconLabel: "SH",
        iconTone: "danger"
      },
      copyItems: [
        {
          id: "command",
          label: t("permission.command"),
          value: command
        }
      ],
      actions: [
        {
          id: "cancel",
          label: t("ai.advancedConfirmCancel")
        },
        {
          id: "confirm",
          label: t("ai.advancedConfirmShellConfirm"),
          tone: "danger",
          onSelect: () => {
            void runRequest(async () => {
              await actions.runThreadShellCommand(activeThreadId, command);
              setShellCommand("");
            });
          }
        }
      ]
    });
  }, [actions, activeThreadId, confirmDangerousAction, hasActiveThread, runRequest, shellCommand, t]);

  const confirmInjectItems = useCallback((): void => {
    if (!hasActiveThread || activeThreadId === null) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(itemsJson);
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      return;
    }
    if (!Array.isArray(parsed)) {
      setStatus({ kind: "error", message: t("ai.advancedJsonArrayRequired") });
      return;
    }
    const preview = previewJson(parsed);
    confirmDangerousAction({
      title: t("ai.advancedConfirmInjectTitle"),
      description: t("ai.advancedConfirmInjectDescription"),
      source: {
        title: `${String(parsed.length)} ${t("ai.advancedInjectItems")}`,
        subtitle: activeThreadId,
        iconLabel: "JSON",
        iconTone: "danger"
      },
      copyItems: [
        {
          id: "items",
          label: t("ai.advancedInjectItems"),
          value: preview
        }
      ],
      actions: [
        {
          id: "cancel",
          label: t("ai.advancedConfirmCancel")
        },
        {
          id: "confirm",
          label: t("ai.advancedConfirmInjectConfirm"),
          tone: "danger",
          onSelect: () => {
            void runRequest(async () => {
              await actions.injectThreadItems(activeThreadId, parsed as readonly unknown[]);
            });
          }
        }
      ]
    });
  }, [actions, activeThreadId, confirmDangerousAction, hasActiveThread, itemsJson, runRequest, t]);

  return (
    <section className="lyra-ai-advanced-panel" aria-label={t("ai.advancedTitle")}>
      <header className="lyra-ai-advanced-panel__header">
        <span className="lyra-ai-advanced-panel__title">
          <Database size={14} aria-hidden="true" />
          <strong>{t("ai.advancedTitle")}</strong>
        </span>
        <button
          type="button"
          className="lyra-ai-advanced-panel__icon"
          aria-label={t("ai.planDraftClose")}
          title={t("ai.planDraftClose")}
          onClick={onClose}
        >
          <X size={15} aria-hidden="true" />
        </button>
      </header>

      <div className="lyra-ai-advanced-panel__section">
        <div className="lyra-ai-advanced-panel__section-header">
          <span>{t("ai.advancedRuntimeSection")}</span>
          <button
            type="button"
            className="lyra-ai-advanced-panel__button lyra-ai-advanced-panel__button-compact"
            disabled={isLoading}
            onClick={() => {
              void refreshRuntime();
            }}
          >
            <RefreshCw size={13} aria-hidden="true" />
            <span>{t("ai.advancedRefresh")}</span>
          </button>
        </div>
        <div className="lyra-ai-advanced-panel__columns">
          <div className="lyra-ai-advanced-panel__list" aria-label={t("ai.advancedLoadedThreads")}>
            <strong>{t("ai.advancedLoadedThreads")}</strong>
            {loadedThreads.length === 0 ? (
              <span className="lyra-ai-advanced-panel__empty">{t("ai.advancedEmpty")}</span>
            ) : loadedThreads.map((threadId) => (
              <code key={threadId}>{threadId}</code>
            ))}
          </div>
          <div className="lyra-ai-advanced-panel__list" aria-label={t("ai.advancedCollaborationModes")}>
            <strong>{t("ai.advancedCollaborationModes")}</strong>
            {collaborationModes.length === 0 ? (
              <span className="lyra-ai-advanced-panel__empty">{t("ai.advancedEmpty")}</span>
            ) : collaborationModes.map((mode, index) => {
              const name = isRecord(mode) ? readString(mode.name) : null;
              const model = isRecord(mode) ? readString(mode.model) : null;
              return (
                <span key={`${name ?? "mode"}-${String(index)}`}>
                  {name ?? previewJson(mode)}
                  {model === null ? null : <small>{model}</small>}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      <div className="lyra-ai-advanced-panel__section">
        <div className="lyra-ai-advanced-panel__section-header">
          <span>{t("ai.advancedActiveThread")}</span>
          <code>{activeThreadId ?? t("ai.advancedNoActiveThread")}</code>
        </div>
        <div className="lyra-ai-advanced-panel__toolbar">
          <button
            type="button"
            className="lyra-ai-advanced-panel__button"
            disabled={!hasActiveThread || isLoading}
            onClick={() => {
              void setMemoryMode("enabled");
            }}
          >
            <MemoryStick size={13} aria-hidden="true" />
            <span>{t("ai.advancedMemoryEnabled")}</span>
          </button>
          <button
            type="button"
            className="lyra-ai-advanced-panel__button"
            disabled={!hasActiveThread || isLoading}
            onClick={() => {
              void setMemoryMode("disabled");
            }}
          >
            <MemoryStick size={13} aria-hidden="true" />
            <span>{t("ai.advancedMemoryDisabled")}</span>
          </button>
          <button
            type="button"
            className="lyra-ai-advanced-panel__button"
            disabled={!hasActiveThread || isLoading}
            onClick={() => {
              void updateElicitation(actions.incrementElicitation);
            }}
          >
            <Pause size={13} aria-hidden="true" />
            <span>{t("ai.advancedIncrement")}</span>
          </button>
          <button
            type="button"
            className="lyra-ai-advanced-panel__button"
            disabled={!hasActiveThread || isLoading}
            onClick={() => {
              void updateElicitation(actions.decrementElicitation);
            }}
          >
            <Play size={13} aria-hidden="true" />
            <span>{t("ai.advancedDecrement")}</span>
          </button>
          <button
            type="button"
            className="lyra-ai-advanced-panel__button"
            disabled={!hasActiveThread || isLoading}
            onClick={() => {
              void loadTurns();
            }}
          >
            <ListTree size={13} aria-hidden="true" />
            <span>{t("ai.advancedLoadTurns")}</span>
          </button>
        </div>
        {turns.length === 0 ? null : (
          <div className="lyra-ai-advanced-panel__list lyra-ai-advanced-panel__turns">
            <strong>{t("ai.advancedTurns")}</strong>
            {turns.map((turn, index) => {
              const id = isRecord(turn) ? readString(turn.id) : null;
              const statusValue = isRecord(turn) ? readString(turn.status) : null;
              return (
                <span key={`${id ?? "turn"}-${String(index)}`}>
                  {id ?? previewJson(turn)}
                  {statusValue === null ? null : <small>{statusValue}</small>}
                </span>
              );
            })}
          </div>
        )}
      </div>

      <div className="lyra-ai-advanced-panel__section lyra-ai-advanced-panel__danger">
        <div className="lyra-ai-advanced-panel__section-header">
          <span>
            <AlertTriangle size={13} aria-hidden="true" />
            {t("ai.advancedDangerZone")}
          </span>
        </div>
        <label className="lyra-ai-advanced-panel__field">
          <span>{t("ai.advancedShellCommand")}</span>
          <textarea
            value={shellCommand}
            placeholder={t("ai.advancedShellPlaceholder")}
            disabled={!hasActiveThread}
            onChange={(event) => {
              setShellCommand(event.target.value);
            }}
          />
        </label>
        <button
          type="button"
          className="lyra-ai-advanced-panel__button lyra-ai-advanced-panel__button-danger"
          disabled={!hasActiveThread || shellCommand.trim().length === 0 || isLoading}
          onClick={confirmShellCommand}
        >
          <Terminal size={13} aria-hidden="true" />
          <span>{t("ai.advancedRunCommand")}</span>
        </button>
        <label className="lyra-ai-advanced-panel__field">
          <span>{t("ai.advancedInjectItems")}</span>
          <textarea
            value={itemsJson}
            placeholder={t("ai.advancedInjectPlaceholder")}
            disabled={!hasActiveThread}
            onChange={(event) => {
              setItemsJson(event.target.value);
            }}
          />
        </label>
        <button
          type="button"
          className="lyra-ai-advanced-panel__button lyra-ai-advanced-panel__button-danger"
          disabled={!hasActiveThread || itemsJson.trim().length === 0 || isLoading}
          onClick={confirmInjectItems}
        >
          <Database size={13} aria-hidden="true" />
          <span>{t("ai.advancedInject")}</span>
        </button>
      </div>

      {status.kind === "idle" ? null : (
        <div className={`lyra-ai-advanced-panel__status lyra-ai-advanced-panel__status-${status.kind}`}>
          {status.message}
        </div>
      )}
    </section>
  );
};
