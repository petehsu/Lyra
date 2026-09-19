import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { LyraDesktopApi } from "../../../../shared/desktop-bridge";
import type { ImageViewerEvent, ImageViewerOpenResult } from "../../../../shared/image-viewer";
import { useImageViewerModel } from "../service";

const createOpenResult = (): ImageViewerOpenResult => ({
  sessionId: "session-1",
  path: "/tmp/large.tiff",
  title: "large.tiff",
  format: "tiff",
  mimeType: "image/tiff",
  width: 40_000,
  height: 12_788,
  frameCount: 1,
  hasAlpha: false,
  orientation: 1,
  colorSpace: "srgb",
  sizeBytes: 1024,
  tileSize: 512,
  levels: [{ level: 0, width: 40_000, height: 12_788, scale: 1 }],
  nativeTileSupported: true,
  sourceUrl: "",
  kernel: "oiio-imagecache",
  renderMode: "native-tiles",
  cacheState: "importing",
  cacheId: "cache-1",
  generationId: "generation-1",
  sampleFormat: "u8",
  channelCount: 3,
  hasInternalTiles: false,
  hasInternalMipmaps: false,
  importProgress: 0
});

describe("useImageViewerModel", () => {
  test("does not publish metadata for unchanged viewport updates", () => {
    const onMetaChange = vi.fn();
    const { result } = renderHook(() =>
      useImageViewerModel({
        desktopApi: null,
        onMetaChange
      })
    );

    act(() => {
      result.current.ensureInstance("image-viewer-1", { filePath: "/tmp/cat.png" });
    });
    expect(onMetaChange).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.setViewport("image-viewer-1", {
        zoom: 1,
        offsetX: 0,
        offsetY: 0,
        rotation: 0,
        background: "checkerboard"
      });
    });
    expect(onMetaChange).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.setViewport("image-viewer-1", { zoom: 2 });
    });
    expect(onMetaChange).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.setViewport("image-viewer-1", { zoom: 2 });
    });
    expect(onMetaChange).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.resetViewport("image-viewer-1");
    });
    expect(onMetaChange).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.resetViewport("image-viewer-1");
    });
    expect(onMetaChange).toHaveBeenCalledTimes(1);
  });

  test("applies image viewer progress events to the matching session", async () => {
    let eventListener: ((event: ImageViewerEvent) => void) | null = null;
    const openResult = createOpenResult();
    const desktopApi = {
      appMeta: {
        version: "0.1.0",
        platform: "darwin",
        isPackaged: false
      },
      files: {
        readDirectory: vi.fn().mockResolvedValue({ entries: [] })
      },
      imageViewer: {
        openImage: vi.fn().mockResolvedValue(openResult),
        readTile: vi.fn(),
        closeSession: vi.fn().mockResolvedValue(undefined),
        onEvent: vi.fn((listener: (event: ImageViewerEvent) => void) => {
          eventListener = listener;
          return vi.fn();
        })
      }
    } as unknown as LyraDesktopApi;
    const { result } = renderHook(() =>
      useImageViewerModel({
        desktopApi,
        onMetaChange: vi.fn()
      })
    );

    await act(async () => {
      result.current.ensureInstance("image-viewer-1", { filePath: openResult.path });
      await result.current.openImage("image-viewer-1", openResult.path);
    });
    expect(result.current.getState("image-viewer-1")?.importProgress).toBe(0);

    act(() => {
      eventListener?.({
        kind: "import-progress",
        sessionId: "session-1",
        generationId: "generation-1",
        cacheId: "cache-1",
        progress: 0.6
      });
    });
    expect(result.current.getState("image-viewer-1")?.importProgress).toBe(0.6);
    expect(result.current.getState("image-viewer-1")?.openResult?.cacheState).toBe("importing");

    act(() => {
      eventListener?.({
        kind: "cache-ready",
        sessionId: "session-1",
        generationId: "generation-1",
        cacheId: "cache-1"
      });
    });
    expect(result.current.getState("image-viewer-1")?.importProgress).toBe(1);
    expect(result.current.getState("image-viewer-1")?.openResult?.cacheState).toBe("ready");
  });

  test("keeps an explicit sibling group instead of listing the directory", async () => {
    const openResult = createOpenResult();
    const readDirectory = vi.fn().mockResolvedValue({ entries: [] });
    const desktopApi = {
      appMeta: {
        version: "0.1.0",
        platform: "darwin",
        isPackaged: false
      },
      files: { readDirectory },
      imageViewer: {
        openImage: vi.fn().mockResolvedValue(openResult),
        readTile: vi.fn(),
        closeSession: vi.fn().mockResolvedValue(undefined)
      }
    } as unknown as LyraDesktopApi;
    const { result } = renderHook(() =>
      useImageViewerModel({
        desktopApi,
        onMetaChange: vi.fn()
      })
    );
    const siblingPaths = [openResult.path, "/tmp/other.png"];

    await act(async () => {
      result.current.ensureInstance("image-viewer-1", { filePath: openResult.path });
      await result.current.openImage("image-viewer-1", openResult.path, { siblingPaths });
    });

    expect(result.current.getState("image-viewer-1")?.siblingPaths).toEqual(siblingPaths);
    expect(result.current.getState("image-viewer-1")?.siblingIndex).toBe(0);
    expect(readDirectory).not.toHaveBeenCalled();
  });

  test("exposes getState immediately after createInstance so workspace tabs are not empty", () => {
    const { result } = renderHook(() =>
      useImageViewerModel({
        desktopApi: null,
        onMetaChange: vi.fn()
      })
    );

    act(() => {
      const created = result.current.createInstance("/tmp/logo.svg");
      expect(result.current.getState(created.appInstanceId)?.filePath).toBe("/tmp/logo.svg");
      expect(result.current.getState(created.appInstanceId)?.status).toBe("idle");
    });
  });

  test("keeps tree-hosted instances when workspace image tabs sync away", () => {
    const { result } = renderHook(() =>
      useImageViewerModel({
        desktopApi: null,
        onMetaChange: vi.fn()
      })
    );

    act(() => {
      result.current.ensureInstance("tree-img", { filePath: "/tmp/cat.png" });
      expect(result.current.getState("tree-img")?.filePath).toBe("/tmp/cat.png");
      result.current.syncExternalInstances(["tree-img"]);
      result.current.syncTabInstances([]);
    });

    expect(result.current.getState("tree-img")?.filePath).toBe("/tmp/cat.png");
  });

  test("protects svg source editors before native open returns and ignores viewport churn", async () => {
    let resolveOpen: ((value: ImageViewerOpenResult) => void) | null = null;
    const fileEditorModel = {
      ensureInstance: vi.fn(),
      openFile: vi.fn().mockResolvedValue(undefined),
      syncExternalInstances: vi.fn()
    };
    const desktopApi = {
      appMeta: {
        version: "0.1.0",
        platform: "linux",
        isPackaged: false
      },
      files: {
        readDirectory: vi.fn().mockResolvedValue({ entries: [] })
      },
      imageViewer: {
        openImage: vi.fn(() => new Promise<ImageViewerOpenResult>((resolve) => {
          resolveOpen = resolve;
        })),
        readTile: vi.fn(),
        closeSession: vi.fn().mockResolvedValue(undefined),
        onEvent: vi.fn(() => () => undefined)
      }
    } as unknown as LyraDesktopApi;
    const { result } = renderHook(() =>
      useImageViewerModel({
        desktopApi,
        fileEditorModel: fileEditorModel as never,
        onMetaChange: vi.fn()
      })
    );

    let opened: Promise<void> = Promise.resolve();
    act(() => {
      opened = result.current.openImage("image-viewer-1", "/tmp/logo.svg");
    });

    expect(fileEditorModel.ensureInstance).toHaveBeenCalledWith(
      "image-viewer-source:image-viewer-1",
      {
        filePath: "/tmp/logo.svg",
        fileSessionId: "image-viewer:image-viewer-1"
      }
    );
    expect(fileEditorModel.syncExternalInstances).toHaveBeenCalledWith(
      ["image-viewer-source:image-viewer-1"],
      "image-viewer-source"
    );

    fileEditorModel.syncExternalInstances.mockClear();
    act(() => {
      result.current.setViewport("image-viewer-1", { zoom: 2 });
    });
    expect(fileEditorModel.syncExternalInstances).not.toHaveBeenCalled();

    await act(async () => {
      resolveOpen?.({
        ...createOpenResult(),
        sessionId: "svg-session",
        path: "/tmp/logo.svg",
        title: "logo.svg",
        format: "svg",
        mimeType: "image/svg+xml",
        width: 0,
        height: 0,
        nativeTileSupported: false
      });
      await opened;
    });
  });
});
