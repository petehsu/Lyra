import {
  FolderOpen,
  Globe,
  MonitorCog,
  PencilLine,
  Power,
  PowerOff,
  Search,
  TerminalSquare
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react";

import type {
  AiComputerAppKind,
  AiComputerAppInstance,
  AiComputerWindowFrame
} from "../../../../shared/desktop-bridge";
import { LyraBrandLogo } from "../../brand";
import { FILE_MANAGER_DISK_BRAND_ASSETS } from "../../file-manager/disk-brand-assets";
import { AiComputerAppSurface } from "./app-surface";
import {
  filterLauncherSearchItems,
  type LauncherSearchItem
} from "./launcher-search";
import {
  useDesktopTypingLauncherEffect,
  useDockContextMenuDismissEffect,
  useLauncherAutoFocusEffect,
  useLauncherCloseOnPowerStateEffect,
  useLauncherKeyboardCaptureEffect,
  useWindowPointerEffects
} from "./view-hooks";
import type { AiPanelComputerSurfaceProps } from "./types";
import {
  AiComputerWindowFrame as AiComputerChrome,
  type AiComputerResizeEdge
} from "./window-frame";

const LOGO_URL = new URL(
  "../../../../renderer/assets/logo.svg",
  import.meta.url
).toString();
const LOGO_BLINK_URL = new URL(
  "../../../../renderer/assets/logo-blink.svg",
  import.meta.url
).toString();
const MONITOR_URL = new URL("./assets/monitor.svg", import.meta.url).toString();
const WALLPAPER_LIGHT_URL = new URL("./assets/wallpaper-light.svg", import.meta.url).toString();
const WALLPAPER_DARK_URL = new URL("./assets/wallpaper-dark.svg", import.meta.url).toString();

type WindowInteractionState = {
  readonly kind: "move" | "resize";
  readonly appId: string;
  readonly edge: AiComputerResizeEdge | null;
  readonly originX: number;
  readonly originY: number;
  readonly startFrame: AiComputerWindowFrame;
  readonly stageWidth: number;
  readonly stageHeight: number;
};

type DockAppKind = Exclude<AiComputerAppKind, "desktop">;

type DockContextMenuState = {
  readonly kind: DockAppKind;
  readonly x: number;
  readonly y: number;
};

type MinimizeBurstState = Readonly<Record<string, {
  readonly dx: number;
  readonly dy: number;
}>>;

const MIN_WINDOW_WIDTH = 320;
const MIN_WINDOW_HEIGHT = 220;
const WINDOW_MAX_SIZE_SCALE = 1.85;
const WINDOW_SAFE_VISIBLE_WIDTH = 110;
const WINDOW_TITLEBAR_HEIGHT = 38;
const WINDOW_SAFE_VISIBLE_TITLEBAR_HEIGHT = 22;
const DOCK_CONTEXT_MENU_WIDTH = 200;
const DOCK_CONTEXT_MENU_HEIGHT = 124;
const OVERLAY_EDGE_PADDING = 8;
const MINIMIZE_ALL_BURST_DURATION_MS = 180;
const MINIMIZE_ALL_BURST_CLEANUP_MS = 320;
const MINIMIZE_ALL_BURST_DISTANCE_MIN = 140;
const MINIMIZE_ALL_BURST_DISTANCE_RANGE = 110;

const formatClock = (timestamp: number): string => {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit"
    }).format(timestamp);
  } catch {
    return new Date(timestamp).toLocaleTimeString();
  }
};

const renderAppIcon = (kind: AiComputerAppKind, size = 15) => {
  switch (kind) {
    case "file-manager":
      return <FolderOpen size={size} />;
    case "file-editor":
      return <PencilLine size={size} />;
    case "terminal":
      return <TerminalSquare size={size} />;
    case "browser":
      return <Globe size={size} />;
    default:
      return <MonitorCog size={size} />;
  }
};

const resolvePinnedKinds = (): readonly Exclude<AiComputerAppKind, "desktop">[] => [
  "file-manager",
  "browser",
  "terminal",
  "file-editor"
];

const LAUNCHER_APP_SEARCH_KEYWORDS: Readonly<
  Record<Exclude<AiComputerAppKind, "desktop">, readonly string[]>
> = {
  "file-manager": [
    "file manager",
    "files",
    "explorer",
    "文件管理",
    "文件",
    "资源管理器"
  ],
  browser: [
    "browser",
    "web",
    "internet",
    "website",
    "浏览器",
    "网页",
    "网站"
  ],
  terminal: [
    "terminal",
    "shell",
    "console",
    "command",
    "command line",
    "终端",
    "命令行",
    "控制台"
  ],
  "file-editor": [
    "editor",
    "code",
    "text editor",
    "文件编辑器",
    "编辑器",
    "代码",
    "文本编辑器"
  ]
};

