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

  return (
    <section
      className={`lyra-file-manager-index-status lyra-file-manager-index-status-${tone}`}
      aria-label={labels.searchIndexTitle}
    >
      <div className="lyra-file-manager-index-status-header">
        <span className="lyra-file-manager-index-status-dot" aria-hidden="true" />
        <div className="lyra-file-manager-index-status-copy">
          <span className="lyra-file-manager-index-status-title">
            {labels.searchIndexTitle}
          </span>
          <strong>{stateLabel}</strong>
        </div>
      </div>
      {statsLabel === undefined ? null : (
        <span className="lyra-file-manager-index-status-line">{statsLabel}</span>
      )}
      {phaseLabel === undefined ? null : (
        <span className="lyra-file-manager-index-status-line">{phaseLabel}</span>
      )}
      {pendingLabel === undefined ? null : (
        <span className="lyra-file-manager-index-status-line">{pendingLabel}</span>
      )}
      {errorLabel === undefined ? null : (
        <span className="lyra-file-manager-index-status-error">{errorLabel}</span>
      )}
      <button
        type="button"
        className="lyra-file-manager-index-status-action"
        disabled={searchIndex.rebuilding}
        onClick={onRebuildSearchIndex}
      >
        {searchIndex.rebuilding ? labels.searchIndexRebuilding : labels.searchIndexRebuild}
      </button>
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

  return (
    <aside className="lyra-file-manager-nav" aria-label="file-manager-nav">
      <div className="lyra-file-manager-nav-group">
        <span className="lyra-file-manager-nav-label">{labels.homeSectionLocations}</span>
        <button
          className={renderModel.sidebar.homeActive ? "lyra-file-manager-nav-item lyra-file-manager-nav-item-active" : "lyra-file-manager-nav-item"}
          onClick={actions.onOpenHome}
        >
          {renderFileManagerAppIcon("file-manager-home")}
          <span>{labels.title}</span>
        </button>
        <button
          className={
            favoritesActive
              ? "lyra-file-manager-nav-item lyra-file-manager-nav-item-active"
              : "lyra-file-manager-nav-item"
          }
          onClick={actions.onOpenFavorites}
        >
          {renderFileManagerSectionIcon("favorites")}
          <span>{labels.homeSectionFavorites}</span>
        </button>
        <button
          className={
            renderModel.sidebar.downloadsActive
              ? "lyra-file-manager-nav-item lyra-file-manager-nav-item-active"
              : "lyra-file-manager-nav-item"
          }
          onClick={actions.onOpenDownloads}
        >
          {renderFileManagerSectionIcon("downloads")}
          <span>{labels.downloadManagerTitle}</span>
        </button>
        {renderModel.sidebar.locations.map(({ location, active }) => (
          <button
            key={location.id}
            className={
              active
                ? "lyra-file-manager-nav-item lyra-file-manager-nav-item-active"
                : "lyra-file-manager-nav-item"
            }
            onClick={() => {
              actions.onOpenLocation(location);
            }}
            onContextMenu={(event) => {
              preventContextMenuDefaults(event);
              actions.onLocationContextMenu(location, event.clientX, event.clientY);
            }}
          >
            {renderFileManagerLocationIcon(location)}
            <span>{location.title}</span>
          </button>
        ))}
      </div>
      <FileManagerSearchIndexStatus
        labels={labels}
        searchIndex={searchIndex}
        onRebuildSearchIndex={actions.onRebuildSearchIndex}
      />
    </aside>
  );
};
