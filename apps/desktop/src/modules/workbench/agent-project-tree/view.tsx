import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, FolderOpen, GitBranch, RefreshCw } from "lucide-react";

import {
  AppEmptyState,
  AppLoadingState,
  AppObjectRow,
  AppStatusMessage,
  AppToolbarButton
} from "@renderer/ui/components";
import type { FileManagerEntry, FileManagerDirectoryPatch } from "../../../shared/file-manager";
import { FileEditorSurface } from "../file-editor";
import { renderFileManagerEntryIcon } from "../file-manager";
import { useWorkbenchTitlebarContribution } from "../shell/titlebar-context";
import type {
  AgentProjectTreeDirectoryState,
  AgentProjectTreeSurfaceProps
} from "./types";

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// ponytail: filter noise directories and hidden entries instead of full gitignore
// parsing. Covers the 90% case — node_modules, .git, build artifacts. Upgrade
// path: add a native gitignore-aware readDirectory binding if needed.
const NOISE_DIRECTORY_NAMES = new Set([
  "node_modules", ".git", "target", "dist", "build", ".next",
  "__pycache__", ".venv", "venv", ".cache", ".svelte-kit", ".turbo"
]);

const isNoiseEntry = (entry: FileManagerEntry): boolean =>
  entry.isHidden ||
  (entry.kind === "directory" && NOISE_DIRECTORY_NAMES.has(entry.name));

const filterNoise = (entries: readonly FileManagerEntry[]): readonly FileManagerEntry[] =>
  entries.filter((entry) => !isNoiseEntry(entry));

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

const prepareEntries = (entries: readonly FileManagerEntry[]): readonly FileManagerEntry[] =>
  sortEntries(filterNoise(entries));

// Apply a live directory patch to the entry list.
export const applyPatchToEntries = (
  entries: readonly FileManagerEntry[],
  patch: FileManagerDirectoryPatch
): readonly FileManagerEntry[] => {
  if (patch.kind === "reset") {
    return patch.snapshot?.entries ?? entries;
  }
  if (patch.kind === "remove") {
    const removePath = patch.path ?? patch.oldPath;
    if (removePath === undefined) return entries;
    return entries.filter((entry) => entry.path !== removePath);
  }
  if (patch.kind === "rename") {
    if (patch.oldPath === undefined || patch.entry === undefined) return entries;
    return sortEntries(filterNoise([
      ...entries.filter((entry) => entry.path !== patch.oldPath),
      patch.entry
    ]));
  }
  // create or update
  if (patch.entry === undefined) return entries;
  const next = entries.filter((entry) => entry.path !== patch.entry!.path);
  next.push(patch.entry);
  return sortEntries(filterNoise(next));
};

const indentStyle = (depth: number, base: number): { readonly paddingLeft: string } => ({
  paddingLeft: `${Math.max(depth, 0) * 14 + base}px`
});

