import type { BrowserSearchPayload } from "./types";
import type { SearchResultsSourceFilter } from "./result-surface-model";

const SKELETON_ENGINE_CARDS = [0, 1, 2] as const;

type ResultEngineOverviewProps = {
  readonly payload: BrowserSearchPayload;
  readonly sourceFilter: SearchResultsSourceFilter;
  readonly localStatusLabel: string;
  readonly engineOverviewLabel: string;
  readonly sourceFilterLabel: string;
  readonly allTabLabel: string;
  readonly webTabLabel: string;
  readonly localTabLabel: string;
  readonly engineErrorLabel: string;
  readonly localPanelTitleLabel: string;
  readonly localScopeLabel: string;
  readonly localScannedFilesLabel: string;
  readonly localScannedDirsLabel: string;
  readonly localContentScansLabel: string;
  readonly localMatchedLabel: string;
  readonly localIndexLabel: string;
  readonly onSourceFilterChange: (value: SearchResultsSourceFilter) => void;
};

export const ResultEngineOverview = ({
  payload,
  sourceFilter,
  localStatusLabel,
  engineOverviewLabel,
  sourceFilterLabel,
  allTabLabel,
  webTabLabel,
  localTabLabel,
  engineErrorLabel,
  localPanelTitleLabel,
  localScopeLabel,
  localScannedFilesLabel,
  localScannedDirsLabel,
  localContentScansLabel,
  localMatchedLabel,
  localIndexLabel,
  onSourceFilterChange
}: ResultEngineOverviewProps) => (
  <aside className="lyra-results-side">
    <h3>{engineOverviewLabel}</h3>
    <section className="lyra-results-side-section">
      <strong className="lyra-results-side-section-label">{sourceFilterLabel}</strong>
      <div className="lyra-results-channel-tabs lyra-results-channel-tabs-side" role="group" aria-label={sourceFilterLabel}>
        {([
          ["all", allTabLabel],
          ["web", webTabLabel],
          ["local", localTabLabel]
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={
              sourceFilter === value
                ? "lyra-results-channel-tab lyra-results-channel-tab-active"
                : "lyra-results-channel-tab"
            }
            onClick={() => {
              onSourceFilterChange(value);
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </section>
    <div className="lyra-engine-panels">
      {payload.web.status === "loading"
        ? SKELETON_ENGINE_CARDS.map((skeletonId) => (
            <section key={`engine-skeleton-${skeletonId}`} className="lyra-engine-panel lyra-engine-panel-skeleton">
              <span className="lyra-skeleton-block lyra-skeleton-engine-title" />
              <span className="lyra-skeleton-block lyra-skeleton-engine-line" />
              <span className="lyra-skeleton-block lyra-skeleton-engine-line lyra-skeleton-line-short" />
            </section>
          ))
        : null}

      {payload.web.status !== "loading"
        ? payload.web.payload.engineBuckets.map((bucket) => (
            <section key={bucket.engine.id} className="lyra-engine-panel">
              <header>
                <span className="lyra-engine-marker" />
                <strong>{bucket.engine.label}</strong>
                <small>{bucket.latencyMs ?? 0}ms</small>
              </header>
              <ul className="lyra-engine-panel-list">
                {bucket.error ? <li className="lyra-engine-error">{engineErrorLabel}</li> : null}
                {!bucket.error
                  ? bucket.results
                      .slice(0, 2)
                      .map((result) => <li key={`${bucket.engine.id}-${result.id}`}>{result.title}</li>)
                  : null}
              </ul>
            </section>
          ))
        : null}

      <section className="lyra-engine-panel">
        <header>
          <span className="lyra-engine-marker" />
          <strong>{localPanelTitleLabel}</strong>
          <small>{localStatusLabel} · {payload.local.payload.elapsedMs}ms</small>
        </header>
        <ul className="lyra-engine-panel-list">
          <li>{localScopeLabel}: {payload.local.payload.scopePreset}</li>
          <li>{localScannedFilesLabel}: {payload.local.payload.stats.scannedFiles}</li>
          <li>{localScannedDirsLabel}: {payload.local.payload.stats.scannedDirs}</li>
          <li>{localContentScansLabel}: {payload.local.payload.stats.contentScannedFiles}</li>
          <li>{localMatchedLabel}: {payload.local.payload.stats.matchedFiles}</li>
          {payload.local.indexStatus === undefined ? null : (
            <li>{localIndexLabel}: {payload.local.indexStatus.state}</li>
          )}
          {payload.local.error === undefined ? null : (
            <li className="lyra-engine-error">{payload.local.error}</li>
          )}
        </ul>
      </section>
    </div>
  </aside>
);
