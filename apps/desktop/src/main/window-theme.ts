import { ipcMain, nativeTheme, type BrowserWindow } from "electron";

import { LYRA_CHANNELS, type WindowThemePayload } from "../shared/desktop-bridge";

// The shell and native window share one authority. Renderer media emulation or
// delayed matchMedia events must not change the meaning of "follow system".
export const registerWindowTheme = (
  getWindow: () => BrowserWindow | null,
  updateBackground: (dark: boolean) => void
): (() => void) => {
  const read = (): WindowThemePayload => ({
    source: nativeTheme.themeSource,
    shouldUseDarkColors: nativeTheme.shouldUseDarkColors
  });
  const publish = () => {
    const theme = read();
    updateBackground(theme.shouldUseDarkColors);
    const window = getWindow();
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(LYRA_CHANNELS.windowThemeChanged, theme);
    }
  };
  ipcMain.handle(LYRA_CHANNELS.readWindowTheme, read);
  ipcMain.handle(LYRA_CHANNELS.setWindowThemeSource, (_event, source: unknown) => {
    if (source !== "system" && source !== "light" && source !== "dark") {
      throw new Error("Invalid Lyra window theme source.");
    }
    if (nativeTheme.themeSource !== source) nativeTheme.themeSource = source;
    publish();
  });
  nativeTheme.on("updated", publish);
  return () => {
    nativeTheme.removeListener("updated", publish);
    ipcMain.removeHandler(LYRA_CHANNELS.readWindowTheme);
    ipcMain.removeHandler(LYRA_CHANNELS.setWindowThemeSource);
  };
};