const clampFrame = (
  frame: AiComputerWindowFrame,
  stageWidth: number,
  stageHeight: number
): AiComputerWindowFrame => {
  const maxWidth = Math.max(MIN_WINDOW_WIDTH, stageWidth * WINDOW_MAX_SIZE_SCALE);
  const maxHeight = Math.max(MIN_WINDOW_HEIGHT, stageHeight * WINDOW_MAX_SIZE_SCALE);
  const width = Math.max(MIN_WINDOW_WIDTH, Math.min(frame.width, maxWidth));
  const height = Math.max(MIN_WINDOW_HEIGHT, Math.min(frame.height, maxHeight));
  const minX = WINDOW_SAFE_VISIBLE_WIDTH - width;
  const maxX = stageWidth - WINDOW_SAFE_VISIBLE_WIDTH;
  const minY = WINDOW_SAFE_VISIBLE_TITLEBAR_HEIGHT - WINDOW_TITLEBAR_HEIGHT;
  const maxY = stageHeight - WINDOW_SAFE_VISIBLE_TITLEBAR_HEIGHT;
  const clampedX = maxX < minX ? minX : Math.min(Math.max(frame.x, minX), maxX);
  const clampedY = maxY < minY ? minY : Math.min(Math.max(frame.y, minY), maxY);
  return { x: clampedX, y: clampedY, width, height };
};

