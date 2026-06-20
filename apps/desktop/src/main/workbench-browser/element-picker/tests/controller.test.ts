import { describe, expect, test, vi } from "vitest";

import { createWorkbenchBrowserElementPickerController } from "../controller";
import { WORKBENCH_ELEMENT_PICKER_CONSOLE_PREFIX } from "../types";
import type { WorkbenchBrowserFrameDescriptor } from "../../types";

const mainFrame = (origin = "https://example.com"): WorkbenchBrowserFrameDescriptor => ({
  frameTreeNodeId: 1,
  url: `${origin}/`,
  origin,
  name: "main",
  isMainFrame: true
});

describe("browser element picker controller", () => {
  test("enables picker on the requested tab and publishes enabled state", async () => {
    const publishEvent = vi.fn();
    const executeFrameScript = vi.fn(async () => undefined);
    const controller = createWorkbenchBrowserElementPickerController({
      host: {
        publishEvent,
        listFrames: () => [mainFrame()],
        executeFrameScript
      }
    });

    await controller.setMode({ tabId: "browser-tab-1", enabled: true });

    expect(executeFrameScript).toHaveBeenCalledTimes(2);
    expect(publishEvent).toHaveBeenCalledWith({
      kind: "element-picker-state",
      state: {
        tabId: "browser-tab-1",
        enabled: true,
        mode: "inspect",
        owner: "manual",
        phase: "idle"
      }
    });
  });

  test("injects only same-origin frames and disables on tab switch", async () => {
    const publishEvent = vi.fn();
    const executeFrameScript = vi.fn(async () => undefined);
    const controller = createWorkbenchBrowserElementPickerController({
      host: {
        publishEvent,
        listFrames: () => [
          mainFrame("https://example.com"),
          {
            frameTreeNodeId: 2,
            url: "https://example.com/child",
            origin: "https://example.com",
            name: "child",
            parentFrameTreeNodeId: 1,
            isMainFrame: false
          },
          {
            frameTreeNodeId: 3,
            url: "https://other.example/frame",
            origin: "https://other.example",
            name: "cross",
            parentFrameTreeNodeId: 1,
            isMainFrame: false
          }
        ],
        executeFrameScript
      }
    });

    await controller.setMode({ tabId: "browser-tab-2", enabled: true });
    controller.handleActiveTabChanged("browser-tab-3");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const injectedFrameIds = executeFrameScript.mock.calls
      .map((call) => {
        const request = (call as unknown[])[1] as { frameTreeNodeId?: number } | undefined;
        return request?.frameTreeNodeId;
      })
      .filter((value): value is number => typeof value === "number");
    expect(injectedFrameIds).toContain(1);
    expect(injectedFrameIds).toContain(2);
    expect(injectedFrameIds).not.toContain(3);
    expect(publishEvent).toHaveBeenLastCalledWith({
      kind: "element-picker-state",
      state: {
        tabId: "browser-tab-2",
        enabled: false,
        mode: "inspect",
        cause: "tab_switched"
      }
    });
  });

  test("publishes selected element context as a page citation payload", async () => {
    const publishEvent = vi.fn();
    const controller = createWorkbenchBrowserElementPickerController({
      host: {
        publishEvent,
        listFrames: () => [mainFrame()],
        executeFrameScript: vi.fn(async () => undefined)
      }
    });

    await controller.setMode({ tabId: "browser-tab-4", enabled: true });
    controller.handleConsoleMessage(
      "browser-tab-4",
      WORKBENCH_ELEMENT_PICKER_CONSOLE_PREFIX + JSON.stringify({
        kind: "select",
        frameTreeNodeId: 1,
        anchorX: 120,
        anchorY: 80,
        pageUrl: "https://example.com/docs",
        pageTitle: "Docs",
        frameUrl: "https://example.com/docs",
        mediaType: "none",
        isEditable: false,
        selectionText: "Install Lyra",
        elementTag: "button",
        elementSelector: "#app > button:nth-of-type(1)",
        elementRole: "button",
        elementAriaLabel: "Install"
      })
    );

    expect(publishEvent).toHaveBeenCalledWith({
      kind: "element-picker-select",
      menu: {
        tabId: "browser-tab-4",
        anchorX: 120,
        anchorY: 80,
        pageUrl: "https://example.com/docs",
        pageTitle: "Docs",
        frameUrl: "https://example.com/docs",
        mediaType: "none",
        isEditable: false,
        canGoBack: false,
        canGoForward: false,
        selectionText: "Install Lyra",
        elementTag: "button",
        elementSelector: "#app > button:nth-of-type(1)",
        elementRole: "button",
        elementAriaLabel: "Install"
      },
      tabTitle: "Docs"
    });
  });
});
