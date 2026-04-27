import type { WorkspaceTab } from "./types";

export type WorkspaceTabsRuntimeState = {
  readonly tabs: readonly WorkspaceTab[];
  readonly activeTabId: string;
  readonly splitGroupTabIds: readonly string[];
  readonly focusedSplitTabId: string | null;
};
