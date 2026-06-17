import type { ContextMenuParams, WebContents } from "electron";

import {
  buildPageElementContextAtPointScript,
  normalizePageElementContext,
  type PageElementContext
} from "./page-element-context-script";

export const resolvePageElementContextAtPoint = async (
  webContents: WebContents,
  x: number,
  y: number,
  frame: ContextMenuParams["frame"]
): Promise<PageElementContext | null> => {
  if (webContents.isDestroyed()) {
    return null;
  }
  const script = buildPageElementContextAtPointScript(x, y);
  try {
    const raw = frame !== null && frame.isDestroyed() === false
      ? await frame.executeJavaScript(script, true)
      : await webContents.mainFrame.executeJavaScript(script, true);
    return normalizePageElementContext(raw);
  } catch (_error) {
    return null;
  }
};