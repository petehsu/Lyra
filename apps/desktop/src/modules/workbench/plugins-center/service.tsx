import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  PluginDetail,
  PluginListResponse,
  PluginCenterState,
  PluginCenterStatusFilter,
  PluginsCenterModel,
  UsePluginsCenterModelOptions
} from "./types";
import {
  findPluginEntry,
  selectPluginEntries
} from "./selectors";

type LegacyLyraApi = {
  readonly request: (payload: Readonly<Record<string, unknown>>) => Promise<unknown>;
};

const getLegacyLyraApi = (
  desktopApi: UsePluginsCenterModelOptions["desktopApi"]
): LegacyLyraApi | null => {
  if (desktopApi === null || typeof desktopApi !== "object") {
    return null;
  }
  const value = (desktopApi as unknown as { readonly lyra?: unknown }).lyra;
  if (value === null || typeof value !== "object") {
    return null;
  }
  const request = (value as { readonly request?: unknown }).request;
  return typeof request === "function"
    ? { request: request as LegacyLyraApi["request"] }
    : null;
};

const requestPayload = (
  method: string,
  params: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> => ({
  method,
  params
});

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

export const usePluginsCenterModel = ({
  desktopApi,
  projectHintPath,
}: UsePluginsCenterModelOptions): PluginsCenterModel => {
  const [state, setState] = useState<PluginCenterState>(createInitialState);
  const legacyLyraApi = useMemo(() => getLegacyLyraApi(desktopApi), [desktopApi]);

  const requestLyra = useCallback(async <T,>(
    method: string,
    params: Readonly<Record<string, unknown>>
  ): Promise<T> => {
    if (legacyLyraApi === null) {
      throw new Error("Plugin runtime bridge is unavailable.");
    }
    return await legacyLyraApi.request(requestPayload(method, params)) as T;
  }, [legacyLyraApi]);

  const load = useCallback(async (): Promise<void> => {
    setState((current) => ({
      ...current,
      status: "loading",
      busyPluginKey: null,
      errorMessage: null,
    }));
    try {
      const response = await requestLyra<PluginListResponse>("plugin/list", {
        cwds: projectHintPath === undefined ? [] : [projectHintPath],
      });
      setState((current) => {
        const nextState = {
          ...current,
          status: "ready" as const,
          marketplaces: response.marketplaces,
          loadErrors: response.marketplaceLoadErrors,
          featuredPluginIds: response.featuredPluginIds,
          busyPluginKey: null,
          errorMessage: null,
        };
        const selectedStillExists =
          current.selectedPluginKey !== null &&
          findPluginEntry(nextState, current.selectedPluginKey) !== null;
        return {
          ...nextState,
          selectedPluginKey: selectedStillExists
            ? current.selectedPluginKey
            : selectPluginEntries(nextState)[0]?.key ?? null,
        };
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        status: "error",
        busyPluginKey: null,
        errorMessage: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [projectHintPath, requestLyra]);

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
    const entry = findPluginEntry(state, pluginKey);
    if (entry === null) {
      return;
    }
    setState((current) => ({
      ...current,
      busyPluginKey: pluginKey,
      errorMessage: null,
    }));
    try {
      const response = await requestLyra<{ readonly plugin: PluginDetail }>("plugin/read", {
        marketplacePath: entry.marketplacePath,
        pluginName: entry.plugin.name,
      });
      setState((current) => ({
        ...current,
        selectedPluginKey: pluginKey,
        detailsByKey: {
          ...current.detailsByKey,
          [pluginKey]: response.plugin,
        },
        busyPluginKey: null,
        errorMessage: null,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        busyPluginKey: null,
        errorMessage: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [requestLyra, state]);

  const refreshPlugin = useCallback(async (pluginKey: string): Promise<void> => {
    setState((current) => ({
      ...current,
      selectedPluginKey: pluginKey,
    }));
    await load();
  }, [load]);

  const installPlugin = useCallback(async (pluginKey: string): Promise<void> => {
    const entry = findPluginEntry(state, pluginKey);
    if (entry === null) {
      return;
    }
    setState((current) => ({
      ...current,
      busyPluginKey: pluginKey,
      errorMessage: null,
    }));
    try {
      await requestLyra("plugin/install", {
        marketplacePath: entry.marketplacePath,
        pluginName: entry.plugin.name,
      });
      await refreshPlugin(pluginKey);
    } catch (error) {
      setState((current) => ({
        ...current,
        busyPluginKey: null,
        errorMessage: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [refreshPlugin, requestLyra, state]);

  const uninstallPlugin = useCallback(async (pluginKey: string): Promise<void> => {
    const entry = findPluginEntry(state, pluginKey);
    if (entry === null) {
      return;
    }
    setState((current) => ({
      ...current,
      busyPluginKey: pluginKey,
      errorMessage: null,
    }));
    try {
      await requestLyra("plugin/uninstall", {
        marketplacePath: entry.marketplacePath,
        pluginName: entry.plugin.name,
      });
      await refreshPlugin(pluginKey);
    } catch (error) {
      setState((current) => ({
        ...current,
        busyPluginKey: null,
        errorMessage: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [refreshPlugin, requestLyra, state]);

  const setPluginEnabled = useCallback(async (
    pluginKey: string,
    enabled: boolean
  ): Promise<void> => {
    const entry = findPluginEntry(state, pluginKey);
    if (entry === null) {
      return;
    }
    setState((current) => ({
      ...current,
      busyPluginKey: pluginKey,
      errorMessage: null,
    }));
    try {
      await requestLyra("config/batchWrite", {
        edits: [
          {
            keyPath: `plugins.${entry.plugin.id}.enabled`,
            value: enabled,
            mergeStrategy: "upsert",
          },
        ],
        reloadUserConfig: true,
      });
      setState((current) => ({
        ...current,
        marketplaces: current.marketplaces.map((marketplace) => ({
          ...marketplace,
          plugins: marketplace.plugins.map((plugin) =>
            plugin.id === entry.plugin.id
              ? {
                  ...plugin,
                  installed: plugin.installed || enabled,
                  enabled,
                }
              : plugin
          ),
        })),
        busyPluginKey: null,
        errorMessage: null,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        busyPluginKey: null,
        errorMessage: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [requestLyra, state]);

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
