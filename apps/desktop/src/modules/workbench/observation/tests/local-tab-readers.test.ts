import { describe, expect, test, vi } from "vitest";

import type { ImageViewerOpenResult } from "../../../../shared/image-viewer";
import type { WorkspaceTabsModel } from "../../workspace-tabs";
import { listObservedTabs, readObservedLocalTab } from "../local-tab-readers";
import type { WorkbenchObservationDependencies } from "../types";

const createImageOpenResult = (): ImageViewerOpenResult => ({
  sessionId: "image-session-1",
  path: "/Users/petehsu/Pictures/ChatGPT Image 2026年5月10日 00_10_01.png",
  title: "ChatGPT Image 2026年5月10日 00_10_01.png",
  format: "png",
  mimeType: "image/png",
  width: 1024,
  height: 768,
  frameCount: 1,
  hasAlpha: true,
  orientation: 1,
  colorSpace: "srgb",
  sizeBytes: 42_000,
  tileSize: 512,
  levels: [{ level: 0, width: 1024, height: 768, scale: 1 }],
  nativeTileSupported: true,
  sourceUrl: "file:///Users/petehsu/Pictures/ChatGPT%20Image.png",
  kernel: "native",
  renderMode: "native-tiles",
  cacheState: "ready",
  cacheId: "cache-1",
  generationId: "generation-1",
  sampleFormat: "u8",
  channelCount: 4,
  hasInternalTiles: true,
  hasInternalMipmaps: true,
  importProgress: 1
});

const createDependencies = (): WorkbenchObservationDependencies => {
  const tabsModel = {
    tabs: [{
      id: "browser-tab-35",
      title: "ChatGPT Image 2026年5月10日 00_10_01.png",
      pageKind: "app",
      inputValue: "",
      displayAddress: "lyra://app/image-viewer/image-viewer-1",
      faviconUrl: undefined,
      query: undefined,
      appId: "image-viewer",
      appInstanceId: "image-viewer-1",
      appIconKey: "image-viewer-default"
    }],
    activeTabId: "browser-tab-35",
    activeTab: undefined,
    splitGroupTabIds: [],
    focusedSplitTabId: null,
    getVisibleWorkspaceLayout: () => ({
      mode: "single",
      activeTabId: "browser-tab-35",
      visibleTabIds: ["browser-tab-35"],
      splitGroupTabIds: [],
      focusedSplitTabId: null
    })
  } as unknown as WorkspaceTabsModel;

  return {
    desktopApi: null,
    tabsModel,
    fileEditorModel: {} as never,
    fileManagerModel: {} as never,
    imageViewerModel: {
      getState: vi.fn(() => ({
        instanceId: "image-viewer-1",
        filePath: "/Users/petehsu/Pictures/fallback.png",
        title: "fallback.png",
        iconKey: "image-viewer-default",
        status: "ready",
        sessionId: "image-session-1",
        openResult: createImageOpenResult(),
        importProgress: 1,
        message: undefined,
        view: {
          zoom: 1,
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
          background: "checkerboard"
        },
        siblingPaths: ["/Users/petehsu/Pictures/ChatGPT Image 2026年5月10日 00_10_01.png"],
        siblingIndex: 0
      }))
    } as never,
    terminalModel: {} as never
  };
};

describe("local Workbench tab readers", () => {
  test("lists image-viewer tabs as structured observable tabs", () => {
    const result = listObservedTabs({ scope: "active" }, createDependencies());

    expect(result.tabs[0]).toEqual(expect.objectContaining({
      tabId: "browser-tab-35",
      pageKind: "app",
      appId: "image-viewer",
      observable: true,
      observationKind: "image-viewer"
    }));
  });

  test("reads image-viewer state with source file metadata", () => {
    const result = readObservedLocalTab(
      { tabId: "browser-tab-35", detail: "full" },
      createDependencies()
    );

    expect("code" in result).toBe(false);
    if ("code" in result) return;
    expect(result.observation).toEqual(expect.objectContaining({
      kind: "image-viewer",
      filePath: "/Users/petehsu/Pictures/ChatGPT Image 2026年5月10日 00_10_01.png",
      mimeType: "image/png",
      width: 1024,
      height: 768,
      cacheState: "ready"
    }));
  });
});
