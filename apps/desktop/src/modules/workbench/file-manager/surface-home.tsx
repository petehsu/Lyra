import type { ReactNode } from "react";

import {
  renderFileManagerDiskIcon,
  renderFileManagerLocationIcon,
  renderFileManagerSectionIcon
} from "./icon-registry";
import {
  resolveFileManagerDiskKindLabel
} from "./surface-model";
import { preventContextMenuDefaults } from "./surface-view-events";
import type { FileManagerSurfaceViewProps } from "./surface-view-types";

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

export const FileManagerHomeContent = ({
  renderModel,
  labels,
  actions
}: FileManagerSurfaceViewProps) => {
  if (renderModel.body.kind !== "home") {
    return null;
  }
  const home = renderModel.body.home;
  return (
    <div className="lyra-file-manager-home">
      <HomeSection title={labels.homeSectionLocations} section="locations">
        {home.locations.map((location) => (
          <button
            key={location.id}
            className="lyra-file-manager-home-card"
            onClick={() => {
              actions.onOpenLocation(location);
            }}
            onContextMenu={(event) => {
              preventContextMenuDefaults(event);
              actions.onLocationContextMenu(location, event.clientX, event.clientY);
            }}
          >
            {renderFileManagerLocationIcon(location)}
            <strong>{location.title}</strong>
            <small>{location.path ?? location.kind}</small>
          </button>
        ))}
      </HomeSection>

      <HomeSection title={labels.homeSectionDevices} section="devices">
        {home.disks.map((item) => (
          <button
            key={item.disk.id}
            className="lyra-file-manager-home-card lyra-file-manager-disk-card"
            onClick={() => {
              actions.onOpenDisk(item.disk);
            }}
            onContextMenu={(event) => {
              preventContextMenuDefaults(event);
              actions.onDiskContextMenu(item.disk, event.clientX, event.clientY);
            }}
          >
            <div className="lyra-file-manager-disk-summary">
              <div className="lyra-file-manager-disk-summary-icon">
                {renderFileManagerDiskIcon(item.disk)}
              </div>
              <div className="lyra-file-manager-disk-summary-body">
                <strong>{item.disk.title}</strong>
                <small className="lyra-file-manager-disk-path">{item.disk.mountPath}</small>
              </div>
            </div>
            <div className="lyra-file-manager-disk-meter" aria-hidden="true">
              <div
                className={`lyra-file-manager-disk-meter-fill lyra-file-manager-disk-meter-fill-${item.usageTone}`}
                style={{ width: `${item.usagePercent}%` }}
              />
            </div>
            <div className="lyra-file-manager-disk-meta">
              <span>{item.usageLabel}</span>
              <span>
                {labels.diskAvailable} {item.availableLabel}
              </span>
            </div>
            <div className="lyra-file-manager-disk-footer">
              <span className={`lyra-file-manager-disk-kind lyra-file-manager-disk-kind-${item.disk.kind}`}>
                {resolveFileManagerDiskKindLabel(item.disk.kind, labels)}
              </span>
            </div>
          </button>
        ))}

        {home.devices.map((item) => (
          <div
            key={item.device.id}
            className="lyra-file-manager-home-card lyra-file-manager-disk-card lyra-file-manager-device-card"
            onContextMenu={(event) => {
              preventContextMenuDefaults(event);
              if (item.device.canMount === false && item.device.canEject === false) {
                return;
              }
              actions.onDeviceContextMenu(item.device, event.clientX, event.clientY);
            }}
          >
            <div className="lyra-file-manager-disk-summary">
              <div className="lyra-file-manager-disk-summary-icon">
                {renderFileManagerDiskIcon(item.device)}
              </div>
              <div className="lyra-file-manager-disk-summary-body">
                <strong>{item.device.title}</strong>
                <small className="lyra-file-manager-disk-path">
                  {item.device.displayPath ?? item.device.devicePath}
                </small>
              </div>
            </div>
            <div className="lyra-file-manager-disk-meta">
              <span>{labels.deviceUnmounted}</span>
              {item.totalBytesLabel === null ? null : <span>{item.totalBytesLabel}</span>}
            </div>
            <div className="lyra-file-manager-disk-footer">
              <span className={`lyra-file-manager-disk-kind lyra-file-manager-disk-kind-${item.device.kind}`}>
                {resolveFileManagerDiskKindLabel(item.device.kind, labels)}
              </span>
            </div>
          </div>
        ))}
      </HomeSection>

      <HomeSection title={labels.homeSectionRecent} section="recent">
        {home.isRecentEmpty ? (
          <div className="lyra-file-manager-home-empty">{labels.noRecentLocations}</div>
        ) : home.recentLocations.map((recent) => (
          <button
            key={recent.id}
            className="lyra-file-manager-home-card"
            onClick={() => {
              actions.onOpenRecentLocation(recent);
            }}
            onContextMenu={(event) => {
              preventContextMenuDefaults(event);
              actions.onRecentLocationContextMenu(recent, event.clientX, event.clientY);
            }}
          >
            {renderFileManagerLocationIcon({
              id: recent.id,
              title: recent.title,
              kind: "directory",
              path: recent.path
            })}
            <strong>{recent.title}</strong>
            <small>{recent.path}</small>
          </button>
        ))}
      </HomeSection>
    </div>
  );
};

export const FileManagerFavoritesContent = ({
  renderModel,
  labels,
  actions
}: FileManagerSurfaceViewProps) => {
  if (renderModel.body.kind !== "favorites") {
    return null;
  }

  const favorites = renderModel.body.favorites;

  return (
    <div className="lyra-file-manager-favorites-page">
      <header className="lyra-file-manager-favorites-header">
        {renderFileManagerSectionIcon("favorites")}
        <h3>{labels.homeSectionFavorites}</h3>
      </header>
      {favorites.isEmpty ? (
        <div className="lyra-file-manager-empty-state">
          {labels.noFavorites}
        </div>
      ) : (
        <div className="lyra-file-manager-favorites-list">
          {favorites.favorites.map((favorite) => (
            <button
              key={favorite.id}
              type="button"
              className="lyra-file-manager-favorite-row"
              onClick={() => {
                actions.onOpenDirectoryPath(favorite.path);
              }}
              onContextMenu={(event) => {
                preventContextMenuDefaults(event);
                actions.onFavoriteContextMenu(favorite, event.clientX, event.clientY);
              }}
            >
              {renderFileManagerLocationIcon(favorite)}
              <span>
                <strong>{favorite.title}</strong>
                <small>{favorite.path}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
