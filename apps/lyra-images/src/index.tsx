import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createFirstPartyAppModule,
  LyraAppState,
  type FirstPartySurfaceProps
} from "@lyra/first-party-app-kit";

const COMMANDS = {
  read: "lyra.core.images.read",
  open: "lyra.core.images.open",
  adjacent: "lyra.core.images.open-adjacent",
  setViewport: "lyra.core.images.set-viewport",
  resetViewport: "lyra.core.images.reset-viewport"
} as const;

type ImageOpenResult = {
  readonly sessionId: string;
  readonly title: string;
  readonly format: string;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly sizeBytes: number;
  readonly sourceUrl: string;
  readonly nativeTileSupported: boolean;
  readonly cacheState: string;
  readonly importProgress: number;
};

export type ImageModuleState = {
  readonly instanceId: string;
  readonly filePath: string;
  readonly title: string;
  readonly status: "idle" | "loading" | "ready" | "unsupported" | "error";
  readonly message?: string;
  readonly openResult: ImageOpenResult | null;
  readonly siblingPaths: readonly string[];
  readonly view: {
    readonly zoom: number;
    readonly offsetX: number;
    readonly offsetY: number;
    readonly rotation: number;
    readonly background: "checkerboard" | "dark" | "light";
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const finiteNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const requiredString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Core returned invalid image field: ${field}`);
  }
  return value;
};

export const parseImageModuleState = (value: unknown): ImageModuleState | null => {
  if (value === null) return null;
  if (!isRecord(value) || !isRecord(value.view)) {
    throw new Error("Core returned an invalid image viewer state.");
  }
  const status = value.status;
  if (status !== "idle" && status !== "loading" && status !== "ready" && status !== "unsupported" && status !== "error") {
    throw new Error("Core returned an invalid image viewer status.");
  }
  let openResult: ImageOpenResult | null = null;
  if (value.openResult !== null && value.openResult !== undefined) {
    if (!isRecord(value.openResult)) throw new Error("Core returned invalid image metadata.");
    openResult = {
      sessionId: requiredString(value.openResult.sessionId, "sessionId"),
      title: requiredString(value.openResult.title, "title"),
      format: requiredString(value.openResult.format, "format"),
      mimeType: requiredString(value.openResult.mimeType, "mimeType"),
      width: finiteNumber(value.openResult.width),
      height: finiteNumber(value.openResult.height),
      sizeBytes: finiteNumber(value.openResult.sizeBytes),
      sourceUrl: requiredString(value.openResult.sourceUrl, "sourceUrl"),
      nativeTileSupported: value.openResult.nativeTileSupported === true,
      cacheState: typeof value.openResult.cacheState === "string" ? value.openResult.cacheState : "none",
      importProgress: finiteNumber(value.openResult.importProgress)
    };
  }
  const background = value.view.background;
  return {
    instanceId: requiredString(value.instanceId, "instanceId"),
    filePath: requiredString(value.filePath, "filePath"),
    title: requiredString(value.title, "title"),
    status,
    ...(typeof value.message === "string" ? { message: value.message } : {}),
    openResult,
    siblingPaths: Array.isArray(value.siblingPaths)
      ? value.siblingPaths.filter((entry): entry is string => typeof entry === "string")
      : [],
    view: {
      zoom: finiteNumber(value.view.zoom, 1),
      offsetX: finiteNumber(value.view.offsetX),
      offsetY: finiteNumber(value.view.offsetY),
      rotation: finiteNumber(value.view.rotation),
      background: background === "dark" || background === "light" ? background : "checkerboard"
    }
  };
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const labels = (locale: string) => {
  const chinese = locale.toLowerCase().startsWith("zh");
  return chinese ? {
    loading: "正在打开图片…", noFile: "没有可显示的图片", retry: "重试", previous: "上一张", next: "下一张",
    zoomOut: "缩小", zoomIn: "放大", actual: "原始大小", rotateLeft: "向左旋转", rotateRight: "向右旋转",
    background: "切换背景", reset: "重置视图", sourceFallback: "此格式正在使用兼容源预览；若源文件无法由 Chromium 解码，请暂时使用内置兼容视图。"
  } : {
    loading: "Opening image…", noFile: "No image is available", retry: "Retry", previous: "Previous", next: "Next",
    zoomOut: "Zoom out", zoomIn: "Zoom in", actual: "Actual size", rotateLeft: "Rotate left", rotateRight: "Rotate right",
    background: "Change background", reset: "Reset view", sourceFallback: "This format is using the compatibility source preview. If Chromium cannot decode it, use the built-in compatibility view for now."
  };
};

const ImagesSurface = ({
  host,
  instanceId,
  opaqueState,
  presentation,
  updateOpaqueState
}: FirstPartySurfaceProps) => {
  const copy = labels(presentation.locale);
  const [state, setState] = useState<ImageModuleState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sourceFailed, setSourceFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = parseImageModuleState(await host.executeCommand(COMMANDS.read, { instanceId }));
      setState(next);
      setError(null);
      if (next !== null) {
        updateOpaqueState({
          filePath: next.filePath,
          view: next.view,
          ...(isRecord(opaqueState) && typeof opaqueState.selectedPane === "string"
            ? { selectedPane: opaqueState.selectedPane } : {})
        });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [host, instanceId, opaqueState, updateOpaqueState]);

  const run = useCallback(async (command: string, input: Record<string, string | number>) => {
    await host.executeCommand(command, { instanceId, ...input });
    await refresh();
  }, [host, instanceId, refresh]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (state !== null && state.status !== "loading" && state.openResult?.cacheState !== "importing") return undefined;
    const timer = window.setInterval(() => void refresh(), 500);
    return () => window.clearInterval(timer);
  }, [refresh, state?.openResult?.cacheState, state?.status]);
  useEffect(() => { setSourceFailed(false); }, [state?.openResult?.sessionId]);

  const metadata = useMemo(() => state?.openResult === null || state?.openResult === undefined ? "" : [
    state.openResult.width > 0 ? `${state.openResult.width}×${state.openResult.height}` : null,
    state.openResult.format.toUpperCase(), formatBytes(state.openResult.sizeBytes)
  ].filter(Boolean).join(" · "), [state?.openResult]);

  const patchView = useCallback((patch: Record<string, string | number>) => run(COMMANDS.setViewport, patch), [run]);
  const background = state?.view.background === "dark" ? "#17191d"
    : state?.view.background === "light" ? "#fff"
      : "repeating-conic-gradient(#d7d9dd 0 25%, #f1f2f4 0 50%) 0 / 20px 20px";

  return (
    <section
      className="lyra-app-module"
      data-lyra-component="lyra.images"
      aria-label="image-viewer-surface"
      style={{ display: "grid", gridTemplateRows: "auto minmax(0, 1fr) auto" }}
    >
      <header className="lyra-app-module-toolbar">
        <strong style={{ marginRight: 6, whiteSpace: "nowrap" }}>{state?.title ?? "Images"}</strong>
        <button className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" disabled={(state?.siblingPaths.length ?? 0) < 2} onClick={() => void run(COMMANDS.adjacent, { direction: -1 })}>{copy.previous}</button>
        <button className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" disabled={(state?.siblingPaths.length ?? 0) < 2} onClick={() => void run(COMMANDS.adjacent, { direction: 1 })}>{copy.next}</button>
        <button className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" onClick={() => void patchView({ zoom: Math.max(0.02, (state?.view.zoom ?? 1) * 0.8) })}>{copy.zoomOut}</button>
        <button className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" onClick={() => void patchView({ zoom: Math.min(64, (state?.view.zoom ?? 1) * 1.25) })}>{copy.zoomIn}</button>
        <button className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" onClick={() => void patchView({ zoom: 1, offsetX: 0, offsetY: 0 })}>{copy.actual}</button>
        <button className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" onClick={() => void patchView({ rotation: (state?.view.rotation ?? 0) - 90 })}>{copy.rotateLeft}</button>
        <button className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" onClick={() => void patchView({ rotation: (state?.view.rotation ?? 0) + 90 })}>{copy.rotateRight}</button>
        <button className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" onClick={() => void patchView({ background: state?.view.background === "checkerboard" ? "dark" : state?.view.background === "dark" ? "light" : "checkerboard" })}>{copy.background}</button>
        <button className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" onClick={() => void run(COMMANDS.resetViewport, {})}>{copy.reset}</button>
      </header>
      <div style={{ display: "grid", placeItems: "center", position: "relative", minWidth: 0, minHeight: 0, overflow: "hidden", background }}>
        {error !== null ? (
          <LyraAppState
            kind="error"
            title={error}
            actionLabel={copy.retry}
            onAction={() => void refresh()}
          />
        ) : state === null ? (
          <LyraAppState kind="empty" title={copy.noFile} />
        ) : state.status === "loading" || state.status === "idle" ? (
          <LyraAppState
            kind="loading"
            title={copy.loading}
            {...(state.openResult === null
              ? {}
              : { description: `${Math.round(state.openResult.importProgress * 100)}%` })}
          />
        ) : state.status !== "ready" || state.openResult === null ? (
          <LyraAppState
            kind="error"
            title={state.message ?? copy.noFile}
            actionLabel={copy.retry}
            onAction={() => void run(COMMANDS.open, { path: state.filePath })}
          />
        ) : sourceFailed ? (
          <LyraAppState
            kind="error"
            title={copy.sourceFallback}
            actionLabel={copy.retry}
            onAction={() => {
              setSourceFailed(false);
              void run(COMMANDS.open, { path: state.filePath });
            }}
          />
        ) : (
          <img src={state.openResult.sourceUrl} alt={state.title} draggable={false} onError={() => setSourceFailed(true)} style={{
            maxWidth: "none", maxHeight: "none", transformOrigin: "center",
            transform: `translate(${state.view.offsetX}px, ${state.view.offsetY}px) scale(${state.view.zoom}) rotate(${state.view.rotation}deg)`,
            userSelect: "none"
          }} />
        )}
      </div>
      <footer className="lyra-app-module-footer">
        <span>{metadata}</span><span>{Math.round((state?.view.zoom ?? 1) * 100)}%</span>
      </footer>
    </section>
  );
};

export const lyraAppModule = createFirstPartyAppModule({
  componentId: "lyra.images",
  version: __LYRA_APP_VERSION__,
  contributions: {
    commands: [
      { id: "lyra.images.reset-view", title: "Reset image view" }
    ],
    status: [
      { id: "lyra.images.status", title: "Image viewer" }
    ]
  },
  commandHandlers: {
    "lyra.images.reset-view": (host, input) =>
      host.executeCommand(COMMANDS.resetViewport, input)
  },
  surfaces: {
    "image-viewer": {
      title: "Images",
      description: "Inspect images and large native image sources.",
      component: ImagesSurface
    }
  }
});
export default lyraAppModule;
