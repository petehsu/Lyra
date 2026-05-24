import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FolderOpen, GitBranch, RefreshCw } from "lucide-react";

import type { FileManagerEntry } from "../../../shared/file-manager";
import { FileEditorSurface } from "../file-editor";
import { renderFileManagerEntryIcon } from "../file-manager";
import { useWorkbenchTitlebarContribution } from "../shell/titlebar-context";
import type {
  AgentProjectTreeDirectoryState,
  AgentProjectTreeSurfaceProps
} from "./types";

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const sortEntries = (entries: readonly FileManagerEntry[]): readonly FileManagerEntry[] =>
  [...entries].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "directory" ? -1 : 1;
    }
    return left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: "base"
    });
  });

const joinClassNames = (...values: Array<string | false | null | undefined>): string =>
  values.filter((value): value is string => typeof value === "string" && value.length > 0).join(" ");

type DirectoryStateMap = Record<string, AgentProjectTreeDirectoryState | undefined>;

const AgentProjectTreeTitlebarBridge = ({
  labels,
  title,
  onOpenGitPanel,
  onRefresh
}: {
  readonly labels: AgentProjectTreeSurfaceProps["labels"];
  readonly title: string;
  readonly onOpenGitPanel?: () => void;
  readonly onRefresh: () => void;
}) => {
  const contribution = useMemo(
    () => ({
      ariaLabel: labels.title,
      leading: (
        <span className="lyra-titlebar-context-chip" title={title}>
          <FolderOpen size={12} aria-hidden="true" />
          <span>{title}</span>
        </span>
      ),
      controls: (
        <>
          {onOpenGitPanel === undefined ? null : (
            <button
              type="button"
              className="lyra-titlebar-context-icon-button"
              aria-label={labels.openSourceControl}
              title={labels.openSourceControl}
              onClick={onOpenGitPanel}
            >
              <GitBranch size={14} />
            </button>
          )}
          <button
            type="button"
            className="lyra-titlebar-context-icon-button"
            aria-label={labels.refresh}
            title={labels.refresh}
            onClick={onRefresh}
          >
            <RefreshCw size={14} />
          </button>
        </>
      )
    }),
    [
      labels.openSourceControl,
      labels.refresh,
      labels.title,
      onOpenGitPanel,
      onRefresh,
      title
    ]
  );
  useWorkbenchTitlebarContribution(contribution);
  return null;
};

type TreeDirectoryProps = {
  readonly path: string;
  readonly depth: number;
  readonly labels: AgentProjectTreeSurfaceProps["labels"];
  readonly selectedFilePath: string | null;
  readonly expandedPaths: ReadonlySet<string>;
  readonly directoryStates: DirectoryStateMap;
  readonly loadDirectory: (path: string) => void;
  readonly onToggleDirectory: (path: string) => void;
  readonly onOpenFile: (path: string) => void;
};

