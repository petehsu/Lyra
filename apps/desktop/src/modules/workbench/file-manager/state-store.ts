import {
  useCallback,
  useRef,
  useState,
  type MutableRefObject
} from "react";

import type {
  DownloadManagerRemoteApiStatus,
  DownloadManagerSettings,
  DownloadManagerTask
} from "../../../shared/download-manager";
import type {
  FileManagerAppIconKey,
  FileManagerAppState,
  FileManagerSurfaceLabels
} from "./types";
import {
  createId,
  createInitialState
} from "./state-model";

type FileManagerAppMeta = {
  readonly appId: "file-manager";
  readonly appInstanceId: string;
  readonly title: string;
  readonly iconKey: FileManagerAppIconKey;
};

type DownloadDefaults = {
  readonly tasks: readonly DownloadManagerTask[];
  readonly status: FileManagerAppState["downloadStatus"];
  readonly errorMessage: string | undefined;
  readonly settings: DownloadManagerSettings | null;
  readonly remoteApiStatus: DownloadManagerRemoteApiStatus | null;
};

export type FileManagerStateStore = {
  readonly statesRef: MutableRefObject<Record<string, FileManagerAppState>>;
  readonly createState: (instanceId: string) => FileManagerAppState;
  readonly updateStates: (
    updater: (
      current: Record<string, FileManagerAppState>
    ) => Record<string, FileManagerAppState>
  ) => void;
  readonly patchState: (
    instanceId: string,
    updater: (state: FileManagerAppState) => FileManagerAppState
  ) => void;
  readonly replaceState: (instanceId: string, nextState: FileManagerAppState) => void;
  readonly createInstance: () => FileManagerAppMeta;
  readonly ensureInstance: (instanceId: string) => void;
  readonly getState: (instanceId: string) => FileManagerAppState | null;
  readonly syncExternalInstances: (instanceIds: readonly string[]) => void;
  readonly syncTabInstances: (instanceIds: readonly string[]) => void;
};

export const useFileManagerStateStore = ({
  labels,
  getDownloadDefaults,
  onMetaChange,
  onStateRemoved
}: {
  readonly labels: FileManagerSurfaceLabels;
  readonly getDownloadDefaults: () => DownloadDefaults;
  readonly onMetaChange: (request: FileManagerAppMeta) => void;
  readonly onStateRemoved: (state: FileManagerAppState) => void;
}): FileManagerStateStore => {
  const [, setStatesById] = useState<Record<string, FileManagerAppState>>({});
  const statesRef = useRef<Record<string, FileManagerAppState>>({});
  const tabInstanceIdsRef = useRef<ReadonlySet<string>>(new Set());
  const externalInstanceIdsRef = useRef<ReadonlySet<string>>(new Set());

  const createState = useCallback(
    (instanceId: string) =>
      createInitialState(instanceId, labels, getDownloadDefaults()),
    [getDownloadDefaults, labels]
  );

  const updateStates = useCallback(
    (
      updater: (
        current: Record<string, FileManagerAppState>
      ) => Record<string, FileManagerAppState>
    ) => {
      setStatesById((current) => {
        const next = updater(current);
        statesRef.current = next;
        return next;
      });
    },
    []
  );

  const patchState = useCallback((
    instanceId: string,
    updater: (state: FileManagerAppState) => FileManagerAppState
  ) => {
    updateStates((current) => {
      const base = current[instanceId] ?? createState(instanceId);
      const nextState = updater(base);
      onMetaChange({
        appId: "file-manager",
        appInstanceId: instanceId,
        title: nextState.title,
        iconKey: nextState.iconKey
      });
      return {
        ...current,
        [instanceId]: nextState
      };
    });
  }, [createState, onMetaChange, updateStates]);

  const replaceState = useCallback((instanceId: string, nextState: FileManagerAppState) => {
    updateStates((current) => ({
      ...current,
      [instanceId]: nextState
    }));
    onMetaChange({
      appId: "file-manager",
      appInstanceId: instanceId,
      title: nextState.title,
      iconKey: nextState.iconKey
    });
  }, [onMetaChange, updateStates]);

  const createInstance = useCallback(() => {
    const appInstanceId = createId("file-manager");
    const initialState = createState(appInstanceId);
    replaceState(appInstanceId, initialState);
    return {
      appId: "file-manager" as const,
      appInstanceId,
      title: initialState.title,
      iconKey: initialState.iconKey
    };
  }, [createState, replaceState]);

  const ensureInstance = useCallback((instanceId: string) => {
    updateStates((current) => {
      if (current[instanceId] !== undefined) {
        return current;
      }
      return {
        ...current,
        [instanceId]: createState(instanceId)
      };
    });
  }, [createState, updateStates]);

  const syncTabInstances = useCallback((instanceIds: readonly string[]) => {
    const normalizedInstanceIds = instanceIds.filter((instanceId) => instanceId.trim().length > 0);
    tabInstanceIdsRef.current = new Set(normalizedInstanceIds);
    const keep = new Set([
      ...normalizedInstanceIds,
      ...externalInstanceIdsRef.current
    ]);
    updateStates((current) => {
      const currentEntries = Object.entries(current);
      const nextEntries = currentEntries.filter(([instanceId]) => keep.has(instanceId));
      if (nextEntries.length === currentEntries.length) {
        return current;
      }
      for (const [, state] of currentEntries) {
        if (keep.has(state.instanceId) === false) {
          onStateRemoved(state);
        }
      }
      return Object.fromEntries(nextEntries);
    });
  }, [onStateRemoved, updateStates]);

  const syncExternalInstances = useCallback((instanceIds: readonly string[]) => {
    const normalized = instanceIds
      .map((instanceId) => instanceId.trim())
      .filter((instanceId) => instanceId.length > 0);
    const nextExternalIds = new Set(normalized);
    const currentExternalIds = externalInstanceIdsRef.current;

    if (
      currentExternalIds.size === nextExternalIds.size
      && normalized.every((instanceId) => currentExternalIds.has(instanceId))
    ) {
      return;
    }

    externalInstanceIdsRef.current = nextExternalIds;
    syncTabInstances(Array.from(tabInstanceIdsRef.current));
  }, [syncTabInstances]);

  const getState = useCallback((instanceId: string) => statesRef.current[instanceId] ?? null, []);

  return {
    statesRef,
    createState,
    updateStates,
    patchState,
    replaceState,
    createInstance,
    ensureInstance,
    getState,
    syncExternalInstances,
    syncTabInstances
  };
};
