import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { ImageViewerOpenResult } from "../../../../shared/image-viewer";
import type { ImageViewerAppState, ImageViewerLabels, ImageViewerModel } from "../types";
import { ImageViewerSurface } from "../view";

const labels: ImageViewerLabels = {
  loading: "Loading",
  unavailable: "Unavailable",
  unsupported: "Unsupported",
  retry: "Retry",
  fit: "Fit",
  actualSize: "Actual size",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  reset: "Reset",
  rotateLeft: "Rotate left",
  rotateRight: "Rotate right",
  background: "Background",
  previous: "Previous",
  next: "Next",
  nativeTiles: "Native tiles",
  sourceOnly: "Original source",
  metadata: "Metadata"
};

const createOpenResult = (
  sessionId: string,
  overrides: Partial<ImageViewerOpenResult> = {}
): ImageViewerOpenResult => ({
  sessionId,
  path: "/tmp/cat.png",
  title: "cat.png",
  format: "png",
  mimeType: "image/png",
  width: 100,
  height: 50,
  frameCount: 1,
  hasAlpha: true,
  orientation: 1,
  colorSpace: "srgb",
  sizeBytes: 1024,
  tileSize: 256,
  levels: [],
  nativeTileSupported: false,
  sourceUrl: "file:///tmp/cat.png",
  kernel: "scalar",
  renderMode: "source",
  cacheState: "none",
  cacheId: "",
  generationId: `${sessionId}-generation`,
  sampleFormat: "u8",
  channelCount: 4,
  hasInternalTiles: false,
  hasInternalMipmaps: false,
  importProgress: 1,
  ...overrides
});

const createState = (
  openResult: ImageViewerOpenResult,
  zoom = 1
): ImageViewerAppState => ({
  instanceId: "image-viewer-1",
  filePath: openResult.path,
  title: openResult.title,
  iconKey: "image-viewer-default",
  status: "ready",
  sessionId: openResult.sessionId,
  openResult,
  importProgress: openResult.importProgress,
  message: undefined,
  view: {
    zoom,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    background: "checkerboard"
  },
  siblingPaths: [openResult.path],
  siblingIndex: 0
});

const createModel = (): ImageViewerModel => ({
  createInstance: vi.fn(),
  findInstanceByPath: vi.fn(() => null),
  getState: vi.fn(() => null),
  ensureInstance: vi.fn(),
  syncTabInstances: vi.fn(),
  openImage: vi.fn().mockResolvedValue(undefined),
  openAdjacent: vi.fn().mockResolvedValue(undefined),
  readTile: vi.fn().mockRejectedValue(new Error("unexpected tile read")),
  setViewport: vi.fn(),
  resetViewport: vi.fn(),
  touchInstance: vi.fn()
} as unknown as ImageViewerModel);

