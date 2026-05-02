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
    expect(onMetaChange).toHaveBeenCalledTimes(2);

    act(() => {
      result.current.setViewport("image-viewer-1", { zoom: 2 });
    });
    expect(onMetaChange).toHaveBeenCalledTimes(2);

    act(() => {
      result.current.resetViewport("image-viewer-1");
    });
    expect(onMetaChange).toHaveBeenCalledTimes(3);

    act(() => {
      result.current.resetViewport("image-viewer-1");
    });
    expect(onMetaChange).toHaveBeenCalledTimes(3);
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
});
