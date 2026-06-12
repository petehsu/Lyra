import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Diff,
  GitBranch,
  GitCommitHorizontal,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw
} from "lucide-react";

import {
  AppEmptyState,
  AppErrorState,
  AppIconButton,
  AppLoadingState,
  AppObjectRow,
  AppStatusMessage,
  AppToolbarButton
} from "@renderer/ui/components";
import type {
  AgentGitChangedFile,
  AgentGitDiffScope,
  AgentGitStatusSnapshot
} from "../../../shared/desktop-bridge";
import { useWorkbenchTitlebarContribution } from "../shell/titlebar-context";
import type {
  AgentGitDiffState,
  AgentGitLabels,
  AgentGitStatusState,
  AgentGitSurfaceProps
} from "./types";

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const joinClassNames = (...values: Array<string | false | null | undefined>): string =>
  values.filter((value): value is string => typeof value === "string" && value.length > 0).join(" ");

const statusLabel = (status: AgentGitChangedFile["status"]): string => {
  switch (status) {
    case "added":
      return "A";
    case "copied":
      return "C";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "typeChanged":
      return "T";
    case "untracked":
      return "U";
    case "conflicted":
      return "!";
    case "modified":
    default:
      return "M";
  }
};

const branchLabel = (snapshot: AgentGitStatusSnapshot | null, fallback: string): string => {
  if (snapshot?.branch !== undefined && snapshot.branch !== null && snapshot.branch.trim().length > 0) {
    return snapshot.branch;
  }
  return fallback;
};

const AgentGitTitlebarBridge = ({
  labels,
  snapshot,
  title,
  onRefresh
}: {
  readonly labels: AgentGitLabels;
  readonly snapshot: AgentGitStatusSnapshot | null;
  readonly title: string;
  readonly onRefresh: () => void;
}) => {
  const contribution = useMemo(
    () => ({
      ariaLabel: labels.title,
      leading: (
        <span className="lyra-titlebar-context-chip" title={title}>
          <GitBranch size={12} aria-hidden="true" />
          <span>{branchLabel(snapshot, title)}</span>
        </span>
      ),
      meta: snapshot?.isRepository === true ? (
        <>
          <span className="lyra-titlebar-context-text">
            {snapshot.summary.changed} {labels.changes}
          </span>
          {snapshot.ahead > 0 || snapshot.behind > 0 ? (
            <span className="lyra-titlebar-context-text">
              ↑{snapshot.ahead} ↓{snapshot.behind}
            </span>
          ) : null}
        </>
      ) : undefined,
      controls: (
        <AppToolbarButton
          type="button"
          className="lyra-titlebar-context-icon-button"
          aria-label={labels.refresh}
          title={labels.refresh}
          onClick={onRefresh}
        >
          <RefreshCw size={14} />
        </AppToolbarButton>
      )
    }),
    [labels.changes, labels.refresh, labels.title, onRefresh, snapshot, title]
  );
  useWorkbenchTitlebarContribution(contribution);
  return null;
};

const statusScope = (file: AgentGitChangedFile): AgentGitDiffScope =>
  file.unstaged || file.untracked ? "unstaged" : "staged";

const GitFileRow = ({
  file,
  labels,
  selected,
  busy,
  onSelect,
  onStage,
  onUnstage,
  onDiscard
}: {
  readonly file: AgentGitChangedFile;
  readonly labels: AgentGitLabels;
  readonly selected: boolean;
  readonly busy: boolean;
  readonly onSelect: (file: AgentGitChangedFile) => void;
  readonly onStage: (file: AgentGitChangedFile) => void;
  readonly onUnstage: (file: AgentGitChangedFile) => void;
  readonly onDiscard: (file: AgentGitChangedFile) => void;
}) => (
  <div className={joinClassNames("lyra-agent-git-row", selected && "lyra-agent-git-row-selected")}>
    <AppObjectRow
      className="lyra-agent-git-row-main"
      active={selected}
      icon={(
        <span className={joinClassNames("lyra-agent-git-status", `lyra-agent-git-status-${file.status}`)}>
          {statusLabel(file.status)}
        </span>
      )}
      title={file.path.split(/[\\/]/u).pop() ?? file.path}
      description={file.path}
      aria-label={file.path}
      onClick={() => onSelect(file)}
    />
    <span className="lyra-agent-git-row-actions">
      {file.unstaged || file.untracked ? (
        <AppIconButton
          className="lyra-agent-git-icon-button"
          aria-label={`${labels.stage}: ${file.path}`}
          title={labels.stage}
          disabled={busy}
          onClick={() => onStage(file)}
        >
          <Plus size={14} aria-hidden="true" />
        </AppIconButton>
      ) : null}
      {file.staged ? (
        <AppIconButton
          className="lyra-agent-git-icon-button"
          aria-label={`${labels.unstage}: ${file.path}`}
          title={labels.unstage}
          disabled={busy}
          onClick={() => onUnstage(file)}
        >
          <Minus size={14} aria-hidden="true" />
        </AppIconButton>
      ) : null}
      <AppIconButton
        className="lyra-agent-git-icon-button"
        tone="danger"
        aria-label={`${labels.discard}: ${file.path}`}
        title={labels.discard}
        disabled={busy}
        onClick={() => onDiscard(file)}
      >
        <RotateCcw size={14} aria-hidden="true" />
      </AppIconButton>
    </span>
  </div>
);

