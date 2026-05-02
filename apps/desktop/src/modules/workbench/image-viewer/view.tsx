import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  PaintBucket,
  RefreshCcw,
  RotateCcw,
  RotateCw,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent as ReactSyntheticEvent
} from "react";

import type { ImageViewerOpenResult } from "../../../shared/image-viewer";
import type { ImageViewerSurfaceProps } from "./surface-types";
import type { ImageViewerAppState, ImageViewerLabels, ImageViewerModel } from "./types";

export type { ImageViewerSurfaceProps } from "./surface-types";

type TileCanvasProps = {
  readonly openResult: ImageViewerOpenResult;
  readonly state: ImageViewerAppState;
  readonly model: ImageViewerModel;
  readonly labels: ImageViewerLabels;
};

type NaturalImageSize = {
  readonly sessionId: string;
  readonly width: number;
  readonly height: number;
};

type WebGlProgram = {
  readonly gl: WebGLRenderingContext;
  readonly program: WebGLProgram;
  readonly positionBuffer: WebGLBuffer;
  readonly texCoordBuffer: WebGLBuffer;
  readonly positionLocation: number;
  readonly texCoordLocation: number;
  readonly samplerLocation: WebGLUniformLocation | null;
};

type TileTexture = {
  readonly texture: WebGLTexture;
  lastUsed: number;
};

type VisibleTile = {
  readonly key: string;
  readonly level: number;
  readonly tileX: number;
  readonly tileY: number;
  readonly screenX: number;
  readonly screenY: number;
  readonly screenWidth: number;
  readonly screenHeight: number;
};

type TileRuntime = {
  readonly program: WebGlProgram;
  readonly textures: Map<string, TileTexture>;
  readonly inflight: Set<string>;
  generationId: string;
  clock: number;
};

type LoadingOverlayProps = {
  readonly labels: ImageViewerSurfaceProps["labels"];
  readonly progress?: number | undefined;
};

const MAX_TEXTURE_CACHE = 384;
const MAX_TILE_REQUESTS_PER_VIEW = 96;
const MAX_CONCURRENT_TILE_REQUESTS = 12;

