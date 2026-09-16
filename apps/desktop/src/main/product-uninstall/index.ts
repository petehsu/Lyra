export {
  listProductFileTargets,
  listProductShortcutTargets,
  removeProductInstallation,
  resolvePackagedAppRoot,
  type ProductUninstallRequest
} from "./service";
export {
  notifyOpenUninstaller,
  readForceUninstaller,
  registerHostUninstallEntry,
  registerProductUninstallIpc
} from "./host";
export {
  WINDOWS_UNINSTALL_KEYS,
  buildWindowsUninstallString
} from "./windows-arp";
