import type { FileEditorChangeReviewItem } from "../../file-editor";
import type { AiPanelRuntimeItem } from "./types";

export const mapRuntimeItemToFileChangeReviewItem = (
  item: AiPanelRuntimeItem
): FileEditorChangeReviewItem | null => {
  if (item.kind !== "file" || item.filePath === undefined) {
    return null;
  }

  return {
    id: item.id,
    status:
      item.collapsedState === "error"
        ? "error"
        : item.collapsedState === "running"
          ? "running"
          : "completed",
    filePath: item.filePath,
    addedLines: item.addedLines ?? 0,
    removedLines: item.removedLines ?? 0,
    createdAt: item.createdAt,
    ...(item.decision === undefined ? {} : { decision: item.decision })
  };
};
