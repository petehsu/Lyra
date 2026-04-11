import type { WorkbenchWebTargetScanScope } from "../../../shared/workbench-web-automation";

export const nextLiveSelectorScope = (
  scope: WorkbenchWebTargetScanScope
): WorkbenchWebTargetScanScope | null => {
  if (scope === "visible") {
    return "nearby";
  }
  if (scope === "nearby") {
    return "expanded";
  }
  return null;
};
