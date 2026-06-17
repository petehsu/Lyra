import type { AgentPageCitation } from "../../../shared/agent";
import type {
  WorkbenchBrowserExecutePageContextActionRequest,
  WorkbenchBrowserPageContextMenuPayload
} from "../../../shared/workbench-browser";
import type { ContextMenuItem } from "../context-menu";
import { buildPageCitationFromContextMenu } from "../ai-panel/lyra-agents/features/chat/page-citation";

export type BrowserPageContextMenuLabels = {
  readonly back: string;
  readonly forward: string;
  readonly reload: string;
  readonly copy: string;
  readonly cut: string;
  readonly paste: string;
  readonly copyLink: string;
  readonly openLinkInNewTab: string;
  readonly citeSelection: string;
  readonly citeLink: string;
  readonly citePage: string;
};

export type BrowserPageContextMenuItemSpec = {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly separatorBefore?: boolean;
};

export type BrowserPageContextMenuActions = {
  readonly executeAction: (request: WorkbenchBrowserExecutePageContextActionRequest) => void | Promise<void>;
  readonly citePage: (citation: AgentPageCitation) => void;
};

const hasSelection = (menu: WorkbenchBrowserPageContextMenuPayload): boolean =>
  (menu.selectionText?.trim().length ?? 0) > 0;

const hasLink = (menu: WorkbenchBrowserPageContextMenuPayload): boolean =>
  (menu.linkUrl?.trim().length ?? 0) > 0;

export const buildBrowserPageContextMenuItemSpecs = (
  menu: WorkbenchBrowserPageContextMenuPayload,
  labels: BrowserPageContextMenuLabels
): readonly BrowserPageContextMenuItemSpec[] => {
  const items: BrowserPageContextMenuItemSpec[] = [];

  items.push({
    id: "back",
    label: labels.back,
    disabled: !menu.canGoBack
  });
  items.push({
    id: "forward",
    label: labels.forward,
    disabled: !menu.canGoForward
  });
  items.push({
    id: "reload",
    label: labels.reload
  });

  if (hasSelection(menu)) {
    items.push({
      id: "copy",
      label: labels.copy,
      separatorBefore: true
    });
    if (menu.isEditable) {
      items.push({
        id: "cut",
        label: labels.cut
      });
    }
  } else if (menu.isEditable) {
    items.push({
      id: "paste",
      label: labels.paste,
      separatorBefore: true
    });
  }

  if (hasLink(menu)) {
    items.push({
      id: "copy-link",
      label: labels.copyLink,
      separatorBefore: items.length > 3
    });
    items.push({
      id: "open-link",
      label: labels.openLinkInNewTab
    });
  }

  const citeLabel = hasSelection(menu)
    ? labels.citeSelection
    : hasLink(menu)
      ? labels.citeLink
      : labels.citePage;
  items.push({
    id: "cite-page",
    label: citeLabel,
    separatorBefore: true
  });

  return items;
};

export const buildBrowserPageContextMenuItems = (
  menu: WorkbenchBrowserPageContextMenuPayload,
  tabTitle: string,
  labels: BrowserPageContextMenuLabels,
  actions: BrowserPageContextMenuActions
): readonly ContextMenuItem[] => {
  const run = (action: WorkbenchBrowserExecutePageContextActionRequest["action"], linkUrl?: string) => {
    void actions.executeAction({
      tabId: menu.tabId,
      action,
      ...(linkUrl === undefined ? {} : { linkUrl })
    });
  };

  return buildBrowserPageContextMenuItemSpecs(menu, labels).map((item) => ({
    ...item,
    onSelect: () => {
      if (item.id === "cite-page") {
        actions.citePage(buildPageCitationFromContextMenu(menu, tabTitle));
        return;
      }
      if (item.id === "back") {
        run("back");
        return;
      }
      if (item.id === "forward") {
        run("forward");
        return;
      }
      if (item.id === "reload") {
        run("reload");
        return;
      }
      if (item.id === "copy") {
        run("copy");
        return;
      }
      if (item.id === "cut") {
        run("cut");
        return;
      }
      if (item.id === "paste") {
        run("paste");
        return;
      }
      if (item.id === "copy-link") {
        run("copyLink", menu.linkUrl);
        return;
      }
      if (item.id === "open-link") {
        run("openLinkInNewTab", menu.linkUrl);
      }
    }
  }));
};