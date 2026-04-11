import type {
  WorkbenchTabReadRequest,
  WorkbenchWorkspaceReadRequest,
  WorkbenchWorkspaceSnapshot
} from "../../../shared/workbench-observation";
import type { WorkbenchObservationDependencies } from "./types";
import { listObservedTabs, readObservedLocalTab } from "./local-tab-readers";

export const readObservedWorkspace = (
  request: WorkbenchWorkspaceReadRequest,
  dependencies: WorkbenchObservationDependencies
): WorkbenchWorkspaceSnapshot => {
  const layout = dependencies.tabsModel.getVisibleWorkspaceLayout();
  const visibleDescriptors = listObservedTabs(
    { scope: "visible", includeUnsupported: false },
    dependencies
  );

  const visibleTabs = visibleDescriptors.tabs.flatMap((descriptor) => {
    if (descriptor.observable === false || descriptor.observationKind === "page") {
      return [];
    }
    const readRequest = {
      tabId: descriptor.tabId,
      maxChars: 12_000,
      maxEntries: 100,
      maxBytes: 16_000
    } as const satisfies Omit<WorkbenchTabReadRequest, "detail" | "includeVisual" | "paneId">;
    const result = readObservedLocalTab(
      {
        ...readRequest,
        ...(request.detail === undefined ? {} : { detail: request.detail })
      },
      dependencies
    );
    return "code" in result ? [] : [result];
  });

  return {
    layoutMode: layout.mode,
    activeTabId: dependencies.tabsModel.activeTabId ?? null,
    focusedTabId: layout.mode === "split" ? layout.focusedSplitTabId : layout.activeTabId,
    visibleTabs
  };
};