const DiffPane = ({
  labels,
  diffState
}: {
  readonly labels: AgentGitLabels;
  readonly diffState: AgentGitDiffState;
}) => {
  if (diffState.kind === "empty") {
    return (
      <AppEmptyState
        className="lyra-agent-git-empty"
        icon={<Diff size={22} aria-hidden="true" />}
        title={labels.selectFileTitle}
        description={labels.selectFileDescription}
      />
    );
  }
  if (diffState.kind === "loading") {
    return <AppLoadingState className="lyra-agent-git-diff-state" title={labels.loading} />;
  }
  if (diffState.kind === "error") {
    return <AppErrorState className="lyra-agent-git-diff-state" title={diffState.message} />;
  }
  if (diffState.diff.isBinary) {
    return <AppEmptyState className="lyra-agent-git-diff-state" icon={<Diff size={18} aria-hidden="true" />} title={labels.binaryDiff} />;
  }
  if (diffState.diff.diff.trim().length === 0) {
    return <AppEmptyState className="lyra-agent-git-diff-state" icon={<Diff size={18} aria-hidden="true" />} title={labels.noDiff} />;
  }
  return (
    <section className="lyra-agent-git-diff" aria-label={diffState.file.path}>
      <header className="lyra-agent-git-diff-header">
        <GitCommitHorizontal size={14} aria-hidden="true" />
        <span>{diffState.file.path}</span>
        <span className="lyra-agent-git-diff-scope">{diffState.diff.scope}</span>
      </header>
      <pre>{diffState.diff.diff}</pre>
    </section>
  );
};

