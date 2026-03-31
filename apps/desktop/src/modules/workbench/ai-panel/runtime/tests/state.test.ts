import { describe, expect, test } from "vitest";

import {
  resolveRuntimePresentation,
  transitionRuntimeItemById,
  transitionRuntimeStatus
} from "../state";
import type { AiPanelRuntimeItem } from "../types";

const createRuntimeItem = (id: string): AiPanelRuntimeItem => ({
  id,
  kind: "file",
  title: "Runtime File",
  summary: "Runtime summary",
  createdAt: 100,
  updatedAt: 100,
  status: "queued",
  presentation: "window",
  windowState: "visible",
  collapsedState: "running",
  controlMode: "ai_only",
  filePath: "/tmp/demo.ts",
  editorInstanceId: "editor-1",
  addedLines: 0,
  removedLines: 0
});

describe("ai runtime state helpers", () => {
  test("maps status to expected presentation", () => {
    expect(resolveRuntimePresentation("queued")).toBe("window");
    expect(resolveRuntimePresentation("running")).toBe("window");
    expect(resolveRuntimePresentation("completed")).toBe("window");
    expect(resolveRuntimePresentation("collapsing")).toBe("capsule");
    expect(resolveRuntimePresentation("collapsed")).toBe("capsule");
    expect(resolveRuntimePresentation("error")).toBe("capsule");
  });

  test("transitions item status and presentation together", () => {
    const base = createRuntimeItem("runtime-1");
    const next = transitionRuntimeStatus(base, "collapsed", 240);

    expect(next.status).toBe("collapsed");
    expect(next.presentation).toBe("capsule");
    expect(next.updatedAt).toBe(240);
  });

  test("updates only target item when transitioning by id", () => {
    const left = createRuntimeItem("left");
    const right = createRuntimeItem("right");
    const updated = transitionRuntimeItemById([left, right], "right", "running", 500);

    expect(updated[0]?.status).toBe("queued");
    expect(updated[1]?.status).toBe("running");
    expect(updated[1]?.updatedAt).toBe(500);
  });
});
