import type { BrowserWindow, WebContents } from "electron";

export const webContentsCanReceiveIpc = (webContents: WebContents): boolean => {
  if (webContents.isDestroyed()) {
    return false;
  }
  try {
    const frame = webContents.mainFrame;
    if (frame != null && frame.isDestroyed()) {
      return false;
    }
  } catch {
    return false;
  }
  return true;
};

export const sendToWebContents = (
  webContents: WebContents,
  channel: string,
  ...args: unknown[]
): boolean => {
  if (webContentsCanReceiveIpc(webContents) === false) {
    return false;
  }
  try {
    webContents.send(channel, ...args);
    return true;
  } catch {
    return false;
  }
};

export const sendToWindow = (
  window: BrowserWindow | null,
  channel: string,
  ...args: unknown[]
): boolean => {
  if (window === null || window.isDestroyed()) {
    return false;
  }
  return sendToWebContents(window.webContents, channel, ...args);
};
