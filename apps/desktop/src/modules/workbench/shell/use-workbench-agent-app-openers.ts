import { useCallback } from "react";

import {
  createAgentProjectTreeAppRequest,
  type AgentProjectTreeModel
} from "../agent-project-tree";
import { createAgentGitAppRequest } from "../agent-git";
import { createAgentSelfDevAppRequest } from "../agent-selfdev";
import { createAgentOvernightAppRequest } from "../agent-overnight";
import type { WorkspaceTabsModel } from "../workspace-tabs";

type WorkbenchAgentAppOpenersParams = {
  readonly tabsModel: WorkspaceTabsModel;
  readonly agentProjectTreeModel: AgentProjectTreeModel;
  readonly agentSelfDevTitle: string;
  readonly agentOvernightTitle: string;
};

export const useWorkbenchAgentAppOpeners = ({
  tabsModel,
  agentProjectTreeModel,
  agentSelfDevTitle,
  agentOvernightTitle
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

  const onOpenAgentSelfDevLab = useCallback((request: {
    readonly parentSessionId: string | null;
  }): void => {
    const parentSessionId = request.parentSessionId?.trim() || null;
    const nextApp = createAgentSelfDevAppRequest(
      agentSelfDevTitle,
      parentSessionId
    );
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
    agentSelfDevTitle,
    tabsModel
  ]);

  const onOpenAgentOvernightLab = useCallback((request: {
    readonly parentSessionId: string | null;
  }): void => {
    const parentSessionId = request.parentSessionId?.trim() || null;
    const nextApp = createAgentOvernightAppRequest(
      agentOvernightTitle,
      parentSessionId
    );
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
    agentOvernightTitle,
    tabsModel
  ]);

  return {
    onOpenAgentProjectTree,
    onOpenAgentGit,
    onOpenAgentSelfDevLab,
    onOpenAgentOvernightLab
  };
};
