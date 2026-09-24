import type { ReactNode } from "react";

import { AppBadge, AppEmptyState, AppObjectRow } from "@renderer/ui/components";
import { MessageCitationText } from "../ai-panel/lyra-agents/features/chat/MessageCitationText";

import {
  renderFileManagerAppIcon,
  renderFileManagerDiskIcon,
  renderFileManagerFavoriteIcon,
  renderFileManagerSectionIcon
} from "./icon-registry";
import {
  resolveFileManagerDiskKindLabel
} from "./surface-model";
import { preventContextMenuDefaults } from "./surface-view-events";
import type { FileManagerSurfaceChromeProps } from "./surface-view-types";

const HomeSection = ({
  title,
  children,
  section
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly section: "devices";
}) => (
  <section className="lyra-app-section lyra-file-manager-home-section">
    <header className="lyra-app-section-title lyra-file-manager-home-section-header">
      {renderFileManagerSectionIcon(section)}
      <h3>{title}</h3>
    </header>
    <div className="lyra-app-group lyra-app-row-list lyra-file-manager-home-grid">{children}</div>
  </section>
);

export const FileManagerHomeContent = ({
  renderModel,
  labels,
  actions
}: FileManagerSurfaceChromeProps) => {
  if (renderModel.body.kind !== "home") {
    return null;
  }
  const home = renderModel.body.home;
  const host = home.host;
  const hostOs = host === null
    ? ""
    : [host.osName, host.architecture]
      .filter((value) => typeof value === "string" && value.length > 0)
      .join(" · ");
  const hasDevices = home.disks.length > 0 || home.devices.length > 0;

  return (
    <div className="lyra-app-content-column lyra-file-manager-home">
      {host === null ? null : (
        <article className="lyra-file-manager-host-card">
          <div className="lyra-file-manager-host-identity">
            {renderFileManagerAppIcon("file-manager-home")}
            <div className="lyra-file-manager-host-copy">
              <h2 className="lyra-file-manager-host-name">{host.name}</h2>
              {hostOs.length === 0 ? null : (
                <p className="lyra-file-manager-host-os">{hostOs}</p>
              )}
            </div>
          </div>
          <dl className="lyra-file-manager-host-facts">
            {typeof host.cpuBrand === "string" && host.cpuBrand.length > 0 ? (
              <div className="lyra-file-manager-host-fact">
                <dt>{labels.hostProcessor}</dt>
                <dd>{host.cpuBrand}</dd>
              </div>
            ) : null}
            <div className="lyra-file-manager-host-fact">
              <dt>{labels.hostMemory}</dt>
              <dd>
                <span className="lyra-file-manager-disk-description">
                  <span className="lyra-file-manager-disk-meter" aria-hidden="true">
                    <span
                      className={`lyra-file-manager-disk-meter-fill lyra-file-manager-disk-meter-fill-${host.memoryUsageTone}`}
                      style={{ width: `${host.memoryUsagePercent}%` }}
                    />
                  </span>
                  <span className="lyra-file-manager-disk-meta">
                    <span>{host.memoryLabel}</span>
                    <span>
                      {labels.diskAvailable} {host.memoryAvailableLabel}
                    </span>
                  </span>
                </span>
              </dd>
            </div>
          </dl>
        </article>
      )}

      {hasDevices === false ? null : (
      <HomeSection title={labels.homeSectionDevices} section="devices">
        {home.disks.map((item) => (
          <AppObjectRow
            key={item.disk.id}
            className="lyra-file-manager-home-card lyra-file-manager-disk-card"
            onClick={() => {
              actions.onOpenDisk(item.disk);
            }}
            onContextMenu={(event) => {
              preventContextMenuDefaults(event);
              actions.onDiskContextMenu(item.disk, event.clientX, event.clientY);
            }}
            icon={renderFileManagerDiskIcon(item.disk)}
            title={item.disk.title}
            meta={(
              <AppBadge className={`lyra-file-manager-disk-kind lyra-file-manager-disk-kind-${item.disk.kind}`}>
                {resolveFileManagerDiskKindLabel(item.disk.kind, labels)}
              </AppBadge>
            )}
            description={(
              <span className="lyra-file-manager-disk-description">
                <span className="lyra-file-manager-disk-path">{item.disk.mountPath}</span>
                <span className="lyra-file-manager-disk-meter" aria-hidden="true">
                  <span
                    className={`lyra-file-manager-disk-meter-fill lyra-file-manager-disk-meter-fill-${item.usageTone}`}
                    style={{ width: `${item.usagePercent}%` }}
                  />
                </span>
                <span className="lyra-file-manager-disk-meta">
                  <span>{item.usageLabel}</span>
                  <span>
                    {labels.diskAvailable} {item.availableLabel}
                  </span>
                </span>
              </span>
            )}
          />
        ))}

        {home.devices.map((item) => (
          <AppObjectRow
            as="div"
            key={item.device.id}
            className="lyra-file-manager-home-card lyra-file-manager-disk-card lyra-file-manager-device-card"
            onContextMenu={(event) => {
              preventContextMenuDefaults(event);
              if (item.device.canMount === false && item.device.canEject === false) {
                return;
              }
              actions.onDeviceContextMenu(item.device, event.clientX, event.clientY);
            }}
            icon={renderFileManagerDiskIcon(item.device)}
            title={item.device.title}
            meta={(
              <AppBadge className={`lyra-file-manager-disk-kind lyra-file-manager-disk-kind-${item.device.kind}`}>
                {resolveFileManagerDiskKindLabel(item.device.kind, labels)}
              </AppBadge>
            )}
            description={(
              <span className="lyra-file-manager-disk-description">
                <span className="lyra-file-manager-disk-path">
                  {item.device.displayPath ?? item.device.devicePath}
                </span>
                <span className="lyra-file-manager-disk-meta">
                  <span>{labels.deviceUnmounted}</span>
                  {item.totalBytesLabel === null ? null : <span>{item.totalBytesLabel}</span>}
                </span>
              </span>
            )}
          />
        ))}
      </HomeSection>
      )}
    </div>
  );
};

export const FileManagerFavoritesContent = ({
  renderModel,
  labels,
  actions
}: FileManagerSurfaceChromeProps) => {
  if (renderModel.body.kind !== "favorites") {
    return null;
  }

  const favorites = renderModel.body.favorites;

  return (
    <div className="lyra-app-content-column lyra-file-manager-favorites-page">
      <header className="lyra-app-section-title lyra-file-manager-favorites-header">
        {renderFileManagerSectionIcon("favorites")}
        <h3>{labels.homeSectionFavorites}</h3>
      </header>
      {favorites.isEmpty ? (
        <AppEmptyState className="lyra-file-manager-empty-state" title={labels.noFavorites} />
      ) : (
        <div className="lyra-app-group lyra-app-row-list lyra-file-manager-favorites-list">
          {favorites.favorites.map((favorite) => (
            <AppObjectRow
              key={favorite.id}
              className="lyra-file-manager-favorite-row"
              onClick={() => {
                actions.onOpenFavorite(favorite);
              }}
              onContextMenu={(event) => {
                preventContextMenuDefaults(event);
                actions.onFavoriteContextMenu(favorite, event.clientX, event.clientY);
              }}
              icon={renderFileManagerFavoriteIcon(favorite)}
              title={<MessageCitationText text={favorite.title} />}
              description={
                favorite.kind === "web"
                  ? favorite.url ?? favorite.path
                  : favorite.kind === "agent-session"
                    ? favorite.workingDir ?? favorite.sessionId ?? favorite.path
                    : favorite.path
              }
            />
          ))}
        </div>
      )}
    </div>
  );
};
