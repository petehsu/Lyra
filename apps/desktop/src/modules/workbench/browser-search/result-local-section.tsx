import type { LocalSearchPayload, SearchChannelStatus } from "./types";

const SKELETON_RESULT_CARDS = [0, 1, 2, 3, 4, 5] as const;

type ResultLocalSectionProps = {
  readonly payload: LocalSearchPayload;
  readonly status: SearchChannelStatus;
  readonly showWebResults: boolean;
  readonly localTitleLabel: string;
  readonly localNoMatchesLabel: string;
  readonly localSearchingMoreLabel: string;
  readonly localScoreLabel: string;
  readonly localLineLabel: string;
};

export const ResultLocalSection = ({
  payload,
  status,
  showWebResults,
  localTitleLabel,
  localNoMatchesLabel,
  localSearchingMoreLabel,
  localScoreLabel,
  localLineLabel
}: ResultLocalSectionProps) => {
  const localHasResults = payload.results.length > 0;

  return (
    <>
      <h3 className={showWebResults ? "lyra-results-local-heading" : undefined}>{localTitleLabel}</h3>
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
      {status !== "loading" && !localHasResults ? (
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
