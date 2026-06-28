import type { LocalSearchPayload, SearchChannelStatus } from "./types";
import { formatBytes, formatNumber } from "@workbench/i18n";

const SKELETON_RESULT_CARDS = [0, 1, 2, 3, 4, 5] as const;

type ResultLocalSectionProps = {
  readonly payload: LocalSearchPayload;
  readonly status: SearchChannelStatus;
  readonly showWebResults: boolean;
  readonly localTitleLabel: string;
  readonly localPanelTitleLabel: string;
  readonly localNoMatchesLabel: string;
  readonly localSearchingMoreLabel: string;
  readonly localScopeLabel: string;
  readonly localScannedFilesLabel: string;
  readonly localScannedDirsLabel: string;
  readonly localContentScansLabel: string;
  readonly localMatchedLabel: string;
  readonly localIndexLabel: string;
  readonly localScoreLabel: string;
  readonly localLineLabel: string;
  readonly error?: string;
};

const formatSkippedSummary = (
  skipped: NonNullable<LocalSearchPayload["indexStatus"]>["skipped"]
): string => {
  const total =
    skipped.hidden +
    skipped.vendor +
    skipped.binaryOrTooLarge +
    skipped.unreadable +
    skipped.contentBudget;
  if (total === 0) {
    return "skipped 0";
  }
  return `skipped ${formatNumber(total)}`;
};

export const ResultLocalSection = ({
  payload,
  status,
  showWebResults,
  localTitleLabel,
  localPanelTitleLabel,
  localNoMatchesLabel,
  localSearchingMoreLabel,
  localScopeLabel,
  localScannedFilesLabel,
  localScannedDirsLabel,
  localContentScansLabel,
  localMatchedLabel,
  localIndexLabel,
  localScoreLabel,
  localLineLabel,
  error
}: ResultLocalSectionProps) => {
  const localHasResults = payload.results.length > 0;
  const indexStatus = payload.indexStatus;

  return (
    <>
      <h3 className={showWebResults ? "lyra-results-local-heading" : undefined}>{localTitleLabel}</h3>
      {indexStatus === undefined ? null : (
        <div className="lyra-results-local-index-panel" aria-label={localPanelTitleLabel}>
          <span>
            <strong>{localIndexLabel}</strong> {indexStatus.state} · {indexStatus.engineVersion} ·{" "}
            {formatBytes(indexStatus.storageBytes)}
          </span>
          <span>
            snapshot {formatBytes(indexStatus.snapshotBytes)} · delta{" "}
            {formatBytes(indexStatus.deltaBytes)} · pending{" "}
            {formatNumber(indexStatus.pendingChanges)}
          </span>
          <span>
            {localScopeLabel}: {payload.scopePreset} · roots {formatNumber(payload.roots.length)}
          </span>
          <span>
            {localScannedFilesLabel}: {formatNumber(indexStatus.indexedFiles)} ·{" "}
            {localScannedDirsLabel}: {formatNumber(indexStatus.indexedDirs)} ·{" "}
            {localContentScansLabel}: {formatNumber(indexStatus.indexedContentFiles)}
          </span>
          <span>
            {localMatchedLabel}: {formatNumber(payload.stats.matchedFiles)} ·{" "}
            {formatSkippedSummary(indexStatus.skipped)}
          </span>
        </div>
      )}
      {status === "loading" && !localHasResults ? (
        <ul className="lyra-results-skeleton-list" aria-label="local-search-loading-skeleton">
          {SKELETON_RESULT_CARDS.map((skeletonId) => (
            <li key={`local-result-skeleton-${skeletonId}`} className="lyra-result-card lyra-result-card-skeleton">
              <span className="lyra-skeleton-block lyra-skeleton-title" />
              <span className="lyra-skeleton-block lyra-skeleton-url" />
              <span className="lyra-skeleton-block lyra-skeleton-line" />
              <span className="lyra-skeleton-block lyra-skeleton-line lyra-skeleton-line-short" />
            </li>
          ))}
        </ul>
      ) : null}
      {status === "error" && error !== undefined ? (
        <div className="lyra-results-state lyra-results-state-error">{error}</div>
      ) : null}
      {status !== "loading" && status !== "error" && !localHasResults ? (
        <div className="lyra-results-state">{localNoMatchesLabel}</div>
      ) : null}
      {localHasResults ? (
        <ul className="lyra-result-card-grid">
          {payload.results.map((result) => (
            <li key={result.id} className="lyra-result-card lyra-result-card-local">
              <strong>{result.fileName}</strong>
              <small>{result.displayPath}</small>
              {result.snippet === undefined ? null : <p>{result.snippet}</p>}
              <div className="lyra-result-source-chips">
                <span className="lyra-result-source-chip">
                  {result.matchKind}
                </span>
                <span className="lyra-result-source-chip">
                  {localScoreLabel} {result.score.toFixed(1)}
                </span>
                {result.line === undefined ? null : (
                  <span className="lyra-result-source-chip">{localLineLabel} {result.line}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {status === "loading" && localHasResults ? (
        <div className="lyra-results-local-progress">{localSearchingMoreLabel}</div>
      ) : null}
    </>
  );
};
