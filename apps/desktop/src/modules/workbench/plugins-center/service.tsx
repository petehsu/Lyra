import { useCallback, useEffect, useRef, useState } from "react";

import type { LyraClientRequestPayload } from "../../../shared/desktop-bridge";
import { findPluginEntry, selectPluginEntries } from "./selectors";
import type {
  PluginCenterState,
  PluginCenterStatusFilter,
  PluginDetail,
  PluginListResponse,
  PluginsCenterModel,
  UsePluginsCenterModelOptions
} from "./types";

type JsonRecord = Record<string, unknown>;

const createRequestPayload = (
  method: string,
  params: JsonRecord = {}
): LyraClientRequestPayload => ({ method, params });

const createInitialState = (): PluginCenterState => ({
  status: "idle",
  statusFilter: "all",
  marketplaces: [],
  loadErrors: [],
  featuredPluginIds: [],
  selectedPluginKey: null,
  detailsByKey: {},
  busyPluginKey: null,
  errorMessage: null,
});

const pluginReadParams = (
  entry: NonNullable<ReturnType<typeof findPluginEntry>>
): JsonRecord => ({
  pluginName: entry.plugin.name,
  ...(entry.marketplacePath === null
    ? { remoteMarketplaceName: entry.marketplaceName }
    : { marketplacePath: entry.marketplacePath }),
});

export const usePluginsCenterModel = ({
  desktopApi,
  projectHintPath,
}: UsePluginsCenterModelOptions): PluginsCenterModel => {
  const [state, setState] = useState<PluginCenterState>(createInitialState);
  const stateRef = useRef(state);
  const loadVersionRef = useRef(0);
  const lyraApi = desktopApi?.lyra ?? null;

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const load = useCallback(async (): Promise<void> => {
    if (lyraApi === null) {
      setState((current) => ({
        ...current,
        status: "error",
        errorMessage: "Lyra runtime bridge is unavailable.",
      }));
      return;
    }

    const requestVersion = loadVersionRef.current + 1;
    loadVersionRef.current = requestVersion;
    setState((current) => ({
      ...current,
      status: "loading",
      errorMessage: null,
    }));

    try {
      const response = await lyraApi.request<PluginListResponse>(createRequestPayload("plugin/list", {
        ...(projectHintPath === undefined ? {} : { cwds: [projectHintPath] }),
      }));
      if (loadVersionRef.current !== requestVersion) {
        return;
      }
      setState((current) => {
        const nextState = {
          ...current,
          status: "ready" as const,
          marketplaces: response.marketplaces,
          loadErrors: response.marketplaceLoadErrors,
          featuredPluginIds: response.featuredPluginIds,
          errorMessage: null,
        };
        const entries = selectPluginEntries(nextState);
        const selectedStillExists =
          current.selectedPluginKey !== null &&
          entries.some((entry) => entry.key === current.selectedPluginKey);
        return {
          ...nextState,
          selectedPluginKey: selectedStillExists ? current.selectedPluginKey : entries[0]?.key ?? null,
        };
      });
    } catch (error) {
      if (loadVersionRef.current !== requestVersion) {
        return;
      }
      setState((current) => ({
        ...current,
        status: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [lyraApi, projectHintPath]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectPlugin = useCallback((pluginKey: string): void => {
    setState((current) => ({
      ...current,
      selectedPluginKey: pluginKey,
    }));
  }, []);

  const setStatusFilter = useCallback((filter: PluginCenterStatusFilter): void => {
    setState((current) => ({
      ...current,
      statusFilter: filter,
    }));
  }, []);

  const readPlugin = useCallback(async (pluginKey: string): Promise<void> => {
    if (lyraApi === null) {
      return;
    }
    const entry = findPluginEntry(stateRef.current, pluginKey);
    if (entry === null) {
      return;
    }
    setState((current) => ({
      ...current,
      busyPluginKey: pluginKey,
      errorMessage: null,
    }));
    try {
      const response = await lyraApi.request<{ readonly plugin: PluginDetail }>(
        createRequestPayload("plugin/read", pluginReadParams(entry))
      );
      setState((current) => ({
        ...current,
        detailsByKey: {
          ...current.detailsByKey,
          [pluginKey]: response.plugin,
        },
        busyPluginKey: current.busyPluginKey === pluginKey ? null : current.busyPluginKey,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        busyPluginKey: current.busyPluginKey === pluginKey ? null : current.busyPluginKey,
        errorMessage: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [lyraApi]);

  const refreshPlugin = useCallback(async (pluginKey: string): Promise<void> => {
    await load();
    await readPlugin(pluginKey);
  }, [load, readPlugin]);

  const installPlugin = useCallback(async (pluginKey: string): Promise<void> => {
    if (lyraApi === null) {
      return;
    }
    const entry = findPluginEntry(stateRef.current, pluginKey);
    if (entry === null) {
      return;
    }
    setState((current) => ({ ...current, busyPluginKey: pluginKey, errorMessage: null }));
    try {
      await lyraApi.request(createRequestPayload("plugin/install", pluginReadParams(entry)));
      await refreshPlugin(pluginKey);
    } catch (error) {
      setState((current) => ({
        ...current,
        busyPluginKey: current.busyPluginKey === pluginKey ? null : current.busyPluginKey,
        errorMessage: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [lyraApi, refreshPlugin]);

  const uninstallPlugin = useCallback(async (pluginKey: string): Promise<void> => {
    if (lyraApi === null) {
      return;
    }
    const entry = findPluginEntry(stateRef.current, pluginKey);
    if (entry === null) {
      return;
    }
    setState((current) => ({ ...current, busyPluginKey: pluginKey, errorMessage: null }));
    try {
      await lyraApi.request(createRequestPayload("plugin/uninstall", {
        pluginId: entry.plugin.id,
      }));
      await refreshPlugin(pluginKey);
    } catch (error) {
      setState((current) => ({
        ...current,
        busyPluginKey: current.busyPluginKey === pluginKey ? null : current.busyPluginKey,
        errorMessage: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [lyraApi, refreshPlugin]);

  const setPluginEnabled = useCallback(async (
    pluginKey: string,
    enabled: boolean
  ): Promise<void> => {
    if (lyraApi === null) {
      return;
    }
    const entry = findPluginEntry(stateRef.current, pluginKey);
    if (entry === null) {
      return;
    }
    setState((current) => ({ ...current, busyPluginKey: pluginKey, errorMessage: null }));
    try {
      await lyraApi.request(createRequestPayload("config/batchWrite", {
        edits: [
          {
            keyPath: `plugins.${entry.plugin.id}.enabled`,
            value: enabled,
            mergeStrategy: "upsert",
          },
        ],
        reloadUserConfig: true,
      }));
      await refreshPlugin(pluginKey);
    } catch (error) {
      setState((current) => ({
        ...current,
        busyPluginKey: current.busyPluginKey === pluginKey ? null : current.busyPluginKey,
        errorMessage: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [lyraApi, refreshPlugin]);

  return {
    state,
    load,
    selectPlugin,
    setStatusFilter,
    readPlugin,
    installPlugin,
    uninstallPlugin,
    setPluginEnabled,
  };
};
