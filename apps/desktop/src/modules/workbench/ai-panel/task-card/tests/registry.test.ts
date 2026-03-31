import { describe, expect, test } from "vitest";

import type { AiPanelRuntimeItem } from "../../runtime";
import {
  registerTaskCardRenderer,
  resolveTaskCardRenderer,
  toTaskCardItem,
  unregisterTaskCardRenderer,
  type AiTaskCardRenderer
} from "..";

const createRuntimeItem = (): AiPanelRuntimeItem => ({
  id: "runtime-1",
  kind: "file",
  title: "Runtime File",
  summary: "summary",
  createdAt: 100,
  updatedAt: 100,
  status: "running",
  presentation: "window",
  windowState: "visible",
  collapsedState: "running",
  controlMode: "ai_only",
  filePath: "/tmp/runtime.ts",
  addedLines: 4,
  removedLines: 2,
  taskCardKind: "plugin.file-card",
  taskCardPayload: {
    source: "plugin"
  }
});

describe("ai task-card registry", () => {
  test("maps runtime item into unified task-card item", () => {
    const mapped = toTaskCardItem(createRuntimeItem(), "capsule");

    expect(mapped.kind).toBe("plugin.file-card");
    expect(mapped.builtinKind).toBe("file");
    expect(mapped.metrics).toEqual({
      addedLines: 4,
      removedLines: 2
    });
    expect(mapped.payload).toEqual({ source: "plugin" });
    expect(mapped.presentation).toBe("capsule");
  });

  test("resolves built-in and fallback renderer when plugin renderer is absent", () => {
    unregisterTaskCardRenderer("plugin.runtime-card");

    const fallbackRenderer = resolveTaskCardRenderer("plugin.runtime-card");
    const webRenderer = resolveTaskCardRenderer("web");

    expect(fallbackRenderer).toBe(webRenderer);
  });

  test("supports plugin renderer register and unregister", () => {
    const kind = "plugin.runtime-card";
    const renderer: AiTaskCardRenderer = () => "plugin-card";

    registerTaskCardRenderer(kind, renderer);
    expect(resolveTaskCardRenderer(kind)).toBe(renderer);

    unregisterTaskCardRenderer(kind);
    expect(resolveTaskCardRenderer(kind)).not.toBe(renderer);
    expect(resolveTaskCardRenderer(kind)).toBe(resolveTaskCardRenderer("web"));
  });

  test("allows overriding built-in renderer through registry", () => {
    const customRenderer: AiTaskCardRenderer = () => "override";
    const builtInFileRenderer = resolveTaskCardRenderer("file");

    registerTaskCardRenderer("file", customRenderer);
    expect(resolveTaskCardRenderer("file")).toBe(customRenderer);

    unregisterTaskCardRenderer("file");
    expect(resolveTaskCardRenderer("file")).toBe(builtInFileRenderer);
  });
});
