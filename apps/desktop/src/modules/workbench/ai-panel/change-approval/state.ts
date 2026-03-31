import type {
  SidebarChangeApprovalItem,
  SidebarChangeApprovalPanelViewModel,
  SidebarChangeApprovalSummary,
  SidebarChangeApprovalView
} from "../../sidebar/types";
import type { AiPanelRuntimeItem } from "../runtime";

const normalizePath = (filePath: string): string => filePath.replaceAll("\\", "/");

const resolveFileName = (filePath: string): string => {
  const normalized = normalizePath(filePath);
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? filePath;
};

const isCompletedFileRuntimeItem = (item: AiPanelRuntimeItem): boolean =>
  item.kind === "file"
  && typeof item.filePath === "string"
  && item.filePath.trim().length > 0
  && item.collapsedState === "completed";

const mapRuntimeItemToChangeApprovalItem = (
  item: AiPanelRuntimeItem
): SidebarChangeApprovalItem | null => {
  if (isCompletedFileRuntimeItem(item) === false) {
    return null;
  }

  const filePath = item.filePath as string;
  return {
    id: item.id,
    filePath,
    fileName: resolveFileName(filePath),
    addedLines: item.addedLines ?? 0,
    removedLines: item.removedLines ?? 0,
    ...(item.decision === undefined ? {} : { decision: item.decision })
  };
};

const summarize = (
  items: readonly SidebarChangeApprovalItem[]
): SidebarChangeApprovalSummary => ({
  fileCount: items.length,
  addedLines: items.reduce((total, item) => total + item.addedLines, 0),
  removedLines: items.reduce((total, item) => total + item.removedLines, 0)
});

export const collectPendingRuntimeFileChangeIds = (
  runtimeItems: readonly AiPanelRuntimeItem[]
): readonly string[] =>
  runtimeItems
    .filter((item) => isCompletedFileRuntimeItem(item) && item.decision === undefined)
    .map((item) => item.id);

export const toSidebarChangeApprovalPanelViewModel = (
  runtimeItems: readonly AiPanelRuntimeItem[],
  _preferredView: SidebarChangeApprovalView | null
): SidebarChangeApprovalPanelViewModel | null => {
  const allItems = runtimeItems
    .map(mapRuntimeItemToChangeApprovalItem)
    .filter((item): item is SidebarChangeApprovalItem => item !== null);

  if (allItems.length === 0) {
    return null;
  }

  const pendingItems = allItems.filter((item) => item.decision === undefined);
  if (pendingItems.length === 0) {
    return null;
  }

  return {
    view: "pending",
    pendingItems,
    allItems,
    pendingSummary: summarize(pendingItems),
    allSummary: summarize(allItems)
  };
};
