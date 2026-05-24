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

  const openFile = useCallback<AgentProjectTreeModel["openFile"]>(async (instanceId, filePath) => {
    const current = statesRef.current[instanceId];
    if (current === undefined) {
      return;
    }
    const editorInstanceId = current.editorInstanceId ?? createEditorInstanceId(instanceId);
    fileEditorModel.ensureInstance(editorInstanceId, {
      filePath,
      fileSessionId: `agent-project-tree:${current.agentSessionId}`
    });
    const next = {
      ...current,
      selectedFilePath: filePath,
      editorInstanceId
    };
    replaceStates({
      ...statesRef.current,
      [instanceId]: next
    });
    await fileEditorModel.openFile(editorInstanceId, filePath);
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
      openFile,
      toggleDirectory,
      updateRoot
    }),
    [
      ensureInstance,
      getState,
      openFile,
      syncTabInstances,
      toggleDirectory,
      updateRoot
    ]
  );
};

export type { AgentProjectTreeAppIconKey };
