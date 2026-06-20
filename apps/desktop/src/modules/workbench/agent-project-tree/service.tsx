import { useCallback, useMemo, useRef, useState } from "react";

import type { WorkspaceAppTabMetaRequest, WorkspaceAppTabOpenRequest } from "../workspace-tabs";
import type { FileEditorModel } from "../file-editor";
import type {
  AgentProjectTreeAppIconKey,
  AgentProjectTreeAppState,
  AgentProjectTreeModel
} from "./types";

export const AGENT_PROJECT_TREE_APP_ID = "agent-project-tree" as const;
export const AGENT_PROJECT_TREE_ICON_KEY = "agent-project-tree-default" as const;

const normalizePath = (value: string): string => value.trim();

export const resolveProjectTreeTitle = (rootPath: string): string => {
  const normalized = normalizePath(rootPath).replace(/[\\/]+$/u, "");
  if (normalized.length === 0) {
    return rootPath;
  }
  const separatorIndex = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return separatorIndex >= 0 ? normalized.slice(separatorIndex + 1) || normalized : normalized;
};

const normalizeInstanceToken = (value: string): string => {
  const token = value.trim().replace(/[^a-zA-Z0-9_-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return token.length > 0 ? token : "unbound";
};

export const createAgentProjectTreeInstanceId = (agentSessionId: string): string =>
  `agent-project-tree-${normalizeInstanceToken(agentSessionId)}`;

const createEditorInstanceId = (appInstanceId: string): string =>
  `agent-project-tree-editor-${normalizeInstanceToken(appInstanceId)}`;

export const resolveAgentProjectTreeEditorInstanceId = (
  treeInstanceId: string,
  editorInstanceId: string | null | undefined
): string =>
  editorInstanceId !== null && editorInstanceId !== undefined && editorInstanceId.trim().length > 0
    ? editorInstanceId
    : createEditorInstanceId(treeInstanceId);

const pathSeparatorFor = (value: string): "/" | "\\" =>
  value.includes("\\") && !value.includes("/") ? "\\" : "/";

const normalizeComparablePath = (value: string): string =>
  value.trim().replace(/\\/g, "/").replace(/\/+$/u, "");

const expansionPathsFor = (
  rootPath: string,
  targetPath: string,
  options: { readonly includeTarget?: boolean } = {}
): string[] => {
  const root = normalizePath(rootPath).replace(/[\\/]+$/u, "");
  const target = normalizePath(targetPath).replace(/[\\/]+$/u, "");
  if (root.length === 0 || target.length === 0) {
    return root.length === 0 ? [] : [root];
  }
  const rootComparable = normalizeComparablePath(root);
  const targetComparable = normalizeComparablePath(target);
  if (
    targetComparable !== rootComparable &&
    !targetComparable.startsWith(`${rootComparable}/`)
  ) {
    return [root];
  }

  const separator = pathSeparatorFor(root);
  const relative = targetComparable === rootComparable
    ? ""
    : targetComparable.slice(rootComparable.length + 1);
  const paths = [root];
  if (relative.length === 0) {
    return paths;
  }
  const rootParts = root.split(/[\\/]+/u);
  const parts = relative.split("/").filter((part) => part.length > 0);
  const limit = options.includeTarget === false
    ? Math.max(0, parts.length - 1)
    : parts.length;
  for (let index = 0; index < limit; index += 1) {
    paths.push([...rootParts, ...parts.slice(0, index + 1)].join(separator));
  }
  return paths;
};

const expandedPathUnion = (
  current: readonly string[],
  rootPath: string,
  targetPath: string,
  options?: { readonly includeTarget?: boolean }
): string[] => {
  const expanded = new Set(current);
  for (const path of expansionPathsFor(rootPath, targetPath, options)) {
    expanded.add(path);
  }
  return Array.from(expanded);
};

const createState = (
  instanceId: string,
  options: {
    readonly agentSessionId: string;
    readonly rootPath: string;
    readonly title?: string | undefined;
  }
): AgentProjectTreeAppState => {
  const rootPath = normalizePath(options.rootPath);
  return {
    instanceId,
    agentSessionId: options.agentSessionId,
    rootPath,
    title: options.title?.trim() || resolveProjectTreeTitle(rootPath),
    selectedPath: null,
    selectedFilePath: null,
    editorInstanceId: null,
    expandedPaths: [rootPath]
  };
};

export const createAgentProjectTreeAppRequest = (
  agentSessionId: string,
  rootPath: string
): WorkspaceAppTabOpenRequest => ({
  appId: AGENT_PROJECT_TREE_APP_ID,
  appInstanceId: createAgentProjectTreeInstanceId(agentSessionId),
  title: resolveProjectTreeTitle(rootPath),
  iconKey: AGENT_PROJECT_TREE_ICON_KEY,
  filePath: normalizePath(rootPath),
  fileSessionId: agentSessionId
});

type UseAgentProjectTreeModelOptions = {
  readonly fileEditorModel: FileEditorModel;
  readonly onMetaChange: (request: WorkspaceAppTabMetaRequest) => void;
};

export const useAgentProjectTreeModel = ({
  fileEditorModel,
  onMetaChange
}: UseAgentProjectTreeModelOptions): AgentProjectTreeModel => {
  const [statesById, setStatesById] = useState<Record<string, AgentProjectTreeAppState>>({});
  const statesRef = useRef<Record<string, AgentProjectTreeAppState>>({});
  const tabInstancesRef = useRef<Set<string>>(new Set());

  const publishMeta = useCallback((state: AgentProjectTreeAppState): void => {
    onMetaChange({
      appId: AGENT_PROJECT_TREE_APP_ID,
      appInstanceId: state.instanceId,
      title: state.title,
      iconKey: AGENT_PROJECT_TREE_ICON_KEY,
      filePath: state.rootPath,
      fileSessionId: state.agentSessionId
    });
  }, [onMetaChange]);

  const syncExternalEditors = useCallback((states: Record<string, AgentProjectTreeAppState>): void => {
    const editorIds = Object.values(states)
      .map((state) => state.editorInstanceId)
      .filter((value): value is string => typeof value === "string" && value.length > 0);
    fileEditorModel.syncExternalInstances(editorIds);
  }, [fileEditorModel]);

  const replaceStates = useCallback((nextStates: Record<string, AgentProjectTreeAppState>): void => {
    statesRef.current = nextStates;
    setStatesById(nextStates);
    syncExternalEditors(nextStates);
  }, [syncExternalEditors]);

  const getState = useCallback((instanceId: string): AgentProjectTreeAppState | null =>
    statesRef.current[instanceId] ?? null, []);

  const ensureInstance = useCallback<AgentProjectTreeModel["ensureInstance"]>((instanceId, options) => {
    const current = statesRef.current[instanceId];
    if (current !== undefined) {
      const rootPath = normalizePath(options.rootPath);
      if (
        current.rootPath === rootPath &&
        current.agentSessionId === options.agentSessionId
      ) {
        return;
      }
    }
    const next = createState(instanceId, options);
    replaceStates({
      ...statesRef.current,
      [instanceId]: next
    });
    publishMeta(next);
  }, [publishMeta, replaceStates]);

  const updateRoot = useCallback<AgentProjectTreeModel["updateRoot"]>((instanceId, options) => {
    const next = createState(instanceId, options);
    replaceStates({
      ...statesRef.current,
      [instanceId]: next
    });
    publishMeta(next);
  }, [publishMeta, replaceStates]);

  const syncTabInstances = useCallback((instanceIds: readonly string[]) => {
    tabInstancesRef.current = new Set(instanceIds);
    const kept = new Set(instanceIds);
    const current = statesRef.current;
    const next = Object.fromEntries(
      Object.entries(current).filter(([instanceId]) => kept.has(instanceId))
    );
    if (Object.keys(next).length !== Object.keys(current).length) {
      replaceStates(next);
      return;
    }
    syncExternalEditors(current);
  }, [replaceStates, syncExternalEditors]);

  const revealPath = useCallback<AgentProjectTreeModel["revealPath"]>((instanceId, path) => {
    const current = statesRef.current[instanceId];
    const targetPath = normalizePath(path);
    if (current === undefined || targetPath.length === 0) {
      return;
    }
    const next = {
      ...current,
      selectedPath: targetPath,
      expandedPaths: expandedPathUnion(current.expandedPaths, current.rootPath, targetPath)
    };
    replaceStates({
      ...statesRef.current,
      [instanceId]: next
    });
  }, [replaceStates]);

  const openFile = useCallback<AgentProjectTreeModel["openFile"]>(async (
    instanceId,
    filePath,
    location
  ) => {
    const current = statesRef.current[instanceId];
    const targetPath = normalizePath(filePath);
    if (current === undefined || targetPath.length === 0) {
      return;
    }
    const editorInstanceId = current.editorInstanceId ?? createEditorInstanceId(instanceId);
    fileEditorModel.ensureInstance(editorInstanceId, {
      filePath: targetPath,
      fileSessionId: `agent-project-tree:${current.agentSessionId}`
    });
    const next = {
      ...current,
      selectedPath: targetPath,
      selectedFilePath: targetPath,
      editorInstanceId,
      expandedPaths: expandedPathUnion(current.expandedPaths, current.rootPath, targetPath, {
        includeTarget: false
      })
    };
    replaceStates({
      ...statesRef.current,
      [instanceId]: next
    });
    await fileEditorModel.openFile(editorInstanceId, targetPath);
    if (location !== undefined) {
      fileEditorModel.revealLocation(editorInstanceId, location);
    }
  }, [fileEditorModel, replaceStates]);

  const toggleDirectory = useCallback<AgentProjectTreeModel["toggleDirectory"]>((instanceId, path) => {
    const current = statesRef.current[instanceId];
    if (current === undefined) {
      return;
    }
    const expanded = new Set(current.expandedPaths);
    if (expanded.has(path)) {
      expanded.delete(path);
    } else {
      expanded.add(path);
    }
    const next = {
      ...current,
      expandedPaths: Array.from(expanded)
    };
    replaceStates({
      ...statesRef.current,
      [instanceId]: next
    });
  }, [replaceStates]);

  return useMemo(
    () => ({
      getState,
      ensureInstance,
      syncTabInstances,
      revealPath,
      openFile,
      toggleDirectory,
      updateRoot
    }),
    [
      ensureInstance,
      getState,
      openFile,
      revealPath,
      syncTabInstances,
      toggleDirectory,
      updateRoot
    ]
  );
};

export type { AgentProjectTreeAppIconKey };
