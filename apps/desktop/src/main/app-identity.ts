import { nativeImage } from "electron";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const LYRA_APP_NAME = "Lyra";
export const LYRA_APP_USER_MODEL_ID = "dev.lyra.desktop";

export type LyraAppIconVariant = "light" | "dark";

const APP_ICON_FILE_NAMES: Record<LyraAppIconVariant, string> = {
  light: "lyra-app-icon-light-512.png",
  dark: "lyra-app-icon-dark-512.png"
};
const APP_ICON_RESOURCE_DIR = join("icons", "app");
const SOURCE_APP_ICON_RESOURCE_DIR = join("resources", "icons", "app");
const mainModuleDir = dirname(fileURLToPath(import.meta.url));

const maybeResourcesPath = (): string | null => {
  const electronProcess = process as NodeJS.Process & { readonly resourcesPath?: unknown };
  return typeof electronProcess.resourcesPath === "string"
    && electronProcess.resourcesPath.length > 0
    ? electronProcess.resourcesPath
    : null;
};

const createLyraAppIconCandidates = (
  variant: LyraAppIconVariant
): readonly string[] => {
  const resourcesPath = maybeResourcesPath();
  const fileName = APP_ICON_FILE_NAMES[variant];
  return [
    ...(resourcesPath === null
      ? []
      : [join(resourcesPath, APP_ICON_RESOURCE_DIR, fileName)]),
    join(mainModuleDir, "..", "..", SOURCE_APP_ICON_RESOURCE_DIR, fileName),
    join(mainModuleDir, "..", "..", "..", SOURCE_APP_ICON_RESOURCE_DIR, fileName),
    join(process.cwd(), SOURCE_APP_ICON_RESOURCE_DIR, fileName),
    join(process.cwd(), "apps", "desktop", SOURCE_APP_ICON_RESOURCE_DIR, fileName)
  ];
};

export const resolveExistingPathForTests = (
  candidates: readonly string[]
): string | null => {
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
};

export const resolveLyraAppIconPath = (
  variant: LyraAppIconVariant = "light"
): string | null =>
  resolveExistingPathForTests(createLyraAppIconCandidates(variant));

export const resolveLyraAppIcon = (
  variant: LyraAppIconVariant = "light"
): Electron.NativeImage | null => {
  const iconPath = resolveLyraAppIconPath(variant);
  if (iconPath === null) {
    return null;
  }
  const icon = nativeImage.createFromPath(iconPath);
  return icon.isEmpty() ? null : icon;
};
