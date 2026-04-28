import type {
  PluginCenterEntry,
  PluginCenterState,
  PluginCenterStatusFilter,
  PluginMarketplaceEntry
} from "./types";

const marketplaceDisplayName = (marketplace: PluginMarketplaceEntry): string =>
  marketplace.interface?.displayName?.trim() || marketplace.name;

export const selectPluginEntries = (
  state: Pick<PluginCenterState, "marketplaces">
): readonly PluginCenterEntry[] =>
  state.marketplaces.flatMap((marketplace) =>
    marketplace.plugins.map((plugin) => ({
      key: `${marketplace.name}:${plugin.id}`,
      marketplaceName: marketplace.name,
      marketplacePath: marketplace.path,
      marketplaceDisplayName: marketplaceDisplayName(marketplace),
      plugin,
    }))
  );

const matchesFilter = (
  entry: PluginCenterEntry,
  filter: PluginCenterStatusFilter
): boolean => {
  if (filter === "installed") {
    return entry.plugin.installed;
  }
  if (filter === "enabled") {
    return entry.plugin.installed && entry.plugin.enabled;
  }
  if (filter === "disabled") {
    return entry.plugin.installed && !entry.plugin.enabled;
  }
  if (filter === "available") {
    return !entry.plugin.installed && entry.plugin.installPolicy === "AVAILABLE";
  }
  return true;
};

export const selectVisiblePlugins = (
  state: Pick<PluginCenterState, "marketplaces" | "statusFilter">
): readonly PluginCenterEntry[] =>
  selectPluginEntries(state).filter((entry) => matchesFilter(entry, state.statusFilter));

export const findPluginEntry = (
  state: Pick<PluginCenterState, "marketplaces">,
  pluginKey: string
): PluginCenterEntry | null =>
  selectPluginEntries(state).find((entry) => entry.key === pluginKey) ?? null;
