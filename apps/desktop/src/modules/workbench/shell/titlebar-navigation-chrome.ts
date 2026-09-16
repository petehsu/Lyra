import type { ChromeNavigationV1, WorkbenchChromeScopeV1 } from "@lyra/app-runtime";
import { useMemo } from "react";

import { useWorkbenchChromeBusContribution } from "./workbench-chrome-hooks";

const INACTIVE_TAB_NAVIGATION_SCOPE: WorkbenchChromeScopeV1 = {
  kind: "workspaceTab",
  tabId: "__lyra-chrome-inactive__"
};

/** Chrome bus override for the active workspace tab address band (hidden / readOnly). */
export const useWorkspaceTabNavigationChrome = (
  activeTabId: string | null
): ChromeNavigationV1 | null => {
  const scope = useMemo((): WorkbenchChromeScopeV1 | null => {
    if (activeTabId === null) {
      return null;
    }
    return { kind: "workspaceTab", tabId: activeTabId };
  }, [activeTabId]);
  const contribution = useWorkbenchChromeBusContribution(
    scope ?? INACTIVE_TAB_NAVIGATION_SCOPE,
    "navigation"
  );
  if (scope === null) {
    return null;
  }
  return contribution?.navigation ?? null;
};
