import { useEffect, useMemo, useRef } from "react";

import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { AiPanelSessionTab } from "../ai-panel/session-tabs";
import {
  attachWorkspaceProblems,
  collectBoundProjectRoots
} from "../bottom-aux/problems";
import type { WorkspaceTab } from "../workspace-tabs";

export const useWorkspaceProblemScan = ({
  desktopApi,
  sessionTabs,
  workspaceTabs
}: {
  readonly desktopApi: LyraDesktopApi | null;
  readonly sessionTabs: readonly AiPanelSessionTab[];
  readonly workspaceTabs: readonly WorkspaceTab[];
}): void => {
  const roots = useMemo(
    () => collectBoundProjectRoots(sessionTabs, workspaceTabs),
    [sessionTabs, workspaceTabs]
  );
  const scannedRootsRef = useRef(new Set<string>());

  useEffect(() => {
    const detach = attachWorkspaceProblems(desktopApi);
    const inspect = desktopApi?.lsp?.inspectProjectProblems;
    if (inspect !== undefined) {
      for (const rootPath of roots) {
        if (scannedRootsRef.current.has(rootPath)) {
          continue;
        }
        scannedRootsRef.current.add(rootPath);
        void inspect({ rootPath }).catch(() => undefined);
      }
    }
    return detach;
  }, [desktopApi, roots]);
};
