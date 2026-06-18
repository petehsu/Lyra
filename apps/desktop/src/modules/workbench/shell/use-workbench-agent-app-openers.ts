import { useCallback } from "react";

import {
  createAgentProjectTreeAppRequest,
  type AgentProjectTreeModel
} from "../agent-project-tree";
import { createAgentGitAppRequest } from "../agent-git";
import type { WorkspaceTabsModel } from "../workspace-tabs";

type WorkbenchAgentAppOpenersParams = {
  readonly tabsModel: WorkspaceTabsModel;
  readonly agentProjectTreeModel: AgentProjectTreeModel;
};

export const useWorkbenchAgentAppOpeners = ({
  tabsModel,
  agentProjectTreeModel,
}: WorkbenchAgentAppOpenersParams) => {
  const onOpenAgentProjectTree = useCallback((request: {
    readonly sessionId: string;
    readonly workingDir: string;
  }): void => {
    const sessionId = request.sessionId.trim();
    const workingDir = request.workingDir.trim();
    if (sessionId.length === 0 || workingDir.length === 0) {
      return;
    }
    const nextApp = createAgentProjectTreeAppRequest(sessionId, workingDir);
    agentProjectTreeModel.ensureInstance(nextApp.appInstanceId, {
      agentSessionId: sessionId,
      rootPath: workingDir,
      title: nextApp.title
    });
    const existingTab = tabsModel.tabs.find(
      (tab) =>
        tab.pageKind === "app" &&
        tab.appId === nextApp.appId &&
        tab.appInstanceId === nextApp.appInstanceId
    );
    if (existingTab !== undefined) {
      tabsModel.updateAppTabMeta(nextApp);
      tabsModel.setActiveTab(existingTab.id);
      return;
    }
    tabsModel.openAppTab(nextApp);
  }, [
    agentProjectTreeModel,
    tabsModel
  ]);

  const onOpenAgentGit = useCallback((request: {
    readonly sessionId: string;
    readonly workingDir: string;
  }): void => {
    const sessionId = request.sessionId.trim();
    const workingDir = request.workingDir.trim();
    if (sessionId.length === 0 || workingDir.length === 0) {
      return;
    }
    const nextApp = createAgentGitAppRequest(sessionId, workingDir);
    const existingTab = tabsModel.tabs.find(
      (tab) =>
        tab.pageKind === "app" &&
        tab.appId === nextApp.appId &&
        tab.appInstanceId === nextApp.appInstanceId
    );
    if (existingTab !== undefined) {
      tabsModel.updateAppTabMeta(nextApp);
      tabsModel.setActiveTab(existingTab.id);
      return;
    }
    tabsModel.openAppTab(nextApp);
  }, [tabsModel]);

  return {
    onOpenAgentProjectTree,
    onOpenAgentGit,
  };
};