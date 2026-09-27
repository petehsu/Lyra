import { expect, test, vi } from "vitest";

vi.mock("electron", () => ({ BrowserWindow: {} }));
import { createBrowserAgentPageController } from "../view-manager-runtime/agent-page-controller";

test.each(["live", "isolated"] as const)("composer reads %s page identity without capture or target creation", async (targetMode) => {
  const capturePage = vi.fn(() => { throw new Error("Unexpected screenshot"); });
  const resolveBrowserAgentTarget = vi.fn(() => { throw new Error("Unexpected target creation"); });
  const webContents = {
    isDestroyed: () => false,
    getURL: () => "https://example.com/inbox",
    getTitle: () => "Inbox",
    capturePage
  };
  const runtime = { address: "https://example.com/inbox", title: "Inbox", faviconUrl: "https://example.com/favicon.ico" };
  const entry = { isDestroyed: false, webContents, runtime };
  const shadow = { ...runtime, webContents };
  const controller = createBrowserAgentPageController({
    stateStore: {},
    entries: new Map([["page-1", entry]]),
    readBrowserAgentShadow: (tabId: string) => tabId === "page-1" ? shadow : undefined,
    resolveBrowserAgentTarget
  } as unknown as Parameters<typeof createBrowserAgentPageController>[0]);

  await expect(controller.readAgentPreviewPage("page-1", targetMode)).resolves.toEqual({
    tabId: "page-1", targetMode, url: runtime.address, title: runtime.title, faviconUrl: runtime.faviconUrl
  });
  runtime.faviconUrl = "";
  shadow.faviconUrl = "";
  expect(await controller.readAgentPreviewPage("page-1", targetMode)).not.toHaveProperty("faviconUrl");
  await expect(controller.readAgentPreviewPage("missing", targetMode)).resolves.toBeNull();
  webContents.isDestroyed = () => true;
  await expect(controller.readAgentPreviewPage("page-1", targetMode)).resolves.toBeNull();
  expect(capturePage).not.toHaveBeenCalled();
  expect(resolveBrowserAgentTarget).not.toHaveBeenCalled();
});
