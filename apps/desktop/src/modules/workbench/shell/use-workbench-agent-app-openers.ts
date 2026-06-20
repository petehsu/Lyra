import { useCallback } from "react";

import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import {
  createAgentProjectTreeAppRequest,
  type AgentProjectTreeModel
} from "../agent-project-tree";
import { createAgentGitAppRequest } from "../agent-git";
import type { WorkspaceTabsModel } from "../workspace-tabs";

type WorkbenchAgentAppOpenersParams = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly tabsModel: WorkspaceTabsModel;
  readonly agentProjectTreeModel: AgentProjectTreeModel;
};

type OpenAgentProjectTreeRequest = {
  readonly sessionId: string;
  readonly workingDir: string;
};

type RevealAgentProjectPathRequest = OpenAgentProjectTreeRequest & {
  readonly path: string;
  readonly location?: {
    readonly line: number;
    readonly endLine?: number;
  };
  readonly mode: "reveal" | "open-file";
};

type WorkbenchPathKind = "file" | "directory" | "missing" | "unknown";

const resolvePathKind = async (
  desktopApi: LyraDesktopApi | null,
  filePath: string
): Promise<WorkbenchPathKind> => {
  try {
    const stat = await desktopApi?.files.statFile({ path: filePath });
    if (stat === undefined) {
      return "unknown";
    }
    if (stat.exists === false) {
      return "missing";
    }
    return stat.isDirectory ? "directory" : "file";
  } catch {
    return "unknown";
  }
};

export const useWorkbenchAgentAppOpeners = ({
  desktopApi,
  tabsModel,
  agentProjectTreeModel,
}: WorkbenchAgentAppOpenersParams) => {
  const openOrActivateProjectTree = useCallback((request: OpenAgentProjectTreeRequest): string | null => {
    const sessionId = request.sessionId.trim();
    const workingDir = request.workingDir.trim();
    if (sessionId.length === 0 || workingDir.length === 0) {
      return null;
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
      return nextApp.appInstanceId;
    }
    tabsModel.openAppTab(nextApp);
    return nextApp.appInstanceId;
  }, [
    agentProjectTreeModel,
    tabsModel
  ]);

  const onOpenAgentProjectTree = useCallback((request: OpenAgentProjectTreeRequest): void => {
    openOrActivateProjectTree(request);
  }, [openOrActivateProjectTree]);

  const onRevealAgentProjectPath = useCallback(async (request: RevealAgentProjectPathRequest): Promise<void> => {
    const instanceId = openOrActivateProjectTree(request);
    const path = request.path.trim();
    if (instanceId === null || path.length === 0) {
      return;
    }
    const pathKind = await resolvePathKind(desktopApi, path);
    if (
      request.mode === "open-file" ||
      pathKind === "file" ||
      (pathKind === "unknown" && request.location !== undefined)
    ) {
      if (pathKind !== "directory") {
        await agentProjectTreeModel.openFile(instanceId, path, request.location);
        return;
      }
    }
    if (pathKind === "directory" || request.mode === "reveal") {
      agentProjectTreeModel.revealPath(instanceId, path);
      return;
    }
    await agentProjectTreeModel.openFile(instanceId, path, request.location);
  }, [agentProjectTreeModel, desktopApi, openOrActivateProjectTree]);

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
    onRevealAgentProjectPath,
  };
};
