import { RefreshCw } from "lucide-react";

import {
  AppIconButton,
  AppObjectRow,
  AppSidebar,
  AppSidebarSection
} from "@renderer/ui/components";
import {
  renderFileManagerAppIcon,
  renderFileManagerLocationIcon,
  renderFileManagerSectionIcon
} from "./icon-registry";
import { preventContextMenuDefaults } from "./surface-view-events";
import type { FileManagerSurfaceViewProps } from "./surface-view-types";
import type {
  FileManagerSearchIndexModel,
  FileManagerSurfaceLabels
} from "./types";

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KiB", "MiB", "GiB", "TiB"] as const;
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const fractionDigits = Number.isInteger(value) || value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`;
};

const replaceTokens = (
  template: string,
  values: Record<string, string>
): string =>
  Object.entries(values).reduce(
    (next, [key, value]) => next.replaceAll(`{${key}}`, value),
    template
  );

const resolveSearchIndexTone = (
  searchIndex: FileManagerSearchIndexModel
): "ready" | "building" | "failed" | "idle" | "unavailable" => {
  if (searchIndex.rebuilding) {
    return "building";
  }
  if (searchIndex.errorMessage !== undefined) {
    return "failed";
  }
  if (searchIndex.status === null) {
    return "unavailable";
  }
  if (searchIndex.status.phase === "policy_mismatch") {
    return "failed";
  }
  return searchIndex.status.state;
};

const resolveSearchIndexLabel = (
  searchIndex: FileManagerSearchIndexModel,
  labels: FileManagerSurfaceLabels
): string => {
  if (searchIndex.rebuilding) {
    return labels.searchIndexRebuilding;
  }
  if (searchIndex.errorMessage !== undefined) {
    return labels.searchIndexFailed;
  }
  if (searchIndex.status === null) {
    return labels.searchIndexUnavailable;
  }
  if (searchIndex.status.phase === "policy_mismatch") {
    return labels.searchIndexNeedsRebuild;
  }
  switch (searchIndex.status.state) {
    case "ready":
      return labels.searchIndexReady;
    case "building":
      return labels.searchIndexBuilding;
    case "failed":
      return labels.searchIndexFailed;
    case "idle":
      return labels.searchIndexIdle;
  }
};

const FileManagerSearchIndexStatus = ({
  labels,
  searchIndex,
  onRebuildSearchIndex
}: {
  readonly labels: FileManagerSurfaceLabels;
  readonly searchIndex: FileManagerSearchIndexModel;
  readonly onRebuildSearchIndex: () => void;
}) => {
  const status = searchIndex.status;
  const tone = resolveSearchIndexTone(searchIndex);
  const stateLabel = resolveSearchIndexLabel(searchIndex, labels);
  const statsLabel =
    status === null
      ? undefined
      : replaceTokens(labels.searchIndexStats, {
          files: status.indexedFiles.toLocaleString(),
          contentFiles: status.indexedContentFiles.toLocaleString(),
          storage: formatBytes(status.storageBytes)
        });
  const pendingLabel =
    status === null || status.pendingChanges === 0
      ? undefined
      : replaceTokens(labels.searchIndexPending, {
          count: status.pendingChanges.toLocaleString()
        });
  const phaseLabel =
    status === null
      ? undefined
      : replaceTokens(labels.searchIndexPhase, { phase: status.phase });
  const errorLabel = searchIndex.errorMessage ?? status?.error ?? status?.policyWarnings[0];
  const detailTitle = [
    statsLabel,
    phaseLabel,
    pendingLabel,
    errorLabel
  ].filter((item): item is string => item !== undefined).join(" · ");

  return (
    <section
      className={`lyra-app-sidebar-status lyra-file-manager-index-status lyra-file-manager-index-status-${tone}`}
      aria-label={labels.searchIndexTitle}
      title={detailTitle.length === 0 ? undefined : detailTitle}
    >
      <div className="lyra-file-manager-index-status-header">
        <span className="lyra-file-manager-index-status-dot" aria-hidden="true" />
        <div className="lyra-file-manager-index-status-copy">
          <span className="lyra-file-manager-index-status-title">
            {labels.searchIndexTitle}
          </span>
          <strong>{stateLabel}</strong>
        </div>
        <AppIconButton
          variant="ghost"
          tone="muted"
          className="lyra-file-manager-index-status-action"
          disabled={searchIndex.rebuilding}
          aria-label={searchIndex.rebuilding ? labels.searchIndexRebuilding : labels.searchIndexRebuild}
          title={searchIndex.rebuilding ? labels.searchIndexRebuilding : labels.searchIndexRebuild}
          onClick={onRebuildSearchIndex}
        >
          <RefreshCw size={14} aria-hidden="true" />
        </AppIconButton>
      </div>
      {statsLabel === undefined ? null : (
        <span className="lyra-file-manager-index-status-line">{statsLabel}</span>
      )}
      {errorLabel === undefined ? null : (
        <span className="lyra-file-manager-index-status-error">{errorLabel}</span>
      )}
    </section>
  );
};

export const FileManagerSidebar = ({
  renderModel,
  labels,
  actions,
  searchIndex
}: FileManagerSurfaceViewProps) => {
  const favoritesActive =
    renderModel.sidebar.favoritesActive
    || renderModel.sidebar.favorites.some((item) => item.active);
  const locationActive = renderModel.sidebar.locations.some((item) => item.active);
  const homeActive =
    renderModel.sidebar.homeActive
    && favoritesActive === false
    && renderModel.sidebar.downloadsActive === false
    && locationActive === false;

  return (
    <AppSidebar className="lyra-file-manager-nav" aria-label="file-manager-nav">
      <AppSidebarSection
        className="lyra-file-manager-nav-group"
        label={labels.homeSectionLocations}
      >
        <AppObjectRow
          className="lyra-app-sidebar-nav-item lyra-file-manager-nav-item"
          active={homeActive}
          onClick={actions.onOpenHome}
          icon={renderFileManagerAppIcon("file-manager-home")}
          title={labels.title}
        />
        <AppObjectRow
          className="lyra-app-sidebar-nav-item lyra-file-manager-nav-item"
          active={favoritesActive}
          onClick={actions.onOpenFavorites}
          icon={renderFileManagerSectionIcon("favorites")}
          title={labels.homeSectionFavorites}
        />
        <AppObjectRow
          className="lyra-app-sidebar-nav-item lyra-file-manager-nav-item"
          active={renderModel.sidebar.downloadsActive}
          onClick={actions.onOpenDownloads}
          icon={renderFileManagerSectionIcon("downloads")}
          title={labels.downloadManagerTitle}
        />
        {renderModel.sidebar.locations.map(({ location, active }) => (
          <AppObjectRow
            key={location.id}
            className="lyra-app-sidebar-nav-item lyra-file-manager-nav-item"
            active={active}
            onClick={() => {
              actions.onOpenLocation(location);
            }}
            onContextMenu={(event) => {
              preventContextMenuDefaults(event);
              actions.onLocationContextMenu(location, event.clientX, event.clientY);
            }}
            icon={renderFileManagerLocationIcon(location)}
            title={location.title}
          />
        ))}
      </AppSidebarSection>
      <FileManagerSearchIndexStatus
        labels={labels}
        searchIndex={searchIndex}
        onRebuildSearchIndex={actions.onRebuildSearchIndex}
      />
    </AppSidebar>
  );
};
