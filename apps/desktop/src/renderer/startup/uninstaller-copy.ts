import type { ProductUninstallProgress } from "../../shared/desktop-bridge";

export const UNINSTALL_IDLE_STATUS = [
  "Removes the app, components, and leftover files",
  "Host shortcuts and uninstall records are included",
  "Your files stay unless you choose otherwise"
] as const;

const UNINSTALL_FILE_STATUS = [
  "Removing staged component files",
  "Deleting the download cache",
  "Clearing leftover receipts",
  "Sweeping the desktop session store"
] as const;

const UNINSTALL_SHORTCUT_STATUS = [
  "Removing desktop and menu shortcuts",
  "Clearing launcher entries"
] as const;

const UNINSTALL_REGISTRY_STATUS = [
  "Removing the uninstall record",
  "Clearing the lyra:// protocol"
] as const;

export const UNINSTALL_COMPLETE_STATUS = "Lyra has been removed";
export const UNINSTALL_FAILED_STATUS = "Uninstall did not finish";
export const UNINSTALL_ROTATE_MS = 1_200;

export const readUninstallerForceFromSearch = (search: string): boolean =>
  new URLSearchParams(search).get("uninstall") === "1";

export const statusPoolForUninstall = (
  progress: ProductUninstallProgress | null,
  running: boolean,
  failed: boolean,
  finished: boolean
): readonly string[] => {
  if (failed) {
    return [UNINSTALL_FAILED_STATUS];
  }
  if (finished) {
    return [UNINSTALL_COMPLETE_STATUS];
  }
  if (!running || progress === null) {
    return UNINSTALL_IDLE_STATUS;
  }
  switch (progress.phase) {
    case "files":
      return UNINSTALL_FILE_STATUS;
    case "shortcuts":
      return UNINSTALL_SHORTCUT_STATUS;
    case "registry":
      return UNINSTALL_REGISTRY_STATUS;
    case "complete":
      return [UNINSTALL_COMPLETE_STATUS];
  }
};

export const uninstallProgressFraction = (progress: ProductUninstallProgress | null): number => {
  if (progress === null || progress.total <= 0) {
    return 0;
  }
  return Math.min(1, progress.completed / progress.total);
};
