import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import {
  AppWindow,
  Camera,
  Download,
  File,
  FolderOpen,
  Globe,
  HardDrive,
  History,
  House,
  Image,
  ListChecks,
  MessageSquare,
  Monitor,
  Sheet,
  Star,
  Trash2
} from "@lyra/icons";

import {
  FirstPartyNestedAppSlot,
  LyraAppState,
  type FirstPartySurfaceProps
} from "@lyra/first-party-app-kit";

import { resolveMessages } from "./l10n/resolve";
import { isRecord, parseFilesModuleState } from "./parse";
import type {
  FileLocation,
  FilesMessages,
  FilesModuleState,
  HostInfo
} from "./types";

export const COMMANDS = {
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

export const EVENTS = {
  changed: "lyra.core.files-changed"
} as const;

/** Nested slot ids may only use [a-z0-9] plus `.` / `-`. Colons fail Core's ID_PATTERN. */
export const DOWNLOADS_SLOT_ID = "downloads";

const NAV_ROW_CLASS =
  "lyra-app-sidebar-nav-item lyra-app-sidebar-row lyra-file-manager-nav-item";

const formatBytes = (bytes: number | undefined): string => {
  if (bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const usageTone = (ratio: number): "low" | "medium" | "high" => {
  if (ratio >= 0.9) return "high";
  if (ratio >= 0.7) return "medium";
  return "low";
};

const IconShell = ({ children }: { readonly children?: ReactNode }): ReactNode => (
  <span className="lyra-file-manager-icon-shell" aria-hidden="true">{children}</span>
);

const ObjectRow = ({
  title,
  description,
  meta,
  icon,
  active,
  className,
  onClick,
  onDoubleClick
}: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly meta?: ReactNode;
  readonly icon?: ReactNode;
  readonly active?: boolean;
  readonly className?: string;
  readonly onClick?: () => void;
  readonly onDoubleClick?: () => void;
}): ReactNode => (
  <button
    type="button"
    className={`lyra-app-object-row ${className ?? ""}`}
    data-has-icon={icon === undefined ? undefined : "true"}
    data-active={active === true ? "true" : undefined}
    onClick={onClick}
    onDoubleClick={onDoubleClick}
  >{icon === undefined ? null : <span className="lyra-app-object-row-icon">{icon}</span>}<span className="lyra-app-object-row-main"><span className="lyra-app-object-row-head"><span className="lyra-app-object-row-title">{title}</span>{meta === undefined ? null : <span className="lyra-app-object-row-meta">{meta}</span>}</span>{description === undefined ? null : <span className="lyra-app-object-row-description">{description}</span>}</span></button>
);

const locationIcon = (location: Pick<FileLocation, "kind" | "specialId">): ReactNode => {
  const key = location.specialId ?? location.kind;
  const node =
    key === "home" ? <House size={14} />
    : key === "desktop" ? <Monitor size={14} />
    : key === "documents" ? <Sheet size={14} />
    : key === "downloads" ? <Download size={14} />
    : key === "pictures" ? <Image size={14} />
    : key === "videos" ? <Camera size={14} />
    : key === "downloadManager" ? <ListChecks size={14} />
    : key === "trash" ? <Trash2 size={14} />
    : key === "favorites" ? <Star size={14} />
    : <FolderOpen size={14} />;
  return <IconShell>{node}</IconShell>;
};

const DiskMeter = ({
  ratio,
  label,
  available,
  availableLabel
}: {
  readonly ratio: number;
  readonly label: string;
  readonly available: string;
  readonly availableLabel: string;
}): ReactNode => {
  const percent = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  return (
    <span className="lyra-file-manager-disk-description">
      <span className="lyra-file-manager-disk-meter" aria-hidden="true">
        <span
          className={`lyra-file-manager-disk-meter-fill lyra-file-manager-disk-meter-fill-${usageTone(ratio)}`}
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className="lyra-file-manager-disk-meta">
        <span>{label}</span>
        <span>{availableLabel} {available}</span>
      </span>
    </span>
  );
};

const HostCard = ({
  host,
  labels
}: {
  readonly host: HostInfo;
  readonly labels: FilesMessages;
}): ReactNode => {
  const total = Math.max(0, host.memoryTotalBytes);
  const used = Math.max(0, Math.min(total, host.memoryUsedBytes));
  const ratio = total > 0 ? used / total : 0;
  const hostOs = [host.osName, host.architecture].filter((value) => value.length > 0).join(" · ");
  return (
    <article className="lyra-file-manager-host-card">
      <div className="lyra-file-manager-host-identity">
        <IconShell><AppWindow size={20} /></IconShell>
        <div className="lyra-file-manager-host-copy">
          <h2 className="lyra-file-manager-host-name">{host.name}</h2>
          {hostOs.length === 0 ? null : <p className="lyra-file-manager-host-os">{hostOs}</p>}
        </div>
      </div>
      <dl className="lyra-file-manager-host-facts">
        {host.cpuBrand.length === 0 ? null : (
          <div className="lyra-file-manager-host-fact">
            <dt>{labels.hostProcessor}</dt>
            <dd>{host.cpuBrand}</dd>
          </div>
        )}
        <div className="lyra-file-manager-host-fact">
          <dt>{labels.hostMemory}</dt>
          <dd>
            <DiskMeter
              ratio={ratio}
              label={`${formatBytes(used)} / ${formatBytes(total)}`}
              available={formatBytes(Math.max(0, total - used))}
              availableLabel={labels.diskAvailable}
            />
          </dd>
        </div>
      </dl>
    </article>
  );
};

const HomeBody = ({
  state,
  labels,
  onOpenLocation
}: {
  readonly state: FilesModuleState;
  readonly labels: FilesMessages;
  readonly onOpenLocation: (location: FileLocation) => void;
}): ReactNode => {
  const hasDevices = state.disks.length > 0 || state.devices.length > 0;
  return (
    <div className="lyra-app-content-column lyra-file-manager-home">
      {state.hostInfo === undefined ? null : (
        <HostCard host={state.hostInfo} labels={labels} />
      )}
      {hasDevices === false ? null : (
        <section className="lyra-app-section lyra-file-manager-home-section">
          <header className="lyra-app-section-title lyra-file-manager-home-section-header">
            <IconShell><HardDrive size={14} /></IconShell>
            <h3>{labels.disks}</h3>
          </header>
          <div className="lyra-app-group lyra-app-row-list lyra-file-manager-home-grid">
            {state.disks.map((disk) => (
              <ObjectRow
                key={disk.id}
                className="lyra-file-manager-home-card lyra-file-manager-disk-card"
                icon={<IconShell><HardDrive size={20} /></IconShell>}
                title={disk.title}
                description={(
                  <>
                    <span className="lyra-file-manager-disk-path">{disk.mountPath}</span>
                    <DiskMeter
                      ratio={disk.usageRatio}
                      label={`${formatBytes(disk.usedBytes)} / ${formatBytes(disk.totalBytes)}`}
                      available={formatBytes(disk.availableBytes)}
                      availableLabel={labels.diskAvailable}
                    />
                  </>
                )}
                onClick={() => onOpenLocation({
                  id: disk.id,
                  title: disk.title,
                  kind: "directory",
                  path: disk.mountPath
                })}
              />
            ))}
            {state.devices.map((device) => (
              <ObjectRow
                key={device.id}
                className="lyra-file-manager-home-card lyra-file-manager-disk-card lyra-file-manager-device-card"
                icon={<IconShell><HardDrive size={20} /></IconShell>}
                title={device.title}
                description={device.devicePath}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

const FavoritesBody = ({
  state,
  labels,
  onOpenFavorite
}: {
  readonly state: FilesModuleState;
  readonly labels: FilesMessages;
  readonly onOpenFavorite: (favoriteId: string) => void;
}): ReactNode => (
  <div className="lyra-app-content-column lyra-file-manager-favorites-page">
    <header className="lyra-app-section-title lyra-file-manager-favorites-header">
      <IconShell><Star size={14} /></IconShell>
      <h3>{labels.favorites}</h3>
    </header>
    {state.favorites.length === 0
      ? <p className="lyra-file-manager-empty-state">{labels.noItems}</p>
      : (
        <div className="lyra-app-group lyra-app-row-list lyra-file-manager-favorites-list">
          {state.favorites.map((favorite) => (
            <ObjectRow
              key={favorite.id}
              className="lyra-file-manager-favorite-row"
              icon={favorite.kind === "web"
                ? <IconShell><Globe size={14} /></IconShell>
                : favorite.kind === "agent-session"
                  ? <IconShell><MessageSquare size={14} /></IconShell>
                  : locationIcon({ kind: "directory" })}
              title={favorite.title}
              description={favorite.kind === "web"
                ? favorite.url ?? favorite.path
                : favorite.kind === "agent-session"
                  ? favorite.workingDir ?? favorite.sessionId ?? favorite.path
                  : favorite.path}
              onClick={() => onOpenFavorite(favorite.id)}
            />
          ))}
        </div>
      )}
  </div>
);

const sidebarLocations = (state: FilesModuleState | null): readonly FileLocation[] =>
  (state?.systemLocations ?? []).filter((location) =>
    location.specialId !== "downloadManager"
    && location.specialId !== "home"
    && location.specialId !== "trash"
    && location.kind !== "home"
    && location.kind !== "trash"
  );

export const FilesEmbeddedChrome = ({
  labels,
  state,
  instanceId,
  error,
  createKind,
  createName,
  destructiveAction,
  currentFavorite,
  showingFavorites = false,
  onOpenHome,
  onOpenDownloads,
  onOpenTrash,
  onOpenFavorite,
  onOpenFavorites,
  onOpenLocation,
  onNavigate,
  onSetPresentation,
  onToggleFavorite,
  onBeginCreate,
  onCreateNameChange,
  onCreate,
  onCancelCreate,
  onSelectEntry,
  onOpenEntry,
  onSelectTrashEntry,
  onBeginDestructive,
  onCancelDestructive,
  onConfirmDestructive,
  onRestore
}: {
  readonly labels: FilesMessages;
  readonly state: FilesModuleState | null;
  readonly instanceId: string;
  readonly error: string | null;
  readonly createKind: "file" | "directory" | null;
  readonly createName: string;
  readonly destructiveAction: "move-to-trash" | "empty-trash" | null;
  readonly currentFavorite: boolean;
  readonly showingFavorites?: boolean;
  readonly onOpenHome: () => void;
  readonly onOpenDownloads: () => void;
  readonly onOpenTrash: () => void;
  readonly onOpenFavorite: (favoriteId: string) => void;
  readonly onOpenFavorites?: () => void;
  readonly onOpenLocation: (location: FileLocation) => void;
  readonly onNavigate: (direction: "back" | "forward" | "up" | "refresh") => void;
  readonly onSetPresentation: (mode: "list" | "large") => void;
  readonly onToggleFavorite: () => void;
  readonly onBeginCreate: (kind: "file" | "directory") => void;
  readonly onCreateNameChange: (value: string) => void;
  readonly onCreate: () => void;
  readonly onCancelCreate: () => void;
  readonly onSelectEntry: (entryId: string) => void;
  readonly onOpenEntry: (kind: "file" | "directory", path: string) => void;
  readonly onSelectTrashEntry: (entryId: string) => void;
  readonly onBeginDestructive: (action: "move-to-trash" | "empty-trash") => void;
  readonly onCancelDestructive: () => void;
  readonly onConfirmDestructive: () => void;
  readonly onRestore: () => void;
}): ReactNode => {
  const canGoBack = (state?.historyIndex ?? -1) > 0;
  const canGoForward = state !== null && state.historyIndex < state.historyLength - 1;
  const large = state?.presentationMode === "large";
  const viewKind = showingFavorites ? "favorites" : state?.viewKind;
  const homeActive = viewKind === "home";
  const favoritesActive = viewKind === "favorites"
    || (state?.favorites.some((item) => item.path === state.currentLocation?.path) ?? false);
  const downloadsActive = viewKind === "downloads";
  const trashActive = viewKind === "trash";
  const breadcrumb = viewKind === "favorites" ? labels.favorites
    : viewKind === "downloads" ? labels.downloads
    : viewKind === "trash" ? labels.trash
    : viewKind === "directory" ? (state?.currentLocation?.title ?? state?.title ?? "")
    : "";

  const renderBody = (): ReactNode => {
    if (error !== null) {
      return (
        <LyraAppState kind="error" title={error} actionLabel={labels.retry} onAction={() => onNavigate("refresh")} />
      );
    }
    if (state === null || state.status === "loading" || state.status === "idle") {
      return <LyraAppState kind="loading" title={labels.loading} />;
    }
    if (state.status === "error") {
      return (
        <LyraAppState
          kind="error"
          title={state.errorMessage ?? labels.noItems}
          actionLabel={labels.retry}
          onAction={() => onNavigate("refresh")}
        />
      );
    }
    if (showingFavorites) {
      return FavoritesBody({ state, labels, onOpenFavorite });
    }
    if (state.viewKind === "home") {
      return HomeBody({
        state,
        labels,
        onOpenLocation
      });
    }
    if (state.viewKind === "trash") {
      return (
        <div className="lyra-app-content-column lyra-app-content-column-wide lyra-file-manager-list-shell">
          <div className="lyra-app-group lyra-file-manager-list-grid">
            {state.trashEntries.length === 0
              ? <p className="lyra-file-manager-empty-state">{labels.noItems}</p>
              : state.trashEntries.map((entry) => (
                <ObjectRow
                  key={entry.id}
                  className="lyra-file-manager-list-row"
                  active={entry.id === state.selectedTrashEntryId}
                  icon={<IconShell>{entry.kind === "directory" ? <FolderOpen size={14} /> : <File size={14} />}</IconShell>}
                  title={entry.name}
                  description={entry.originalPath ?? ""}
                  meta={formatBytes(entry.sizeBytes)}
                  onClick={() => onSelectTrashEntry(entry.id)}
                />
              ))}
          </div>
        </div>
      );
    }
    if (state.viewKind === "downloads") {
      return (
        <FirstPartyNestedAppSlot
          slotId={DOWNLOADS_SLOT_ID}
          className="lyra-file-manager-downloads-slot"
          style={{ height: "100%" }}
          child={{
            appId: "downloads",
            instanceId: `downloads:${instanceId}`,
            route: "/"
          }}
        />
      );
    }
    return (
      <div className="lyra-app-content-column lyra-app-content-column-wide lyra-file-manager-list-shell">
        <div className={large ? "lyra-app-group lyra-file-manager-large-grid" : "lyra-app-group lyra-file-manager-list-grid"}>
          {state.entries.length === 0
            ? <p className="lyra-file-manager-empty-state">{labels.noItems}</p>
            : state.entries.map((entry) => (
              <ObjectRow
                key={entry.id}
                className={large ? "lyra-file-manager-home-card" : "lyra-file-manager-list-row"}
                active={entry.id === state.selectedEntryId}
                icon={<IconShell>{entry.kind === "directory" ? <FolderOpen size={14} /> : <File size={14} />}</IconShell>}
                title={entry.name}
                description={entry.modifiedAt === undefined
                  ? formatBytes(entry.sizeBytes)
                  : `${formatBytes(entry.sizeBytes)} · ${new Date(entry.modifiedAt).toLocaleString()}`}
                onClick={() => onSelectEntry(entry.id)}
                onDoubleClick={() => onOpenEntry(entry.kind, entry.path)}
              />
            ))}
        </div>
      </div>
    );
  };

  return (
    <section
      className="lyra-file-manager-surface"
      data-lyra-component="lyra.files"
      aria-label="file-manager-surface"
    >
      <section className="lyra-app-sidebar-split lyra-file-manager-layout">
        <aside className="lyra-app-sidebar-nav lyra-file-manager-nav" aria-label="file-manager-nav">
          <div className="lyra-app-sidebar-nav-list lyra-file-manager-nav-group">
            <ObjectRow
              className={NAV_ROW_CLASS}
              active={homeActive}
              icon={<IconShell><AppWindow size={14} /></IconShell>}
              title={labels.home}
              onClick={onOpenHome}
            />
            <ObjectRow
              className={NAV_ROW_CLASS}
              active={favoritesActive && viewKind === "favorites"}
              icon={<IconShell><Star size={14} /></IconShell>}
              title={labels.favorites}
              onClick={() => onOpenFavorites?.()}
            />
            {state?.favorites.map((favorite) => (
              <ObjectRow
                key={favorite.id}
                className={NAV_ROW_CLASS}
                active={!showingFavorites && favorite.path === state.currentLocation?.path}
                icon={favorite.kind === "web"
                  ? <IconShell><Globe size={14} /></IconShell>
                  : favorite.kind === "agent-session"
                    ? <IconShell><MessageSquare size={14} /></IconShell>
                    : locationIcon({ kind: "directory" })}
                title={favorite.title}
                onClick={() => onOpenFavorite(favorite.id)}
              />
            ))}
            <ObjectRow
              className={NAV_ROW_CLASS}
              active={downloadsActive}
              icon={<IconShell><ListChecks size={14} /></IconShell>}
              title={labels.downloads}
              onClick={onOpenDownloads}
            />
            {sidebarLocations(state).map((location) => (
              <ObjectRow
                key={location.id}
                className={NAV_ROW_CLASS}
                active={!showingFavorites
                  && viewKind !== "downloads"
                  && (location.path !== undefined && location.path === state?.currentLocation?.path)}
                icon={locationIcon(location)}
                title={location.title}
                onClick={() => onOpenLocation(location)}
              />
            ))}
            {state?.recentLocations.map((recent) => (
              <ObjectRow
                key={recent.id}
                className={NAV_ROW_CLASS}
                active={!showingFavorites && recent.path === state.currentLocation?.path}
                icon={<IconShell><History size={14} /></IconShell>}
                title={recent.title}
                onClick={() => onOpenLocation({
                  id: recent.id,
                  title: recent.title,
                  kind: "directory",
                  path: recent.path
                })}
              />
            ))}
            <ObjectRow
              className={NAV_ROW_CLASS}
              active={trashActive}
              icon={<IconShell><Trash2 size={14} /></IconShell>}
              title={labels.trash}
              onClick={onOpenTrash}
            />
          </div>
        </aside>
        <div className="lyra-file-manager-pane">
          <header className="lyra-titlebar-context lyra-file-manager-embedded-toolbar">
            <div className="lyra-titlebar-context-group">
              <button type="button" className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" disabled={!canGoBack} onClick={() => onNavigate("back")}>{labels.back}</button>
              <button type="button" className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" disabled={!canGoForward} onClick={() => onNavigate("forward")}>{labels.forward}</button>
              <button type="button" className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" disabled={state?.parentPath === undefined} onClick={() => onNavigate("up")}>{labels.up}</button>
              <button type="button" className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" onClick={() => onNavigate("refresh")}>{labels.refresh}</button>
            </div>
            {breadcrumb.length === 0 ? null : (
              <div className="lyra-titlebar-context-group lyra-file-manager-titlebar-breadcrumbs">
                <span className="lyra-titlebar-context-text lyra-file-manager-titlebar-breadcrumb-current">
                  {breadcrumb}
                </span>
              </div>
            )}
            <div className="lyra-titlebar-context-group">
              {state?.viewKind === "directory" && showingFavorites === false ? (
                <>
                  <button type="button" className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" onClick={() => onSetPresentation(large ? "list" : "large")}>{large ? labels.list : labels.large}</button>
                  <button type="button" className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" onClick={onToggleFavorite}>{currentFavorite ? labels.removeFavorite : labels.addFavorite}</button>
                  <button type="button" className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" onClick={() => onBeginCreate("directory")}>{labels.newFolder}</button>
                  <button type="button" className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" onClick={() => onBeginCreate("file")}>{labels.newFile}</button>
                  <button type="button" className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" disabled={state.selectedEntryId === undefined} onClick={() => onBeginDestructive("move-to-trash")}>{labels.remove}</button>
                </>
              ) : null}
              {state?.viewKind === "trash" && showingFavorites === false ? (
                <>
                  <button type="button" className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" disabled={state.selectedTrashEntryId === undefined} onClick={onRestore}>{labels.restore}</button>
                  <button type="button" className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" disabled={state.trashEntries.length === 0} onClick={() => onBeginDestructive("empty-trash")}>{labels.emptyTrash}</button>
                </>
              ) : null}
            </div>
          </header>
          <section className="lyra-file-manager-content">
            <div
              className="lyra-file-manager-content-scroll"
              style={viewKind === "downloads" ? { overflow: "hidden" } : undefined}
            >
              {renderBody()}
            </div>
          </section>
        </div>
      </section>
      {createKind === null ? null : (
        <form
          className="lyra-app-module-dialog"
          onSubmit={(event) => {
            event.preventDefault();
            onCreate();
          }}
          style={{
            position: "absolute",
            inset: "50% auto auto 50%",
            transform: "translate(-50%, -50%)",
            width: "auto",
            display: "flex",
            gap: 8
          }}
        >
          <input
            className="lyra-ui-input"
            autoFocus
            aria-label={labels.createName}
            value={createName}
            onChange={(event) => onCreateNameChange(event.target.value)}
            style={{ minWidth: 220, width: "auto" }}
          />
          <button className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" type="submit" disabled={createName.trim().length === 0}>{labels.create}</button>
          <button className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" type="button" onClick={onCancelCreate}>{labels.cancel}</button>
        </form>
      )}
      {destructiveAction === null ? null : (
        <div className="lyra-app-module-scrim" role="presentation">
          <div
            className="lyra-app-module-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-label={destructiveAction === "move-to-trash"
              ? labels.confirmMoveTitle
              : labels.confirmEmptyTitle}
          >
            <h2 style={{ margin: 0, fontSize: 16 }}>
              {destructiveAction === "move-to-trash"
                ? labels.confirmMoveTitle
                : labels.confirmEmptyTitle}
            </h2>
            <p className="lyra-app-module-muted" style={{ margin: "10px 0 16px" }}>
              {destructiveAction === "move-to-trash"
                ? labels.confirmMoveBody
                : labels.confirmEmptyBody}
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button autoFocus type="button" className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" onClick={onCancelDestructive}>
                {labels.cancel}
              </button>
              <button
                type="button"
                className="lyra-ui-button lyra-ui-button-destructive lyra-ui-button-size-sm"
                onClick={onConfirmDestructive}
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

export const FilesSurface = ({
  host,
  instanceId,
  presentation,
  updateOpaqueState
}: FirstPartySurfaceProps) => {
  const labels = useMemo(
    () => resolveMessages(presentation.locale),
    [presentation.locale]
  );
  const [state, setState] = useState<FilesModuleState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createKind, setCreateKind] = useState<"file" | "directory" | null>(null);
  const [createName, setCreateName] = useState("");
  const [destructiveAction, setDestructiveAction] = useState<
    "move-to-trash" | "empty-trash" | null
  >(null);
  const [showingFavorites, setShowingFavorites] = useState(false);

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
    try {
      const registration = host.subscribeEvent(EVENTS.changed, async (value) => {
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
      return () => registration.dispose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return undefined;
    }
  }, [host, instanceId, refresh]);

  useEffect(() => {
    setDestructiveAction(null);
    setShowingFavorites(false);
  }, [state?.viewKind]);

  const openLocation = useCallback((location: FileLocation) => {
    setShowingFavorites(false);
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

  const currentFavorite = Boolean(
    state?.currentLocation?.path !== undefined
    && state.favorites.some((item) => item.path === state.currentLocation?.path)
  );

  return (
    <FilesEmbeddedChrome
      labels={labels}
      state={state}
      instanceId={instanceId}
      error={error}
      createKind={createKind}
      createName={createName}
      destructiveAction={destructiveAction}
      currentFavorite={currentFavorite}
      showingFavorites={showingFavorites}
      onOpenHome={() => {
        setShowingFavorites(false);
        void run(COMMANDS.openHome);
      }}
      onOpenDownloads={() => {
        setShowingFavorites(false);
        void run(COMMANDS.openDownloads);
      }}
      onOpenTrash={() => {
        setShowingFavorites(false);
        void run(COMMANDS.openTrash);
      }}
      onOpenFavorite={(favoriteId) => {
        setShowingFavorites(false);
        void run(COMMANDS.openFavorite, { favoriteId });
      }}
      onOpenFavorites={() => setShowingFavorites(true)}
      onOpenLocation={openLocation}
      onNavigate={(direction) => void run(COMMANDS.navigate, { direction })}
      onSetPresentation={(mode) => void run(COMMANDS.setPresentation, { mode })}
      onToggleFavorite={() => void run(COMMANDS.toggleFavorite)}
      onBeginCreate={setCreateKind}
      onCreateNameChange={setCreateName}
      onCreate={() => {
        if (createKind === null || createName.trim().length === 0) return;
        void run(COMMANDS.createEntry, { kind: createKind, name: createName.trim() }).then(() => {
          setCreateKind(null);
          setCreateName("");
        });
      }}
      onCancelCreate={() => setCreateKind(null)}
      onSelectEntry={(entryId) => void run(COMMANDS.selectEntry, { entryId })}
      onOpenEntry={(kind, path) => {
        if (kind === "directory") {
          void run(COMMANDS.openDirectory, { path });
        } else {
          void host.executeCommand(COMMANDS.openResource, { path });
        }
      }}
      onSelectTrashEntry={(entryId) => void run(COMMANDS.selectTrashEntry, { entryId })}
      onBeginDestructive={setDestructiveAction}
      onCancelDestructive={() => setDestructiveAction(null)}
      onConfirmDestructive={() => {
        const command = destructiveAction === "move-to-trash"
          ? COMMANDS.moveSelectionToTrash
          : COMMANDS.emptyTrash;
        setDestructiveAction(null);
        void run(command);
      }}
      onRestore={() => void run(COMMANDS.restoreSelection)}
    />
  );
};
