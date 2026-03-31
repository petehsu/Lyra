import {
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FilePlus2,
  FolderPlus,
  FolderUp,
  LayoutGrid,
  List,
  RefreshCw,
  RotateCcw,
  Star,
  StarOff,
  Trash2,
  X,
  Check
} from "lucide-react";
import {
  Fragment,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef
} from "react";

import {
  renderFileManagerAppIcon,
  renderFileManagerDiskIcon,
  renderFileManagerEntryIcon,
  renderFileManagerLocationIcon,
  renderFileManagerSectionIcon
} from "./icon-registry";
import { OverflowMarqueeText } from "./overflow-marquee";
import {
  clearFileManagerEntryDragPayload,
  writeFileManagerEntryDragPayload,
  type FileManagerEntryDragPayload
} from "./drag-transfer";
import { resolveFileManagerEntryIconKind } from "./entry-icon-classifier";
import type {
  FileManagerEntry,
  FileManagerDisk,
  FileManagerDiskKind,
  FileManagerFavorite,
  FileManagerLocation,
  FileManagerTrashEntry
} from "../../../shared/file-manager";
import { useLoadingVisibility } from "../shell/use-loading-visibility";
import type { FileManagerAppState, FileManagerModel, FileManagerSurfaceLabels } from "./types";
import { FileManagerImagePreview, isPreviewableImageEntry } from "./preview";

type FileManagerSurfaceProps = {
  readonly state: FileManagerAppState | null;
  readonly labels: FileManagerSurfaceLabels;
  readonly model: FileManagerModel;
  readonly onOpenFile: (filePath: string) => void;
};

const FILE_MANAGER_HOME_FAVORITES_DEFAULT = 4;
const FILE_MANAGER_HOME_LOCATIONS_DEFAULT = 4;
const FILE_MANAGER_HOME_DEVICES_DEFAULT = 3;
const FILE_MANAGER_HOME_RECENT_DEFAULT = 4;
const FILE_MANAGER_DIRECTORY_LIST_DEFAULT = 12;
const FILE_MANAGER_TRASH_LIST_DEFAULT = 8;
const FILE_MANAGER_DIRECTORY_LARGE_DEFAULT = 10;
const FILE_MANAGER_TRASH_LARGE_DEFAULT = 8;

type FileManagerSkeletonMetrics = {
  readonly favoritesCount: number;
  readonly locationsCount: number;
  readonly devicesCount: number;
  readonly recentCount: number;
  readonly directoryEntriesCount: number;
  readonly trashEntriesCount: number;
};

const clampSkeletonCount = (
  value: number,
  minimum: number,
  maximum: number
): number => Math.min(maximum, Math.max(minimum, value));

const deriveSkeletonCount = (
  observed: number,
  fallback: number,
  minimum: number,
  maximum: number
): number => {
  if (observed <= 0) {
    return fallback;
  }
  return clampSkeletonCount(observed, minimum, maximum);
};

const createSkeletonSlots = (count: number): readonly number[] =>
  Array.from({ length: count }, (_value, index) => index);

type BreadcrumbPart = {
  readonly id: string;
  readonly title: string;
  readonly path: string;
};

const splitBreadcrumbs = (path: string): readonly BreadcrumbPart[] => {
  const normalized = path.replace(/\\/g, "/");
  const driveMatch = normalized.match(/^[A-Za-z]:/);
  const drivePrefix = driveMatch?.[0] ?? "";
  const withoutDrive = drivePrefix.length > 0 ? normalized.slice(drivePrefix.length) : normalized;
  const segments = withoutDrive.split("/").filter((segment) => segment.length > 0);

  const breadcrumbs: BreadcrumbPart[] = [];
  let current = drivePrefix;

  if (drivePrefix.length > 0) {
    breadcrumbs.push({
      id: drivePrefix,
      title: drivePrefix,
      path: drivePrefix + "/"
    });
    current = `${drivePrefix}/`;
  } else if (normalized.startsWith("/")) {
    breadcrumbs.push({
      id: "root",
      title: "/",
      path: "/"
    });
    current = "/";
  }

  for (const segment of segments) {
    current = current === "/" || current.endsWith("/") ? `${current}${segment}` : `${current}/${segment}`;
    breadcrumbs.push({
      id: current,
      title: segment,
      path: current
    });
  }

  return breadcrumbs;
};

const isCurrentFavorite = (state: FileManagerAppState | null): boolean => {
  if (state?.currentLocation?.path === undefined) {
    return false;
  }
  return state.favorites.some((item) => item.path === state.currentLocation?.path);
};

const isActiveLocation = (
  state: FileManagerAppState,
  location: Pick<FileManagerLocation, "id" | "path" | "specialId">
): boolean => {
  const currentLocation = state.currentLocation;
  if (currentLocation === null) {
    return false;
  }

  if (
    location.specialId !== undefined &&
    currentLocation.specialId !== undefined &&
    location.specialId === currentLocation.specialId
  ) {
    return true;
  }

  if (
    location.path !== undefined &&
    currentLocation.path !== undefined &&
    location.path === currentLocation.path
  ) {
    return true;
  }

  return location.id === currentLocation.id;
};

const isActiveFavorite = (
  state: FileManagerAppState,
  favorite: Pick<FileManagerFavorite, "path">
): boolean => {
  const currentPath = state.currentLocation?.path;
  if (currentPath === undefined) {
    return false;
  }

  return favorite.path === currentPath;
};

