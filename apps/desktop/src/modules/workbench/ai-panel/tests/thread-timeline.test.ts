import { describe, expect, test } from "vitest";

import { buildAiPanelThreadTimeline } from "../thread-timeline";
import type { AiPanelMessage } from "../chat-types";
import type { AiPanelRuntimeItem } from "../runtime";

const createMessage = (): AiPanelMessage => ({
  id: "msg-1",
  role: "assistant",
  mode: "chat",
  content: "runtime",
  createdAt: 100,
  isPending: false
});

const createRuntimeItem = (): AiPanelRuntimeItem => ({
  id: "runtime-1",
  kind: "file",
  title: "Runtime File",
  summary: "summary",
  createdAt: 105,
  updatedAt: 105,
  status: "running",
  presentation: "window",
  windowState: "visible",
  collapsedState: "running",
  controlMode: "ai_only",
  filePath: "/tmp/runtime.ts",
  editorInstanceId: "editor-1",
  addedLines: 2,
  removedLines: 1
});

describe("ai panel timeline builder", () => {
  test("keeps message entries when runtime items are absent", () => {
    const timeline = buildAiPanelThreadTimeline(
      [createMessage()],
      [],
      "sidebar"
    );

    expect(timeline.map((entry) => entry.kind)).toEqual(["message"]);
  });

  test("uses runtime entries when runtime exists", () => {
    const timeline = buildAiPanelThreadTimeline(
      [createMessage()],
      [createRuntimeItem()],
      "sidebar"
    );

    expect(timeline.map((entry) => entry.kind)).toEqual(["message", "runtime"]);
  });

  test("projects runtime presentation per variant", () => {
    const runtime = createRuntimeItem();

    const sidebarTimeline = buildAiPanelThreadTimeline(
      [createMessage()],
      [runtime],
      "sidebar"
    );
    const workspaceTimeline = buildAiPanelThreadTimeline(
      [createMessage()],
      [runtime],
      "workspace"
    );

    expect(sidebarTimeline[1]?.kind).toBe("runtime");
    if (sidebarTimeline[1]?.kind === "runtime") {
      expect(sidebarTimeline[1].presentation).toBe("window");
    }

    expect(workspaceTimeline[1]?.kind).toBe("runtime");
    if (workspaceTimeline[1]?.kind === "runtime") {
      expect(workspaceTimeline[1].presentation).toBe("capsule");
    }
  });
});
