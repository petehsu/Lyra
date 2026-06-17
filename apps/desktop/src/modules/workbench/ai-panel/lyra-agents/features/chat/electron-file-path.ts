import { getDesktopApi } from "../../../../shell/service";

export const resolveElectronFilePath = (file: File): string | null => {
  const fromBridge = getDesktopApi()?.files.getPathForFile?.(file)?.trim();
  if (fromBridge !== undefined && fromBridge.length > 0) {
    return fromBridge;
  }

  const legacy = (file as File & { readonly path?: string }).path?.trim();
  return legacy === undefined || legacy.length === 0 ? null : legacy;
};