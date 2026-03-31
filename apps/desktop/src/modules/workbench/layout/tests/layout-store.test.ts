import { beforeEach, describe, expect, test } from "vitest";

import { useLayoutStore } from "../service";

describe("layout store", () => {
  beforeEach(() => {
    useLayoutStore.setState({
      preset: "ide",
      showFiles: true,
      showAi: true,
      showRuntime: true
    });
  });

  test("applies browser preset defaults", () => {
    useLayoutStore.getState().applyPresetDefaults("browser");

    const state = useLayoutStore.getState();
    expect(state.preset).toBe("browser");
    expect(state.showRuntime).toBe(false);
    expect(state.showFiles).toBe(true);
    expect(state.showAi).toBe(true);
  });

  test("toggles panel visibility", () => {
    useLayoutStore.getState().togglePanel("files");
    expect(useLayoutStore.getState().showFiles).toBe(false);

    useLayoutStore.getState().setPanelVisibility("files", true);
    expect(useLayoutStore.getState().showFiles).toBe(true);
  });
});
