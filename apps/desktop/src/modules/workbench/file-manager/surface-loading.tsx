import type {
  FileManagerSkeletonSlots,
  FileManagerSurfaceRenderModel
} from "./surface-model";

export const FileManagerLoadingSkeleton = ({
  viewKind,
  presentationMode,
  slots
}: {
  readonly viewKind: FileManagerSurfaceRenderModel["viewKind"];
  readonly presentationMode: FileManagerSurfaceRenderModel["presentationMode"];
  readonly slots: FileManagerSkeletonSlots;
}) => {
  const renderHomeCardSkeleton = (cardId: number, sectionKey: string) => (
    <article
      key={`${sectionKey}-card-${cardId}`}
      className="lyra-file-manager-home-card lyra-file-manager-home-card-skeleton"
    >
      <span className="lyra-skeleton-block lyra-file-manager-skeleton-card-icon" />
      <span className="lyra-skeleton-block lyra-file-manager-skeleton-card-title" />
      <span className="lyra-skeleton-block lyra-file-manager-skeleton-card-subtitle" />
    </article>
  );

  if (viewKind === "home") {
    return (
      <div className="lyra-file-manager-skeleton-home" aria-label="file-manager-loading-skeleton">
        <section className="lyra-file-manager-skeleton-home-section">
          <header className="lyra-file-manager-skeleton-home-header">
            <span className="lyra-skeleton-block lyra-file-manager-skeleton-home-header-icon" />
            <span className="lyra-skeleton-block lyra-file-manager-skeleton-home-header-title" />
          </header>
          <div className="lyra-file-manager-home-grid">
            {slots.favoriteSlots.map((cardId) => renderHomeCardSkeleton(cardId, "favorites"))}
          </div>
        </section>

        <section className="lyra-file-manager-skeleton-home-section">
          <header className="lyra-file-manager-skeleton-home-header">
            <span className="lyra-skeleton-block lyra-file-manager-skeleton-home-header-icon" />
            <span className="lyra-skeleton-block lyra-file-manager-skeleton-home-header-title" />
          </header>
          <div className="lyra-file-manager-home-grid">
            {slots.locationSlots.map((cardId) => renderHomeCardSkeleton(cardId, "locations"))}
          </div>
        </section>

        <section className="lyra-file-manager-skeleton-home-section">
          <header className="lyra-file-manager-skeleton-home-header">
            <span className="lyra-skeleton-block lyra-file-manager-skeleton-home-header-icon" />
            <span className="lyra-skeleton-block lyra-file-manager-skeleton-home-header-title" />
          </header>
          <div className="lyra-file-manager-home-grid">
            {slots.deviceSlots.map((cardId) => (
              <article
                key={`devices-card-${cardId}`}
                className="lyra-file-manager-home-card lyra-file-manager-home-card-skeleton lyra-file-manager-disk-card lyra-file-manager-disk-card-skeleton"
              >
                <div className="lyra-file-manager-disk-summary">
                  <div className="lyra-file-manager-disk-summary-icon">
                    <span className="lyra-skeleton-block lyra-file-manager-skeleton-disk-icon" />
                  </div>
                  <div className="lyra-file-manager-disk-summary-body">
                    <span className="lyra-skeleton-block lyra-file-manager-skeleton-disk-title" />
                    <span className="lyra-skeleton-block lyra-file-manager-skeleton-disk-path" />
                  </div>
                </div>
                <div className="lyra-file-manager-disk-meter">
                  <span className="lyra-skeleton-block lyra-file-manager-skeleton-disk-meter" />
                </div>
                <div className="lyra-file-manager-disk-meta">
                  <span className="lyra-skeleton-block lyra-file-manager-skeleton-disk-meta-line" />
                  <span className="lyra-skeleton-block lyra-file-manager-skeleton-disk-meta-line lyra-file-manager-skeleton-disk-meta-line-short" />
                </div>
                <div className="lyra-file-manager-disk-footer">
                  <span className="lyra-skeleton-block lyra-file-manager-skeleton-disk-kind" />
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="lyra-file-manager-skeleton-home-section">
          <header className="lyra-file-manager-skeleton-home-header">
            <span className="lyra-skeleton-block lyra-file-manager-skeleton-home-header-icon" />
            <span className="lyra-skeleton-block lyra-file-manager-skeleton-home-header-title" />
          </header>
          <div className="lyra-file-manager-home-grid">
            {slots.recentSlots.map((cardId) => renderHomeCardSkeleton(cardId, "recent"))}
          </div>
        </section>
      </div>
    );
  }

  if (presentationMode === "large") {
    const tiles = viewKind === "trash" ? slots.trashLargeSlots : slots.directoryLargeSlots;
    return (
      <div className="lyra-file-manager-list-shell" aria-label="file-manager-loading-skeleton">
        <div className="lyra-file-manager-large-grid">
          {tiles.map((tileId) => (
            <article
              key={`fm-large-skeleton-tile-${tileId}`}
              className="lyra-file-manager-large-tile lyra-file-manager-large-tile-skeleton"
            >
              <div className="lyra-file-manager-large-tile-preview">
                <span className="lyra-skeleton-block lyra-file-manager-skeleton-large-preview" />
              </div>
              <div className="lyra-file-manager-large-tile-body">
                <span className="lyra-skeleton-block lyra-file-manager-skeleton-large-title" />
                {viewKind === "trash" ? (
                  <span className="lyra-skeleton-block lyra-file-manager-skeleton-large-subtitle" />
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </div>
    );
  }

  const rows = viewKind === "trash" ? slots.trashListSlots : slots.directoryListSlots;

  return (
    <div className="lyra-file-manager-list-shell" aria-label="file-manager-loading-skeleton">
      <div className="lyra-file-manager-list-grid lyra-file-manager-list-grid-skeleton">
        {rows.map((rowId) => (
          <article
            key={`fm-list-skeleton-row-${rowId}`}
            className="lyra-file-manager-list-row lyra-file-manager-list-row-skeleton"
          >
            <div className="lyra-file-manager-list-cell-primary">
              <span className="lyra-skeleton-block lyra-file-manager-skeleton-list-icon" />
              <span className="lyra-skeleton-block lyra-file-manager-skeleton-list-name" />
            </div>
            {viewKind === "trash" ? (
              <span className="lyra-skeleton-block lyra-file-manager-skeleton-list-subline" />
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
};
