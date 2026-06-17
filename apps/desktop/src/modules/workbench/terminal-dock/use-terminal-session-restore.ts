import { useEffect, useRef } from "react";

import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import { registerBulkTerminalRestore } from "./bulk-terminal-restore";
import type { TerminalDockModel } from "./types";

type UseTerminalSessionRestoreParams = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly terminalModel: TerminalDockModel;
};

/**
 * Bulk-restore persisted terminal PTY sessions after workbench boot.
 * Mirrors VS Code's layout revive: shells come back before each pane mounts xterm.
 */
export const useTerminalSessionRestore = ({
  desktopApi,
  terminalModel
}: UseTerminalSessionRestoreParams): void => {
  const restoreStartedRef = useRef(false);

  useEffect(() => {
    if (desktopApi === null || restoreStartedRef.current) {
      return;
    }
    const sessions = terminalModel.restoreRequest.sessions;
    if (sessions.length === 0) {
      return;
    }

    restoreStartedRef.current = true;
    const restoreWork = desktopApi.terminal.restoreSessions({ sessions }).then((snapshots) => {
      terminalModel.syncRestoredSessions(snapshots);
      return snapshots;
    });
    registerBulkTerminalRestore(restoreWork);
    void restoreWork.catch(() => {
      restoreStartedRef.current = false;
    });
  }, [desktopApi, terminalModel]);
};