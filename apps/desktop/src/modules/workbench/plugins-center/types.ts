import type { LyraDesktopApi } from "../../../shared/desktop-bridge";

export type PluginCenterStatus = "idle" | "loading" | "ready" | "error";

export type PluginCenterStatusFilter =
  | "all"
  | "installed"
  | "enabled"
  | "disabled"
  | "available";

export type PluginSource =
  | { readonly type: "local"; readonly path: string }
  | {
      readonly type: "git";
      readonly url: string;
      readonly path: string | null;
      readonly refName: string | null;
      readonly sha: string | null;
    }
  | { readonly type: "remote" };

export type PluginInstallPolicy =
  | "NOT_AVAILABLE"
  | "AVAILABLE"
  | "INSTALLED_BY_DEFAULT";

export type PluginAuthPolicy = "ON_INSTALL" | "ON_USE";

export type PluginInterface = {
  readonly displayName: string | null;
  readonly shortDescription: string | null;
  readonly longDescription: string | null;
  readonly developerName: string | null;
  readonly category: string | null;
  readonly capabilities: readonly string[];
  readonly websiteUrl: string | null;
  readonly privacyPolicyUrl: string | null;
  readonly termsOfServiceUrl: string | null;
  readonly defaultPrompt: readonly string[] | null;
  readonly brandColor: string | null;
  readonly composerIcon: string | null;
  readonly composerIconUrl: string | null;
  readonly logo: string | null;
  readonly logoUrl: string | null;
  readonly screenshots: readonly string[];
  readonly screenshotUrls: readonly string[];
};

export type PluginSummary = {
  readonly id: string;
  readonly name: string;
  readonly source: PluginSource;
  readonly installed: boolean;
  readonly enabled: boolean;
  readonly installPolicy: PluginInstallPolicy;
  readonly authPolicy: PluginAuthPolicy;
  readonly interface: PluginInterface | null;
};

export type PluginMarketplaceEntry = {
  readonly name: string;
  readonly path: string | null;
  readonly interface: { readonly displayName: string | null } | null;
  readonly plugins: readonly PluginSummary[];
};

export type MarketplaceLoadErrorInfo = {
  readonly marketplacePath: string;
  readonly message: string;
};

export type SkillSummary = {
  readonly name: string;
  readonly description: string;
  readonly shortDescription: string | null;
  readonly path: string;
  readonly enabled: boolean;
};

export type AppSummary = {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly installUrl: string | null;
  readonly needsAuth: boolean;
};

export type PluginDetail = {
  readonly marketplaceName: string;
  readonly marketplacePath: string;
  readonly summary: PluginSummary;
  readonly description: string | null;
  readonly skills: readonly SkillSummary[];
  readonly apps: readonly AppSummary[];
  readonly mcpServers: readonly string[];
};

export type PluginListResponse = {
  readonly marketplaces: readonly PluginMarketplaceEntry[];
  readonly marketplaceLoadErrors: readonly MarketplaceLoadErrorInfo[];
  readonly featuredPluginIds: readonly string[];
};

export type PluginCenterEntry = {
  readonly key: string;
  readonly marketplaceName: string;
  readonly marketplacePath: string | null;
  readonly marketplaceDisplayName: string;
  readonly plugin: PluginSummary;
};

export type PluginCenterState = {
  readonly status: PluginCenterStatus;
  readonly statusFilter: PluginCenterStatusFilter;
  readonly marketplaces: readonly PluginMarketplaceEntry[];
  readonly loadErrors: readonly MarketplaceLoadErrorInfo[];
  readonly featuredPluginIds: readonly string[];
  readonly selectedPluginKey: string | null;
  readonly detailsByKey: Readonly<Record<string, PluginDetail>>;
  readonly busyPluginKey: string | null;
  readonly errorMessage: string | null;
};

export type PluginsCenterLabels = {
  readonly title: string;
  readonly description: string;
  readonly statusAll: string;
  readonly statusInstalled: string;
  readonly statusEnabled: string;
  readonly statusDisabled: string;
  readonly statusAvailable: string;
  readonly actionRefresh: string;
  readonly actionInstall: string;
  readonly actionUninstall: string;
  readonly actionEnable: string;
  readonly actionDisable: string;
  readonly details: string;
  readonly marketplace: string;
  readonly fieldDescription: string;
  readonly fieldSkills: string;
  readonly fieldMcpServers: string;
  readonly fieldApps: string;
  readonly fieldCapabilities: string;
  readonly fieldPolicies: string;
  readonly fieldSource: string;
  readonly empty: string;
  readonly emptySelection: string;
  readonly noDescription: string;
  readonly noSkills: string;
  readonly noMcpServers: string;
  readonly noApps: string;
  readonly noCapabilities: string;
  readonly installed: string;
  readonly available: string;
  readonly enabled: string;
  readonly disabled: string;
  readonly loadErrors: string;
  readonly sourceLocal: string;
  readonly sourceGit: string;
  readonly sourceRemote: string;
  readonly installNotAvailable: string;
  readonly installAvailable: string;
  readonly installDefault: string;
  readonly authOnInstall: string;
  readonly authOnUse: string;
  readonly appNeedsAuth: string;
};

export type PluginsCenterModel = {
  readonly state: PluginCenterState;
  readonly load: () => Promise<void>;
  readonly selectPlugin: (pluginKey: string) => void;
  readonly setStatusFilter: (filter: PluginCenterStatusFilter) => void;
  readonly readPlugin: (pluginKey: string) => Promise<void>;
  readonly installPlugin: (pluginKey: string) => Promise<void>;
  readonly uninstallPlugin: (pluginKey: string) => Promise<void>;
  readonly setPluginEnabled: (pluginKey: string, enabled: boolean) => Promise<void>;
};

export type UsePluginsCenterModelOptions = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly projectHintPath?: string;
};
