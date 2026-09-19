import {
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

export const FileManagerSidebar = ({
  renderModel,
  labels,
  actions
}: FileManagerSurfaceViewProps) => {
  const favoritesActive =
    renderModel.sidebar.favoritesActive
    || renderModel.sidebar.favorites.some((item) => item.active);

  return (
    <AppSidebar className="lyra-file-manager-nav" aria-label="file-manager-nav">
      <AppSidebarSection className="lyra-file-manager-nav-group">
        <AppObjectRow
          className="lyra-app-sidebar-nav-item lyra-app-sidebar-row lyra-file-manager-nav-item"
          active={renderModel.sidebar.homeActive}
          onClick={actions.onOpenHome}
          icon={renderFileManagerAppIcon("file-manager-home")}
          title={labels.title}
        />
        <AppObjectRow
          className="lyra-app-sidebar-nav-item lyra-app-sidebar-row lyra-file-manager-nav-item"
          active={favoritesActive}
          onClick={actions.onOpenFavorites}
          icon={renderFileManagerSectionIcon("favorites")}
          title={labels.homeSectionFavorites}
        />
        <AppObjectRow
          className="lyra-app-sidebar-nav-item lyra-app-sidebar-row lyra-file-manager-nav-item"
          active={renderModel.sidebar.downloadsActive}
          onClick={actions.onOpenDownloads}
          icon={renderFileManagerSectionIcon("downloads")}
          title={labels.downloadManagerTitle}
        />
        {renderModel.sidebar.locations.map(({ location, active }) => (
          <AppObjectRow
            key={location.id}
            className="lyra-app-sidebar-nav-item lyra-app-sidebar-row lyra-file-manager-nav-item"
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
        {renderModel.sidebar.recents.map(({ recent, active }) => (
          <AppObjectRow
            key={recent.id}
            className="lyra-app-sidebar-nav-item lyra-app-sidebar-row lyra-file-manager-nav-item"
            active={active}
            onClick={() => {
              actions.onOpenRecentLocation(recent);
            }}
            onContextMenu={(event) => {
              preventContextMenuDefaults(event);
              actions.onRecentLocationContextMenu(recent, event.clientX, event.clientY);
            }}
            icon={renderFileManagerLocationIcon({
              id: recent.id,
              title: recent.title,
              kind: "directory",
              path: recent.path
            })}
            title={recent.title}
          />
        ))}
      </AppSidebarSection>
    </AppSidebar>
  );
};