const renderTreeIconSlot = (icon: ReactNode, twist?: ReactNode): ReactNode => (
  <span className={`lyra-agent-project-tree-icon-slot${twist === undefined ? "" : " has-twist"}`} aria-hidden="true">
    <span className="lyra-agent-project-tree-entry-icon">{icon}</span>
    {twist === undefined ? null : (
      <span className="lyra-agent-project-tree-twist">{twist}</span>
    )}
  </span>
);

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
            <AppToolbarButton
              type="button"
              className="lyra-titlebar-context-icon-button"
              aria-label={labels.openSourceControl}
              title={labels.openSourceControl}
              onClick={onOpenGitPanel}
            >
              <GitBranch size={14} />
            </AppToolbarButton>
          )}
          <AppToolbarButton
            type="button"
            className="lyra-titlebar-context-icon-button"
            aria-label={labels.refresh}
            title={labels.refresh}
            onClick={onRefresh}
          >
            <RefreshCw size={14} />
          </AppToolbarButton>
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
  readonly selectedPath: string | null;
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
  selectedPath,
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
      <AppLoadingState
        className="lyra-agent-project-tree-inline-state"
        align="start"
        density="compact"
        title={labels.loading}
        style={indentStyle(depth, 28)}
      />
    );
  }

  if (node.status === "error") {
    return (
      <AppStatusMessage
        className="lyra-agent-project-tree-inline-state"
        tone="error"
        style={indentStyle(depth, 28)}
      >
        {node.errorMessage}
      </AppStatusMessage>
    );
  }

  const entries = prepareEntries(node.entries);
  if (entries.length === 0) {
    return (
      <AppEmptyState
        className="lyra-agent-project-tree-inline-state"
        align="start"
        density="compact"
        title={labels.emptyDirectory}
        style={indentStyle(depth, 28)}
      />
    );
  }

  return (
    <>
      {entries.map((entry) => {
        const expanded = entry.kind === "directory" && expandedPaths.has(entry.path);
        const selected = selectedPath === entry.path || (
          selectedPath === null &&
          entry.kind === "file" &&
          selectedFilePath === entry.path
        );
        return (
          <div key={entry.path} className="lyra-agent-project-tree-node">
            <AppObjectRow
              className="lyra-agent-project-tree-row"
              active={selected}
              style={indentStyle(depth, 10)}
              aria-expanded={entry.kind === "directory" ? expanded : undefined}
              aria-label={entry.path}
              title={(
                <span className="lyra-agent-project-tree-label">
                  {renderTreeIconSlot(
                    renderFileManagerEntryIcon(entry),
                    entry.kind === "directory"
                      ? expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />
                      : undefined
                  )}
                  <span className="lyra-agent-project-tree-name">{entry.name}</span>
                </span>
              )}
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
            />
            {expanded ? (
              <TreeDirectory
                path={entry.path}
                depth={depth + 1}
                labels={labels}
                selectedPath={selectedPath}
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

  // Subscription tracking: path ↔ subscriptionId + generation.
  const subByPathRef = useRef<Map<string, { subscriptionId: string; generation: number }>>(new Map());
  const pathBySubIdRef = useRef<Map<string, string>>(new Map());

  const setDirectoryState = useCallback((
    path: string,
    next: AgentProjectTreeDirectoryState
  ): void => {
    setDirectoryStates((current) => ({
      ...current,
      [path]: next
    }));
  }, []);

  const unsubscribePath = useCallback((path: string): void => {
    const sub = subByPathRef.current.get(path);
    if (sub === undefined) return;
    subByPathRef.current.delete(path);
    pathBySubIdRef.current.delete(sub.subscriptionId);
    void desktopApi?.files?.unsubscribeDirectory?.(sub.subscriptionId);
  }, [desktopApi?.files]);

  const loadDirectory = useCallback((path: string): void => {
    if (desktopApi?.files === undefined) {
      setDirectoryState(path, {
        status: "error",
        entries: [],
        errorMessage: labels.unavailable
      });
      return;
    }

    unsubscribePath(path);
    setDirectoryState(path, {
      status: "loading",
      entries: [],
      errorMessage: null
    });

    const files = desktopApi.files;
    const useSubscribe = typeof files.subscribeDirectory === "function";

    const load = useSubscribe
      ? files.subscribeDirectory!({ path }).then((response) => ({
          entries: response.snapshot.entries,
          subscriptionId: response.subscriptionId,
          generation: response.snapshot.generation
        }))
      : files.readDirectory({ path }).then((response) => ({
          entries: response.entries,
          subscriptionId: undefined as string | undefined,
          generation: undefined as number | undefined
        }));

    void load
      .then((result) => {
        if (result.subscriptionId !== undefined) {
          subByPathRef.current.set(path, {
            subscriptionId: result.subscriptionId,
            generation: result.generation ?? 0
          });
          pathBySubIdRef.current.set(result.subscriptionId, path);
        }
        setDirectoryState(path, {
          status: "ready",
          entries: result.entries,
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
  }, [desktopApi?.files, labels.unavailable, setDirectoryState, unsubscribePath]);

  // Listen for live directory patches and apply them to the tree.
  useEffect(() => {
    if (desktopApi?.files?.onDirectoryPatch === undefined) return undefined;
    return desktopApi.files.onDirectoryPatch((patch: FileManagerDirectoryPatch) => {
      const path = pathBySubIdRef.current.get(patch.subscriptionId);
      if (path === undefined) return;
      const sub = subByPathRef.current.get(path);
      if (sub === undefined || patch.generation < sub.generation) return;
      subByPathRef.current.set(path, { subscriptionId: sub.subscriptionId, generation: patch.generation });

      setDirectoryStates((current) => {
        const node = current[path];
        if (node === undefined || node.status !== "ready") return current;
        const entries = applyPatchToEntries(node.entries, patch);
        if (entries === node.entries) return current;
        return { ...current, [path]: { ...node, entries } };
      });
    });
  }, [desktopApi?.files]);

  // Unsubscribe all on unmount or root change.
  useEffect(() => {
    return () => {
      for (const path of subByPathRef.current.keys()) {
        const sub = subByPathRef.current.get(path);
        if (sub !== undefined) {
          void desktopApi?.files?.unsubscribeDirectory?.(sub.subscriptionId);
        }
      }
      subByPathRef.current.clear();
      pathBySubIdRef.current.clear();
    };
  }, [desktopApi?.files, state.rootPath]);

  useEffect(() => {
    setDirectoryStates({});
    setActionError(null);
    subByPathRef.current.clear();
    pathBySubIdRef.current.clear();
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
        <AppObjectRow
          className="lyra-agent-project-tree-root-row"
          active={state.selectedPath === state.rootPath}
          aria-expanded={expandedPaths.has(state.rootPath)}
          aria-label={state.rootPath}
          title={(
            <span className="lyra-agent-project-tree-label">
              {renderTreeIconSlot(
                <FolderOpen size={14} aria-hidden="true" />,
                expandedPaths.has(state.rootPath) ? <ChevronDown size={13} /> : <ChevronRight size={13} />
              )}
              <span className="lyra-agent-project-tree-name">{state.title}</span>
            </span>
          )}
          onClick={() => {
            model.toggleDirectory(state.instanceId, state.rootPath);
            if (directoryStates[state.rootPath] === undefined) {
              loadDirectory(state.rootPath);
            }
          }}
        />
        <div className="lyra-agent-project-tree-list" role="tree" aria-label={labels.title}>
          {expandedPaths.has(state.rootPath) ? (
            <TreeDirectory
              path={state.rootPath}
              depth={1}
              labels={labels}
              selectedPath={state.selectedPath}
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
          <AppStatusMessage className="lyra-agent-project-tree-error" tone="error" role="status">
            {actionError}
          </AppStatusMessage>
        )}
      </aside>
      <main className="lyra-agent-project-tree-editor">
        {fileEditorState === null ? (
          <AppEmptyState
            className="lyra-agent-project-tree-empty"
            title={labels.selectFileTitle}
          />
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
