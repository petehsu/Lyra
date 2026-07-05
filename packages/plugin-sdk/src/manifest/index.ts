export type PluginSurfaceContribution = "workspace" | "ai-computer" | "settings" | "background";
export type PluginPlatform = "macos" | "windows" | "linux";

export type PluginCompatibility = {
  readonly minApiVersion?: string;
  readonly platforms?: readonly PluginPlatform[];
};

export type PluginContributions = {
  readonly surfaces: readonly PluginSurfaceContribution[];
};

export type PluginManifest = {
  readonly id: string;
  readonly version: string;
  readonly entry: string;
  readonly l10n?: string;
  readonly title?: string;
  readonly description?: string;
  readonly permissions: readonly string[];
  readonly capabilities?: readonly string[];
  readonly compatibility?: PluginCompatibility;
  readonly contributes?: PluginContributions;
};
