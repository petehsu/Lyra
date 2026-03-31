import { describe, expect, test } from "vitest";

import {
  collectPendingRuntimeFileChangeIds,
  toSidebarChangeApprovalPanelViewModel
} from "../state";
import type { AiPanelRuntimeItem } from "../../runtime";

const createFileRuntimeItem = (
  id: string,
  overrides?: Partial<AiPanelRuntimeItem>
): AiPanelRuntimeItem => ({
  id,
  kind: "file",
  title: `file-${id}`,
  summary: "summary",
  createdAt: 100,
  updatedAt: 100,
  status: "completed",
  presentation: "window",
  windowState: "visible",
  collapsedState: "completed",
  controlMode: "ai_only",
  filePath: `/tmp/${id}.ts`,
  addedLines: 2,
  removedLines: 1,
  ...overrides
});

const createWebRuntimeItem = (id: string): AiPanelRuntimeItem => ({
  id,
  kind: "web",
  title: `web-${id}`,
  summary: "summary",
  createdAt: 100,
  updatedAt: 100,
  status: "completed",
  presentation: "window",
  windowState: "visible",
  collapsedState: "completed",
  controlMode: "ai_only"
});

describe("ai change approval panel state", () => {
  test("collects pending items from completed file changes only", () => {
    const runtimeItems: readonly AiPanelRuntimeItem[] = [
      createFileRuntimeItem("a"),
      createFileRuntimeItem("b", { decision: "accepted" }),
      createFileRuntimeItem("c", { collapsedState: "running", status: "running" }),
      createWebRuntimeItem("w")
    ];

    const panel = toSidebarChangeApprovalPanelViewModel(runtimeItems, null);

    expect(panel).not.toBeNull();
    expect(panel?.pendingItems.map((item) => item.id)).toEqual(["a"]);
    expect(panel?.allItems.map((item) => item.id)).toEqual(["a", "b"]);
  });

  test("hides panel when no pending approvals remain", () => {
    const runtimeItems: readonly AiPanelRuntimeItem[] = [
      createFileRuntimeItem("a", { decision: "accepted" }),
      createFileRuntimeItem("b", { decision: "rejected" })
    ];

    const panel = toSidebarChangeApprovalPanelViewModel(runtimeItems, null);

    expect(panel).toBeNull();
  });

  test("calculates file count and +/- summary", () => {
    const runtimeItems: readonly AiPanelRuntimeItem[] = [
      createFileRuntimeItem("a", { addedLines: 3, removedLines: 1 }),
      createFileRuntimeItem("b", { addedLines: 5, removedLines: 2, decision: "accepted" })
    ];

    const panel = toSidebarChangeApprovalPanelViewModel(runtimeItems, null);

    expect(panel?.pendingSummary).toEqual({
      fileCount: 1,
      addedLines: 3,
      removedLines: 1
    });
    expect(panel?.allSummary).toEqual({ fileCount: 2, addedLines: 8, removedLines: 3 });
  });

  test("accept-all target ids include only pending completed file changes", () => {
    const runtimeItems: readonly AiPanelRuntimeItem[] = [
      createFileRuntimeItem("a"),
      createFileRuntimeItem("b", { decision: "accepted" }),
      createFileRuntimeItem("c", { collapsedState: "error", status: "error" }),
      createFileRuntimeItem("d", { collapsedState: "running", status: "running" })
    ];

    expect(collectPendingRuntimeFileChangeIds(runtimeItems)).toEqual(["a"]);
  });
});
