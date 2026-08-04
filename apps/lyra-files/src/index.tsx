import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties
} from "react";

import {
  createFirstPartyAppModule,
  type FirstPartySurfaceProps
} from "@lyra/first-party-app-kit";

const COMMANDS = {
  read: "lyra.core.files.read",
  openHome: "lyra.core.files.open-home",
  openDirectory: "lyra.core.files.open-directory",
  openTrash: "lyra.core.files.open-trash",
  openDownloads: "lyra.core.files.open-downloads",
  openFavorite: "lyra.core.files.open-favorite",
  navigate: "lyra.core.files.navigate",
  setPresentation: "lyra.core.files.set-presentation",
  selectEntry: "lyra.core.files.select-entry",
  selectTrashEntry: "lyra.core.files.select-trash-entry",
  createEntry: "lyra.core.files.create-entry",
  moveSelectionToTrash: "lyra.core.files.move-selection-to-trash",
  restoreSelection: "lyra.core.files.restore-selection",
  emptyTrash: "lyra.core.files.empty-trash",
  toggleFavorite: "lyra.core.files.toggle-favorite",
  openResource: "lyra.core.open-resource"
} as const;

const EVENTS = {
  changed: "lyra.core.files-changed"
} as const;

type FileLocation = {
  readonly id: string;
  readonly title: string;
  readonly kind: "home" | "directory" | "trash" | "special";
  readonly path?: string;
  readonly specialId?: string;
};

type FileEntry = {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly sizeBytes?: number;
  readonly modifiedAt?: string;
};

type FavoriteEntry = {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  readonly kind: "path" | "web" | "agent-session";
  readonly url?: string;
  readonly sessionId?: string;
  readonly workingDir?: string;
};

type TrashEntry = {
  readonly id: string;
  readonly name: string;
  readonly kind: "file" | "directory";
  readonly originalPath?: string;
  readonly sizeBytes?: number;
  readonly deletedAt?: string;
};

type DownloadTask = {
  readonly id: string;
  readonly fileName: string;
  readonly state: string;
  readonly receivedBytes: number;
  readonly totalBytes: number;
  readonly speedBytesPerSecond: number;
};

export type FilesModuleState = {
  readonly instanceId: string;
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly viewKind: "home" | "directory" | "trash" | "downloads";
  readonly presentationMode: "list" | "large";
  readonly title: string;
  readonly currentLocation: FileLocation | null;
  readonly parentPath?: string;
  readonly historyLength: number;
  readonly historyIndex: number;
  readonly systemLocations: readonly FileLocation[];
  readonly favorites: readonly FavoriteEntry[];
  readonly recentLocations: readonly { readonly id: string; readonly title: string; readonly path: string }[];
  readonly disks: readonly { readonly id: string; readonly title: string; readonly mountPath: string }[];
  readonly entries: readonly FileEntry[];
  readonly trashEntries: readonly TrashEntry[];
  readonly downloadTasks: readonly DownloadTask[];
  readonly selectedEntryId?: string;
  readonly selectedTrashEntryId?: string;
  readonly errorMessage?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const finiteNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const parseLocation = (value: unknown): FileLocation | null => {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const title = stringValue(value.title);
  const kind = value.kind;
  if (
    id === undefined
    || title === undefined
    || (kind !== "home" && kind !== "directory" && kind !== "trash" && kind !== "special")
  ) {
    return null;
  }
  const path = stringValue(value.path);
  const specialId = stringValue(value.specialId);
  return {
    id,
    title,
    kind,
    ...(path === undefined ? {} : { path }),
    ...(specialId === undefined ? {} : { specialId })
  };
};

const parseLocations = (value: unknown): readonly FileLocation[] =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        const location = parseLocation(item);
        return location === null ? [] : [location];
      })
    : [];

