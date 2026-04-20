import { describe, expect, test } from "vitest";

import { resolveAiPanelSurfaceClassName } from "../surface-layout";

describe("ai panel surface layout", () => {
  test("resolves class names for each variant", () => {
    expect(resolveAiPanelSurfaceClassName("sidebar"))
      .toBe("lyra-ai-panel-surface lyra-ai-panel-surface-sidebar");
    expect(resolveAiPanelSurfaceClassName("workspace"))
      .toBe("lyra-ai-panel-surface lyra-ai-panel-surface-workspace");
    expect(resolveAiPanelSurfaceClassName("detached"))
      .toBe("lyra-ai-panel-surface lyra-ai-panel-surface-detached");
  });
});
