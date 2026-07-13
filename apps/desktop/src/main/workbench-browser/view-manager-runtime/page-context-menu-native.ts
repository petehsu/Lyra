import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from "electron";

import {
  normalizeBrowserContextMenuLocale,
  type BrowserContextMenuLabels,
  type BrowserContextMenuLocale
} from "../../../shared/browser-context-menu-labels";
import type {
  WorkbenchBrowserExecutePageContextActionRequest,
  WorkbenchBrowserPageContextMenuPayload
} from "../../../shared/workbench-browser";
import type { WorkbenchBrowserPublishEvent } from "../types";
import { executePageContextAction } from "./page-context-actions";
import type { BrowserPageEntry } from "./types";

type PageContextActionHost = {
  readonly publishEvent: WorkbenchBrowserPublishEvent;
  readonly goBack: (tabId: string) => void;
  readonly goForward: (tabId: string) => void;
  readonly reload: (tabId: string, ignoreCache?: boolean) => void;
};

type ShowNativePageContextMenuParams = {
  readonly window: BrowserWindow;
  readonly entry: BrowserPageEntry;
  readonly menu: WorkbenchBrowserPageContextMenuPayload;
  readonly tabTitle: string;
  readonly labels: BrowserContextMenuLabels;
  readonly host: PageContextActionHost;
};

const hasSelection = (menu: WorkbenchBrowserPageContextMenuPayload): boolean =>
  (menu.selectionText?.trim().length ?? 0) > 0;

const hasLink = (menu: WorkbenchBrowserPageContextMenuPayload): boolean =>
  (menu.linkUrl?.trim().length ?? 0) > 0;

const runAction = (
  host: PageContextActionHost,
  entry: BrowserPageEntry,
  request: WorkbenchBrowserExecutePageContextActionRequest
): void => {
  executePageContextAction(host, entry, request);
};

export const readBrowserContextMenuLocaleFromPreferences = (
  rawPreferences: string | null | undefined
): BrowserContextMenuLocale => {
  if (rawPreferences === null || rawPreferences === undefined || rawPreferences.trim().length === 0) {
    return "en-US";
  }
  try {
    const parsed = JSON.parse(rawPreferences) as { readonly locale?: unknown };
    return normalizeBrowserContextMenuLocale(parsed.locale);
  } catch {
    return "en-US";
  }
};

export const showNativePageContextMenu = ({
  window,
  entry,
  menu,
  tabTitle,
  labels,
  host
}: ShowNativePageContextMenuParams): void => {
  const template: MenuItemConstructorOptions[] = [];

  template.push({
    label: labels.back,
    enabled: menu.canGoBack,
    click: () => runAction(host, entry, { tabId: menu.tabId, action: "back" })
  });
  template.push({
    label: labels.forward,
    enabled: menu.canGoForward,
    click: () => runAction(host, entry, { tabId: menu.tabId, action: "forward" })
  });
  template.push({
    label: labels.reload,
    click: () => runAction(host, entry, { tabId: menu.tabId, action: "reload" })
  });

  if (hasSelection(menu)) {
    template.push({ type: "separator" });
    template.push({
      label: labels.copy,
      click: () => runAction(host, entry, { tabId: menu.tabId, action: "copy" })
    });
    if (menu.isEditable) {
      template.push({
        label: labels.cut,
        click: () => runAction(host, entry, { tabId: menu.tabId, action: "cut" })
      });
    }
  } else if (menu.isEditable) {
    template.push({ type: "separator" });
    template.push({
      label: labels.paste,
      click: () => runAction(host, entry, { tabId: menu.tabId, action: "paste" })
    });
  }

  if (hasLink(menu)) {
    if (template.length > 3) {
      template.push({ type: "separator" });
    }
    template.push({
      label: labels.copyLink,
      click: () => runAction(host, entry, {
        tabId: menu.tabId,
        action: "copyLink",
        ...(menu.linkUrl === undefined ? {} : { linkUrl: menu.linkUrl })
      })
    });
    template.push({
      label: labels.openLinkInNewTab,
      click: () => runAction(host, entry, {
        tabId: menu.tabId,
        action: "openLinkInNewTab",
        ...(menu.linkUrl === undefined ? {} : { linkUrl: menu.linkUrl })
      })
    });
  }

  const citeLabel = hasSelection(menu)
    ? labels.citeSelection
    : hasLink(menu)
      ? labels.citeLink
      : labels.citePage;
  template.push({ type: "separator" });
  template.push({
    label: citeLabel,
    click: () => {
      host.publishEvent({
        kind: "page-context-menu-select",
        tabId: menu.tabId,
        itemId: "cite-page",
        menu,
        tabTitle
      });
    }
  });

  const nativeMenu = Menu.buildFromTemplate(template);
  nativeMenu.popup({
    window,
    x: Math.round(menu.anchorX),
    y: Math.round(menu.anchorY)
  });
};
