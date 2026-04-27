import { describe, expect, test } from "vitest";

import {
  DEFAULT_WORKBENCH_UI_STYLE_ID,
  createWorkbenchUiStyleOptions,
  isWorkbenchUiStyleId,
  resolveWorkbenchUiStyleId,
  resolveWorkbenchUiStylePack,
  syncWorkbenchUiStyleToDocument
} from "../service";

describe("workbench ui style service", () => {
  test("resolves the default classic style pack", () => {
    const stylePack = resolveWorkbenchUiStylePack();

    expect(DEFAULT_WORKBENCH_UI_STYLE_ID).toBe("classic");
    expect(stylePack.id).toBe("classic");
    expect(stylePack.labelKey).toBe("settings.uiStyle.classic");
    expect(stylePack.rootClassName).toBe("lyra-style-classic");
    expect(stylePack.rootAttributes["data-lyra-ui-style"]).toBe("classic");
    expect(stylePack.capabilities.source).toBe("builtin");
  });

  test("validates supported style ids", () => {
    expect(isWorkbenchUiStyleId("classic")).toBe(true);
    expect(isWorkbenchUiStyleId("unknown")).toBe(false);
    expect(resolveWorkbenchUiStyleId("unknown")).toBe("classic");
  });

  test("builds localized settings options", () => {
    const options = createWorkbenchUiStyleOptions((key) => key);

    expect(options).toEqual([
      {
        value: "classic",
        label: "settings.uiStyle.classic",
        description: "settings.uiStyleDescription.classic"
      }
    ]);
  });

  test("syncs style identity to the document root", () => {
    const stylePack = resolveWorkbenchUiStylePack("classic");

    syncWorkbenchUiStyleToDocument(stylePack);

    expect(document.documentElement).toHaveClass("lyra-style-classic");
    expect(document.documentElement.dataset.lyraUiStyle).toBe("classic");
  });
});