const TreeDirectory = ({
  path,
  depth,
  labels,
  selectedFilePath,
  expandedPaths,
  directoryStates,
  loadDirectory,
  onToggleDirectory,
  onOpenFile
}: TreeDirectoryProps) => {
  const node = directoryStates[path];

  useEffect(() => {
    if (node === undefined) {
      loadDirectory(path);
    }
  }, [loadDirectory, node, path]);

  if (node === undefined || node.status === "loading") {
    return (
      <div
        className="lyra-agent-project-tree-inline-state"
        style={{ paddingLeft: `${Math.max(depth, 0) * 14 + 28}px` }}
      >
        {labels.loading}
      </div>
    );
  }

  if (node.status === "error") {
    return (
      <div
        className="lyra-agent-project-tree-inline-state lyra-agent-project-tree-inline-error"
        style={{ paddingLeft: `${Math.max(depth, 0) * 14 + 28}px` }}
      >
        {node.errorMessage}
      </div>
    );
  }

  const entries = sortEntries(node.entries);
  if (entries.length === 0) {
    return (
      <div
        className="lyra-agent-project-tree-inline-state"
        style={{ paddingLeft: `${Math.max(depth, 0) * 14 + 28}px` }}
      >
        {labels.emptyDirectory}
      </div>
    );
  }

  return (
    <>
      {entries.map((entry) => {
        const expanded = entry.kind === "directory" && expandedPaths.has(entry.path);
        const selected = entry.kind === "file" && selectedFilePath === entry.path;
        return (
          <div key={entry.path} className="lyra-agent-project-tree-node">
            <button
              type="button"
              className={joinClassNames(
                "lyra-agent-project-tree-row",
                selected && "lyra-agent-project-tree-row-selected"
              )}
              style={{ paddingLeft: `${Math.max(depth, 0) * 14 + 10}px` }}
              aria-expanded={entry.kind === "directory" ? expanded : undefined}
              title={entry.path}
              onClick={() => {
                if (entry.kind === "directory") {
                  onToggleDirectory(entry.path);
                  if (!expanded && directoryStates[entry.path] === undefined) {
                    loadDirectory(entry.path);
                  }
                  return;
                }
                onOpenFile(entry.path);
              }}
            >
              <span className="lyra-agent-project-tree-twist" aria-hidden="true">
                {entry.kind === "directory"
                  ? expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />
                  : null}
              </span>
              {renderFileManagerEntryIcon(entry)}
              <span className="lyra-agent-project-tree-name">{entry.name}</span>
            </button>
            {expanded ? (
              <TreeDirectory
                path={entry.path}
                depth={depth + 1}
                labels={labels}
                selectedFilePath={selectedFilePath}
                expandedPaths={expandedPaths}
                directoryStates={directoryStates}
                loadDirectory={loadDirectory}
                onToggleDirectory={onToggleDirectory}
                onOpenFile={onOpenFile}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
};

export const AgentProjectTreeSurface = ({
  desktopApi,
  labels,
  state,
  model,
  fileEditorModel,
  fileEditorLabels,
  themeSignature,
  onOpenGitPanel
}: AgentProjectTreeSurfaceProps) => {
  const [directoryStates, setDirectoryStates] = useState<DirectoryStateMap>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const expandedPaths = useMemo(
    () => new Set(state.expandedPaths),
    [state.expandedPaths]
  );

  const setDirectoryState = useCallback((
    path: string,
    next: AgentProjectTreeDirectoryState
  ): void => {
    setDirectoryStates((current) => ({
      ...current,
      [path]: next
    }));
  }, []);

  const loadDirectory = useCallback((path: string): void => {
    if (desktopApi?.files === undefined) {
      setDirectoryState(path, {
        status: "error",
        entries: [],
        errorMessage: labels.unavailable
      });
      return;
    }

    setDirectoryState(path, {
      status: "loading",
      entries: [],
      errorMessage: null
    });
    void desktopApi.files.readDirectory({ path })
      .then((response) => {
        setDirectoryState(path, {
          status: "ready",
          entries: response.entries,
          errorMessage: null
        });
      })
      .catch((error: unknown) => {
        setDirectoryState(path, {
          status: "error",
          entries: [],
          errorMessage: toErrorMessage(error)
        });
      });
  }, [desktopApi?.files, labels.unavailable, setDirectoryState]);

  useEffect(() => {
    setDirectoryStates({});
    setActionError(null);
    loadDirectory(state.rootPath);
  }, [loadDirectory, refreshKey, state.rootPath]);

  const onOpenFile = useCallback((path: string): void => {
    setActionError(null);
    void model.openFile(state.instanceId, path).catch((error: unknown) => {
      setActionError(toErrorMessage(error));
    });
  }, [model, state.instanceId]);

  const onToggleDirectory = useCallback((path: string): void => {
    model.toggleDirectory(state.instanceId, path);
  }, [model, state.instanceId]);

  const onRefresh = useCallback((): void => {
    setRefreshKey((value) => value + 1);
  }, []);

  const onOpenSourceControl = useMemo(() => {
    if (onOpenGitPanel === undefined) {
      return undefined;
    }
    return (): void => {
      void onOpenGitPanel({
        sessionId: state.agentSessionId,
        workingDir: state.rootPath
      });
    };
  }, [onOpenGitPanel, state.agentSessionId, state.rootPath]);

  const fileEditorState =
    state.editorInstanceId === null
      ? null
      : fileEditorModel.getState(state.editorInstanceId);

  return (
    <section className="lyra-agent-project-tree-surface" aria-label={labels.title}>
      <AgentProjectTreeTitlebarBridge
        labels={labels}
        title={state.title}
        onRefresh={onRefresh}
        {...(onOpenSourceControl === undefined
          ? {}
          : { onOpenGitPanel: onOpenSourceControl })}
      />
      <aside className="lyra-agent-project-tree-sidebar">
        <button
          type="button"
          className="lyra-agent-project-tree-root-row"
          title={state.rootPath}
          aria-expanded={expandedPaths.has(state.rootPath)}
          onClick={() => {
            model.toggleDirectory(state.instanceId, state.rootPath);
            if (directoryStates[state.rootPath] === undefined) {
              loadDirectory(state.rootPath);
            }
          }}
        >
          <span className="lyra-agent-project-tree-twist" aria-hidden="true">
            {expandedPaths.has(state.rootPath) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
          <FolderOpen size={14} aria-hidden="true" />
          <span className="lyra-agent-project-tree-name">{state.title}</span>
        </button>
        <div className="lyra-agent-project-tree-list" role="tree" aria-label={labels.title}>
          {expandedPaths.has(state.rootPath) ? (
            <TreeDirectory
              path={state.rootPath}
              depth={1}
              labels={labels}
              selectedFilePath={state.selectedFilePath}
              expandedPaths={expandedPaths}
              directoryStates={directoryStates}
              loadDirectory={loadDirectory}
              onToggleDirectory={onToggleDirectory}
              onOpenFile={onOpenFile}
            />
          ) : null}
        </div>
        {actionError === null ? null : (
          <div className="lyra-agent-project-tree-error" role="status">
            {actionError}
          </div>
        )}
      </aside>
      <main className="lyra-agent-project-tree-editor">
        {fileEditorState === null ? (
          <section className="lyra-agent-project-tree-empty">
            <h2>{labels.selectFileTitle}</h2>
            <p>{labels.selectFileDescription}</p>
          </section>
        ) : (
          <FileEditorSurface
            state={fileEditorState}
            labels={fileEditorLabels}
            themeSignature={themeSignature}
            model={fileEditorModel}
            surfaceVariant="full"
            controlMode="human_takeover"
            contributeTitlebar={false}
          />
        )}
      </main>
    </section>
  );
};
