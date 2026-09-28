import { EventEmitter } from "node:events";
import { expect, test, vi } from "vitest";

vi.mock("electron", () => ({ BrowserWindow: {} }));
import { createBrowserAgentPageController } from "../view-manager-runtime/agent-page-controller";

test("a tab closed during navigation returns failure without touching destroyed WebContents", async () => {
  let destroyed = false;
  const getURL = vi.fn(() => {
    if (destroyed) throw new Error("Object has been destroyed");
    return "about:blank";
  });
  const webContents = Object.assign(new EventEmitter(), { isDestroyed: () => destroyed, getURL });
  const entry = { isDestroyed: false, webContents, runtime: { address: "about:blank", title: "" } };
  const navigateInEntry = vi.fn(async () => {
    destroyed = true;
    webContents.emit("destroyed");
    return { tabId: "tab", address: "file:///tmp/image.png", title: "" };
  });
  const controller = createBrowserAgentPageController({
    stateStore: {}, entries: new Map([["tab", entry]]), navigateInEntry,
    resolveBrowserAgentTarget: async () => ({ webContents, liveEntry: entry, targetMode: "live", browserMode: {} }),
    publishBrowserAgentActivity: vi.fn(), publishEvent: vi.fn()
  } as unknown as Parameters<typeof createBrowserAgentPageController>[0]);
  await expect(controller.navigateAgentPage("tab", { url: "file:///tmp/image.png", targetMode: "live" }))
    .resolves.toMatchObject({ navigationState: "failed", tabId: "tab" });
  expect(getURL).toHaveBeenCalledTimes(1);
  expect(navigateInEntry).toHaveBeenCalledTimes(1);
  expect(webContents.eventNames()).toEqual([]);
});

test("a stale entry is replaced before navigation instead of using its destroyed target", async () => {
  const dead = { isDestroyed: false, webContents: { isDestroyed: () => true } };
  const live = { isDestroyed: false, webContents: { isDestroyed: () => false, getURL: () => "https://example.test/" } };
  const entries = new Map<string, unknown>([["tab", dead]]);
  const publishEvent = vi.fn(() => entries.set("tab", live));
  const controller = createBrowserAgentPageController({
    stateStore: {}, entries, publishEvent,
    resolveBrowserAgentTarget: async () => {
      expect(entries.get("tab")).toBe(live);
      return { webContents: live.webContents, targetMode: "live", browserMode: {} };
    }
  } as unknown as Parameters<typeof createBrowserAgentPageController>[0]);
  await expect(controller.navigateAgentPage("tab", { url: "https://example.test/", targetMode: "live" }))
    .resolves.toMatchObject({ alreadyOpen: true });
  expect(publishEvent).toHaveBeenCalledOnce();
});
