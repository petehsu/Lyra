import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { TabCanvas } from "../index";

describe("tab canvas", () => {
  test("renders tabs and fires actions", () => {
    const onActivateTab = vi.fn();
    const onCloseTab = vi.fn();
    const onCreatePluginTab = vi.fn();

    render(
      <TabCanvas
        tabs={[
          {
            id: "tab-1",
            title: "service.ts",
            type: "editor",
            pinned: false,
            dirty: false,
            subtitle: "src/service.ts"
          }
        ]}
        activeTabId="tab-1"
        onActivateTab={onActivateTab}
        onCloseTab={onCloseTab}
        onCreatePluginTab={onCreatePluginTab}
      />
    );

    fireEvent.click(screen.getByText("service.ts"));
    fireEvent.click(screen.getByRole("button", { name: "close-tab-1" }));
    fireEvent.click(screen.getByRole("button", { name: "New Tab" }));

    expect(onActivateTab).toHaveBeenCalledWith("tab-1");
    expect(onCloseTab).toHaveBeenCalledWith("tab-1");
    expect(onCreatePluginTab).toHaveBeenCalled();
  });
});