const formatBytes = (value: number): string => {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const SOURCE_RENDER_FORMATS = new Set([
  "avif",
  "bmp",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp"
]);

const shouldUseNativeTiles = (openResult: ImageViewerOpenResult): boolean =>
  openResult.nativeTileSupported
  && SOURCE_RENDER_FORMATS.has(openResult.format.toLowerCase()) === false;

const createShader = (
  gl: WebGLRenderingContext,
  type: number,
  source: string
): WebGLShader => {
  const shader = gl.createShader(type);
  if (shader === null) {
    throw new Error("create shader failed");
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    throw new Error(gl.getShaderInfoLog(shader) ?? "shader compile failed");
  }
  return shader;
};

const createProgram = (canvas: HTMLCanvasElement): WebGlProgram => {
  const gl = (canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    preserveDrawingBuffer: false
  }) ?? canvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    preserveDrawingBuffer: false
  })) as WebGLRenderingContext | null;
  if (gl === null) {
    throw new Error("webgl unavailable");
  }
  const vertex = createShader(gl, gl.VERTEX_SHADER, `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_texCoord = a_texCoord;
    }
  `);
  const fragment = createShader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    varying vec2 v_texCoord;
    uniform sampler2D u_image;
    void main() {
      gl_FragColor = texture2D(u_image, v_texCoord);
    }
  `);
  const program = gl.createProgram();
  if (program === null) {
    throw new Error("create program failed");
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    throw new Error(gl.getProgramInfoLog(program) ?? "program link failed");
  }
  const positionBuffer = gl.createBuffer();
  const texCoordBuffer = gl.createBuffer();
  if (positionBuffer === null || texCoordBuffer === null) {
    throw new Error("create buffer failed");
  }
  return {
    gl,
    program,
    positionBuffer,
    texCoordBuffer,
    positionLocation: gl.getAttribLocation(program, "a_position"),
    texCoordLocation: gl.getAttribLocation(program, "a_texCoord"),
    samplerLocation: gl.getUniformLocation(program, "u_image")
  };
};

const toClipRect = (
  canvasWidth: number,
  canvasHeight: number,
  left: number,
  top: number,
  width: number,
  height: number
): Float32Array => {
  const x1 = (left / canvasWidth) * 2 - 1;
  const y1 = 1 - (top / canvasHeight) * 2;
  const x2 = ((left + width) / canvasWidth) * 2 - 1;
  const y2 = 1 - ((top + height) / canvasHeight) * 2;
  return new Float32Array([
    x1, y1,
    x2, y1,
    x1, y2,
    x1, y2,
    x2, y1,
    x2, y2
  ]);
};

const selectLevel = (
  openResult: ImageViewerOpenResult,
  zoom: number,
  preferCoarsePreview = false
) => {
  if (openResult.levels.length === 0) {
    return { level: 0, width: openResult.width, height: openResult.height, scale: 1 };
  }
  if (preferCoarsePreview) {
    return openResult.levels[openResult.levels.length - 1]!;
  }
  const desiredScale = Math.max(1, Math.floor(1 / Math.max(zoom, 0.001)));
  return [...openResult.levels].reverse().find((level) => level.scale <= desiredScale)
    ?? openResult.levels[0]!;
};

const tileKey = (generationId: string, level: number, tileX: number, tileY: number): string =>
  `${generationId}:${level}:${tileX}:${tileY}`;

const resizeCanvasToHost = (canvas: HTMLCanvasElement): number => {
  const host = canvas.parentElement;
  const cssWidth = Math.max(1, host?.clientWidth ?? canvas.clientWidth ?? 1);
  const cssHeight = Math.max(1, host?.clientHeight ?? canvas.clientHeight ?? 1);
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const width = Math.round(cssWidth * dpr);
  const height = Math.round(cssHeight * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return dpr;
};

const visibleTilesForView = (
  canvas: HTMLCanvasElement,
  openResult: ImageViewerOpenResult,
  state: ImageViewerAppState,
  dpr: number,
  preferCoarsePreview = false
): readonly VisibleTile[] => {
  const level = selectLevel(openResult, state.view.zoom, preferCoarsePreview);
  const levelScale = Math.max(1, level.scale);
  const drawScale = state.view.zoom * levelScale * dpr;
  if (drawScale <= 0) {
    return [];
  }
  const originX = canvas.width / 2 + state.view.offsetX * dpr - openResult.width * state.view.zoom * dpr / 2;
  const originY = canvas.height / 2 + state.view.offsetY * dpr - openResult.height * state.view.zoom * dpr / 2;
  const tileSize = openResult.tileSize;
  const minTileX = Math.max(0, Math.floor((-originX / drawScale) / tileSize) - 1);
  const minTileY = Math.max(0, Math.floor((-originY / drawScale) / tileSize) - 1);
  const maxTileX = Math.min(
    Math.ceil(level.width / tileSize) - 1,
    Math.ceil(((canvas.width - originX) / drawScale) / tileSize) + 1
  );
  const maxTileY = Math.min(
    Math.ceil(level.height / tileSize) - 1,
    Math.ceil(((canvas.height - originY) / drawScale) / tileSize) + 1
  );
  const centerTileX = (minTileX + maxTileX) / 2;
  const centerTileY = (minTileY + maxTileY) / 2;
  const visible: VisibleTile[] = [];
  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      visible.push({
        key: tileKey(openResult.generationId, level.level, tileX, tileY),
        level: level.level,
        tileX,
        tileY,
        screenX: originX + tileX * tileSize * drawScale,
        screenY: originY + tileY * tileSize * drawScale,
        screenWidth: Math.min(tileSize, level.width - tileX * tileSize) * drawScale,
        screenHeight: Math.min(tileSize, level.height - tileY * tileSize) * drawScale
      });
    }
  }
  return visible
    .sort((left, right) => {
      const leftDistance = Math.abs(left.tileX - centerTileX) + Math.abs(left.tileY - centerTileY);
      const rightDistance = Math.abs(right.tileX - centerTileX) + Math.abs(right.tileY - centerTileY);
      return leftDistance - rightDistance;
    })
    .slice(0, MAX_TILE_REQUESTS_PER_VIEW);
};

const drawTexture = (
  canvas: HTMLCanvasElement,
  program: WebGlProgram,
  texture: WebGLTexture,
  visible: VisibleTile
): void => {
  const { gl } = program;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.bindBuffer(gl.ARRAY_BUFFER, program.positionBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    toClipRect(canvas.width, canvas.height, visible.screenX, visible.screenY, visible.screenWidth, visible.screenHeight),
    gl.STATIC_DRAW
  );
  gl.enableVertexAttribArray(program.positionLocation);
  gl.vertexAttribPointer(program.positionLocation, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, program.texCoordBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
    gl.STATIC_DRAW
  );
  gl.enableVertexAttribArray(program.texCoordLocation);
  gl.vertexAttribPointer(program.texCoordLocation, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
};

const renderCachedTiles = (
  canvas: HTMLCanvasElement,
  runtime: TileRuntime,
  visibleTiles: readonly VisibleTile[]
): number => {
  const cachedVisibleTiles = visibleTiles.filter((visible) => runtime.textures.has(visible.key));
  if (cachedVisibleTiles.length === 0 && runtime.textures.size > 0) {
    return 0;
  }
  const { gl } = runtime.program;
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(runtime.program.program);
  gl.uniform1i(runtime.program.samplerLocation, 0);
  for (const visible of cachedVisibleTiles) {
    const cached = runtime.textures.get(visible.key);
    if (cached === undefined) {
      continue;
    }
    runtime.clock += 1;
    cached.lastUsed = runtime.clock;
    drawTexture(canvas, runtime.program, cached.texture, visible);
  }
  return cachedVisibleTiles.length;
};

const pruneTextureCache = (runtime: TileRuntime): void => {
  if (runtime.textures.size <= MAX_TEXTURE_CACHE) {
    return;
  }
  const entries = [...runtime.textures.entries()].sort((left, right) => left[1].lastUsed - right[1].lastUsed);
  const removeCount = runtime.textures.size - MAX_TEXTURE_CACHE;
  for (const [key, tile] of entries.slice(0, removeCount)) {
    runtime.program.gl.deleteTexture(tile.texture);
    runtime.textures.delete(key);
  }
};

const ImageViewerLoadingOverlay = ({ labels, progress }: LoadingOverlayProps) => (
  <section className="lyra-image-viewer-loading-flow lyra-image-viewer-loading-overlay" aria-label="image-viewer-loading">
    <div className="lyra-image-viewer-loading-ribbons" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
    <div className="lyra-image-viewer-loading-copy">
      <strong>{labels.loading}</strong>
      {progress === undefined ? null : (
        <small>{Math.round(Math.max(0, Math.min(1, progress)) * 100)}%</small>
      )}
    </div>
  </section>
);

const ImageViewerTileCanvas = ({ openResult, state, model, labels }: TileCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runtimeRef = useRef<TileRuntime | null>(null);
  const latestRenderRef = useRef({ openResult, state });
  const [failed, setFailed] = useState(false);
  const [hasRenderedTile, setHasRenderedTile] = useState(false);
  latestRenderRef.current = { openResult, state };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || failed) {
      return;
    }
    let runtime = runtimeRef.current;
    if (runtime === null) {
      try {
        runtime = {
          program: createProgram(canvas),
          textures: new Map(),
          inflight: new Set(),
          generationId: openResult.generationId,
          clock: 0
        };
        runtimeRef.current = runtime;
      } catch (_error) {
        setFailed(true);
        return;
      }
    }

    if (runtime.generationId !== openResult.generationId) {
      for (const cached of runtime.textures.values()) {
        runtime.program.gl.deleteTexture(cached.texture);
      }
      runtime.textures.clear();
      runtime.inflight.clear();
      runtime.generationId = openResult.generationId;
      runtime.program.gl.clearColor(0, 0, 0, 0);
      runtime.program.gl.clear(runtime.program.gl.COLOR_BUFFER_BIT);
      setHasRenderedTile(false);
    }

    const dpr = resizeCanvasToHost(canvas);
    const visibleTiles = visibleTilesForView(canvas, openResult, state, dpr, hasRenderedTile === false);
    if (renderCachedTiles(canvas, runtime, visibleTiles) > 0 && hasRenderedTile === false) {
      setHasRenderedTile(true);
    }

    const requestBudget = Math.max(0, MAX_CONCURRENT_TILE_REQUESTS - runtime.inflight.size);
    const missingTiles = visibleTiles
      .filter((tile) => runtime.textures.has(tile.key) === false && runtime.inflight.has(tile.key) === false)
      .slice(0, requestBudget);

    for (const visible of missingTiles) {
      runtime.inflight.add(visible.key);
      void model.readTile({
        sessionId: openResult.sessionId,
        generationId: openResult.generationId,
        level: visible.level,
        tileX: visible.tileX,
        tileY: visible.tileY
      }).then((tile) => {
        const activeRuntime = runtimeRef.current;
        if (activeRuntime === null || activeRuntime.generationId !== openResult.generationId) {
          return;
        }
        const { gl } = activeRuntime.program;
        const texture = gl.createTexture();
        if (texture === null) {
          return;
        }
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          tile.width,
          tile.height,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          tile.pixels
        );
        activeRuntime.clock += 1;
        activeRuntime.textures.set(visible.key, {
          texture,
          lastUsed: activeRuntime.clock
        });
        pruneTextureCache(activeRuntime);
        const latest = latestRenderRef.current;
        const renderedCount = renderCachedTiles(
          canvas,
          activeRuntime,
          visibleTilesForView(canvas, latest.openResult, latest.state, resizeCanvasToHost(canvas), hasRenderedTile === false)
        );
        if (renderedCount > 0) {
          setHasRenderedTile(true);
        }
      }).catch(() => undefined).finally(() => {
        runtimeRef.current?.inflight.delete(visible.key);
      });
    }
  }, [failed, hasRenderedTile, model, openResult, state]);

  useEffect(() => () => {
    const runtime = runtimeRef.current;
    if (runtime === null) {
      return;
    }
    for (const cached of runtime.textures.values()) {
      runtime.program.gl.deleteTexture(cached.texture);
    }
    runtime.textures.clear();
    runtime.inflight.clear();
    runtimeRef.current = null;
  }, []);

  if (failed) {
    return (
      <img
        className="lyra-image-viewer-source"
        src={openResult.sourceUrl}
        width={openResult.width || undefined}
        height={openResult.height || undefined}
        alt=""
        draggable={false}
      />
    );
  }

  return (
    <>
    <canvas
      ref={canvasRef}
      className="lyra-image-viewer-canvas"
      style={{
        transform: `rotate(${state.view.rotation}deg)`,
        transformOrigin: "center"
      }}
    />
      {hasRenderedTile ? null : (
        <ImageViewerLoadingOverlay
          labels={labels}
          progress={state.importProgress}
        />
      )}
    </>
  );
};

export const ImageViewerSurface = ({
  state,
  labels,
  model
}: ImageViewerSurfaceProps) => {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<{ readonly x: number; readonly y: number; readonly offsetX: number; readonly offsetY: number } | null>(null);
  const fittedSessionRef = useRef<string | null>(null);
  const latestStateRef = useRef<ImageViewerAppState | null>(state);
  const [naturalImageSize, setNaturalImageSize] = useState<NaturalImageSize | null>(null);
  const [sourceLoadedSessionId, setSourceLoadedSessionId] = useState<string | null>(null);
  const [sourceFailedSessionId, setSourceFailedSessionId] = useState<string | null>(null);
  latestStateRef.current = state;

  const openResult = state?.openResult ?? null;
  const instanceId = state?.instanceId ?? null;
  const openSessionId = openResult?.sessionId ?? null;
  const measuredNaturalSize = naturalImageSize?.sessionId === openSessionId
    ? naturalImageSize
    : null;
  const openWidth = openResult?.width && openResult.width > 0
    ? openResult.width
    : measuredNaturalSize?.width ?? 0;
  const openHeight = openResult?.height && openResult.height > 0
    ? openResult.height
    : measuredNaturalSize?.height ?? 0;
  const canGoAdjacent = (state?.siblingPaths.length ?? 0) > 1;
  const useNativeTiles = openResult === null ? false : shouldUseNativeTiles(openResult);
  const importProgress = state?.importProgress ?? openResult?.importProgress;
  const sourceImagePending = openResult !== null
    && useNativeTiles === false
    && sourceLoadedSessionId !== openSessionId
    && sourceFailedSessionId !== openSessionId;
  const sourceImageFailed = openResult !== null
    && useNativeTiles === false
    && sourceFailedSessionId === openSessionId;
  const metadata = useMemo(() => {
    if (openResult === null) {
      return "";
    }
    const dimensions = openResult.width > 0 && openResult.height > 0
      ? `${openResult.width}x${openResult.height}`
      : openResult.format.toUpperCase();
    return `${dimensions} | ${openResult.format.toUpperCase()} | ${formatBytes(openResult.sizeBytes)} | ${openResult.kernel}`;
  }, [openResult]);

  const fitToViewport = useCallback((): boolean => {
    if (instanceId === null || openWidth <= 0 || openHeight <= 0) {
      return false;
    }
    const host = bodyRef.current;
    const width = host?.clientWidth ?? 0;
    const height = host?.clientHeight ?? 0;
    if (width <= 0 || height <= 0) {
      return false;
    }
    const zoom = Math.min(width / openWidth, height / openHeight) * 0.92;
    model.setViewport(instanceId, { zoom, offsetX: 0, offsetY: 0 });
    return true;
  }, [instanceId, model, openHeight, openWidth]);

  const onSourceImageLoad = useCallback((event: ReactSyntheticEvent<HTMLImageElement>): void => {
    if (openSessionId === null) {
      return;
    }
    setSourceLoadedSessionId(openSessionId);
    setSourceFailedSessionId((current) => current === openSessionId ? null : current);
    const width = event.currentTarget.naturalWidth;
    const height = event.currentTarget.naturalHeight;
    if (width <= 0 || height <= 0) {
      return;
    }
    setNaturalImageSize((current) => {
      if (
        current?.sessionId === openSessionId
        && current.width === width
        && current.height === height
      ) {
        return current;
      }
      return { sessionId: openSessionId, width, height };
    });
  }, [openSessionId]);

  const onSourceImageError = useCallback((): void => {
    if (openSessionId === null) {
      return;
    }
    setSourceFailedSessionId(openSessionId);
  }, [openSessionId]);

  useEffect(() => {
    if (state?.status !== "ready" || openSessionId === null) {
      return;
    }
    if (fittedSessionRef.current === openSessionId) {
      return;
    }
    if (fitToViewport()) {
      fittedSessionRef.current = openSessionId;
    }
  }, [fitToViewport, openSessionId, state?.status]);

  useEffect(() => {
    const stage = bodyRef.current;
    if (stage === null || state?.status !== "ready") {
      return undefined;
    }
    const handleWheel = (event: WheelEvent): void => {
      const currentState = latestStateRef.current;
      if (currentState === null) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const nextZoom = Math.max(
        0.02,
        Math.min(64, currentState.view.zoom * Math.exp(Math.max(-120, Math.min(120, -event.deltaY)) * 0.002))
      );
      const factor = nextZoom / currentState.view.zoom;
      const rect = stage.getBoundingClientRect();
      const anchorX = event.clientX - rect.left - rect.width / 2;
      const anchorY = event.clientY - rect.top - rect.height / 2;
      model.setViewport(currentState.instanceId, {
        zoom: nextZoom,
        offsetX: anchorX - (anchorX - currentState.view.offsetX) * factor,
        offsetY: anchorY - (anchorY - currentState.view.offsetY) * factor
      });
    };
    stage.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      stage.removeEventListener("wheel", handleWheel);
    };
  }, [model, state?.status, openSessionId]);

  if (state === null) {
    return null;
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      offsetX: state.view.offsetX,
      offsetY: state.view.offsetY
    };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const start = dragStartRef.current;
    if (start === null) {
      return;
    }
    event.preventDefault();
    model.setViewport(state.instanceId, {
      offsetX: start.offsetX + event.clientX - start.x,
      offsetY: start.offsetY + event.clientY - start.y
    });
  };
  const onPointerEnd = (): void => {
    dragStartRef.current = null;
  };
  const cycleBackground = (): void => {
    const background = state.view.background === "checkerboard"
      ? "dark"
      : state.view.background === "dark"
        ? "light"
        : "checkerboard";
    model.setViewport(state.instanceId, { background });
  };

  const renderBody = () => {
    if (state.status === "loading" || state.status === "idle") {
      return (
        <section className="lyra-image-viewer-loading-flow" aria-label="image-viewer-loading">
          <div className="lyra-image-viewer-loading-ribbons" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="lyra-image-viewer-loading-copy">
            <strong>{labels.loading}</strong>
            {importProgress === undefined ? null : (
              <small>{Math.round(Math.max(0, Math.min(1, importProgress)) * 100)}%</small>
            )}
          </div>
        </section>
      );
    }
    if (state.status === "error" || state.status === "unsupported" || openResult === null) {
      return (
        <section className="lyra-image-viewer-empty">
          <p>{state.message ?? labels.unsupported}</p>
          <button
            type="button"
            className="lyra-image-viewer-button"
            onClick={() => {
              void model.openImage(state.instanceId, state.filePath);
            }}
          >
            {labels.retry}
          </button>
        </section>
      );
    }

    return (
      <div
        ref={bodyRef}
        className={`lyra-image-viewer-stage lyra-image-viewer-stage-${state.view.background}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        {useNativeTiles ? (
          <ImageViewerTileCanvas
            openResult={openResult}
            state={state}
            model={model}
            labels={labels}
          />
        ) : (
          <img
            className="lyra-image-viewer-source"
            src={openResult.sourceUrl}
            width={openWidth || undefined}
            height={openHeight || undefined}
            alt=""
            draggable={false}
            onLoad={onSourceImageLoad}
            onError={onSourceImageError}
            style={{
              transform: `translate(${state.view.offsetX}px, ${state.view.offsetY}px) scale(${state.view.zoom}) rotate(${state.view.rotation}deg)`
            }}
          />
        )}
        {sourceImagePending ? (
          <ImageViewerLoadingOverlay labels={labels} progress={importProgress} />
        ) : null}
        {sourceImageFailed ? (
          <section className="lyra-image-viewer-empty lyra-image-viewer-stage-message">
            <p>{labels.unavailable}</p>
            <button
              type="button"
              className="lyra-image-viewer-button"
              onClick={() => {
                setSourceFailedSessionId(null);
                setSourceLoadedSessionId(null);
                void model.openImage(state.instanceId, state.filePath);
              }}
            >
              {labels.retry}
            </button>
          </section>
        ) : null}
        {openResult.cacheState === "importing" ? (
          <div className="lyra-image-viewer-import-overlay" aria-label="image-viewer-import-progress">
            <div className="lyra-image-viewer-import-meter">
              <span
                style={{
                  inlineSize: `${Math.round(Math.max(0, Math.min(1, importProgress ?? 0)) * 100)}%`
                }}
              />
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <section className="lyra-image-viewer-surface" aria-label="image-viewer-surface">
      <header className="lyra-image-viewer-toolbar">
        <div className="lyra-image-viewer-title">
          <strong>{state.title}</strong>
          <small>{metadata}</small>
        </div>
        <div className="lyra-image-viewer-actions">
          <button
            type="button"
            className="lyra-image-viewer-icon-button"
            aria-label={labels.previous}
            disabled={!canGoAdjacent}
            onClick={() => {
              void model.openAdjacent(state.instanceId, -1);
            }}
          >
            <ChevronLeft size={15} />
          </button>
          <button
            type="button"
            className="lyra-image-viewer-icon-button"
            aria-label={labels.next}
            disabled={!canGoAdjacent}
            onClick={() => {
              void model.openAdjacent(state.instanceId, 1);
            }}
          >
            <ChevronRight size={15} />
          </button>
          <button
            type="button"
            className="lyra-image-viewer-icon-button"
            aria-label={labels.zoomOut}
            onClick={() => model.setViewport(state.instanceId, { zoom: state.view.zoom * 0.8 })}
          >
            <ZoomOut size={15} />
          </button>
          <button
            type="button"
            className="lyra-image-viewer-icon-button"
            aria-label={labels.zoomIn}
            onClick={() => model.setViewport(state.instanceId, { zoom: state.view.zoom * 1.25 })}
          >
            <ZoomIn size={15} />
          </button>
          <button
            type="button"
            className="lyra-image-viewer-button"
            aria-label={labels.actualSize}
            onClick={() => model.setViewport(state.instanceId, { zoom: 1, offsetX: 0, offsetY: 0 })}
          >
            {labels.actualSize}
          </button>
          <button
            type="button"
            className="lyra-image-viewer-icon-button"
            aria-label={labels.fit}
            onClick={fitToViewport}
          >
            <Maximize2 size={15} />
          </button>
          <button
            type="button"
            className="lyra-image-viewer-icon-button"
            aria-label={labels.rotateLeft}
            onClick={() => model.setViewport(state.instanceId, { rotation: state.view.rotation - 90 })}
          >
            <RotateCcw size={15} />
          </button>
          <button
            type="button"
            className="lyra-image-viewer-icon-button"
            aria-label={labels.rotateRight}
            onClick={() => model.setViewport(state.instanceId, { rotation: state.view.rotation + 90 })}
          >
            <RotateCw size={15} />
          </button>
          <button
            type="button"
            className="lyra-image-viewer-icon-button"
            aria-label={labels.reset}
            onClick={() => model.resetViewport(state.instanceId)}
          >
            <RefreshCcw size={15} />
          </button>
          <button
            type="button"
            className="lyra-image-viewer-icon-button"
            aria-label={labels.background}
            onClick={cycleBackground}
          >
            <PaintBucket size={15} />
          </button>
        </div>
      </header>
      {renderBody()}
      <footer className="lyra-image-viewer-status">
        <span>{useNativeTiles ? labels.nativeTiles : labels.sourceOnly}</span>
        <span>{Math.round(state.view.zoom * 100)}%</span>
      </footer>
    </section>
  );
};
