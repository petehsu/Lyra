import type { PluginManifest } from "../manifest";

const PERMISSION_PATTERN = /^[a-z0-9-]+(?::[a-z0-9._-]+)*$/;
const CAPABILITY_ID_PATTERN = /^[a-z0-9-]+\.[a-z0-9._-]+$/;
const SURFACES = new Set(["workspace", "ai-computer", "settings", "background"]);
const PLATFORMS = new Set(["macos", "windows", "linux"]);

export const validatePluginManifest = (manifest: PluginManifest): boolean => {
  if (manifest.id.length === 0 || manifest.version.length === 0 || manifest.entry.length === 0) {
    return false;
  }
  if (manifest.permissions.some((permission) => PERMISSION_PATTERN.test(permission) === false)) {
    return false;
  }
  if (manifest.capabilities?.some((capabilityId) => CAPABILITY_ID_PATTERN.test(capabilityId) === false)) {
    return false;
  }
  if (
    manifest.contributes?.surfaces.some((surface) => SURFACES.has(surface) === false)
  ) {
    return false;
  }
  if (
    manifest.compatibility?.platforms?.some((platform) => PLATFORMS.has(platform) === false)
  ) {
    return false;
  }
  return true;
};
