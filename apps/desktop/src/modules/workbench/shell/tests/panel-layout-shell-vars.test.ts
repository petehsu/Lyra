import { describe, expect, test } from "vitest";

import {
  applyPanelLayoutCssVars,
  buildPanelLayoutCssVars
} from "../panel-layout-shell-vars";

describe("panel-layout-shell-vars", () => {
  test("buildPanelLayoutCssVars hides collapsed panels", () => {
    const vars = buildPanelLayoutCssVars({
      leftWidth: 320,
      bottomHeight: 200,
      isLeftPanelVisible: false,
      isBottomPanelVisible: true
    });

    expect(vars["--left-width"]).toBe("0px");
    expect(vars["--bottom-height"]).toBe("200px");
  });

  test("applyPanelLayoutCssVars writes custom properties on the shell root", () => {
    const root = document.createElement("div");
    applyPanelLayoutCssVars(
      root,
      buildPanelLayoutCssVars({
        leftWidth: 280,
        bottomHeight: 160,
        isLeftPanelVisible: true,
        isBottomPanelVisible: true
      })
    );

    expect(root.style.getPropertyValue("--left-width")).toBe("280px");
    expect(root.style.getPropertyValue("--bottom-height")).toBe("160px");
  });
});