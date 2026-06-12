import { AppList, AppObjectRow } from "@renderer/ui/components";

import {
  renderFileManagerEntryIcon
} from "./icon-registry";
import { OverflowMarqueeText } from "./overflow-marquee";
import {
  FileManagerLargeTrashTile
} from "./surface-entry-tiles";
import { preventContextMenuDefaults } from "./surface-view-events";
import type { FileManagerSurfaceViewProps } from "./surface-view-types";

export const FileManagerTrashContent = ({
  renderModel,
  labels,
  actions
}: FileManagerSurfaceViewProps) => {
  if (renderModel.body.kind !== "trash") {
    return null;
  }
  const trash = renderModel.body.trash;
  if (renderModel.toolbar.isLargeMode) {
    return (
      <div className="lyra-app-content-column lyra-app-content-column-wide lyra-file-manager-list-shell">
        <div className="lyra-app-group lyra-file-manager-large-grid">
          {trash.isEmpty ? (
            <div className="lyra-file-manager-empty-state">{labels.emptyTrashState}</div>
          ) : trash.entries.map(({ entry, active }) => (
            <FileManagerLargeTrashTile
              key={entry.id}
              entry={entry}
              isActive={active}
              onSelect={() => {
                actions.onSelectTrashEntry(entry.id);
              }}
              onContextMenu={(event) => {
                preventContextMenuDefaults(event);
                actions.onTrashEntryContextMenu(entry.id, event.clientX, event.clientY);
              }}
              onDragStart={(event) => {
                actions.onTrashEntryDragStart(event, entry);
              }}
              onDragEnd={actions.onEntryDragEnd}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="lyra-app-content-column lyra-app-content-column-wide lyra-file-manager-list-shell">
      <AppList className="lyra-app-group lyra-file-manager-list-grid">
        {trash.isEmpty ? (
          <div className="lyra-file-manager-empty-state lyra-file-manager-empty-state-span">
            {labels.emptyTrashState}
          </div>
        ) : trash.entries.map(({ entry, active }) => (
          <AppObjectRow
            key={entry.id}
            className="lyra-file-manager-list-row"
            active={active}
            data-lyra-allow-web-drag="true"
            draggable
            onClick={() => {
              actions.onSelectTrashEntry(entry.id);
            }}
            onContextMenu={(event) => {
              preventContextMenuDefaults(event);
              actions.onTrashEntryContextMenu(entry.id, event.clientX, event.clientY);
            }}
            onDragStart={(event) => {
              actions.onTrashEntryDragStart(event, entry);
            }}
            onDragEnd={actions.onEntryDragEnd}
            icon={renderFileManagerEntryIcon(entry)}
            title={(
              <OverflowMarqueeText
                text={entry.name}
                active={active}
                className="lyra-file-manager-list-name"
              />
            )}
          />
        ))}
      </AppList>
    </div>
  );
};