describe("ImageViewerSurface", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("auto-fits once per opened image session", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(500);

    const model = createModel();
    const firstOpenResult = createOpenResult("session-1");
    const { rerender } = render(
      <ImageViewerSurface
        state={createState(firstOpenResult)}
        labels={labels}
        model={model}
        themeSignature="test"
      />
    );

    await waitFor(() => {
      expect(model.setViewport).toHaveBeenCalledTimes(1);
    });
    expect(model.setViewport).toHaveBeenLastCalledWith("image-viewer-1", {
      zoom: 9.200000000000001,
      offsetX: 0,
      offsetY: 0
    });

    rerender(
      <ImageViewerSurface
        state={createState(firstOpenResult, 9.200000000000001)}
        labels={labels}
        model={model}
        themeSignature="test"
      />
    );
    expect(model.setViewport).toHaveBeenCalledTimes(1);

    const nextOpenResult = createOpenResult("session-2");
    rerender(
      <ImageViewerSurface
        state={createState(nextOpenResult)}
        labels={labels}
        model={model}
        themeSignature="test"
      />
    );
    await waitFor(() => {
      expect(model.setViewport).toHaveBeenCalledTimes(2);
    });
  });

  test("uses the browser image renderer for common image formats", () => {
    const model = createModel();
    render(
      <ImageViewerSurface
        state={createState(createOpenResult("session-1", {
          nativeTileSupported: true,
          format: "png"
        }))}
        labels={labels}
        model={model}
        themeSignature="test"
      />
    );

    expect(screen.getByText("Original source")).toBeInTheDocument();
  });

  test("keeps a loading overlay until a source image loads", () => {
    const model = createModel();
    const { container } = render(
      <ImageViewerSurface
        state={createState(createOpenResult("session-1", {
          width: 320,
          height: 180
        }))}
        labels={labels}
        model={model}
        themeSignature="test"
      />
    );

    const image = container.querySelector(".lyra-image-viewer-source");
    expect(image).toBeInstanceOf(HTMLImageElement);
    expect(image).toHaveAttribute("width", "320");
    expect(image).toHaveAttribute("height", "180");
    expect(screen.getByLabelText("image-viewer-loading")).toBeInTheDocument();

    fireEvent.load(image as HTMLImageElement);
    expect(screen.queryByLabelText("image-viewer-loading")).not.toBeInTheDocument();
  });

  test("shows a full surface loading flow with import progress", () => {
    const model = createModel();
    render(
      <ImageViewerSurface
        state={{
          ...createState(createOpenResult("session-1")),
          status: "loading",
          openResult: null,
          importProgress: 0.42
        }}
        labels={labels}
        model={model}
        themeSignature="test"
      />
    );

    expect(screen.getByLabelText("image-viewer-loading")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
  });

  test("requests native tiles with the active generation id", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(512);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(512);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(createFakeWebGlContext() as never);

    const readTile = vi.fn().mockResolvedValue({
      width: 512,
      height: 512,
      stride: 2048,
      pixelFormat: "rgba8",
      pixels: new Uint8Array(512 * 512 * 4)
    });
    const model = {
      ...createModel(),
      readTile
    };
    const openResult = createOpenResult("session-native", {
      format: "tiff",
      mimeType: "image/tiff",
      nativeTileSupported: true,
      renderMode: "native-tiles",
      cacheState: "ready",
      tileSize: 512,
      levels: [{ level: 0, width: 512, height: 512, scale: 1 }]
    });

    render(
      <ImageViewerSurface
        state={createState(openResult)}
        labels={labels}
        model={model}
        themeSignature="test"
      />
    );

    await waitFor(() => {
      expect(readTile).toHaveBeenCalled();
    });
    expect(readTile).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-native",
      generationId: "session-native-generation",
      level: 0,
      tileX: 0,
      tileY: 0
    }));
  });

  test("contains invalid asynchronous tile adapters without crashing the surface", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(512);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(512);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(createFakeWebGlContext() as never);

    const readTile = vi.fn(() => undefined as never);
    const model = {
      ...createModel(),
      readTile
    };
    const openResult = createOpenResult("session-invalid-adapter", {
      format: "tiff",
      mimeType: "image/tiff",
      nativeTileSupported: true,
      renderMode: "native-tiles",
      cacheState: "ready",
      tileSize: 512,
      levels: [{ level: 0, width: 512, height: 512, scale: 1 }]
    });

    render(
      <ImageViewerSurface
        state={createState(openResult)}
        labels={labels}
        model={model}
        themeSignature="test"
      />
    );

    await waitFor(() => {
      expect(readTile).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByLabelText("image-viewer-loading")).toBeInTheDocument();
  });

  test("requests the coarsest native tile before first detailed render", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(700);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(createFakeWebGlContext() as never);

    const readTile = vi.fn().mockResolvedValue({
      width: 313,
      height: 100,
      stride: 1252,
      pixelFormat: "rgba8",
      pixels: new Uint8Array(313 * 100 * 4)
    });
    const model = {
      ...createModel(),
      readTile
    };
    const openResult = createOpenResult("session-huge", {
      format: "tiff",
      mimeType: "image/tiff",
      width: 40000,
      height: 12788,
      nativeTileSupported: true,
      renderMode: "native-tiles",
      cacheState: "ready",
      tileSize: 512,
      levels: [
        { level: 0, width: 40000, height: 12788, scale: 1 },
        { level: 1, width: 20000, height: 6394, scale: 2 },
        { level: 2, width: 10000, height: 3197, scale: 4 },
        { level: 3, width: 5000, height: 1599, scale: 8 },
        { level: 4, width: 2500, height: 800, scale: 16 },
        { level: 5, width: 1250, height: 400, scale: 32 },
        { level: 6, width: 625, height: 200, scale: 64 },
        { level: 7, width: 313, height: 100, scale: 128 }
      ]
    });

    render(
      <ImageViewerSurface
        state={createState(openResult)}
        labels={labels}
        model={model}
        themeSignature="test"
      />
    );

    await waitFor(() => {
      expect(readTile).toHaveBeenCalled();
    });
    expect(readTile).toHaveBeenCalledWith(expect.objectContaining({
      level: 7,
      tileX: 0,
      tileY: 0
    }));
  });
});

const createFakeWebGlContext = () => {
  const gl = {
    ARRAY_BUFFER: 0x8892,
    CLAMP_TO_EDGE: 0x812f,
    COLOR_BUFFER_BIT: 0x4000,
    COMPILE_STATUS: 0x8b81,
    FLOAT: 0x1406,
    FRAGMENT_SHADER: 0x8b30,
    LINEAR: 0x2601,
    LINK_STATUS: 0x8b82,
    RGBA: 0x1908,
    STATIC_DRAW: 0x88e4,
    TEXTURE0: 0x84c0,
    TEXTURE_2D: 0x0de1,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    TRIANGLES: 0x0004,
    UNPACK_ALIGNMENT: 0x0cf5,
    UNSIGNED_BYTE: 0x1401,
    VERTEX_SHADER: 0x8b31,
    activeTexture: vi.fn(),
    attachShader: vi.fn(),
    bindBuffer: vi.fn(),
    bindTexture: vi.fn(),
    bufferData: vi.fn(),
    clear: vi.fn(),
    clearColor: vi.fn(),
    compileShader: vi.fn(),
    createBuffer: vi.fn(() => ({})),
    createProgram: vi.fn(() => ({})),
    createShader: vi.fn(() => ({})),
    createTexture: vi.fn(() => ({})),
    deleteTexture: vi.fn(),
    drawArrays: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    getAttribLocation: vi.fn(() => 0),
    getProgramInfoLog: vi.fn(() => ""),
    getProgramParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ""),
    getShaderParameter: vi.fn(() => true),
    getUniformLocation: vi.fn(() => ({})),
    linkProgram: vi.fn(),
    pixelStorei: vi.fn(),
    shaderSource: vi.fn(),
    texImage2D: vi.fn(),
    texParameteri: vi.fn(),
    uniform1i: vi.fn(),
    useProgram: vi.fn(),
    vertexAttribPointer: vi.fn(),
    viewport: vi.fn()
  };
  return gl;
};