export const AgentGitSurface = ({
  desktopApi,
  labels,
  rootPath,
  title
}: AgentGitSurfaceProps) => {
  const [statusState, setStatusState] = useState<AgentGitStatusState>({
    kind: "loading",
    snapshot: null
  });
  const [diffState, setDiffState] = useState<AgentGitDiffState>({ kind: "empty" });
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const snapshot = statusState.snapshot;

  const loadStatus = useCallback(async (): Promise<AgentGitStatusSnapshot | null> => {
    if (desktopApi?.agent === undefined) {
      const message = labels.unavailable;
      setStatusState((current) => ({
        kind: "error",
        snapshot: current.snapshot,
        message
      }));
      return null;
    }
    setStatusState((current) => ({
      kind: "loading",
      snapshot: current.snapshot
    }));
    try {
      const next = await desktopApi.agent.readGitStatus({ workingDir: rootPath });
      setStatusState({ kind: "ready", snapshot: next });
      return next;
    } catch (error: unknown) {
      setStatusState((current) => ({
        kind: "error",
        snapshot: current.snapshot,
        message: toErrorMessage(error)
      }));
      return null;
    }
  }, [desktopApi, labels.unavailable, rootPath]);

  useEffect(() => {
    setDiffState({ kind: "empty" });
    void loadStatus();
  }, [loadStatus]);

  const loadDiff = useCallback(async (file: AgentGitChangedFile): Promise<void> => {
    if (desktopApi?.agent === undefined) {
      setDiffState({
        kind: "error",
        file,
        message: labels.unavailable
      });
      return;
    }
    setDiffState({ kind: "loading", file });
    try {
      const diff = await desktopApi.agent.readGitDiff({
        workingDir: rootPath,
        path: file.path,
        scope: statusScope(file)
      });
      setDiffState({ kind: "ready", file, diff });
    } catch (error: unknown) {
      setDiffState({
        kind: "error",
        file,
        message: toErrorMessage(error)
      });
    }
  }, [desktopApi, labels.unavailable, rootPath]);

  const applyMutation = useCallback(async (
    file: AgentGitChangedFile,
    mutation: "stage" | "unstage" | "discard"
  ): Promise<void> => {
    if (desktopApi?.agent === undefined || busyPath !== null) {
      return;
    }
    if (mutation === "discard" && window.confirm(labels.discardConfirm.replace("{path}", file.path)) === false) {
      return;
    }
    setBusyPath(file.path);
    try {
      const request = { workingDir: rootPath, path: file.path };
      const response = mutation === "stage"
        ? await desktopApi.agent.stageGitFile(request)
        : mutation === "unstage"
          ? await desktopApi.agent.unstageGitFile(request)
          : await desktopApi.agent.discardGitFile(request);
      setStatusState({ kind: "ready", snapshot: response.snapshot });
      const refreshedFile = response.snapshot.entries.find((entry) => entry.path === file.path);
      if (refreshedFile === undefined) {
        setDiffState({ kind: "empty" });
      } else {
        await loadDiff(refreshedFile);
      }
    } catch (error: unknown) {
      setStatusState((current) => ({
        kind: "error",
        snapshot: current.snapshot,
        message: toErrorMessage(error)
      }));
    } finally {
      setBusyPath(null);
    }
  }, [busyPath, desktopApi, labels.discardConfirm, loadDiff, rootPath]);

  const onRefresh = useCallback(() => {
    void loadStatus();
  }, [loadStatus]);

  const entries = snapshot?.entries ?? [];
  const selectedPath =
    diffState.kind === "empty" ? null : diffState.file.path;

  return (
    <section className="lyra-agent-git-surface" aria-label={labels.title}>
      <AgentGitTitlebarBridge
        labels={labels}
        snapshot={snapshot}
        title={title}
        onRefresh={onRefresh}
      />
      <aside className="lyra-agent-git-sidebar">
        {snapshot?.isRepository === false ? (
          <AppErrorState
            className="lyra-agent-git-empty lyra-agent-git-empty-sidebar"
            title={labels.notRepositoryTitle}
            description={snapshot.message ?? labels.notRepositoryDescription}
          />
        ) : entries.length === 0 && statusState.kind !== "loading" ? (
          <AppEmptyState
            className="lyra-agent-git-empty lyra-agent-git-empty-sidebar"
            density="compact"
            title={labels.emptyTitle}
            description={labels.emptyDescription}
          />
        ) : (
          <>
            <div className="lyra-agent-git-summary">
              <span>{entries.length} {labels.changes}</span>
              {snapshot === null ? null : (
                <span>
                  {snapshot.summary.staged} {labels.staged} · {snapshot.summary.untracked} {labels.untracked}
                </span>
              )}
            </div>
            <div className="lyra-agent-git-list" aria-label={labels.changes}>
              {entries.map((file) => (
                <GitFileRow
                  key={file.path}
                  file={file}
                  labels={labels}
                  selected={selectedPath === file.path}
                  busy={busyPath === file.path}
                  onSelect={(nextFile) => void loadDiff(nextFile)}
                  onStage={(nextFile) => void applyMutation(nextFile, "stage")}
                  onUnstage={(nextFile) => void applyMutation(nextFile, "unstage")}
                  onDiscard={(nextFile) => void applyMutation(nextFile, "discard")}
                />
              ))}
            </div>
          </>
        )}
        {statusState.kind === "loading" ? (
          <AppLoadingState
            className="lyra-agent-git-inline-state"
            align="start"
            density="compact"
            title={labels.loading}
          />
        ) : null}
        {statusState.kind === "error" ? (
          <AppStatusMessage className="lyra-agent-git-inline-state" tone="error">
            {statusState.message}
          </AppStatusMessage>
        ) : null}
      </aside>
      <main className="lyra-agent-git-main">
        <DiffPane labels={labels} diffState={diffState} />
      </main>
    </section>
  );
};