const parseEntries = (value: unknown): readonly FileEntry[] =>
  Array.isArray(value)
    ? value.flatMap((item): readonly FileEntry[] => {
        if (!isRecord(item)) return [];
        const id = stringValue(item.id);
        const name = stringValue(item.name);
        const path = stringValue(item.path);
        const kind = item.kind;
        if (
          id === undefined
          || name === undefined
          || path === undefined
          || (kind !== "file" && kind !== "directory")
        ) {
          return [];
        }
        const modifiedAt = stringValue(item.modifiedAt);
        return [{
          id,
          name,
          path,
          kind,
          ...(typeof item.sizeBytes === "number" ? { sizeBytes: finiteNumber(item.sizeBytes) } : {}),
          ...(modifiedAt === undefined ? {} : { modifiedAt })
        }];
      })
    : [];

const parseTrashEntries = (value: unknown): readonly TrashEntry[] =>
  Array.isArray(value)
    ? value.flatMap((item): readonly TrashEntry[] => {
        if (!isRecord(item)) return [];
        const id = stringValue(item.id);
        const name = stringValue(item.name);
        const kind = item.kind;
        if (id === undefined || name === undefined || (kind !== "file" && kind !== "directory")) {
          return [];
        }
        const originalPath = stringValue(item.originalPath);
        const deletedAt = stringValue(item.deletedAt);
        return [{
          id,
          name,
          kind,
          ...(originalPath === undefined ? {} : { originalPath }),
          ...(typeof item.sizeBytes === "number" ? { sizeBytes: finiteNumber(item.sizeBytes) } : {}),
          ...(deletedAt === undefined ? {} : { deletedAt })
        }];
      })
    : [];

const parseNamedPaths = (
  value: unknown
): readonly { readonly id: string; readonly title: string; readonly path: string }[] =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        if (!isRecord(item)) return [];
        const id = stringValue(item.id);
        const title = stringValue(item.title);
        const path = stringValue(item.path);
        return id === undefined || title === undefined || path === undefined
          ? []
          : [{ id, title, path }];
      })
    : [];

const parseFavorites = (value: unknown): readonly FavoriteEntry[] =>
  Array.isArray(value)
    ? value.flatMap((item): readonly FavoriteEntry[] => {
        if (!isRecord(item)) return [];
        const id = stringValue(item.id);
        const title = stringValue(item.title);
        const path = stringValue(item.path);
        if (id === undefined || title === undefined || path === undefined) return [];
        const kind = item.kind === "web" || item.kind === "agent-session"
          ? item.kind
          : "path";
        const url = stringValue(item.url);
        const sessionId = stringValue(item.sessionId);
        const workingDir = stringValue(item.workingDir);
        return [{
          id,
          title,
          path,
          kind,
          ...(url === undefined ? {} : { url }),
          ...(sessionId === undefined ? {} : { sessionId }),
          ...(workingDir === undefined ? {} : { workingDir })
        }];
      })
    : [];

const parseDisks = (
  value: unknown
): readonly { readonly id: string; readonly title: string; readonly mountPath: string }[] =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        if (!isRecord(item)) return [];
        const id = stringValue(item.id);
        const title = stringValue(item.title);
        const mountPath = stringValue(item.mountPath);
        return id === undefined || title === undefined || mountPath === undefined
          ? []
          : [{ id, title, mountPath }];
      })
    : [];

const parseDownloadTasks = (value: unknown): readonly DownloadTask[] =>
  Array.isArray(value)
    ? value.flatMap((item): readonly DownloadTask[] => {
        if (!isRecord(item)) return [];
        const id = stringValue(item.id);
        const fileName = stringValue(item.fileName);
        const state = stringValue(item.state);
        if (id === undefined || fileName === undefined || state === undefined) return [];
        return [{
          id,
          fileName,
          state,
          receivedBytes: finiteNumber(item.receivedBytes),
          totalBytes: finiteNumber(item.totalBytes),
          speedBytesPerSecond: finiteNumber(item.speedBytesPerSecond)
        }];
      })
    : [];

