export type PluginManifest = {
  readonly id: string;
  readonly version: string;
  readonly entry: string;
  readonly permissions: readonly string[];
};
