import type { PluginManifest } from "../manifest";

export const validatePluginManifest = (manifest: PluginManifest): boolean => {
  return manifest.id.length > 0 && manifest.version.length > 0 && manifest.entry.length > 0;
};