export const parseFilesModuleState = (value: unknown): FilesModuleState | null => {
  if (value === null) return null;
  if (!isRecord(value)) {
    throw new Error("Core returned an invalid Files state.");
  }
  const instanceId = stringValue(value.instanceId);
  const title = stringValue(value.title);
  const status = value.status;
  const viewKind = value.viewKind;
  const presentationMode = value.presentationMode;
  if (
    instanceId === undefined
    || title === undefined
    || (status !== "idle" && status !== "loading" && status !== "ready" && status !== "error")
    || (viewKind !== "home" && viewKind !== "directory" && viewKind !== "trash" && viewKind !== "downloads")
    || (presentationMode !== "list" && presentationMode !== "large")
  ) {
    throw new Error("Core returned an invalid Files state.");
  }
  const parentPath = stringValue(value.parentPath);
  const selectedEntryId = stringValue(value.selectedEntryId);
  const selectedTrashEntryId = stringValue(value.selectedTrashEntryId);
  const errorMessage = stringValue(value.errorMessage);
  return {
    instanceId,
    title,
    status,
    viewKind,
    presentationMode,
    currentLocation: parseLocation(value.currentLocation),
    ...(parentPath === undefined ? {} : { parentPath }),
    historyLength: Array.isArray(value.history) ? value.history.length : 0,
    historyIndex: finiteNumber(value.historyIndex, -1),
    systemLocations: parseLocations(value.systemLocations),
    favorites: parseFavorites(value.favorites),
    recentLocations: parseNamedPaths(value.recentLocations),
    disks: parseDisks(value.disks),
    entries: parseEntries(value.entries),
    trashEntries: parseTrashEntries(value.trashEntries),
    downloadTasks: parseDownloadTasks(value.downloadTasks),
    ...(selectedEntryId === undefined ? {} : { selectedEntryId }),
    ...(selectedTrashEntryId === undefined ? {} : { selectedTrashEntryId }),
    ...(errorMessage === undefined ? {} : { errorMessage })
  };
};

const copy = (locale: string) => {
  const chinese = locale.toLowerCase().startsWith("zh");
  return chinese ? {
    home: "文件", favorites: "收藏", downloads: "下载", trash: "废纸篓",
    back: "后退", forward: "前进", up: "上一级", refresh: "刷新",
    list: "列表", large: "大图标", addFavorite: "收藏此目录",
    removeFavorite: "取消收藏", newFile: "新建文件", newFolder: "新建文件夹",
    name: "名称", modified: "修改时间", size: "大小", location: "位置",
    restore: "恢复", remove: "移到废纸篓", emptyTrash: "清空废纸篓",
    confirmMoveTitle: "将项目移到废纸篓？", confirmMoveBody: "该项目会移到废纸篓，之后仍可恢复。",
    confirmEmptyTitle: "永久清空废纸篓？", confirmEmptyBody: "废纸篓中的所有项目将被永久删除。此操作无法撤销。",
    confirmMove: "移到废纸篓", confirmEmpty: "永久删除",
    noItems: "这里没有项目", loading: "正在读取文件…", retry: "重试",
    create: "创建", cancel: "取消", createName: "名称", recent: "最近使用",
    locations: "位置", disks: "磁盘", progress: "进度"
  } : {
    home: "Files", favorites: "Favorites", downloads: "Downloads", trash: "Trash",
    back: "Back", forward: "Forward", up: "Up", refresh: "Refresh",
    list: "List", large: "Large icons", addFavorite: "Add favorite",
    removeFavorite: "Remove favorite", newFile: "New file", newFolder: "New folder",
    name: "Name", modified: "Modified", size: "Size", location: "Location",
    restore: "Restore", remove: "Move to Trash", emptyTrash: "Empty Trash",
    confirmMoveTitle: "Move this item to Trash?", confirmMoveBody: "The item will be moved to Trash and can still be restored.",
    confirmEmptyTitle: "Permanently empty Trash?", confirmEmptyBody: "Every item in Trash will be permanently deleted. This cannot be undone.",
    confirmMove: "Move to Trash", confirmEmpty: "Delete permanently",
    noItems: "No items here", loading: "Reading files…", retry: "Retry",
    create: "Create", cancel: "Cancel", createName: "Name", recent: "Recent",
    locations: "Locations", disks: "Disks", progress: "Progress"
  };
};

const buttonStyle: CSSProperties = {
  border: "1px solid var(--lyra-border-subtle, #d5d8de)",
  borderRadius: 6,
  color: "inherit",
  background: "var(--lyra-surface-secondary, #f6f7f9)",
  padding: "6px 9px",
  cursor: "pointer"
};

