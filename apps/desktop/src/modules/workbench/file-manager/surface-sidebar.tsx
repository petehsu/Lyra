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
    </aside>
  );
};
