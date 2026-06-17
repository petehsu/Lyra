import { clipboard } from "electron";

import type { WorkbenchBrowserExecutePageContextActionRequest } from "../../../shared/workbench-browser";
import type { WorkbenchBrowserPublishEvent } from "../types";
import type { BrowserPageEntry } from "./types";

type PageContextActionHost = {
  readonly publishEvent: WorkbenchBrowserPublishEvent;
  readonly goBack: (tabId: string) => void;
  readonly goForward: (tabId: string) => void;
  readonly reload: (tabId: string, ignoreCache?: boolean) => void;
};

export const executePageContextAction = (
  host: PageContextActionHost,
  entry: BrowserPageEntry,
  request: WorkbenchBrowserExecutePageContextActionRequest
): void => {
  if (entry.isDestroyed) return;
  const action = request.action;
  const webContents = entry.webContents;
  switch (action) {
    case "back":
      host.goBack(entry.tabId);
      return;
    case "forward":
      host.goForward(entry.tabId);
      return;
    case "reload":
      host.reload(entry.tabId);
      return;
    case "copy":
      webContents.copy();
      return;
    case "cut":
      webContents.cut();
      return;
    case "paste":
      webContents.paste();
      return;
    case "copyLink": {
      const linkUrl = request.linkUrl?.trim();
      if (linkUrl !== undefined && linkUrl.length > 0) {
        clipboard.writeText(linkUrl);
      }
      return;
    }
    case "openLinkInNewTab": {
      const linkUrl = request.linkUrl?.trim();
      if (linkUrl !== undefined && linkUrl.length > 0) {
        host.publishEvent({
          kind: "request-open-tab",
          address: linkUrl
        });
      }
      return;
    }
    default:
      return;
  }
};