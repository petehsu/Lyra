import { useCallback, useEffect, useState } from "react";

import type {
  PluginCenterState,
  PluginCenterStatusFilter,
  PluginsCenterModel,
  UsePluginsCenterModelOptions
} from "./types";

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
  void desktopApi;
  void projectHintPath;
  const [state, setState] = useState<PluginCenterState>(createInitialState);

  const load = useCallback(async (): Promise<void> => {
    setState((current) => ({
      ...current,
      status: "ready",
      marketplaces: [],
      loadErrors: [],
      featuredPluginIds: [],
      selectedPluginKey: null,
      busyPluginKey: null,
      errorMessage: null,
    }));
  }, []);

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
    void pluginKey;
  }, []);

  const refreshPlugin = useCallback(async (pluginKey: string): Promise<void> => {
    void pluginKey;
    await load();
  }, [load]);

  const installPlugin = useCallback(async (pluginKey: string): Promise<void> => {
    await refreshPlugin(pluginKey);
  }, [refreshPlugin]);

  const uninstallPlugin = useCallback(async (pluginKey: string): Promise<void> => {
    await refreshPlugin(pluginKey);
  }, [refreshPlugin]);

  const setPluginEnabled = useCallback(async (
    pluginKey: string,
    enabled: boolean
  ): Promise<void> => {
    void enabled;
    await refreshPlugin(pluginKey);
  }, [refreshPlugin]);

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