const createNewAppInstanceId = (kind: Exclude<AiComputerAppKind, "desktop">): string =>
  `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const applyResizeDelta = (
  frame: AiComputerWindowFrame,
  edge: AiComputerResizeEdge,
  dx: number,
  dy: number,
  stageWidth: number,
  stageHeight: number
): AiComputerWindowFrame => {
  let nextX = frame.x;
  let nextY = frame.y;
  let nextWidth = frame.width;
  let nextHeight = frame.height;

  if (edge.includes("e")) {
    nextWidth = frame.width + dx;
  }
  if (edge.includes("s")) {
    nextHeight = frame.height + dy;
  }
  if (edge.includes("w")) {
    nextWidth = frame.width - dx;
    nextX = frame.x + dx;
  }
  if (edge.includes("n")) {
    nextHeight = frame.height - dy;
    nextY = frame.y + dy;
  }

  if (nextWidth < MIN_WINDOW_WIDTH) {
    if (edge.includes("w")) {
      nextX -= MIN_WINDOW_WIDTH - nextWidth;
    }
    nextWidth = MIN_WINDOW_WIDTH;
  }
  if (nextHeight < MIN_WINDOW_HEIGHT) {
    if (edge.includes("n")) {
      nextY -= MIN_WINDOW_HEIGHT - nextHeight;
    }
    nextHeight = MIN_WINDOW_HEIGHT;
  }

  return clampFrame(
    {
      x: nextX,
      y: nextY,
      width: nextWidth,
      height: nextHeight
    },
    stageWidth,
    stageHeight
  );
};

const resolveAppLabel = (
  kind: Exclude<AiComputerAppKind, "desktop">,
  labels: AiPanelComputerSurfaceProps["labels"]
): string => {
  if (kind === "file-manager") {
    return labels.desktopFiles;
  }
  if (kind === "browser") {
    return labels.desktopBrowser;
  }
  if (kind === "terminal") {
    return labels.desktopTerminal;
  }
  return labels.desktopEditor;
};

const resolveWindowTitle = (app: AiComputerAppInstance, labels: AiPanelComputerSurfaceProps["labels"]): string => {
  if (app.kind === "file-manager") {
    return app.title || labels.fileManagerTitle;
  }
  if (app.kind === "file-editor") {
    return app.title || labels.fileEditorTitle;
  }
  return app.title;
};

const resolveLauncherTarget = (
  apps: readonly AiComputerAppInstance[],
  kind: DockAppKind
): AiComputerAppInstance | null =>
  [...apps]
    .filter((app) => app.kind === kind)
    .sort((left, right) => Number(right.lastFocusedAt) - Number(left.lastFocusedAt))[0] ?? null;

const clampOverlayPointToRect = (
  clientX: number,
  clientY: number,
  rect: DOMRect,
  overlayWidth: number,
  overlayHeight: number
): { readonly x: number; readonly y: number } => {
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  const maxX = Math.max(OVERLAY_EDGE_PADDING, rect.width - overlayWidth - OVERLAY_EDGE_PADDING);
  const maxY = Math.max(OVERLAY_EDGE_PADDING, rect.height - overlayHeight - OVERLAY_EDGE_PADDING);
  return {
    x: Math.min(Math.max(localX, OVERLAY_EDGE_PADDING), maxX),
    y: Math.min(Math.max(localY, OVERLAY_EDGE_PADDING), maxY)
  };
};

const resolveMinimizeBurstState = (
  apps: readonly AiComputerAppInstance[],
  stageWidth: number,
  stageHeight: number
): MinimizeBurstState => {
  const centerX = stageWidth * 0.5;
  const centerY = stageHeight * 0.5;
  const map: Record<string, { dx: number; dy: number }> = {};

  for (const [index, app] of apps.entries()) {
    const frameCenterX = app.frame.x + app.frame.width * 0.5;
    const frameCenterY = app.frame.y + app.frame.height * 0.5;
    let vectorX = frameCenterX - centerX;
    let vectorY = frameCenterY - centerY;
    const vectorLength = Math.hypot(vectorX, vectorY);
    if (vectorLength < 1) {
      const angle = (Math.PI * 2 * index) / Math.max(1, apps.length);
      vectorX = Math.cos(angle);
      vectorY = Math.sin(angle);
    }

    const normalizedLength = Math.max(1, Math.hypot(vectorX, vectorY));
    const unitX = vectorX / normalizedLength;
    const unitY = vectorY / normalizedLength;
    const distanceRatio = Math.min(1, vectorLength / Math.max(1, Math.hypot(centerX, centerY)));
    const burstDistance = MINIMIZE_ALL_BURST_DISTANCE_MIN + (distanceRatio * MINIMIZE_ALL_BURST_DISTANCE_RANGE);

    map[app.id] = {
      dx: unitX * burstDistance,
      dy: unitY * burstDistance
    };
  }

  return map;
};

export const AiPanelComputerSurface = ({
  sessionId: _sessionId,
  labels,
  desktopApi,
  computerState,
  computerHostStatus,
  fileManagerModel,
  fileManagerLabels,
  fileEditorModel,
  fileEditorLabels,
  terminalLabels,
  terminalThemeSignature,
  terminalThemePreset,
  uiThemeId,
  onPowerOn,
  onPowerOff,
  onInstallOfficialSystem,
  onOpenApp,
  onFocusApp,
  onCloseApp,
  onMoveAppWindow,
  onResizeAppWindow,
  onMinimizeApp,
  onMaximizeApp,
  onRestoreApp,
  onOpenFileInWorkspace
}: AiPanelComputerSurfaceProps) => {
  const [clockValue, setClockValue] = useState(() => formatClock(Date.now()));
  const [transientFrames, setTransientFrames] = useState<Readonly<Record<string, AiComputerWindowFrame>>>({});
  const [isLauncherOpen, setIsLauncherOpen] = useState(false);
  const [launcherQuery, setLauncherQuery] = useState("");
  const [pinnedKinds, setPinnedKinds] = useState<readonly DockAppKind[]>(() => resolvePinnedKinds());
  const [dockPreviewKind, setDockPreviewKind] = useState<DockAppKind | null>(null);
  const [dockContextMenu, setDockContextMenu] = useState<DockContextMenuState | null>(null);
  const [minimizeBurstByAppId, setMinimizeBurstByAppId] = useState<MinimizeBurstState>({});
  const [isComputerFocused, setIsComputerFocused] = useState(false);
  const computerRootRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const launcherButtonRef = useRef<HTMLButtonElement | null>(null);
  const launcherPanelRef = useRef<HTMLElement | null>(null);
  const launcherInputRef = useRef<HTMLInputElement | null>(null);
  const dockContextMenuRef = useRef<HTMLElement | null>(null);
  const interactionRef = useRef<WindowInteractionState | null>(null);
  const transientFramesRef = useRef<Readonly<Record<string, AiComputerWindowFrame>>>({});
  const minimizeAllTimersRef = useRef<number[]>([]);

  const activeApp = useMemo(
    () =>
      computerState?.openApps.find((app) => app.id === computerState.activeAppId) ?? null,
    [computerState]
  );

  const hostAsset =
    computerHostStatus === null
      ? undefined
      : FILE_MANAGER_DISK_BRAND_ASSETS[computerHostStatus.osFlavor]
        ?? FILE_MANAGER_DISK_BRAND_ASSETS[
          computerHostStatus.platform === "macos"
            ? "macos"
            : computerHostStatus.platform === "windows"
              ? "windows"
              : "linux"
        ];
  const hostAssetIsAdaptive = hostAsset?.tone === "adaptive";
  const monitorLogoStyle = useMemo<CSSProperties>(
    () =>
      ({
        "--lyra-ai-computer-monitor-logo-url": `url("${MONITOR_URL}")`
      }) as CSSProperties,
    []
  );
  const hostLogoStyle = useMemo<CSSProperties | undefined>(() => {
    if (hostAsset === undefined || hostAssetIsAdaptive === false) {
      return undefined;
    }
    return {
      "--lyra-ai-computer-host-logo-url": `url("${hostAsset.url}")`
    } as CSSProperties;
  }, [hostAsset, hostAssetIsAdaptive]);
  const resolvedHostName = computerHostStatus?.hostname ?? labels.menuTitle;

  const visibleApps = useMemo(
    () =>
      [...(computerState?.openApps ?? [])]
        .filter((app) => app.windowState !== "minimized"),
    [computerState]
  );
  const renderedApps = useMemo(
    () => [...(computerState?.openApps ?? [])],
    [computerState]
  );

  const taskbarApps = useMemo(
    () =>
      [...(computerState?.openApps ?? [])].sort(
        (left, right) => Number(right.lastFocusedAt) - Number(left.lastFocusedAt)
      ),
    [computerState]
  );
  const runningKinds = useMemo<readonly DockAppKind[]>(
    () =>
      Array.from(
        new Set(
          taskbarApps
            .map((app) => app.kind)
            .filter((kind): kind is DockAppKind => kind !== "desktop")
        )
      ),
    [taskbarApps]
  );
  const dockKinds = useMemo<readonly DockAppKind[]>(
    () => [
      ...pinnedKinds,
      ...runningKinds.filter((kind) => pinnedKinds.includes(kind) === false)
    ],
    [pinnedKinds, runningKinds]
  );

  const wallpaperUrl = uiThemeId.endsWith("-dark") ? WALLPAPER_DARK_URL : WALLPAPER_LIGHT_URL;
  const isPoweredOff = computerState === null || computerState.powerState === "off";
  const isBooting = computerState?.powerState === "booting";
  const isSystemMissing = isPoweredOff === false && computerState?.systemContextState === "error";
  const isDockVisible =
    computerState !== null && computerState.powerState !== "off" && isSystemMissing === false;
  const launcherBaseItems = useMemo<readonly LauncherSearchItem[]>(
    () => resolvePinnedKinds().map((kind) => {
      const targetApp = resolveLauncherTarget(taskbarApps, kind);
      const label = resolveAppLabel(kind, labels);
      return {
        kind,
        label,
        targetApp,
        keywords: LAUNCHER_APP_SEARCH_KEYWORDS[kind]
      };
    }),
    [labels, taskbarApps]
  );
  const launcherItems = useMemo(() => {
    return filterLauncherSearchItems(launcherQuery, launcherBaseItems);
  }, [launcherBaseItems, launcherQuery]);

  const activateLauncherItem = useCallback((
    item: {
      readonly kind: Exclude<AiComputerAppKind, "desktop">;
      readonly label: string;
      readonly targetApp: AiComputerAppInstance | null;
    }
  ): void => {
    onOpenApp({
      kind: item.kind,
      title: item.label,
      appInstanceId: createNewAppInstanceId(item.kind)
    });
    setIsLauncherOpen(false);
    setLauncherQuery("");
  }, [onOpenApp]);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setClockValue(formatClock(Date.now()));
    }, 30_000);
    return () => {
      window.clearInterval(timerId);
    };
  }, []);

  useEffect(() => {
    transientFramesRef.current = transientFrames;
  }, [transientFrames]);

  useEffect(
    () => () => {
      for (const timerId of minimizeAllTimersRef.current) {
        window.clearTimeout(timerId);
      }
      minimizeAllTimersRef.current = [];
    },
    []
  );

  useLauncherAutoFocusEffect({
    isLauncherOpen,
    launcherPanelRef,
    launcherInputRef,
    computerRootRef
  });

  useLauncherKeyboardCaptureEffect({
    isLauncherOpen,
    launcherItems,
    activateLauncherItem,
    launcherPanelRef,
    launcherButtonRef,
    launcherInputRef,
    computerRootRef,
    setIsLauncherOpen,
    setLauncherQuery
  });

  useLauncherCloseOnPowerStateEffect({
    isPoweredOff,
    isBooting,
    setIsLauncherOpen
  });

  useDockContextMenuDismissEffect({
    dockContextMenu,
    dockContextMenuRef,
    setDockContextMenu
  });

  useEffect(() => {
    if (dockContextMenu === null) {
      return;
    }
    const root = computerRootRef.current;
    const menu = dockContextMenuRef.current;
    if (root === null || menu === null) {
      return;
    }
    const maxX = Math.max(
      OVERLAY_EDGE_PADDING,
      root.clientWidth - menu.offsetWidth - OVERLAY_EDGE_PADDING
    );
    const maxY = Math.max(
      OVERLAY_EDGE_PADDING,
      root.clientHeight - menu.offsetHeight - OVERLAY_EDGE_PADDING
    );
    const nextX = Math.min(Math.max(dockContextMenu.x, OVERLAY_EDGE_PADDING), maxX);
    const nextY = Math.min(Math.max(dockContextMenu.y, OVERLAY_EDGE_PADDING), maxY);
    if (nextX === dockContextMenu.x && nextY === dockContextMenu.y) {
      return;
    }
    setDockContextMenu((current) =>
      current === null
        ? null
        : {
            ...current,
            x: nextX,
            y: nextY
          }
    );
  }, [dockContextMenu]);

  useDesktopTypingLauncherEffect({
    isComputerFocused,
    isLauncherOpen,
    isPoweredOff,
    isBooting,
    visibleAppCount: visibleApps.length,
    computerRootRef,
    setLauncherQuery,
    setIsLauncherOpen
  });

  useEffect(() => {
    setTransientFrames((current) => {
      if (Object.keys(current).length === 0) {
        return current;
      }

      const appsById = new Map(
        (computerState?.openApps ?? []).map((app) => [app.id, app] as const)
      );
      let didChange = false;
      const next = { ...current };

      for (const [appId, frame] of Object.entries(current)) {
        const app = appsById.get(appId);
        if (
          app === undefined
          || app.windowState === "maximized"
          || (
            app.frame.x === frame.x
            && app.frame.y === frame.y
            && app.frame.width === frame.width
            && app.frame.height === frame.height
          )
        ) {
          delete next[appId];
          didChange = true;
        }
      }

      return didChange ? next : current;
    });
  }, [computerState]);

  useWindowPointerEffects({
    interactionRef,
    transientFramesRef,
    setTransientFrames,
    onMoveAppWindow,
    onResizeAppWindow,
    clampFrame,
    applyResizeDelta
  });

  const beginWindowInteraction = useCallback((
    app: AiComputerAppInstance,
    kind: "move" | "resize",
    event: ReactPointerEvent<HTMLElement>,
    edge?: AiComputerResizeEdge
  ): void => {
    event.preventDefault();
    event.stopPropagation();
    onFocusApp(app.id);
    if (app.windowState === "maximized") {
      return;
    }
    const stageRect = stageRef.current?.getBoundingClientRect();
    if (stageRect === undefined) {
      return;
    }
    interactionRef.current = {
      kind,
      appId: app.id,
      edge: edge ?? null,
      originX: event.clientX,
      originY: event.clientY,
      startFrame: transientFramesRef.current[app.id] ?? app.frame,
      stageWidth: Math.max(stageRect.width, MIN_WINDOW_WIDTH),
      stageHeight: Math.max(stageRect.height, MIN_WINDOW_HEIGHT)
    };
  }, [onFocusApp]);

  const renderFrameStyle = useCallback((app: AiComputerAppInstance): CSSProperties => {
    if (app.windowState === "maximized") {
      return {
        inset: 0,
        zIndex: app.zIndex
      };
    }
    const frame = transientFrames[app.id] ?? app.frame;
    return {
      left: frame.x,
      top: frame.y,
      width: frame.width,
      height: frame.height,
      zIndex: app.zIndex
    };
  }, [transientFrames]);

  const handleDesktopPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0) {
      return;
    }

    const targetNode = event.target instanceof Node ? event.target : null;
    const clickedDesktopBackdrop =
      targetNode === event.currentTarget || targetNode === stageRef.current;
    if (clickedDesktopBackdrop === false) {
      return;
    }

    computerRootRef.current?.focus();

    if (isLauncherOpen) {
      setIsLauncherOpen(false);
      return;
    }

    const openedApps = computerState?.openApps ?? [];
    const runningApps = openedApps.filter((app) => app.windowState !== "minimized");
    if (runningApps.length === 0) {
      return;
    }

    for (const timerId of minimizeAllTimersRef.current) {
      window.clearTimeout(timerId);
    }
    minimizeAllTimersRef.current = [];

    const stageRect = stageRef.current?.getBoundingClientRect();
    if (stageRect === undefined) {
      for (const app of runningApps) {
        onMinimizeApp(app.id);
      }
      return;
    }

    setMinimizeBurstByAppId(
      resolveMinimizeBurstState(
        runningApps,
        stageRect.width,
        stageRect.height
      )
    );

    const minimizeTimerId = window.setTimeout(() => {
      for (const app of runningApps) {
        onMinimizeApp(app.id);
      }
    }, MINIMIZE_ALL_BURST_DURATION_MS);
    const clearTimerId = window.setTimeout(() => {
      setMinimizeBurstByAppId({});
    }, MINIMIZE_ALL_BURST_CLEANUP_MS);
    minimizeAllTimersRef.current = [minimizeTimerId, clearTimerId];
  }, [computerState, isLauncherOpen, onMinimizeApp]);

  const renderDesktop = () => (
    <section
      className="lyra-ai-computer-desktop"
      style={{ backgroundImage: `url(${wallpaperUrl})` }}
      aria-label="ai-computer-desktop"
      onPointerDown={handleDesktopPointerDown}
    >
      <div ref={stageRef} className="lyra-ai-computer-window-layer" aria-label="ai-computer-window-layer">
        {renderedApps.map((app) => {
          const burst = minimizeBurstByAppId[app.id];
          const isBurstingOut = burst !== undefined && app.windowState !== "minimized";
          const className = app.windowState === "minimized"
            ? "lyra-ai-computer-window-minimized-keepalive"
            : isBurstingOut
              ? "lyra-ai-computer-window-minimizing-burst"
              : undefined;
          const baseStyle = renderFrameStyle(app);
          const style = isBurstingOut
            ? {
                ...baseStyle,
                "--lyra-ai-computer-window-burst-x": `${burst.dx}px`,
                "--lyra-ai-computer-window-burst-y": `${burst.dy}px`
              } as CSSProperties
            : baseStyle;

          return (
            <AiComputerChrome
              key={app.id}
              app={app}
              variant="workspace"
              isActive={app.id === activeApp?.id}
              {...(className === undefined ? {} : { className })}
              title={resolveWindowTitle(app, labels)}
              {...(app.kind === "browser"
                ? { statusText: app.address ?? labels.desktopBrowser }
                : app.kind === "terminal"
                  ? { statusText: labels.terminalPlaceholder }
                  : {})}
              style={style}
              isMaximized={app.windowState === "maximized"}
              minimizeLabel={labels.minimizeWindow}
              maximizeLabel={labels.maximizeWindow}
              restoreLabel={labels.restoreWindow}
              closeLabel={labels.closeWindow}
              {...(app.kind === "file-editor" && app.filePath !== undefined
                ? {
                    openInWorkspaceLabel: labels.openInWorkspace,
                    onOpenInWorkspace: () => {
                      onOpenFileInWorkspace(app.filePath!);
                    }
                  }
                : {})}
              onFocus={() => {
                onFocusApp(app.id);
              }}
              onTitlePointerDown={(event) => {
                beginWindowInteraction(app, "move", event);
              }}
              onTitleDoubleClick={() => {
                if (app.windowState === "maximized") {
                  onRestoreApp(app.id);
                  return;
                }
                onMaximizeApp(app.id);
              }}
              onResizePointerDown={(edge, event) => {
                beginWindowInteraction(app, "resize", event, edge);
              }}
              onMinimize={() => {
                onMinimizeApp(app.id);
              }}
              onMaximize={() => {
                onMaximizeApp(app.id);
              }}
              onRestore={() => {
                onRestoreApp(app.id);
              }}
              onClose={() => {
                onCloseApp(app.id);
              }}
            >
              <AiComputerAppSurface
                app={app}
                variant="workspace"
                labels={labels}
                desktopApi={desktopApi}
                fileManagerModel={fileManagerModel}
                fileManagerLabels={fileManagerLabels}
                fileEditorModel={fileEditorModel}
                fileEditorLabels={fileEditorLabels}
                terminalLabels={terminalLabels}
                terminalThemeSignature={terminalThemeSignature}
                terminalThemePreset={terminalThemePreset}
                uiThemeId={uiThemeId}
                onOpenApp={onOpenApp}
                onFocusApp={onFocusApp}
              />
            </AiComputerChrome>
          );
        })}
      </div>
    </section>
  );

  const renderPowerScreen = () => (
    <section
      className="lyra-ai-computer-desktop lyra-ai-computer-desktop-powered-off"
      style={{ backgroundImage: `url(${wallpaperUrl})` }}
      aria-label="ai-computer-power-screen"
    >
      <div className="lyra-ai-computer-power-screen-stack">
        <div className="lyra-ai-computer-power-screen-brand">
          <LyraBrandLogo
            logoUrl={LOGO_URL}
            className="lyra-ai-computer-power-screen-brand-logo"
            blinkEyes
            blinkLogoUrl={LOGO_BLINK_URL}
          />
        </div>
        <strong>{labels.idleTitle}</strong>
        <span>{labels.idleDescription}</span>
        <div className="lyra-ai-computer-power-screen-devices">
          <span
            className="lyra-ai-computer-power-screen-device-icon lyra-ai-computer-power-screen-device-icon-monitor"
            aria-hidden="true"
            style={monitorLogoStyle}
          />
          {hostAsset === undefined ? null : (
            hostAssetIsAdaptive ? (
              <span
                className="lyra-ai-computer-power-screen-device-icon lyra-ai-computer-power-screen-host-adaptive"
                aria-hidden="true"
                style={hostLogoStyle}
              />
            ) : (
              <img
                className="lyra-ai-computer-power-screen-device-icon"
                src={hostAsset.url}
                alt=""
                aria-hidden="true"
              />
            )
          )}
        </div>
      </div>
    </section>
  );

  const renderMissingSystemScreen = () => (
    <section
      className="lyra-ai-computer-desktop lyra-ai-computer-desktop-powered-off lyra-ai-computer-desktop-system-missing"
      style={{ backgroundImage: `url(${wallpaperUrl})` }}
      aria-label="ai-computer-missing-system"
    >
      <div className="lyra-ai-computer-power-screen-stack">
        <div className="lyra-ai-computer-power-screen-brand">
          <LyraBrandLogo
            logoUrl={LOGO_URL}
            className="lyra-ai-computer-power-screen-brand-logo"
            blinkEyes
            blinkLogoUrl={LOGO_BLINK_URL}
          />
        </div>
        <strong>{labels.missingSystemTitle}</strong>
        <span>{labels.missingSystemDescription}</span>
        <div className="lyra-ai-computer-power-screen-devices">
          <span
            className="lyra-ai-computer-power-screen-device-icon lyra-ai-computer-power-screen-device-icon-monitor"
            aria-hidden="true"
            style={monitorLogoStyle}
          />
          {hostAsset === undefined ? null : (
            hostAssetIsAdaptive ? (
              <span
                className="lyra-ai-computer-power-screen-device-icon lyra-ai-computer-power-screen-host-adaptive"
                aria-hidden="true"
                style={hostLogoStyle}
              />
            ) : (
              <img
                className="lyra-ai-computer-power-screen-device-icon"
                src={hostAsset.url}
                alt=""
                aria-hidden="true"
              />
            )
          )}
        </div>
        <button
          type="button"
          className="lyra-ai-computer-power-screen-install"
          onClick={onInstallOfficialSystem}
        >
          {labels.installOfficialSystem}
        </button>
      </div>
    </section>
  );

  return (
    <section
      ref={computerRootRef}
      className={isPoweredOff ? "lyra-ai-computer lyra-ai-computer-powered-off" : "lyra-ai-computer"}
      aria-label="ai-computer"
      tabIndex={0}
      onPointerDownCapture={() => {
        computerRootRef.current?.focus();
      }}
      onFocusCapture={() => {
        setIsComputerFocused(true);
      }}
      onBlurCapture={(event) => {
        const nextFocusTarget = event.relatedTarget;
        if (
          nextFocusTarget !== null
          && nextFocusTarget instanceof Node
          && event.currentTarget.contains(nextFocusTarget)
        ) {
          return;
        }
        setIsComputerFocused(false);
      }}
    >
      <header className="lyra-ai-computer-menubar">
        <div className="lyra-ai-computer-menubar-start">
          {hostAsset === undefined ? (
            <span className="lyra-ai-computer-menubar-host-fallback" aria-hidden="true">
              <MonitorCog size={12} />
            </span>
          ) : hostAssetIsAdaptive ? (
            <span
              className="lyra-ai-computer-menubar-host-icon lyra-ai-computer-menubar-host-icon-adaptive"
              aria-hidden="true"
              style={hostLogoStyle}
            />
          ) : (
            <img
              className="lyra-ai-computer-menubar-host-icon"
              src={hostAsset.url}
              alt=""
              aria-hidden="true"
            />
          )}
          <span className="lyra-ai-computer-menubar-host-name">{resolvedHostName}</span>
        </div>
        <div className="lyra-ai-computer-menubar-end">
          <button
            type="button"
            className={isPoweredOff ? "lyra-ai-computer-menubar-power lyra-ai-computer-menubar-power-active" : "lyra-ai-computer-menubar-power"}
            aria-label={isPoweredOff ? labels.powerOn : labels.stateOff}
            onClick={() => {
              if (isPoweredOff) {
                onPowerOn();
                return;
              }
              onPowerOff();
            }}
          >
            {isPoweredOff ? <Power size={13} /> : <PowerOff size={13} />}
          </button>
          <strong className="lyra-ai-computer-menubar-clock-value">{clockValue}</strong>
        </div>
      </header>

      <section className="lyra-ai-computer-stage">
        {isPoweredOff ? renderPowerScreen() : isBooting ? (
          <section className="lyra-ai-computer-booting" style={{ backgroundImage: `url(${wallpaperUrl})` }} aria-label="ai-computer-booting">
            <div className="lyra-ai-computer-booting-orb" aria-hidden="true" />
            <strong>{labels.stateBooting}</strong>
          </section>
        ) : isSystemMissing ? (
          renderMissingSystemScreen()
        ) : renderDesktop()}
      </section>

      {isDockVisible ? (
        <footer className="lyra-ai-computer-taskbar">
          <div className="lyra-ai-computer-taskbar-start">
            <button
              ref={launcherButtonRef}
              type="button"
              className={isLauncherOpen ? "lyra-ai-computer-taskbar-launcher lyra-ai-computer-taskbar-launcher-active" : "lyra-ai-computer-taskbar-launcher"}
              aria-label={labels.launcher}
              onClick={() => {
                setIsLauncherOpen((current) => !current);
                setLauncherQuery("");
              }}
            >
              <LyraBrandLogo logoUrl={LOGO_URL} className="lyra-ai-computer-taskbar-launcher-logo" />
            </button>
          </div>

          <div className="lyra-ai-computer-taskbar-center">
            <div className="lyra-ai-computer-taskbar-pinned" onContextMenu={(event) => {
              event.preventDefault();
            }}>
              {dockKinds.map((kind) => {
                const kindApps = taskbarApps.filter((app) => app.kind === kind);
                const targetApp = resolveLauncherTarget(taskbarApps, kind);
                const isActivePinned =
                  targetApp !== null
                  && targetApp.id === activeApp?.id
                  && targetApp.windowState !== "minimized";
                const isOpenPinned = kindApps.length > 0;
                const isPreviewVisible = dockPreviewKind === kind && dockContextMenu === null;
                return (
                  <div
                    key={kind}
                    className="lyra-ai-computer-taskbar-item-anchor"
                    onMouseEnter={() => {
                      if (kindApps.length > 0) {
                        setDockPreviewKind(kind);
                      }
                    }}
                    onMouseLeave={() => {
                      setDockPreviewKind((current) => (current === kind ? null : current));
                    }}
                  >
                    <button
                      type="button"
                      className={isActivePinned ? "lyra-ai-computer-taskbar-pinned-item lyra-ai-computer-taskbar-pinned-item-active" : isOpenPinned ? "lyra-ai-computer-taskbar-pinned-item lyra-ai-computer-taskbar-pinned-item-open" : "lyra-ai-computer-taskbar-pinned-item"}
                      aria-label={resolveAppLabel(kind, labels)}
                      onClick={() => {
                        setDockContextMenu(null);
                        if (targetApp === null) {
                          onOpenApp({ kind, title: resolveAppLabel(kind, labels) });
                          return;
                        }
                        if (isActivePinned) {
                          onMinimizeApp(targetApp.id);
                          return;
                        }
                        onFocusApp(targetApp.id);
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const rootRect = computerRootRef.current?.getBoundingClientRect();
                        if (rootRect === undefined) {
                          return;
                        }
                        const point = clampOverlayPointToRect(
                          event.clientX,
                          event.clientY,
                          rootRect,
                          DOCK_CONTEXT_MENU_WIDTH,
                          DOCK_CONTEXT_MENU_HEIGHT
                        );
                        setDockPreviewKind(null);
                        setDockContextMenu({
                          kind,
                          x: point.x,
                          y: point.y
                        });
                      }}
                    >
                      {renderAppIcon(kind, 16)}
                      <span className="lyra-ai-computer-taskbar-pinned-indicator" aria-hidden="true" />
                    </button>

                    {kindApps.length === 0 ? null : (
                      <section
                        className={
                          isPreviewVisible
                            ? "lyra-ai-computer-taskbar-preview lyra-ai-computer-taskbar-preview-visible"
                            : "lyra-ai-computer-taskbar-preview"
                        }
                        aria-label="ai-computer-taskbar-preview"
                      >
                        {kindApps.map((app) => (
                          <button
                            key={app.id}
                            type="button"
                            className={app.id === activeApp?.id ? "lyra-ai-computer-taskbar-preview-item lyra-ai-computer-taskbar-preview-item-active" : "lyra-ai-computer-taskbar-preview-item"}
                            onClick={() => {
                              onFocusApp(app.id);
                            }}
                          >
                            <span className="lyra-ai-computer-taskbar-preview-item-meta">
                              <span className="lyra-ai-computer-taskbar-preview-item-icon" aria-hidden="true">
                                {renderAppIcon(app.kind, 12)}
                              </span>
                              <span className="lyra-ai-computer-taskbar-preview-item-title">{resolveWindowTitle(app, labels)}</span>
                            </span>
                            <span className="lyra-ai-computer-taskbar-preview-item-surface" aria-hidden="true">
                              <AiComputerAppSurface
                                app={app}
                                variant="timeline"
                                labels={labels}
                                desktopApi={desktopApi}
                                fileManagerModel={fileManagerModel}
                                fileManagerLabels={fileManagerLabels}
                                fileEditorModel={fileEditorModel}
                                fileEditorLabels={fileEditorLabels}
                                terminalLabels={terminalLabels}
                                terminalThemeSignature={terminalThemeSignature}
                                terminalThemePreset={terminalThemePreset}
                                uiThemeId={uiThemeId}
                                onOpenApp={onOpenApp}
                                onFocusApp={onFocusApp}
                              />
                            </span>
                          </button>
                        ))}
                      </section>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

        </footer>
      ) : null}
      {dockContextMenu === null ? null : (
        <section
          ref={dockContextMenuRef}
          className="lyra-ai-computer-dock-context-menu"
          style={{
            left: dockContextMenu.x,
            top: dockContextMenu.y
          }}
          aria-label="ai-computer-dock-context-menu"
        >
          <button
            type="button"
            className="lyra-ai-computer-dock-context-menu-item"
            onClick={() => {
              onOpenApp({
                kind: dockContextMenu.kind,
                title: resolveAppLabel(dockContextMenu.kind, labels),
                appInstanceId: createNewAppInstanceId(dockContextMenu.kind)
              });
              setDockContextMenu(null);
            }}
          >
            <span aria-hidden="true">{renderAppIcon(dockContextMenu.kind, 12)}</span>
            <span>{labels.dockNewWindow}</span>
          </button>
          <button
            type="button"
            className="lyra-ai-computer-dock-context-menu-item"
            disabled={pinnedKinds.includes(dockContextMenu.kind) === false}
            onClick={() => {
              setPinnedKinds((current) => current.filter((kind) => kind !== dockContextMenu.kind));
              setDockContextMenu(null);
            }}
          >
            <span>{labels.dockUnpin}</span>
          </button>
          <button
            type="button"
            className="lyra-ai-computer-dock-context-menu-item lyra-ai-computer-dock-context-menu-item-danger"
            onClick={() => {
              for (const app of taskbarApps) {
                if (app.kind === dockContextMenu.kind) {
                  onCloseApp(app.id);
                }
              }
              setDockContextMenu(null);
            }}
          >
            <span>{labels.dockCloseAllWindows}</span>
          </button>
        </section>
      )}
      {isLauncherOpen ? (
        <section className="lyra-ai-computer-launcher-overlay" aria-label="ai-computer-launcher-overlay">
          <section
            ref={launcherPanelRef}
            className="lyra-ai-computer-launcher-panel"
            aria-label="ai-computer-launcher-panel"
          >
            <label className="lyra-ai-computer-launcher-search">
              <Search size={16} />
              <input
                ref={launcherInputRef}
                type="text"
                value={launcherQuery}
                onChange={(event) => {
                  setLauncherQuery(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") {
                    return;
                  }
                  const firstLauncherItem = launcherItems[0];
                  if (firstLauncherItem === undefined) {
                    return;
                  }
                  event.preventDefault();
                  activateLauncherItem(firstLauncherItem);
                }}
                placeholder={labels.search}
              />
            </label>
            <div className="lyra-ai-computer-launcher-list">
              {launcherItems.map(({ kind, label, targetApp }) => (
                <button
                  key={kind}
                  type="button"
                  className={
                    targetApp?.id === activeApp?.id
                      ? "lyra-ai-computer-launcher-item lyra-ai-computer-launcher-item-active"
                      : targetApp === null
                        ? "lyra-ai-computer-launcher-item"
                        : "lyra-ai-computer-launcher-item lyra-ai-computer-launcher-item-open"
                  }
                  onClick={() => {
                    activateLauncherItem({
                      kind,
                      label,
                      targetApp
                    });
                  }}
                >
                  {renderAppIcon(kind, 16)}
                  <span className="lyra-ai-computer-launcher-item-label">{label}</span>
                </button>
              ))}
            </div>
          </section>
        </section>
      ) : null}
    </section>
  );
};
