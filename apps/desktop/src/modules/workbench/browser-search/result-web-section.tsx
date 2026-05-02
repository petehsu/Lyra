import { BadgeCheck } from "lucide-react";

import type { AggregatedSearchPayload, SearchEngineDefinition } from "./types";
import {
  createWebResultViewModel,
  type SearchResultOfficialCategoryLabels
} from "./result-surface-model";

const SKELETON_RESULT_CARDS = [0, 1, 2, 3, 4, 5] as const;

type ResultWebSectionProps = {
  readonly payload: AggregatedSearchPayload;
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly blendLabel: string;
  readonly emptyLabel: string;
  readonly engineById: ReadonlyMap<string, SearchEngineDefinition>;
  readonly officialCategoryLabels: SearchResultOfficialCategoryLabels;
  readonly onOpenUrl: ((url: string, title: string) => void) | undefined;
};

export const ResultWebSection = ({
  payload,
  status,
  blendLabel,
  emptyLabel,
  engineById,
  officialCategoryLabels,
  onOpenUrl
}: ResultWebSectionProps) => (
  <>
    <h3>{blendLabel}</h3>

    {status === "loading" ? (
      <ul className="lyra-results-skeleton-list" aria-label="search-loading-skeleton">
        {SKELETON_RESULT_CARDS.map((skeletonId) => (
          <li key={`web-result-skeleton-${skeletonId}`} className="lyra-result-card lyra-result-card-skeleton">
            <span className="lyra-skeleton-block lyra-skeleton-title" />
            <span className="lyra-skeleton-block lyra-skeleton-url" />
            <span className="lyra-skeleton-block lyra-skeleton-line" />
            <span className="lyra-skeleton-block lyra-skeleton-line lyra-skeleton-line-short" />
          </li>
        ))}
      </ul>
    ) : null}

    {status !== "loading" && payload.blendedResults.length === 0 ? (
      <div className="lyra-results-state">{emptyLabel}</div>
    ) : null}

    {status !== "loading" && payload.blendedResults.length > 0 ? (
      <ul className="lyra-result-card-grid">
        {payload.blendedResults.map((result) => {
          const resultModel = createWebResultViewModel(
            result,
            engineById,
            officialCategoryLabels
          );
          return (
            <li key={`${result.id}-${result.url}`} className="lyra-result-card">
              <div className="lyra-result-card-heading">
                <a
                  href={result.url}
                  onClick={(event) => {
                    event.preventDefault();
                    onOpenUrl?.(result.url, result.title);
                  }}
                >
                  {result.title}
                </a>
                {result.isOfficialResult === true ? (
                  <span className="lyra-result-official-badge">
                    <span
                      className="lyra-result-official-icon"
                      title={resultModel.officialCategoryLabel}
                      aria-label={resultModel.officialCategoryLabel}
                    >
                      <BadgeCheck size={14} />
                    </span>
                    <span className="lyra-result-official-badge-text">
                      {resultModel.officialCategoryLabel}
                    </span>
                  </span>
                ) : null}
              </div>
              <small>{result.displayUrl}</small>
              <p>{result.snippet}</p>
              <div className="lyra-result-source-chips">
                {resultModel.sourceChips.map((chip) => (
                  <span
                    key={`${result.id}-${chip.id}`}
                    className="lyra-result-source-chip"
                  >
                    {chip.label}
                  </span>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    ) : null}
  </>
);
