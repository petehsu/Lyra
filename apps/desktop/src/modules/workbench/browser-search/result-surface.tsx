import { BadgeCheck, Search } from "lucide-react";
import { useLayoutEffect, useRef } from "react";

import { LyraBrandLogo } from "../brand";
import type {
  BrowserSearchPayload,
  SearchEngineDefinition
} from "./types";
import type { SearchOfficialCategory } from "../../../shared/desktop-bridge";

export type BrowserResultSurfaceProps = {
  readonly logoUrl: string;
  readonly inputValue: string;
  readonly placeholder: string;
  readonly searchActionLabel: string;
  readonly deepSearchToggleLabel: string;
  readonly deepSearchEnabled: boolean;
  readonly deepSearchChipLabel: string;
  readonly headingLabel: string;
  readonly blendLabel: string;
  readonly engineOverviewLabel: string;
  readonly sourceFilterLabel: string;
  readonly officialResultLabel: string;
  readonly officialHomepageLabel: string;
  readonly officialSubsiteLabel: string;
  readonly officialDocsLabel: string;
  readonly officialLoginLabel: string;
  readonly officialDownloadLabel: string;
  readonly officialSupportLabel: string;
  readonly allTabLabel: string;
  readonly emptyLabel: string;
  readonly engineErrorLabel: string;
  readonly webTabLabel: string;
  readonly localTabLabel: string;
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
  readonly channelIdleLabel: string;
  readonly channelLoadingLabel: string;
  readonly channelReadyLabel: string;
  readonly channelErrorLabel: string;
  readonly sourceFilter: "all" | "web" | "local";
  readonly payload: BrowserSearchPayload;
  readonly sharedStartRect?: DOMRect | null;
  readonly engineById: ReadonlyMap<string, SearchEngineDefinition>;
  readonly onInputChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onToggleDeepSearch: () => void;
  readonly onSourceFilterChange: (value: "all" | "web" | "local") => void;
  readonly onOpenUrl?: (url: string, title: string) => void;
  readonly onSharedAnimationDone?: () => void;
};

const resolveEngineLabel = (engineById: ReadonlyMap<string, SearchEngineDefinition>, engineId: string): string =>
  engineById.get(engineId)?.label ?? engineId;

const resolveEngineAccent = (engineById: ReadonlyMap<string, SearchEngineDefinition>, engineId: string): string =>
  engineById.get(engineId)?.accentColor ?? "var(--lyra-text-accent)";

const SKELETON_RESULT_CARDS = [0, 1, 2, 3, 4, 5] as const;
const SKELETON_ENGINE_CARDS = [0, 1, 2] as const;

const resolveOfficialCategoryLabel = (
  category: SearchOfficialCategory | undefined,
  labels: {
    readonly fallback: string;
    readonly homepage: string;
    readonly subsite: string;
    readonly docs: string;
    readonly login: string;
    readonly download: string;
    readonly support: string;
  }
): string => {
  if (category === "official_homepage") {
    return labels.homepage;
  }
  if (category === "official_subsite") {
    return labels.subsite;
  }
  if (category === "official_docs") {
    return labels.docs;
  }
  if (category === "official_login") {
    return labels.login;
  }
  if (category === "official_download") {
    return labels.download;
  }
  if (category === "official_support") {
    return labels.support;
  }
  return labels.fallback;
};

