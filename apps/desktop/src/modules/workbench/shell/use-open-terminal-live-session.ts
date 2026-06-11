import { useCallback } from "react";

import type { TerminalDockModel } from "../terminal-dock/types";
import type { TerminalWorkspaceActions } from "./use-terminal-workspace-actions";

export type OpenTerminalLiveSessionRequest = {
  readonly sessionId?: string | null;
  readonly terminalTabId?: string | null;
  readonly paneId?: string | null;
};

type UseOpenTerminalLiveSessionArgs = {
  readonly terminalModel: TerminalDockModel;
  readonly terminalWorkspaceActions: TerminalWorkspaceActions;
};

const hasValue = (value: string | undefined): value is string =>
  value !== undefined && value.length > 0;

export const useOpenTerminalLiveSession = ({
  terminalModel,
  terminalWorkspaceActions
}: UseOpenTerminalLiveSessionArgs): ((request: OpenTerminalLiveSessionRequest) => void) =>
  useCallback((request: OpenTerminalLiveSessionRequest): void => {
    const normalizedSessionId = request.sessionId?.trim();
    const normalizedTabId = request.terminalTabId?.trim();
    const normalizedPaneId = request.paneId?.trim();
    const targetTab = hasValue(normalizedTabId)
      ? terminalModel.findTab(normalizedTabId)
      : terminalModel.state.tabs.find((tab) =>
          terminalModel.getTabPanes(tab.id).some((pane) =>
            (!hasValue(normalizedSessionId) || pane.sessionId === normalizedSessionId)
            && (!hasValue(normalizedPaneId) || pane.id === normalizedPaneId)
          )
        ) ?? null;
    if (targetTab === null) {
      return;
    }

    const panes = terminalModel.getTabPanes(targetTab.id);
    const targetPane = hasValue(normalizedPaneId)
      ? panes.find((pane) => pane.id === normalizedPaneId)
      : panes[0];
    if (targetPane !== undefined) {
      terminalModel.focusPane(targetTab.id, targetPane.id);
    }
    terminalWorkspaceActions.openTerminalTabInWorkspace(targetTab.id);
  }, [terminalModel, terminalWorkspaceActions]);