const navigationButtonStyle: CSSProperties = {
  ...buttonStyle,
  display: "block",
  width: "100%",
  border: 0,
  textAlign: "left",
  background: "transparent"
};

const formatBytes = (bytes: number | undefined): string => {
  if (bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const FilesSurface = ({
  host,
  instanceId,
  presentation,
  updateOpaqueState
}: FirstPartySurfaceProps) => {
  const labels = copy(presentation.locale);
  const [state, setState] = useState<FilesModuleState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createKind, setCreateKind] = useState<"file" | "directory" | null>(null);
  const [createName, setCreateName] = useState("");
  const [destructiveAction, setDestructiveAction] = useState<
    "move-to-trash" | "empty-trash" | null
  >(null);

  const acceptState = useCallback((value: unknown) => {
    const next = parseFilesModuleState(value);
    setState(next);
    setError(null);
    if (next !== null) {
      updateOpaqueState({
        viewKind: next.viewKind,
        presentationMode: next.presentationMode,
        ...(next.currentLocation?.path === undefined
          ? {}
          : { currentPath: next.currentLocation.path })
      });
    }
    return next;
  }, [updateOpaqueState]);

  const refresh = useCallback(async () => {
    try {
      acceptState(await host.executeCommand(COMMANDS.read, { instanceId }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [acceptState, host, instanceId]);

  const run = useCallback(async (
    command: string,
    input: Readonly<Record<string, string | number | boolean>> = {}
  ) => {
    try {
      const result = await host.executeCommand(command, { instanceId, ...input });
      acceptState(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [acceptState, host, instanceId]);

  useEffect(() => {
    void refresh();
    let fallbackTimer: number | undefined;
    let registration: { dispose(): void } | undefined;
    try {
      registration = host.subscribeEvent(EVENTS.changed, async (value) => {
        if (!isRecord(value) || !Array.isArray(value.instanceIds)) {
          await refresh();
          return;
        }
        const changedInstanceIds = value.instanceIds.filter(
          (item): item is string => typeof item === "string"
        );
        if (changedInstanceIds.includes(instanceId)) {
          await refresh();
        }
      });
    } catch {
      // Compatibility hosts that predate the event contract stay usable while
      // Core retains the static fallback during the preview migration.
      fallbackTimer = window.setInterval(() => void refresh(), 5_000);
    }
    return () => {
      registration?.dispose();
      if (fallbackTimer !== undefined) window.clearInterval(fallbackTimer);
    };
  }, [host, instanceId, refresh]);

  useEffect(() => {
    setDestructiveAction(null);
  }, [state?.viewKind]);

  const openLocation = useCallback((location: FileLocation) => {
    if (location.specialId === "trash" || location.kind === "trash") {
      void run(COMMANDS.openTrash);
    } else if (location.specialId === "downloadManager") {
      void run(COMMANDS.openDownloads);
    } else if (location.path !== undefined) {
      void run(COMMANDS.openDirectory, { path: location.path });
    } else {
      void run(COMMANDS.openHome);
    }
  }, [run]);

  const currentFavorite = useMemo(
    () => state?.currentLocation?.path !== undefined
      && state.favorites.some((item) => item.path === state.currentLocation?.path),
    [state]
  );

  const create = useCallback(async () => {
    if (createKind === null || createName.trim().length === 0) return;
    await run(COMMANDS.createEntry, { kind: createKind, name: createName.trim() });
    setCreateKind(null);
    setCreateName("");
  }, [createKind, createName, run]);

  const renderEntries = () => {
    if (state === null) return null;
    if (state.viewKind === "home") {
      const locations = [
        ...state.systemLocations,
        ...state.disks.map((disk): FileLocation => ({
          id: disk.id,
          title: disk.title,
          kind: "directory",
          path: disk.mountPath
        }))
      ];
      return (
        <div style={{ padding: 18, overflow: "auto" }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 14 }}>{labels.locations}</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 8 }}>
            {locations.map((location) => (
              <button key={location.id} style={{ ...buttonStyle, textAlign: "left", padding: 12 }} onClick={() => openLocation(location)}>
                <strong>{location.title}</strong>
                <small style={{ display: "block", marginTop: 4, color: "var(--lyra-text-secondary, #666)", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {location.path ?? location.kind}
                </small>
              </button>
            ))}
          </div>
          <h2 style={{ margin: "20px 0 8px", fontSize: 14 }}>{labels.recent}</h2>
          {state.recentLocations.length === 0 ? <p>{labels.noItems}</p> : state.recentLocations.map((item) => (
            <button key={item.id} style={navigationButtonStyle} onClick={() => void run(COMMANDS.openDirectory, { path: item.path })}>
              <strong>{item.title}</strong>
              <small style={{ display: "block", color: "var(--lyra-text-secondary, #666)" }}>{item.path}</small>
            </button>
          ))}
        </div>
      );
    }
    if (state.viewKind === "trash") {
      return (
        <div style={{ padding: 12, overflow: "auto" }}>
          {state.trashEntries.length === 0 ? <p>{labels.noItems}</p> : state.trashEntries.map((entry) => (
            <button
              key={entry.id}
              style={{
                ...navigationButtonStyle,
                background: entry.id === state.selectedTrashEntryId
                  ? "var(--lyra-surface-selected, #e8eef8)"
                  : "transparent"
              }}
              onClick={() => void run(COMMANDS.selectTrashEntry, { entryId: entry.id })}
            >
              <strong>{entry.kind === "directory" ? "▸ " : ""}{entry.name}</strong>
              <small style={{ display: "block", color: "var(--lyra-text-secondary, #666)" }}>
                {entry.originalPath ?? ""} · {formatBytes(entry.sizeBytes)}
              </small>
            </button>
          ))}
        </div>
      );
    }
    if (state.viewKind === "downloads") {
      return (
        <div style={{ padding: 12, overflow: "auto" }}>
          {state.downloadTasks.length === 0 ? <p>{labels.noItems}</p> : state.downloadTasks.map((task) => {
            const progress = task.totalBytes > 0
              ? Math.min(100, Math.round(task.receivedBytes / task.totalBytes * 100))
              : 0;
            return (
              <div key={task.id} style={{ padding: 10, borderBottom: "1px solid var(--lyra-border-subtle, #ddd)" }}>
                <strong>{task.fileName}</strong>
                <small style={{ display: "block", marginTop: 4, color: "var(--lyra-text-secondary, #666)" }}>
                  {task.state} · {labels.progress} {progress}% · {formatBytes(task.speedBytesPerSecond)}/s
                </small>
              </div>
            );
          })}
        </div>
      );
    }
    const grid = state.presentationMode === "large";
    return (
      <div style={{
        display: grid ? "grid" : "block",
        gridTemplateColumns: grid ? "repeat(auto-fill, minmax(140px, 1fr))" : undefined,
        alignContent: "start",
        gap: grid ? 8 : undefined,
        padding: 12,
        overflow: "auto"
      }}>
        {state.entries.length === 0 ? <p>{labels.noItems}</p> : state.entries.map((entry) => (
          <button
            key={entry.id}
            style={{
              ...navigationButtonStyle,
              width: "100%",
              padding: grid ? 14 : "8px 10px",
              textAlign: grid ? "center" : "left",
              background: entry.id === state.selectedEntryId
                ? "var(--lyra-surface-selected, #e8eef8)"
                : "transparent"
            }}
            onClick={() => void run(COMMANDS.selectEntry, { entryId: entry.id })}
            onDoubleClick={() => {
              if (entry.kind === "directory") {
                void run(COMMANDS.openDirectory, { path: entry.path });
              } else {
                void host.executeCommand(COMMANDS.openResource, { path: entry.path });
              }
            }}
          >
            <strong>{entry.kind === "directory" ? "▸ " : ""}{entry.name}</strong>
            <small style={{ display: "block", marginTop: grid ? 5 : 2, color: "var(--lyra-text-secondary, #666)" }}>
              {formatBytes(entry.sizeBytes)}
              {entry.modifiedAt === undefined ? "" : ` · ${new Date(entry.modifiedAt).toLocaleString()}`}
            </small>
          </button>
        ))}
      </div>
    );
  };

  return (
    <section data-lyra-component="lyra.files" aria-label="file-manager-surface" style={{
      display: "grid",
      gridTemplateColumns: "190px minmax(0, 1fr)",
      position: "relative",
      width: "100%",
      height: "100%",
      color: "var(--lyra-text-primary, #202124)",
      background: "var(--lyra-surface-primary, #fff)",
      fontFamily: "var(--lyra-font-sans, system-ui, sans-serif)"
    }}>
      <aside style={{ padding: 8, overflow: "auto", borderRight: "1px solid var(--lyra-border-subtle, #ddd)" }}>
        <button style={navigationButtonStyle} onClick={() => void run(COMMANDS.openHome)}>{labels.home}</button>
        <p style={{ margin: "14px 8px 5px", fontSize: 11, color: "var(--lyra-text-secondary, #666)" }}>{labels.favorites}</p>
        {state?.favorites.map((favorite) => (
          <button
            key={favorite.id}
            style={navigationButtonStyle}
            title={favorite.kind === "web"
              ? favorite.url ?? favorite.path
              : favorite.kind === "agent-session"
                ? favorite.workingDir ?? favorite.sessionId ?? favorite.path
                : favorite.path}
            onClick={() => void run(COMMANDS.openFavorite, { favoriteId: favorite.id })}
          >
            {favorite.kind === "web" ? "↗ " : favorite.kind === "agent-session" ? "◉ " : ""}
            {favorite.title}
          </button>
        ))}
        <button style={navigationButtonStyle} onClick={() => void run(COMMANDS.openDownloads)}>{labels.downloads}</button>
        <button style={navigationButtonStyle} onClick={() => void run(COMMANDS.openTrash)}>{labels.trash}</button>
      </aside>
      <div style={{ display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", minWidth: 0, minHeight: 0 }}>
        <header style={{ display: "flex", alignItems: "center", gap: 6, padding: 8, borderBottom: "1px solid var(--lyra-border-subtle, #ddd)", overflowX: "auto" }}>
          <button style={buttonStyle} disabled={(state?.historyIndex ?? -1) <= 0} onClick={() => void run(COMMANDS.navigate, { direction: "back" })}>{labels.back}</button>
          <button style={buttonStyle} disabled={state === null || state.historyIndex >= state.historyLength - 1} onClick={() => void run(COMMANDS.navigate, { direction: "forward" })}>{labels.forward}</button>
          <button style={buttonStyle} disabled={state?.parentPath === undefined} onClick={() => void run(COMMANDS.navigate, { direction: "up" })}>{labels.up}</button>
          <button style={buttonStyle} onClick={() => void run(COMMANDS.navigate, { direction: "refresh" })}>{labels.refresh}</button>
          <strong style={{ marginLeft: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {state?.currentLocation?.path ?? state?.title ?? labels.home}
          </strong>
          <span style={{ flex: 1 }} />
          {state?.viewKind === "directory" ? (
            <>
              <button style={buttonStyle} onClick={() => void run(COMMANDS.setPresentation, { mode: state.presentationMode === "list" ? "large" : "list" })}>
                {state.presentationMode === "list" ? labels.large : labels.list}
              </button>
              <button style={buttonStyle} onClick={() => void run(COMMANDS.toggleFavorite)}>
                {currentFavorite ? labels.removeFavorite : labels.addFavorite}
              </button>
              <button style={buttonStyle} onClick={() => setCreateKind("file")}>{labels.newFile}</button>
              <button style={buttonStyle} onClick={() => setCreateKind("directory")}>{labels.newFolder}</button>
              <button
                style={buttonStyle}
                disabled={state.selectedEntryId === undefined}
                onClick={() => setDestructiveAction("move-to-trash")}
              >{labels.remove}</button>
            </>
          ) : null}
          {state?.viewKind === "trash" ? (
            <>
              <button style={buttonStyle} disabled={state.selectedTrashEntryId === undefined} onClick={() => void run(COMMANDS.restoreSelection)}>{labels.restore}</button>
              <button
                style={buttonStyle}
                disabled={state.trashEntries.length === 0}
                onClick={() => setDestructiveAction("empty-trash")}
              >{labels.emptyTrash}</button>
            </>
          ) : null}
        </header>
        {error !== null ? (
          <div role="alert" style={{ margin: "auto", textAlign: "center" }}>
            <p>{error}</p>
            <button style={buttonStyle} onClick={() => void refresh()}>{labels.retry}</button>
          </div>
        ) : state === null || state.status === "loading" || state.status === "idle" ? (
          <p style={{ margin: "auto" }}>{labels.loading}</p>
        ) : state.status === "error" ? (
          <div role="alert" style={{ margin: "auto", textAlign: "center" }}>
            <p>{state.errorMessage ?? labels.noItems}</p>
            <button style={buttonStyle} onClick={() => void refresh()}>{labels.retry}</button>
          </div>
        ) : (
          renderEntries()
        )}
        {createKind === null ? null : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
            style={{
              position: "absolute",
              inset: "50% auto auto 50%",
              transform: "translate(-50%, -50%)",
              display: "flex",
              gap: 8,
              padding: 14,
              border: "1px solid var(--lyra-border-subtle, #ddd)",
              borderRadius: 8,
              background: "var(--lyra-surface-primary, #fff)",
              boxShadow: "0 10px 30px rgb(0 0 0 / 18%)"
            }}
          >
            <input
              autoFocus
              aria-label={labels.createName}
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              style={{ ...buttonStyle, cursor: "text", minWidth: 220 }}
            />
            <button style={buttonStyle} type="submit" disabled={createName.trim().length === 0}>{labels.create}</button>
            <button style={buttonStyle} type="button" onClick={() => setCreateKind(null)}>{labels.cancel}</button>
          </form>
        )}
      </div>
      {destructiveAction === null ? null : (
        <div
          role="presentation"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 10,
            display: "grid",
            placeItems: "center",
            padding: 16,
            background: "rgb(0 0 0 / 32%)"
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label={destructiveAction === "move-to-trash"
              ? labels.confirmMoveTitle
              : labels.confirmEmptyTitle}
            style={{
              width: "min(420px, 100%)",
              padding: 18,
              border: "1px solid var(--lyra-border-subtle, #ddd)",
              borderRadius: 8,
              background: "var(--lyra-surface-primary, #fff)",
              boxShadow: "0 12px 36px rgb(0 0 0 / 24%)"
            }}
          >
            <h2 style={{ margin: 0, fontSize: 16 }}>
              {destructiveAction === "move-to-trash"
                ? labels.confirmMoveTitle
                : labels.confirmEmptyTitle}
            </h2>
            <p style={{ margin: "10px 0 16px", color: "var(--lyra-text-secondary, #666)" }}>
              {destructiveAction === "move-to-trash"
                ? labels.confirmMoveBody
                : labels.confirmEmptyBody}
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button autoFocus type="button" style={buttonStyle} onClick={() => setDestructiveAction(null)}>
                {labels.cancel}
              </button>
              <button
                type="button"
                style={{
                  ...buttonStyle,
                  color: "var(--lyra-danger-foreground, #fff)",
                  background: "var(--lyra-danger, #b3261e)",
                  borderColor: "transparent"
                }}
                onClick={() => {
                  const command = destructiveAction === "move-to-trash"
                    ? COMMANDS.moveSelectionToTrash
                    : COMMANDS.emptyTrash;
                  setDestructiveAction(null);
                  void run(command);
                }}
              >
                {destructiveAction === "move-to-trash"
                  ? labels.confirmMove
                  : labels.confirmEmpty}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export const lyraAppModule = createFirstPartyAppModule({
  componentId: "lyra.files",
  version: __LYRA_APP_VERSION__,
  contributions: {
    commands: [
      { id: "lyra.files.refresh", title: "Refresh Files" },
      { id: "lyra.files.open-home", title: "Open Files home" }
    ],
    status: [
      { id: "lyra.files.status", title: "Files" }
    ]
  },
  commandHandlers: {
    "lyra.files.refresh": (host, input) =>
      host.executeCommand(COMMANDS.navigate, isRecord(input)
        ? { ...input, direction: "refresh" }
        : { direction: "refresh" }),
    "lyra.files.open-home": (host, input) =>
      host.executeCommand(COMMANDS.openHome, input)
  },
  surfaces: {
    "file-manager": {
      title: "Files",
      description: "Browse, search, organize, and open workspace files.",
      component: FilesSurface
    }
  }
});

export default lyraAppModule;