export const BrowserResultSurface = ({
  logoUrl,
  inputValue,
  placeholder,
  searchActionLabel,
  deepSearchToggleLabel,
  deepSearchEnabled,
  deepSearchChipLabel,
  headingLabel,
  blendLabel,
  engineOverviewLabel,
  sourceFilterLabel,
  officialResultLabel,
  officialHomepageLabel,
  officialSubsiteLabel,
  officialDocsLabel,
  officialLoginLabel,
  officialDownloadLabel,
  officialSupportLabel,
  allTabLabel,
  emptyLabel,
  engineErrorLabel,
  webTabLabel,
  localTabLabel,
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
  channelIdleLabel,
  channelLoadingLabel,
  channelReadyLabel,
  channelErrorLabel,
  sourceFilter,
  payload,
  sharedStartRect,
  engineById,
  onInputChange,
  onSubmit,
  onToggleDeepSearch,
  onSourceFilterChange,
  onOpenUrl,
  onSharedAnimationDone
}: BrowserResultSurfaceProps) => {
  const pillRef = useRef<HTMLDivElement | null>(null);
  const localHasResults = payload.local.payload.results.length > 0;
  const showWebResults = sourceFilter !== "local";
  const showLocalResults = sourceFilter !== "web";
  const localStatusLabel =
    payload.local.status === "idle"
      ? channelIdleLabel
      : payload.local.status === "loading"
        ? channelLoadingLabel
        : payload.local.status === "ready"
          ? channelReadyLabel
          : channelErrorLabel;

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
          <button
            type="button"
            role="switch"
            aria-checked={deepSearchEnabled}
            aria-label={deepSearchToggleLabel}
            title={deepSearchToggleLabel}
            className={
              deepSearchEnabled
                ? "lyra-logo-circle lyra-logo-toggle lyra-logo-toggle-active"
                : "lyra-logo-circle lyra-logo-toggle"
            }
            onClick={onToggleDeepSearch}
          >
            <LyraBrandLogo logoUrl={logoUrl} />
          </button>
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
          {deepSearchEnabled ? (
            <span className="lyra-browser-mode-chip">{deepSearchChipLabel}</span>
          ) : null}
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
          {showWebResults ? (
            <>
              <h3>{blendLabel}</h3>

              {payload.web.status === "loading" ? (
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

              {payload.web.status !== "loading" && payload.web.payload.blendedResults.length === 0 ? (
                <div className="lyra-results-state">{emptyLabel}</div>
              ) : null}

          {payload.web.status !== "loading" && payload.web.payload.blendedResults.length > 0 ? (
                <ul className="lyra-result-card-grid">
                  {payload.web.payload.blendedResults.map((result) => (
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
                              title={resolveOfficialCategoryLabel(result.officialCategory, {
                                fallback: officialResultLabel,
                                homepage: officialHomepageLabel,
                                subsite: officialSubsiteLabel,
                                docs: officialDocsLabel,
                                login: officialLoginLabel,
                                download: officialDownloadLabel,
                                support: officialSupportLabel
                              })}
                              aria-label={resolveOfficialCategoryLabel(result.officialCategory, {
                                fallback: officialResultLabel,
                                homepage: officialHomepageLabel,
                                subsite: officialSubsiteLabel,
                                docs: officialDocsLabel,
                                login: officialLoginLabel,
                                download: officialDownloadLabel,
                                support: officialSupportLabel
                              })}
                            >
                              <BadgeCheck size={14} />
                            </span>
                            <span className="lyra-result-official-badge-text">
                              {resolveOfficialCategoryLabel(result.officialCategory, {
                                fallback: officialResultLabel,
                                homepage: officialHomepageLabel,
                                subsite: officialSubsiteLabel,
                                docs: officialDocsLabel,
                                login: officialLoginLabel,
                                download: officialDownloadLabel,
                                support: officialSupportLabel
                              })}
                            </span>
                          </span>
                        ) : null}
                      </div>
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
            </>
          ) : null}

          {showLocalResults ? (
            <>
              <h3 className={showWebResults ? "lyra-results-local-heading" : undefined}>{localTitleLabel}</h3>
              {payload.local.status === "loading" && !localHasResults ? (
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
              {payload.local.status !== "loading" && !localHasResults ? (
                <div className="lyra-results-state">{localNoMatchesLabel}</div>
              ) : null}
              {localHasResults ? (
                <ul className="lyra-result-card-grid">
                  {payload.local.payload.results.map((result) => (
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
              {payload.local.status === "loading" && localHasResults ? (
                <div className="lyra-results-local-progress">{localSearchingMoreLabel}</div>
              ) : null}
            </>
          ) : null}
        </section>

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

            <section className="lyra-engine-panel">
              <header>
                <span className="lyra-engine-dot" />
                <strong>{localPanelTitleLabel}</strong>
                <small>{localStatusLabel} · {payload.local.payload.elapsedMs}ms</small>
              </header>
              <ul>
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
      </div>
    </section>
  );
};
