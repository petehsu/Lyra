import { useMemo } from "react";

import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import { AGENT_PROJECT_TREE_APP_ID } from "../agent-project-tree";
import {
  useProjectIdentityMap,
  type ProjectIdentityRequest,
  type ResolvedIdentityIcon
} from "../identity";
import type { WorkspaceTab } from "../workspace-tabs";

export const useWorkspaceAppIdentityProjection = ({
  desktopApi,
  tabs
}: {
  readonly desktopApi: LyraDesktopApi | null;
  readonly tabs: readonly WorkspaceTab[];
}): Readonly<Record<string, ResolvedIdentityIcon>> => {
  const requests = useMemo<readonly ProjectIdentityRequest[]>(() =>
    tabs
      .filter((tab) =>
        tab.pageKind === "app" &&
        tab.appId === AGENT_PROJECT_TREE_APP_ID &&
        typeof tab.filePath === "string" &&
        tab.filePath.trim().length > 0
      )
      .map((tab) => ({
        identityId: tab.id,
        projectPath: tab.filePath
      })),
    [tabs]
  );

  return useProjectIdentityMap(desktopApi, requests);
};
