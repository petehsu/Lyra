import type { WorkbenchTab } from "../shell/types";

export type TabCanvasProps = {
  readonly tabs: readonly WorkbenchTab[];
  readonly activeTabId: string;
  readonly onActivateTab: (tabId: string) => void;
  readonly onCloseTab: (tabId: string) => void;
  readonly onCreatePluginTab: () => void;
};
