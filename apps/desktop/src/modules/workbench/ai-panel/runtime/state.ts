import type {
  AiPanelRuntimeItem,
  AiPanelRuntimePresentation,
  AiPanelRuntimeStatus
} from "./types";

export const resolveRuntimePresentation = (
  status: AiPanelRuntimeStatus
): AiPanelRuntimePresentation => {
  if (status === "queued" || status === "running" || status === "completed") {
    return "window";
  }
  return "capsule";
};

export const transitionRuntimeStatus = (
  item: AiPanelRuntimeItem,
  status: AiPanelRuntimeStatus,
  updatedAt = Date.now()
): AiPanelRuntimeItem => ({
  ...item,
  status,
  updatedAt,
  presentation: resolveRuntimePresentation(status),
  windowState:
    status === "collapsing"
      ? "collapsing"
      : status === "collapsed"
        ? "collapsed"
        : "visible",
  collapsedState:
    status === "error"
      ? "error"
      : status === "queued" || status === "running"
        ? "running"
        : "completed"
});

export const transitionRuntimeItemById = (
  items: readonly AiPanelRuntimeItem[],
  itemId: string,
  status: AiPanelRuntimeStatus,
  updatedAt = Date.now()
): readonly AiPanelRuntimeItem[] =>
  items.map((item) => {
    if (item.id !== itemId) {
      return item;
    }
    return transitionRuntimeStatus(item, status, updatedAt);
  });

export const collapseRuntimeItems = (
  items: readonly AiPanelRuntimeItem[]
): readonly AiPanelRuntimeItem[] =>
  items.map((item) => {
    if (item.status === "collapsed") {
      return item;
    }
    return transitionRuntimeStatus(item, "collapsed");
  });
