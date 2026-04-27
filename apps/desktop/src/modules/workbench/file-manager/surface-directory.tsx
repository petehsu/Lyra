import {
  renderFileManagerEntryIcon
} from "./icon-registry";
import { OverflowMarqueeText } from "./overflow-marquee";
import {
  FileManagerDraftInput,
  FileManagerLargeEntryTile
} from "./surface-entry-tiles";
import { preventContextMenuDefaults } from "./surface-view-events";
import type { FileManagerSurfaceViewProps } from "./surface-view-types";

export const FileManagerDirectoryContent = ({
  renderModel,
  labels,
  actions
}: FileManagerSurfaceViewProps) => {
  if (renderModel.body.kind !== "directory") {
    return null;
  }
  const directory = renderModel.body.directory;
  if (renderModel.toolbar.isLargeMode) {
    return (
      <div className="lyra-file-manager-list-shell">
        <div className="lyra-file-manager-large-grid">
          {directory.createDraft === undefined ? null : (
            <FileManagerDraftInput
              draft={directory.createDraft}
              labels={labels}
              actions={actions}
              variant="large"
            />
          )}

          {directory.isEmpty ? (
            <div className="lyra-file-manager-empty-state">{labels.emptyDirectory}</div>
          ) : directory.entries.map(({ entry, active }) => (
            <FileManagerLargeEntryTile
              key={entry.id}
              entry={entry}
              isActive={active}
              onSelect={() => {
                actions.onSelectEntry(entry.id);
              }}
              onOpen={() => {
                actions.onOpenEntry(entry);
              }}
              onContextMenu={(event) => {
                preventContextMenuDefaults(event);
                actions.onEntryContextMenu(entry.id, event.clientX, event.clientY);
              }}
              onDragStart={(event) => {
                actions.onDirectoryEntryDragStart(event, entry);
              }}
              onDragEnd={actions.onEntryDragEnd}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="lyra-file-manager-list-shell">
      <div className="lyra-file-manager-list-grid">
        {directory.createDraft === undefined ? null : (
          <FileManagerDraftInput
            draft={directory.createDraft}
            labels={labels}
            actions={actions}
            variant="list"
          />
        )}

        {directory.isEmpty ? (
          <div className="lyra-file-manager-empty-state lyra-file-manager-empty-state-span">
            {labels.emptyDirectory}
          </div>
        ) : directory.entries.map(({ entry, active }) => (
          <button
            key={entry.id}
            className={
              active
                ? "lyra-file-manager-list-row lyra-file-manager-list-row-active"
                : "lyra-file-manager-list-row"
            }
            data-lyra-allow-web-drag="true"
            draggable
            onClick={() => {
              actions.onSelectEntry(entry.id);
            }}
            onDoubleClick={() => {
              actions.onOpenEntry(entry);
            }}
            onContextMenu={(event) => {
              preventContextMenuDefaults(event);
              actions.onEntryContextMenu(entry.id, event.clientX, event.clientY);
            }}
            onDragStart={(event) => {
              actions.onDirectoryEntryDragStart(event, entry);
            }}
            onDragEnd={actions.onEntryDragEnd}
          >
            <div className="lyra-file-manager-list-cell-primary">
              {renderFileManagerEntryIcon(entry)}
              <OverflowMarqueeText
                text={entry.name}
                active={active}
                className="lyra-file-manager-list-name"
              />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
