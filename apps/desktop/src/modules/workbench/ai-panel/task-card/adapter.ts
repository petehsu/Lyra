import type { AiPanelRuntimeItem, AiPanelRuntimePresentation } from "../runtime";
import type { AiTaskCardItem } from "./types";

export const toTaskCardItem = (
  runtimeItem: AiPanelRuntimeItem,
  presentation: AiPanelRuntimePresentation
): AiTaskCardItem => ({
  id: runtimeItem.id,
  kind: runtimeItem.taskCardKind ?? runtimeItem.kind,
  builtinKind: runtimeItem.kind,
  title: runtimeItem.title,
  summary: runtimeItem.summary,
  status: runtimeItem.status,
  presentation,
  ...(runtimeItem.decision === undefined ? {} : { decision: runtimeItem.decision }),
  ...(runtimeItem.filePath === undefined ? {} : { filePath: runtimeItem.filePath }),
  ...(runtimeItem.kind === "file"
    ? {
        metrics: {
          addedLines: runtimeItem.addedLines ?? 0,
          removedLines: runtimeItem.removedLines ?? 0
        }
      }
    : {}),
  ...(runtimeItem.taskCardPayload === undefined ? {} : { payload: runtimeItem.taskCardPayload }),
  runtimeItem
});
