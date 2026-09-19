export const resolveElectronFilePath = (file: File): string | null => {
  const fromElectron = window.lyraElectron?.getPathForFile(file)?.trim();
  if (fromElectron !== undefined && fromElectron.length > 0) {
    return fromElectron;
  }

  const legacy = (file as File & { readonly path?: string }).path?.trim();
  return legacy === undefined || legacy.length === 0 ? null : legacy;
};
