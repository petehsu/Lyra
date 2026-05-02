import { useMemo } from "react";

import type {
  BrowserSearchPayload,
  SearchEngineDefinition
} from "./types";
import { ResultEngineOverview } from "./result-engine-overview";
import { ResultLocalSection } from "./result-local-section";
import {
  resolveLocalSearchStatusLabel,
  resolveSearchResultChannelVisibility,
  type SearchResultOfficialCategoryLabels,
  type SearchResultsSourceFilter
} from "./result-surface-model";
import { ResultWebSection } from "./result-web-section";
import { useWorkbenchTitlebarContribution } from "../shell/titlebar-context";

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
  readonly sourceFilter: SearchResultsSourceFilter;
  readonly payload: BrowserSearchPayload;
  readonly sharedStartRect?: DOMRect | null;
  readonly engineById: ReadonlyMap<string, SearchEngineDefinition>;
  readonly onInputChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onToggleDeepSearch: () => void;
  readonly onSourceFilterChange: (value: SearchResultsSourceFilter) => void;
  readonly onOpenUrl?: (url: string, title: string) => void;
  readonly onSharedAnimationDone?: () => void;
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
  const { showWebResults, showLocalResults } =
    resolveSearchResultChannelVisibility(sourceFilter);
  const localStatusLabel = resolveLocalSearchStatusLabel(payload.local.status, {
    idle: channelIdleLabel,
    loading: channelLoadingLabel,
    ready: channelReadyLabel,
    error: channelErrorLabel
  });
  const officialCategoryLabels: SearchResultOfficialCategoryLabels = {
    fallback: officialResultLabel,
    homepage: officialHomepageLabel,
    subsite: officialSubsiteLabel,
    docs: officialDocsLabel,
    login: officialLoginLabel,
    download: officialDownloadLabel,
    support: officialSupportLabel
  };
  const titlebarContribution = useMemo(
    () => ({
      ariaLabel: headingLabel,
      content: (
        <>
          <span className="lyra-titlebar-context-chip">{payload.query}</span>
          <div className="lyra-titlebar-context-controls">
            <button
              type="button"
              role="switch"
              aria-checked={deepSearchEnabled}
              className={
                deepSearchEnabled
                  ? "lyra-titlebar-context-text-button lyra-titlebar-context-button-active"
                  : "lyra-titlebar-context-text-button"
              }
              aria-label={deepSearchToggleLabel}
              onClick={onToggleDeepSearch}
            >
              {deepSearchChipLabel}
            </button>
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
                    ? "lyra-titlebar-context-text-button lyra-titlebar-context-button-active"
                    : "lyra-titlebar-context-text-button"
                }
                aria-label={`${sourceFilterLabel}: ${label}`}
                onClick={() => {
                  onSourceFilterChange(value);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )
    }),
    [
      allTabLabel,
      deepSearchChipLabel,
      deepSearchEnabled,
      deepSearchToggleLabel,
      headingLabel,
      localTabLabel,
      onSourceFilterChange,
      onToggleDeepSearch,
      payload.query,
      sourceFilter,
      sourceFilterLabel,
      webTabLabel
    ]
  );
  useWorkbenchTitlebarContribution(titlebarContribution);

  void inputValue;
  void logoUrl;
  void onInputChange;
  void onSharedAnimationDone;
  void onSubmit;
  void placeholder;
  void searchActionLabel;
  void sharedStartRect;

  return (
    <section className="lyra-results-shell" aria-label="search-results-surface">
      <div className="lyra-results-grid">
        <section className="lyra-results-main">
          {showWebResults ? (
            <ResultWebSection
              payload={payload.web.payload}
              status={payload.web.status}
              blendLabel={blendLabel}
              emptyLabel={emptyLabel}
              engineById={engineById}
              officialCategoryLabels={officialCategoryLabels}
              onOpenUrl={onOpenUrl}
            />
          ) : null}

          {showLocalResults ? (
            <ResultLocalSection
              payload={payload.local.payload}
              status={payload.local.status}
              showWebResults={showWebResults}
              localTitleLabel={localTitleLabel}
              localNoMatchesLabel={localNoMatchesLabel}
              localSearchingMoreLabel={localSearchingMoreLabel}
              localScoreLabel={localScoreLabel}
              localLineLabel={localLineLabel}
            />
          ) : null}
        </section>

        <ResultEngineOverview
          payload={payload}
          sourceFilter={sourceFilter}
          localStatusLabel={localStatusLabel}
          engineOverviewLabel={engineOverviewLabel}
          sourceFilterLabel={sourceFilterLabel}
          allTabLabel={allTabLabel}
          webTabLabel={webTabLabel}
          localTabLabel={localTabLabel}
          engineErrorLabel={engineErrorLabel}
          localPanelTitleLabel={localPanelTitleLabel}
          localScopeLabel={localScopeLabel}
          localScannedFilesLabel={localScannedFilesLabel}
          localScannedDirsLabel={localScannedDirsLabel}
          localContentScansLabel={localContentScansLabel}
          localMatchedLabel={localMatchedLabel}
          localIndexLabel={localIndexLabel}
          onSourceFilterChange={onSourceFilterChange}
        />
      </div>
    </section>
  );
};
