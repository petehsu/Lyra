import { expect, test, vi } from "vitest";

vi.mock("electron", () => ({ BrowserWindow: {} }));
import { createBrowserAgentPageController } from "../view-manager-runtime/agent-page-controller";

const reader = (executeJavaScript: ReturnType<typeof vi.fn>) => createBrowserAgentPageController({
  stateStore: {},
  resolveBrowserAgentTarget: async () => ({
    tabId: "fixture", targetMode: "live", browserMode: { visibleFollow: false }, webContents: { executeJavaScript }
  }),
  publishBrowserAgentActivity: () => undefined
} as unknown as Parameters<typeof createBrowserAgentPageController>[0]);

test.each([
  { strategy: "focus", scope: "viewport" },
  { strategy: "focus", scope: "full" },
  { strategy: "domFallback", scope: "full" }
] as const)("page read preserves extraction failure: %j", async request => {
  const failure = new Error("Renderer context was destroyed during navigation");
  const execute = vi.fn().mockRejectedValue(failure);
  await expect(reader(execute).readAgentPage("fixture", request)).rejects.toBe(failure);
  expect(execute).toHaveBeenCalledTimes(1);
});

test.each([null, {}, { text: 42 }])("invalid renderer read is not a successful empty page: %j", async raw => {
  await expect(reader(vi.fn().mockResolvedValue(raw)).readAgentPage("fixture", {})).rejects.toThrow();
});

test("an actually empty document remains a valid read", async () => {
  const result = await reader(vi.fn().mockResolvedValue({ text: "", truncated: false }))
    .readAgentPage("fixture", {});
  expect(result).toMatchObject({ content: "", totalChars: 0, extractionMethod: "lumen:rendered-viewport" });
});

test("a guessed wait target cannot be reported as successfully hidden", async () => {
  const execute = vi.fn();
  const controller = createBrowserAgentPageController({
    stateStore: { readBrowserAgentCacheEntry: () => ({ elements: [] }) },
    resolveBrowserAgentTarget: async () => ({ targetMode: "live", webContents: { executeJavaScript: execute } })
  } as unknown as Parameters<typeof createBrowserAgentPageController>[0]);
  await expect(controller.readAgentPage("fixture", { waitTargetRef: "lumen:invented" })).rejects.toThrow("current page map");
  expect(execute).not.toHaveBeenCalled();
});

test("target waits execute in the mapped frame, not an unrelated main document", async () => {
  const execute = vi.fn(async () => ({ text: "Frame reply", waitState: { readyState: "complete", busy: false, target: { visible: false, enabled: false } } }));
  const mainExecute = vi.fn();
  const controller = createBrowserAgentPageController({
    stateStore: { readBrowserAgentCacheEntry: () => ({ elements: [{ targetRef: "lumen:stop", frameTreeNodeId: 2 }] }) },
    resolveBrowserAgentTarget: async () => ({ targetMode: "live", webContents: {
      executeJavaScript: mainExecute, mainFrame: { framesInSubtree: [{ frameTreeNodeId: 2, isDestroyed: () => false, executeJavaScript: execute }] }
    } })
  } as unknown as Parameters<typeof createBrowserAgentPageController>[0]);
  const result = await controller.readAgentPage("fixture", { waitTargetRef: "lumen:stop" });
  expect(result).toMatchObject({ content: "Frame reply", waitState: { target: { visible: false } } });
  expect(execute).toHaveBeenCalledTimes(1);
  expect(mainExecute).not.toHaveBeenCalled();
});

test("cross-origin frame extraction uses its context and reports failures as partial", async () => {
  const { createBrowserFrameTextReader } = await import("../view-manager-runtime/agent-frame-text");
  const top = {frameTreeNodeId:1,isDestroyed:()=>false,executeJavaScript:vi.fn().mockResolvedValue({left:0,top:0,right:400,bottom:180})};
  const child = {frameTreeNodeId:2,isDestroyed:()=>false,executeJavaScript:vi.fn().mockResolvedValue({text:"Posted just now",unreadFrames:0})};
  const target = {webContents:{executeJavaScript:vi.fn().mockResolvedValue({text:"Navigation",unreadFrames:1,waitState:{readyState:"complete",busy:false}}),mainFrame:{...top,framesInSubtree:[top,child]}}};
  const descriptor = {frameTreeNodeId:2,parentFrameTreeNodeId:1,ownerSelectorPreview:'iframe#feed'};
  const graph = vi.fn().mockResolvedValue({frames:[{frameTreeNodeId:1,isMainFrame:true},descriptor],framesByTreeNodeId:new Map([[2,descriptor]])});
  const read = createBrowserFrameTextReader(graph);
  const result = await read(target as never,"viewport",4000,1000);
  expect(result.text).toContain("Posted just now"); expect(result.truncated).toBe(false);
  expect(child.executeJavaScript).toHaveBeenCalledTimes(1);
  child.executeJavaScript.mockRejectedValue(new Error("Frame navigated"));
  const partial = await read(target as never,"viewport",4000,1000);
  expect(partial.text).toContain("Partial page read"); expect(partial.truncated).toBe(true);
  top.executeJavaScript.mockResolvedValue(false);child.executeJavaScript.mockClear();
  const hidden = await read(target as never,"viewport",4000,1000);
  expect(hidden.text).not.toContain("Posted just now");expect(child.executeJavaScript).not.toHaveBeenCalled();
});
