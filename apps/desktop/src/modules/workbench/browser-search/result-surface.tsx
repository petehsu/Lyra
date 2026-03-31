import { Search } from "lucide-react";
import { useLayoutEffect, useRef } from "react";

import { LyraBrandLogo } from "../brand";
import type { AggregatedSearchPayload, SearchEngineDefinition } from "./types";

export type BrowserResultSurfaceProps = {
  readonly logoUrl: string;
  readonly inputValue: string;
  readonly placeholder: string;
  readonly searchActionLabel: string;
  readonly headingLabel: string;
  readonly blendLabel: string;
  readonly engineOverviewLabel: string;
  readonly emptyLabel: string;
  readonly engineErrorLabel: string;
  readonly isLoading: boolean;
  readonly payload: AggregatedSearchPayload;
  readonly sharedStartRect?: DOMRect | null;
  readonly engineById: ReadonlyMap<string, SearchEngineDefinition>;
  readonly onInputChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onOpenUrl?: (url: string, title: string) => void;
  readonly onSharedAnimationDone?: () => void;
};

const resolveEngineLabel = (engineById: ReadonlyMap<string, SearchEngineDefinition>, engineId: string): string =>
  engineById.get(engineId)?.label ?? engineId;

const resolveEngineAccent = (engineById: ReadonlyMap<string, SearchEngineDefinition>, engineId: string): string =>
  engineById.get(engineId)?.accentColor ?? "var(--lyra-text-accent)";

const SKELETON_RESULT_CARDS = [0, 1, 2, 3, 4, 5] as const;
const SKELETON_ENGINE_CARDS = [0, 1, 2] as const;

export const BrowserResultSurface = ({
  logoUrl,
  inputValue,
  placeholder,
  searchActionLabel,
  headingLabel,
  blendLabel,
  engineOverviewLabel,
  emptyLabel,
  engineErrorLabel,
  isLoading,
  payload,
  sharedStartRect,
  engineById,
  onInputChange,
  onSubmit,
  onOpenUrl,
  onSharedAnimationDone
}: BrowserResultSurfaceProps) => {
  const pillRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (sharedStartRect === null || sharedStartRect === undefined) {
      return;
    }

    const pill = pillRef.current;
    if (pill === null) {
      return;
    }

    const targetRect = pill.getBoundingClientRect();
    const deltaX = sharedStartRect.left - targetRect.left;
    const deltaY = sharedStartRect.top - targetRect.top;
    const scaleX = sharedStartRect.width / targetRect.width;
    const scaleY = sharedStartRect.height / targetRect.height;

    const animation = pill.animate(
      [
        {
          transformOrigin: "left top",
          transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`
        },
        {
          transformOrigin: "left top",
          transform: "translate(0, 0) scale(1, 1)"
        }
      ],
      {
        duration: 320,
        easing: "cubic-bezier(0.2, 0.78, 0.08, 0.98)",
        fill: "both"
      }
    );

    animation.onfinish = () => {
      pill.style.transform = "none";
      pill.style.transformOrigin = "";
      onSharedAnimationDone?.();
    };

    return () => {
      animation.cancel();
      pill.style.transform = "";
      pill.style.transformOrigin = "";
    };
  }, [onSharedAnimationDone, sharedStartRect]);

  return (
    <section className="lyra-results-shell" aria-label="search-results-surface">
      <header className="lyra-results-topbar">
        <div className="lyra-browser-pill lyra-browser-pill-compact" ref={pillRef}>
          <span className="lyra-logo-circle">
            <LyraBrandLogo logoUrl={logoUrl} />
          </span>
          <input
            aria-label="browser-address-input"
            value={inputValue}
            placeholder={placeholder}
            onChange={(event) => {
              onInputChange(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onSubmit();
              }
            }}
          />
          <button className="lyra-search-circle" aria-label={searchActionLabel} onClick={onSubmit}>
            <Search size={14} />
          </button>
        </div>
        <div className="lyra-results-summary">
          <strong>{headingLabel}</strong>
          <span>{payload.query}</span>
        </div>
      </header>

      <div className="lyra-results-grid">
        <section className="lyra-results-main">
          <h3>{blendLabel}</h3>

          {isLoading ? (
            <ul className="lyra-results-skeleton-list" aria-label="search-loading-skeleton">
              {SKELETON_RESULT_CARDS.map((skeletonId) => (
                <li key={`result-skeleton-${skeletonId}`} className="lyra-result-card lyra-result-card-skeleton">
                  <span className="lyra-skeleton-block lyra-skeleton-title" />
                  <span className="lyra-skeleton-block lyra-skeleton-url" />
                  <span className="lyra-skeleton-block lyra-skeleton-line" />
                  <span className="lyra-skeleton-block lyra-skeleton-line lyra-skeleton-line-short" />
                </li>
              ))}
            </ul>
          ) : null}

          {!isLoading && payload.blendedResults.length === 0 ? (
            <div className="lyra-results-state">{emptyLabel}</div>
          ) : null}

          {!isLoading && payload.blendedResults.length > 0 ? (
            <ul>
              {payload.blendedResults.map((result) => (
                <li key={`${result.id}-${result.url}`} className="lyra-result-card">
                  <a
                    href={result.url}
                    onClick={(event) => {
                      event.preventDefault();
                      onOpenUrl?.(result.url, result.title);
                    }}
                  >
                    {result.title}
                  </a>
                  <small>{result.displayUrl}</small>
                  <p>{result.snippet}</p>
                  <div className="lyra-result-source-chips">
                    {result.sourceEngineIds.map((engineId) => (
                      <span
                        key={`${result.id}-${engineId}`}
                        className="lyra-result-source-chip"
                        style={{ borderColor: resolveEngineAccent(engineById, engineId) }}
                      >
                        {resolveEngineLabel(engineById, engineId)}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <aside className="lyra-results-side">
          <h3>{engineOverviewLabel}</h3>
          <div className="lyra-engine-panels">
            {isLoading
              ? SKELETON_ENGINE_CARDS.map((skeletonId) => (
                  <section key={`engine-skeleton-${skeletonId}`} className="lyra-engine-panel lyra-engine-panel-skeleton">
                    <span className="lyra-skeleton-block lyra-skeleton-engine-title" />
                    <span className="lyra-skeleton-block lyra-skeleton-engine-line" />
                    <span className="lyra-skeleton-block lyra-skeleton-engine-line lyra-skeleton-line-short" />
                  </section>
                ))
              : null}

            {!isLoading
              ? payload.engineBuckets.map((bucket) => (
                  <section key={bucket.engine.id} className="lyra-engine-panel">
                    <header>
                      <span className="lyra-engine-dot" style={{ background: bucket.engine.accentColor }} />
                      <strong>{bucket.engine.label}</strong>
                      <small>{bucket.latencyMs ?? 0}ms</small>
                    </header>
                    <ul>
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
          </div>
        </aside>
      </div>
    </section>
  );
};
