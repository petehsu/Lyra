import {
  renderFileManagerAppIcon,
  renderFileManagerLocationIcon
} from "./icon-registry";
import { preventContextMenuDefaults } from "./surface-view-events";
import type { FileManagerSurfaceViewProps } from "./surface-view-types";

export const FileManagerSidebar = ({
  renderModel,
  labels,
  actions
}: FileManagerSurfaceViewProps) => (
  <aside className="lyra-file-manager-nav" aria-label="file-manager-nav">
    <div className="lyra-file-manager-nav-group">
      <span className="lyra-file-manager-nav-label">{labels.homeSectionFavorites}</span>
      {renderModel.sidebar.favorites.map(({ favorite, active }) => (
        <button
          key={favorite.id}
          className={
            active
              ? "lyra-file-manager-nav-item lyra-file-manager-nav-item-active"
              : "lyra-file-manager-nav-item"
          }
          onClick={() => {
            actions.onOpenDirectoryPath(favorite.path);
          }}
          onContextMenu={(event) => {
            preventContextMenuDefaults(event);
            actions.onFavoriteContextMenu(favorite, event.clientX, event.clientY);
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
        className={renderModel.sidebar.homeActive ? "lyra-file-manager-nav-item lyra-file-manager-nav-item-active" : "lyra-file-manager-nav-item"}
        onClick={actions.onOpenHome}
      >
        {renderFileManagerAppIcon("file-manager-home")}
        <span>{labels.title}</span>
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
