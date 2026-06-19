import { useEffect, useMemo } from "react";

import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { AiPanelSessionTab } from "../ai-panel/session-tabs";
import {
  useTerminalIdentityMap,
  type ResolvedIdentityIcon,
  type TerminalIdentityRequest
} from "../identity";
import type { TerminalDockModel } from "../terminal-dock";

export const useTerminalIdentityProjection = ({
  desktopApi,
  terminalModel,
  aiSessionTabs
}: {
  readonly desktopApi: LyraDesktopApi | null;
  readonly terminalModel: TerminalDockModel;
  readonly aiSessionTabs: readonly AiPanelSessionTab[];
}): Readonly<Record<string, ResolvedIdentityIcon>> => {
  useEffect(() => {
    if (desktopApi?.terminal.onCwdChanged === undefined) {
      return;
    }
    return desktopApi.terminal.onCwdChanged(terminalModel.applyCwdChanged);
  }, [desktopApi, terminalModel]);

  const agentWorkingDirBySessionId = useMemo(() => {
    const entries = new Map<string, string>();
    for (const tab of aiSessionTabs) {
      const sessionId = tab.sessionId?.trim();
      const workingDir = (tab.workingDir ?? tab.draftWorkingDir)?.trim();
      if (
        sessionId !== undefined &&
        sessionId.length > 0 &&
        workingDir !== undefined &&
        workingDir.length > 0
      ) {
        entries.set(sessionId, workingDir);
      }
    }
    return entries;
  }, [aiSessionTabs]);

  const terminalIdentityRequests = useMemo<readonly TerminalIdentityRequest[]>(() => {
    const tabs = [...terminalModel.dockTabs, ...terminalModel.workspaceTabs];
    return tabs.map((tab) => {
      const activePane = terminalModel.state.panes[tab.activePaneId];
      const sourceAgentWorkingDir =
        activePane?.sourceAgentSessionId === undefined
          ? null
          : agentWorkingDirBySessionId.get(activePane.sourceAgentSessionId) ?? null;
      return {
        terminalTabId: tab.id,
        currentCwd: activePane?.currentCwd ?? activePane?.cwd ?? null,
        sourceAgentWorkingDir
      };
    });
  }, [
    agentWorkingDirBySessionId,
    terminalModel.dockTabs,
    terminalModel.state.panes,
    terminalModel.workspaceTabs
  ]);

  return useTerminalIdentityMap(desktopApi, terminalIdentityRequests);
};
