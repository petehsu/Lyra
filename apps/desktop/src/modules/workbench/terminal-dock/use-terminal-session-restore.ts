import { useEffect, useRef } from "react";

import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { TerminalDockModel } from "./types";

type UseTerminalSessionRestoreParams = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly terminalModel: TerminalDockModel;
};

/**
 * Bulk-restore persisted terminal PTY sessions after workbench boot.
 * Session persistence was removed in the spawn-per-call refactoring;
 * this hook is now a no-op placeholder.
 */
export const useTerminalSessionRestore = ({
  desktopApi,
  terminalModel
}: UseTerminalSessionRestoreParams): void => {
  const restoreStartedRef = useRef(false);

  useEffect(() => {
    // No-op: session restore removed in terminal architecture refactoring
  }, [desktopApi, terminalModel]);
};