const HomeSection = ({
  title,
  children,
  section
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly section: "favorites" | "locations" | "devices" | "recent";
}) => (
  <section className="lyra-file-manager-home-section">
    <header className="lyra-file-manager-home-section-header">
      {renderFileManagerSectionIcon(section)}
      <h3>{title}</h3>
    </header>
    <div className="lyra-file-manager-home-grid">{children}</div>
  </section>
);

const FileManagerLoadingSkeleton = ({
  viewKind,
  presentationMode,
  metrics
}: {
  readonly viewKind: FileManagerAppState["viewKind"];
  readonly presentationMode: FileManagerAppState["presentationMode"];
  readonly metrics: FileManagerSkeletonMetrics;
}) => {
  const favoriteSlots = createSkeletonSlots(
    deriveSkeletonCount(metrics.favoritesCount, FILE_MANAGER_HOME_FAVORITES_DEFAULT, 2, 8)
  );
  const locationSlots = createSkeletonSlots(
    deriveSkeletonCount(metrics.locationsCount, FILE_MANAGER_HOME_LOCATIONS_DEFAULT, 3, 8)
  );
  const deviceSlots = createSkeletonSlots(
    deriveSkeletonCount(metrics.devicesCount, FILE_MANAGER_HOME_DEVICES_DEFAULT, 2, 6)
  );
  const recentSlots = createSkeletonSlots(
    deriveSkeletonCount(metrics.recentCount, FILE_MANAGER_HOME_RECENT_DEFAULT, 2, 10)
  );
  const directoryListSlots = createSkeletonSlots(
    deriveSkeletonCount(metrics.directoryEntriesCount, FILE_MANAGER_DIRECTORY_LIST_DEFAULT, 6, 24)
  );
  const trashListSlots = createSkeletonSlots(
    deriveSkeletonCount(metrics.trashEntriesCount, FILE_MANAGER_TRASH_LIST_DEFAULT, 4, 16)
  );
  const directoryLargeSlots = createSkeletonSlots(
    deriveSkeletonCount(metrics.directoryEntriesCount, FILE_MANAGER_DIRECTORY_LARGE_DEFAULT, 6, 18)
  );
  const trashLargeSlots = createSkeletonSlots(
    deriveSkeletonCount(metrics.trashEntriesCount, FILE_MANAGER_TRASH_LARGE_DEFAULT, 4, 14)
  );

  const renderHomeCardSkeleton = (cardId: number, sectionKey: string) => (
    <article
      key={`${sectionKey}-card-${cardId}`}
      className="lyra-file-manager-home-card lyra-file-manager-home-card-skeleton"
    >
      <span className="lyra-skeleton-block lyra-file-manager-skeleton-card-icon" />
      <span className="lyra-skeleton-block lyra-file-manager-skeleton-card-title" />
      <span className="lyra-skeleton-block lyra-file-manager-skeleton-card-subtitle" />
    </article>
  );

  if (viewKind === "home") {
    return (
      <div className="lyra-file-manager-skeleton-home" aria-label="file-manager-loading-skeleton">
        <section className="lyra-file-manager-skeleton-home-section">
          <header className="lyra-file-manager-skeleton-home-header">
            <span className="lyra-skeleton-block lyra-file-manager-skeleton-home-header-icon" />
            <span className="lyra-skeleton-block lyra-file-manager-skeleton-home-header-title" />
          </header>
          <div className="lyra-file-manager-home-grid">
            {favoriteSlots.map((cardId) => renderHomeCardSkeleton(cardId, "favorites"))}
          </div>
        </section>

        <section className="lyra-file-manager-skeleton-home-section">
          <header className="lyra-file-manager-skeleton-home-header">
            <span className="lyra-skeleton-block lyra-file-manager-skeleton-home-header-icon" />
            <span className="lyra-skeleton-block lyra-file-manager-skeleton-home-header-title" />
          </header>
          <div className="lyra-file-manager-home-grid">
            {locationSlots.map((cardId) => renderHomeCardSkeleton(cardId, "locations"))}
          </div>
        </section>

        <section className="lyra-file-manager-skeleton-home-section">
          <header className="lyra-file-manager-skeleton-home-header">
            <span className="lyra-skeleton-block lyra-file-manager-skeleton-home-header-icon" />
            <span className="lyra-skeleton-block lyra-file-manager-skeleton-home-header-title" />
          </header>
          <div className="lyra-file-manager-home-grid">
            {deviceSlots.map((cardId) => (
              <article
                key={`devices-card-${cardId}`}
                className="lyra-file-manager-home-card lyra-file-manager-home-card-skeleton lyra-file-manager-disk-card lyra-file-manager-disk-card-skeleton"
              >
                <div className="lyra-file-manager-disk-summary">
                  <div className="lyra-file-manager-disk-summary-icon">
                    <span className="lyra-skeleton-block lyra-file-manager-skeleton-disk-icon" />
                  </div>
                  <div className="lyra-file-manager-disk-summary-body">
                    <span className="lyra-skeleton-block lyra-file-manager-skeleton-disk-title" />
                    <span className="lyra-skeleton-block lyra-file-manager-skeleton-disk-path" />
                  </div>
                </div>
                <div className="lyra-file-manager-disk-meter">
                  <span className="lyra-skeleton-block lyra-file-manager-skeleton-disk-meter" />
                </div>
                <div className="lyra-file-manager-disk-meta">
                  <span className="lyra-skeleton-block lyra-file-manager-skeleton-disk-meta-line" />
                  <span className="lyra-skeleton-block lyra-file-manager-skeleton-disk-meta-line lyra-file-manager-skeleton-disk-meta-line-short" />
                </div>
                <div className="lyra-file-manager-disk-footer">
                  <span className="lyra-skeleton-block lyra-file-manager-skeleton-disk-kind" />
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="lyra-file-manager-skeleton-home-section">
          <header className="lyra-file-manager-skeleton-home-header">
            <span className="lyra-skeleton-block lyra-file-manager-skeleton-home-header-icon" />
            <span className="lyra-skeleton-block lyra-file-manager-skeleton-home-header-title" />
          </header>
          <div className="lyra-file-manager-home-grid">
            {recentSlots.map((cardId) => renderHomeCardSkeleton(cardId, "recent"))}
          </div>
        </section>
      </div>
    );
  }

  if (presentationMode === "large") {
    const tiles = viewKind === "trash" ? trashLargeSlots : directoryLargeSlots;
    return (
      <div className="lyra-file-manager-list-shell" aria-label="file-manager-loading-skeleton">
        <div className="lyra-file-manager-large-grid">
          {tiles.map((tileId) => (
            <article
              key={`fm-large-skeleton-tile-${tileId}`}
              className="lyra-file-manager-large-tile lyra-file-manager-large-tile-skeleton"
            >
              <div className="lyra-file-manager-large-tile-preview">
                <span className="lyra-skeleton-block lyra-file-manager-skeleton-large-preview" />
              </div>
              <div className="lyra-file-manager-large-tile-body">
                <span className="lyra-skeleton-block lyra-file-manager-skeleton-large-title" />
                {viewKind === "trash" ? (
                  <span className="lyra-skeleton-block lyra-file-manager-skeleton-large-subtitle" />
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </div>
    );
  }

  const rows = viewKind === "trash" ? trashListSlots : directoryListSlots;

  return (
    <div className="lyra-file-manager-list-shell" aria-label="file-manager-loading-skeleton">
      <div className="lyra-file-manager-list-grid lyra-file-manager-list-grid-skeleton">
        {rows.map((rowId) => (
          <article
            key={`fm-list-skeleton-row-${rowId}`}
            className="lyra-file-manager-list-row lyra-file-manager-list-row-skeleton"
          >
            <div className="lyra-file-manager-list-cell-primary">
              <span className="lyra-skeleton-block lyra-file-manager-skeleton-list-icon" />
              <span className="lyra-skeleton-block lyra-file-manager-skeleton-list-name" />
            </div>
            {viewKind === "trash" ? (
              <span className="lyra-skeleton-block lyra-file-manager-skeleton-list-subline" />
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
};

const formatDiskBytes = (value: number): string => {
  if (value <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const precision = size >= 100 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
};

const formatDiskUsage = (disk: FileManagerDisk): string =>
  `${Math.round(disk.usageRatio * 100)}% · ${formatDiskBytes(disk.usedBytes)} / ${formatDiskBytes(disk.totalBytes)}`;

const getDiskUsageTone = (usageRatio: number): "healthy" | "warning" | "danger" => {
  if (usageRatio >= 0.9) {
    return "danger";
  }

  if (usageRatio >= 0.7) {
    return "warning";
  }

  return "healthy";
};

const resolveDiskKindLabel = (
  diskKind: FileManagerDiskKind,
  labels: Pick<
    FileManagerSurfaceLabels,
    "diskKindSystem" | "diskKindLocal" | "diskKindRemovable" | "diskKindExternal"
  >
): string => {
  switch (diskKind) {
    case "system":
      return labels.diskKindSystem;
    case "local":
      return labels.diskKindLocal;
    case "removable":
      return labels.diskKindRemovable;
    default:
      return labels.diskKindExternal;
  }
};

const formatOptionalDiskBytes = (value: number | undefined): string | null =>
  value === undefined ? null : formatDiskBytes(value);

const toDirectoryEntryDragPayload = (
  entry: FileManagerEntry
): FileManagerEntryDragPayload => ({
  name: entry.name,
  kind: entry.kind,
  source: "directory",
  path: entry.path,
  iconKind: resolveFileManagerEntryIconKind(entry)
});

const toTrashEntryDragPayload = (
  entry: FileManagerTrashEntry
): FileManagerEntryDragPayload => ({
  name: entry.name,
  kind: entry.kind,
  source: "trash",
  iconKind: resolveFileManagerEntryIconKind(entry),
  ...(entry.originalPath === undefined
    ? entry.trashedPath === undefined
      ? {}
      : { path: entry.trashedPath }
    : { path: entry.originalPath })
});

const createFileManagerDragPreview = (
  documentRef: Document,
  label: string
): HTMLDivElement => {
  const preview = documentRef.createElement("div");
  preview.className = "lyra-file-manager-drag-preview";
  preview.textContent = label;
  documentRef.body.append(preview);
  return preview;
};

const FileManagerLargeEntryTile = ({
  entry,
  isActive,
  onSelect,
  onOpen,
  onContextMenu,
  onDragStart,
  onDragEnd
}: {
  readonly entry: FileManagerEntry;
  readonly isActive: boolean;
  readonly onSelect: () => void;
  readonly onOpen: () => void;
  readonly onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  readonly onDragStart: (event: ReactDragEvent<HTMLButtonElement>) => void;
  readonly onDragEnd: () => void;
}) => (
  <button
    className={
      isActive
        ? "lyra-file-manager-large-tile lyra-file-manager-large-tile-active"
        : "lyra-file-manager-large-tile"
    }
    data-lyra-allow-web-drag="true"
    draggable
    onClick={onSelect}
    onDoubleClick={onOpen}
    onContextMenu={onContextMenu}
    onDragStart={onDragStart}
    onDragEnd={onDragEnd}
  >
    <div className="lyra-file-manager-large-tile-preview">
      {isPreviewableImageEntry(entry) ? (
        <FileManagerImagePreview
          entry={entry}
          className="lyra-file-manager-large-tile-image"
        />
      ) : renderFileManagerEntryIcon(entry)}
    </div>
    <div className="lyra-file-manager-large-tile-body">
      <OverflowMarqueeText
        text={entry.name}
        active={isActive}
        className="lyra-file-manager-large-tile-title"
      />
    </div>
  </button>
);

const FileManagerLargeTrashTile = ({
  entry,
  isActive,
  onSelect,
  onContextMenu,
  onDragStart,
  onDragEnd
}: {
  readonly entry: FileManagerTrashEntry;
  readonly isActive: boolean;
  readonly onSelect: () => void;
  readonly onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  readonly onDragStart: (event: ReactDragEvent<HTMLButtonElement>) => void;
  readonly onDragEnd: () => void;
}) => (
  <button
    className={
      isActive
        ? "lyra-file-manager-large-tile lyra-file-manager-large-tile-active"
        : "lyra-file-manager-large-tile"
    }
    data-lyra-allow-web-drag="true"
    draggable
    onClick={onSelect}
    onContextMenu={onContextMenu}
    onDragStart={onDragStart}
    onDragEnd={onDragEnd}
  >
    <div className="lyra-file-manager-large-tile-preview">
      {isPreviewableImageEntry(entry) ? (
        <FileManagerImagePreview
          entry={entry}
          className="lyra-file-manager-large-tile-image"
        />
      ) : renderFileManagerEntryIcon(entry)}
    </div>
    <div className="lyra-file-manager-large-tile-body">
      <OverflowMarqueeText
        text={entry.name}
        active={isActive}
        className="lyra-file-manager-large-tile-title"
      />
    </div>
  </button>
);

export const FileManagerSurface = ({
  state,
  labels,
  model,
  onOpenFile
}: FileManagerSurfaceProps) => {
  const breadcrumbs = useMemo(
    () => (state?.currentLocation?.path ? splitBreadcrumbs(state.currentLocation.path) : []),
    [state?.currentLocation?.path]
  );
  const isLoading = state?.status === "loading";
  const showLoadingSkeleton = useLoadingVisibility(isLoading, {
    showDelayMs: 120,
    minVisibleMs: 180
  });
  const dragPreviewRef = useRef<HTMLElement | null>(null);
  const clearEntryDragPreview = (): void => {
    const currentPreview = dragPreviewRef.current;
    if (currentPreview === null) {
      return;
    }
    dragPreviewRef.current = null;
    currentPreview.remove();
  };

  useEffect(
    () => () => {
      clearEntryDragPreview();
    },
    []
  );

  if (state === null) {
    return null;
  }

  const canGoBack = state.historyIndex > 0;
  const canGoForward = state.historyIndex >= 0 && state.historyIndex < state.history.length - 1;
  const canGoUp = state.parentPath !== undefined;
  const favoriteActive = isCurrentFavorite(state);
  const isLargeMode = state.presentationMode === "large";
  const canRenderBodyContent =
    state.status !== "error" &&
    (state.status !== "loading" || showLoadingSkeleton === false);
  const loadingSkeletonMetrics: FileManagerSkeletonMetrics = {
    favoritesCount: state.favorites.length,
    locationsCount: state.systemLocations.length,
    devicesCount: state.disks.length + state.devices.length,
    recentCount: state.recentLocations.length,
    directoryEntriesCount: state.entries.length,
    trashEntriesCount: state.trashEntries.length
  };

  const onEntryDragEnd = (): void => {
    clearEntryDragPreview();
    clearFileManagerEntryDragPayload();
  };
  const applyEntryDragImage = (
    event: ReactDragEvent<HTMLButtonElement>,
    label: string
  ): void => {
    clearEntryDragPreview();
    const preview = createFileManagerDragPreview(event.currentTarget.ownerDocument, label);
    dragPreviewRef.current = preview;
    event.dataTransfer.setDragImage(preview, 14, 12);
  };
  const onDirectoryEntryDragStart = (
    event: ReactDragEvent<HTMLButtonElement>,
    entry: FileManagerEntry
  ): void => {
    applyEntryDragImage(event, entry.name);
    writeFileManagerEntryDragPayload(
      event.dataTransfer,
      toDirectoryEntryDragPayload(entry)
    );
  };
  const onTrashEntryDragStart = (
    event: ReactDragEvent<HTMLButtonElement>,
    entry: FileManagerTrashEntry
  ): void => {
    applyEntryDragImage(event, entry.name);
    writeFileManagerEntryDragPayload(
      event.dataTransfer,
      toTrashEntryDragPayload(entry)
    );
  };

  return (
    <section className="lyra-file-manager-surface" aria-label="file-manager-surface">
      <header className="lyra-file-manager-toolbar">
        <div className="lyra-file-manager-toolbar-group">
          <button
            className="lyra-file-manager-tool-button"
            aria-label={labels.navigationBack}
            disabled={!canGoBack}
            onClick={() => {
              void model.goBack(state.instanceId);
            }}
          >
            <ChevronLeft size={14} />
          </button>
          <button
            className="lyra-file-manager-tool-button"
            aria-label={labels.navigationForward}
            disabled={!canGoForward}
            onClick={() => {
              void model.goForward(state.instanceId);
            }}
          >
            <ChevronRight size={14} />
          </button>
          <button
            className="lyra-file-manager-tool-button"
            aria-label={labels.navigationUp}
            disabled={!canGoUp}
            onClick={() => {
              void model.goUp(state.instanceId);
            }}
          >
            <ChevronUp size={14} />
          </button>
          <button
            className="lyra-file-manager-tool-button"
            aria-label={labels.refresh}
            onClick={() => {
              void model.refresh(state.instanceId);
            }}
          >
            <RefreshCw size={14} />
          </button>
        </div>

        <div className="lyra-file-manager-breadcrumbs" aria-label="file-manager-breadcrumbs">
          {state.viewKind === "home" ? (
            <span className="lyra-file-manager-breadcrumb-current">{labels.title}</span>
          ) : state.viewKind === "trash" ? (
            <span className="lyra-file-manager-breadcrumb-current">{state.currentLocation?.title ?? labels.title}</span>
          ) : breadcrumbs.length > 0 ? (
            breadcrumbs.map((part, index) => (
              <Fragment key={part.id}>
                <button
                  className={
                    index === breadcrumbs.length - 1
                      ? "lyra-file-manager-breadcrumb lyra-file-manager-breadcrumb-active"
                      : "lyra-file-manager-breadcrumb"
                  }
                  onClick={() => {
                    void model.openDirectory(state.instanceId, part.path);
                  }}
                >
                  {part.title}
                </button>
                {index < breadcrumbs.length - 1 ? <i aria-hidden="true">/</i> : null}
              </Fragment>
            ))
          ) : (
            <span className="lyra-file-manager-breadcrumb-current">{state.currentLocation?.title ?? labels.title}</span>
          )}
        </div>

        <div className="lyra-file-manager-toolbar-group">
          <button
            className={
              isLargeMode
                ? "lyra-file-manager-tool-button"
                : "lyra-file-manager-tool-button lyra-file-manager-tool-button-active"
            }
            aria-label={labels.viewList}
            onClick={() => {
              model.setPresentationMode(state.instanceId, "list");
            }}
          >
            <List size={14} />
          </button>
          <button
            className={
              isLargeMode
                ? "lyra-file-manager-tool-button lyra-file-manager-tool-button-active"
                : "lyra-file-manager-tool-button"
            }
            aria-label={labels.viewLarge}
            onClick={() => {
              model.setPresentationMode(state.instanceId, "large");
            }}
          >
            <LayoutGrid size={14} />
          </button>
          <button
            className={favoriteActive ? "lyra-file-manager-tool-button lyra-file-manager-tool-button-active" : "lyra-file-manager-tool-button"}
            aria-label={favoriteActive ? labels.removeFavorite : labels.addFavorite}
            disabled={state.currentLocation?.path === undefined}
            onClick={() => {
              void model.toggleCurrentDirectoryFavorite(state.instanceId);
            }}
          >
            {favoriteActive ? <StarOff size={14} /> : <Star size={14} />}
          </button>
          <button
            className="lyra-file-manager-tool-button"
            aria-label={labels.newFolder}
            disabled={state.viewKind !== "directory"}
            onClick={() => {
              model.beginCreateDraft(state.instanceId, "directory");
            }}
          >
            <FolderPlus size={14} />
          </button>
          <button
            className="lyra-file-manager-tool-button"
            aria-label={labels.newFile}
            disabled={state.viewKind !== "directory"}
            onClick={() => {
              model.beginCreateDraft(state.instanceId, "file");
            }}
          >
            <FilePlus2 size={14} />
          </button>
          <button
            className="lyra-file-manager-tool-button"
            aria-label={labels.delete}
            disabled={state.viewKind !== "directory" || state.selectedEntryId === undefined}
            onClick={() => {
              void model.moveSelectionToTrash(state.instanceId);
            }}
          >
            <Trash2 size={14} />
          </button>
          <button
            className="lyra-file-manager-tool-button"
            aria-label={labels.restore}
            disabled={state.viewKind !== "trash" || state.selectedTrashEntryId === undefined}
            onClick={() => {
              void model.restoreSelectionFromTrash(state.instanceId);
            }}
          >
            <RotateCcw size={14} />
          </button>
          <button
            className="lyra-file-manager-tool-button lyra-file-manager-tool-button-danger"
            aria-label={labels.emptyTrash}
            disabled={state.viewKind !== "trash"}
            onClick={() => {
              void model.emptyTrash(state.instanceId);
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </header>

      <section className="lyra-file-manager-layout">
        <aside className="lyra-file-manager-nav" aria-label="file-manager-nav">
          <div className="lyra-file-manager-nav-group">
            <span className="lyra-file-manager-nav-label">{labels.homeSectionFavorites}</span>
            {state.favorites.map((favorite) => (
              <button
                key={favorite.id}
                className={
                  isActiveFavorite(state, favorite)
                    ? "lyra-file-manager-nav-item lyra-file-manager-nav-item-active"
                    : "lyra-file-manager-nav-item"
                }
                onClick={() => {
                  void model.openDirectory(state.instanceId, favorite.path);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  model.openFavoriteContextMenu(
                    state.instanceId,
                    favorite,
                    event.clientX,
                    event.clientY
                  );
                }}
              >
                {renderFileManagerLocationIcon(favorite)}
                <span>{favorite.title}</span>
              </button>
            ))}
          </div>

          <div className="lyra-file-manager-nav-group">
            <span className="lyra-file-manager-nav-label">{labels.homeSectionLocations}</span>
            <button
              className={state.viewKind === "home" ? "lyra-file-manager-nav-item lyra-file-manager-nav-item-active" : "lyra-file-manager-nav-item"}
              onClick={() => {
                void model.openHome(state.instanceId);
              }}
            >
              {renderFileManagerAppIcon("file-manager-home")}
              <span>{labels.title}</span>
            </button>
            {state.systemLocations.map((location) => (
              <button
                key={location.id}
                className={
                  isActiveLocation(state, location)
                    ? "lyra-file-manager-nav-item lyra-file-manager-nav-item-active"
                    : "lyra-file-manager-nav-item"
                }
                onClick={() => {
                  if (location.specialId === "trash") {
                    void model.openTrash(state.instanceId);
                    return;
                  }
                  if (location.path !== undefined) {
                    void model.openDirectory(state.instanceId, location.path);
                  }
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  model.openLocationContextMenu(
                    state.instanceId,
                    location,
                    event.clientX,
                    event.clientY
                  );
                }}
              >
                {renderFileManagerLocationIcon(location)}
                <span>{location.title}</span>
              </button>
            ))}
          </div>
        </aside>

        <section
          className="lyra-file-manager-content"
          onContextMenu={(event) => {
            if (state.viewKind === "directory") {
              event.preventDefault();
              model.openDirectoryContextMenu(state.instanceId, event.clientX, event.clientY);
              return;
            }
            if (state.viewKind === "trash") {
              event.preventDefault();
              model.openTrashContextMenu(state.instanceId, event.clientX, event.clientY);
            }
          }}
        >
          {showLoadingSkeleton ? (
            <FileManagerLoadingSkeleton
              viewKind={state.viewKind}
              presentationMode={state.presentationMode}
              metrics={loadingSkeletonMetrics}
            />
          ) : null}

          {state.status === "error" ? (
            <div className="lyra-file-manager-empty-state lyra-file-manager-empty-state-error">
              {state.errorMessage ?? labels.unavailable}
            </div>
          ) : null}

          {canRenderBodyContent && state.viewKind === "home" ? (
            <div className="lyra-file-manager-home">
              <HomeSection title={labels.homeSectionFavorites} section="favorites">
                {state.favorites.map((favorite) => (
                  <button
                    key={favorite.id}
                    className="lyra-file-manager-home-card"
                    onClick={() => {
                      void model.openDirectory(state.instanceId, favorite.path);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      model.openFavoriteContextMenu(
                        state.instanceId,
                        favorite,
                        event.clientX,
                        event.clientY
                      );
                    }}
                  >
                    {renderFileManagerLocationIcon(favorite)}
                    <strong>{favorite.title}</strong>
                    <small>{favorite.path}</small>
                  </button>
                ))}
              </HomeSection>

              <HomeSection title={labels.homeSectionLocations} section="locations">
                {state.systemLocations.map((location) => (
                  <button
                    key={location.id}
                    className="lyra-file-manager-home-card"
                    onClick={() => {
                      if (location.specialId === "trash") {
                        void model.openTrash(state.instanceId);
                        return;
                      }
                      if (location.path !== undefined) {
                        void model.openDirectory(state.instanceId, location.path);
                      }
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      model.openLocationContextMenu(
                        state.instanceId,
                        location,
                        event.clientX,
                        event.clientY
                      );
                    }}
                  >
                    {renderFileManagerLocationIcon(location)}
                    <strong>{location.title}</strong>
                    <small>{location.path ?? location.kind}</small>
                  </button>
                ))}
              </HomeSection>

              <HomeSection title={labels.homeSectionDevices} section="devices">
                {state.disks.map((disk) => (
                  <button
                    key={disk.id}
                    className="lyra-file-manager-home-card lyra-file-manager-disk-card"
                    onClick={() => {
                      void model.openDirectory(state.instanceId, disk.mountPath);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      model.openDiskContextMenu(
                        state.instanceId,
                        disk,
                        event.clientX,
                        event.clientY
                      );
                    }}
                  >
                    <div className="lyra-file-manager-disk-summary">
                      <div className="lyra-file-manager-disk-summary-icon">
                        {renderFileManagerDiskIcon(disk)}
                      </div>
                      <div className="lyra-file-manager-disk-summary-body">
                        <strong>{disk.title}</strong>
                        <small className="lyra-file-manager-disk-path">{disk.mountPath}</small>
                      </div>
                    </div>
                    <div className="lyra-file-manager-disk-meter" aria-hidden="true">
                      <div
                        className={`lyra-file-manager-disk-meter-fill lyra-file-manager-disk-meter-fill-${getDiskUsageTone(disk.usageRatio)}`}
                        style={{
                          width: `${Math.max(0, Math.min(100, Math.round(disk.usageRatio * 100)))}%`
                        }}
                      />
                    </div>
                    <div className="lyra-file-manager-disk-meta">
                      <span>{formatDiskUsage(disk)}</span>
                      <span>
                        {labels.diskAvailable} {formatDiskBytes(disk.availableBytes)}
                      </span>
                    </div>
                    <div className="lyra-file-manager-disk-footer">
                      <span className={`lyra-file-manager-disk-kind lyra-file-manager-disk-kind-${disk.kind}`}>
                        {resolveDiskKindLabel(disk.kind, labels)}
                      </span>
                    </div>
                  </button>
                ))}

                {state.devices.map((device) => {
                  const totalBytes = formatOptionalDiskBytes(device.totalBytes);

                  return (
                    <div
                      key={device.id}
                      className="lyra-file-manager-home-card lyra-file-manager-disk-card lyra-file-manager-device-card"
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (device.canMount === false && device.canEject === false) {
                          return;
                        }
                        model.openDeviceContextMenu(
                          state.instanceId,
                          device,
                          event.clientX,
                          event.clientY
                        );
                      }}
                    >
                      <div className="lyra-file-manager-disk-summary">
                        <div className="lyra-file-manager-disk-summary-icon">
                          {renderFileManagerDiskIcon(device)}
                        </div>
                        <div className="lyra-file-manager-disk-summary-body">
                          <strong>{device.title}</strong>
                          <small className="lyra-file-manager-disk-path">
                            {device.displayPath ?? device.devicePath}
                          </small>
                        </div>
                      </div>
                      <div className="lyra-file-manager-disk-meta">
                        <span>{labels.deviceUnmounted}</span>
                        {totalBytes === null ? null : <span>{totalBytes}</span>}
                      </div>
                      <div className="lyra-file-manager-disk-footer">
                        <span className={`lyra-file-manager-disk-kind lyra-file-manager-disk-kind-${device.kind}`}>
                          {resolveDiskKindLabel(device.kind, labels)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </HomeSection>

              <HomeSection title={labels.homeSectionRecent} section="recent">
                {state.recentLocations.length === 0 ? (
                  <div className="lyra-file-manager-home-empty">{labels.noRecentLocations}</div>
                ) : state.recentLocations.map((recent) => (
                  <button
                    key={recent.id}
                    className="lyra-file-manager-home-card"
                    onClick={() => {
                      void model.openDirectory(state.instanceId, recent.path);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      model.openRecentLocationContextMenu(
                        state.instanceId,
                        recent,
                        event.clientX,
                        event.clientY
                      );
                    }}
                  >
                    {renderFileManagerLocationIcon({ id: recent.id, title: recent.title, kind: "directory", path: recent.path })}
                    <strong>{recent.title}</strong>
                    <small>{recent.path}</small>
                  </button>
                ))}
              </HomeSection>
            </div>
          ) : null}

          {canRenderBodyContent && state.viewKind === "directory" ? (
            <div className="lyra-file-manager-list-shell">
              {!isLargeMode ? (
                <>
                  <div className="lyra-file-manager-list-grid">
                    {state.createDraft !== undefined ? (
                      <div className="lyra-file-manager-list-row lyra-file-manager-list-row-draft">
                        <div className="lyra-file-manager-list-cell-primary lyra-file-manager-list-cell-primary-draft">
                          {state.createDraft.kind === "directory"
                            ? renderFileManagerLocationIcon({ id: "draft", title: "", kind: "directory", path: "" })
                            : renderFileManagerEntryIcon({ id: "draft", name: "", path: "", kind: "file", isHidden: false })}
                          <input
                            className="lyra-file-manager-create-input"
                            value={state.createDraft.value}
                            placeholder={
                              state.createDraft.kind === "directory"
                                ? labels.createPlaceholderDirectory
                                : labels.createPlaceholderFile
                            }
                            autoFocus
                            onChange={(event) => {
                              model.updateCreateDraft(state.instanceId, event.target.value);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void model.commitCreateDraft(state.instanceId);
                              }
                              if (event.key === "Escape") {
                                event.preventDefault();
                                model.cancelCreateDraft(state.instanceId);
                              }
                            }}
                          />
                          <div className="lyra-file-manager-create-actions">
                            <button
                              className="lyra-file-manager-create-button"
                              aria-label={labels.createConfirm}
                              onClick={() => {
                                void model.commitCreateDraft(state.instanceId);
                              }}
                            >
                              <Check size={14} />
                            </button>
                            <button
                              className="lyra-file-manager-create-button"
                              aria-label={labels.createCancel}
                              onClick={() => {
                                model.cancelCreateDraft(state.instanceId);
                              }}
                            >
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {state.entries.length === 0 ? (
                      <div className="lyra-file-manager-empty-state lyra-file-manager-empty-state-span">
                        {labels.emptyDirectory}
                      </div>
                    ) : state.entries.map((entry) => (
                      <button
                        key={entry.id}
                        className={
                          entry.id === state.selectedEntryId
                            ? "lyra-file-manager-list-row lyra-file-manager-list-row-active"
                            : "lyra-file-manager-list-row"
                        }
                        data-lyra-allow-web-drag="true"
                        draggable
                        onClick={() => {
                          model.selectEntry(state.instanceId, entry.id);
                        }}
                        onDoubleClick={() => {
                          if (entry.kind === "directory") {
                            void model.openDirectory(state.instanceId, entry.path);
                            return;
                          }
                          onOpenFile(entry.path);
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          model.openEntryContextMenu(state.instanceId, entry.id, event.clientX, event.clientY);
                        }}
                        onDragStart={(event) => {
                          onDirectoryEntryDragStart(event, entry);
                        }}
                        onDragEnd={onEntryDragEnd}
                      >
                      <div className="lyra-file-manager-list-cell-primary">
                        {renderFileManagerEntryIcon(entry)}
                        <OverflowMarqueeText
                          text={entry.name}
                          active={entry.id === state.selectedEntryId}
                          className="lyra-file-manager-list-name"
                        />
                      </div>
                    </button>
                  ))}
                  </div>
                </>
              ) : (
                <div className="lyra-file-manager-large-grid">
                  {state.createDraft !== undefined ? (
                    <div className="lyra-file-manager-large-tile lyra-file-manager-large-tile-draft">
                      <div className="lyra-file-manager-large-tile-preview">
                        {state.createDraft.kind === "directory"
                          ? renderFileManagerLocationIcon({ id: "draft", title: "", kind: "directory", path: "" })
                          : renderFileManagerEntryIcon({ id: "draft", name: "", path: "", kind: "file", isHidden: false })}
                      </div>
                      <div className="lyra-file-manager-large-tile-body">
                        <input
                          className="lyra-file-manager-create-input"
                          value={state.createDraft.value}
                          placeholder={
                            state.createDraft.kind === "directory"
                              ? labels.createPlaceholderDirectory
                              : labels.createPlaceholderFile
                          }
                          autoFocus
                          onChange={(event) => {
                            model.updateCreateDraft(state.instanceId, event.target.value);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void model.commitCreateDraft(state.instanceId);
                            }
                            if (event.key === "Escape") {
                              event.preventDefault();
                              model.cancelCreateDraft(state.instanceId);
                            }
                          }}
                        />
                        <div className="lyra-file-manager-create-actions">
                          <button
                            className="lyra-file-manager-create-button"
                            aria-label={labels.createConfirm}
                            onClick={() => {
                              void model.commitCreateDraft(state.instanceId);
                            }}
                          >
                            <Check size={14} />
                          </button>
                          <button
                            className="lyra-file-manager-create-button"
                            aria-label={labels.createCancel}
                            onClick={() => {
                              model.cancelCreateDraft(state.instanceId);
                            }}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {state.entries.length === 0 ? (
                    <div className="lyra-file-manager-empty-state">{labels.emptyDirectory}</div>
                  ) : state.entries.map((entry) => (
                    <FileManagerLargeEntryTile
                      key={entry.id}
                      entry={entry}
                      isActive={entry.id === state.selectedEntryId}
                      onSelect={() => {
                        model.selectEntry(state.instanceId, entry.id);
                      }}
                      onOpen={() => {
                        if (entry.kind === "directory") {
                          void model.openDirectory(state.instanceId, entry.path);
                          return;
                        }
                        onOpenFile(entry.path);
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        model.openEntryContextMenu(state.instanceId, entry.id, event.clientX, event.clientY);
                      }}
                      onDragStart={(event) => {
                        onDirectoryEntryDragStart(event, entry);
                      }}
                      onDragEnd={onEntryDragEnd}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {canRenderBodyContent && state.viewKind === "trash" ? (
            <div className="lyra-file-manager-list-shell">
              {!isLargeMode ? (
                <>
                  <div className="lyra-file-manager-list-grid">
                    {state.trashEntries.length === 0 ? (
                      <div className="lyra-file-manager-empty-state lyra-file-manager-empty-state-span">
                        {labels.emptyTrashState}
                      </div>
                    ) : state.trashEntries.map((entry) => (
                      <button
                        key={entry.id}
                        className={
                          entry.id === state.selectedTrashEntryId
                            ? "lyra-file-manager-list-row lyra-file-manager-list-row-active"
                            : "lyra-file-manager-list-row"
                        }
                        data-lyra-allow-web-drag="true"
                        draggable
                        onClick={() => {
                          model.selectTrashEntry(state.instanceId, entry.id);
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          model.openTrashEntryContextMenu(state.instanceId, entry.id, event.clientX, event.clientY);
                        }}
                        onDragStart={(event) => {
                          onTrashEntryDragStart(event, entry);
                        }}
                        onDragEnd={onEntryDragEnd}
                      >
                      <div className="lyra-file-manager-list-cell-primary">
                        {renderFileManagerEntryIcon(entry)}
                        <OverflowMarqueeText
                          text={entry.name}
                          active={entry.id === state.selectedTrashEntryId}
                          className="lyra-file-manager-list-name"
                        />
                      </div>
                    </button>
                  ))}
                  </div>
                </>
              ) : (
                <div className="lyra-file-manager-large-grid">
                  {state.trashEntries.length === 0 ? (
                    <div className="lyra-file-manager-empty-state">{labels.emptyTrashState}</div>
                  ) : state.trashEntries.map((entry) => (
                    <FileManagerLargeTrashTile
                      key={entry.id}
                      entry={entry}
                      isActive={entry.id === state.selectedTrashEntryId}
                      onSelect={() => {
                        model.selectTrashEntry(state.instanceId, entry.id);
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        model.openTrashEntryContextMenu(state.instanceId, entry.id, event.clientX, event.clientY);
                      }}
                      onDragStart={(event) => {
                        onTrashEntryDragStart(event, entry);
                      }}
                      onDragEnd={onEntryDragEnd}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </section>
      </section>
    </section>
  );
};
