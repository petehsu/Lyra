import type { WorkspaceTab } from "../workspace-tabs/types";
import { AGENT_PROJECT_TREE_APP_ID } from "../agent-project-tree";

export const resolveFindInFilesRoot = (
  tabs: readonly WorkspaceTab[],
  activeTab: WorkspaceTab | undefined,
  getTreeRoot: (instanceId: string) => string | null
): string | null => {
  const ordered = activeTab === undefined
    ? tabs
    : [activeTab, ...tabs.filter((tab) => tab.id !== activeTab.id)];
  for (const tab of ordered) {
    if (
      tab.pageKind !== "app" ||
      tab.appId !== AGENT_PROJECT_TREE_APP_ID ||
      tab.appInstanceId === undefined
    ) {
      continue;
    }
    const rootPath = getTreeRoot(tab.appInstanceId)?.trim() ?? "";
    if (rootPath.length > 0) {
      return rootPath;
    }
  }
  return null;
};
