import { useMemo } from "react";

import type {
  BrowserSearchPayload,
  SearchEngineDefinition
} from "./types";
import { AppTabs } from "@renderer/ui/components";
import { ResultLocalSection } from "./result-local-section";
import {
  resolveLocalSearchStatusLabel,
  type SearchResultsSourceFilter
} from "./result-surface-model";
import { resolveLocalSearchErrorLabel } from "./local-search-errors";
import { useWorkbenchTitlebarContribution } from "../shell/titlebar-context";
import {
  isSearchIndexReady,
  resolveNextSearchEngineSelection
} from "./service";

export type BrowserResultSurfaceProps = {
  readonly logoUrl: string;
  readonly inputValue: string;
  readonly placeholder: string;
  readonly searchActionLabel: string;
  readonly headingLabel: string;
  readonly sourceFilterLabel: string;
  readonly autoSearchLabel: string;
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
  readonly localIndexNotReadyLabel: string;
  readonly localTimedOutLabel: string;
  readonly channelIdleLabel: string;
  readonly channelLoadingLabel: string;
  readonly channelReadyLabel: string;
  readonly channelErrorLabel: string;
  readonly sourceFilter: SearchResultsSourceFilter;
  readonly payload: BrowserSearchPayload;
  readonly localSearchReady?: boolean;
  readonly sharedStartRect?: DOMRect | null;
  readonly searchEngineSelectionMode?: "auto" | "manual";
  readonly searchSelectedEngineIds?: readonly string[];
  readonly searchEngines: readonly SearchEngineDefinition[];
  readonly onInputChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onSourceFilterChange: (value: SearchResultsSourceFilter) => void;
  readonly onSearchEngineSelectionChange: (
    selection: {
      readonly mode: "auto" | "manual";
      readonly engineIds: readonly string[];
    }
  ) => void;
  readonly onSwitchToWebSearch: () => void;
  readonly onOpenUrl?: (url: string, title: string) => void;
  readonly onSharedAnimationDone?: () => void;
};

export const BrowserResultSurface = ({
  logoUrl,
  inputValue,
  placeholder,
  searchActionLabel,
  headingLabel,
  sourceFilterLabel,
  autoSearchLabel,
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
  localIndexNotReadyLabel,
  localTimedOutLabel,
  channelIdleLabel,
  channelLoadingLabel,
  channelReadyLabel,
  channelErrorLabel,
  sourceFilter,
  payload,
  localSearchReady,
  sharedStartRect,
  searchEngineSelectionMode = "auto",
  searchSelectedEngineIds = [],
  searchEngines,
  onInputChange,
  onSubmit,
  onSourceFilterChange,
  onSearchEngineSelectionChange,
  onSwitchToWebSearch,
  onOpenUrl,
  onSharedAnimationDone
}: BrowserResultSurfaceProps) => {
  const localStatusLabel = resolveLocalSearchStatusLabel(payload.local.status, {
    idle: channelIdleLabel,
    loading: channelLoadingLabel,
    ready: channelReadyLabel,
    error: channelErrorLabel
  });
  const localErrorLabel = resolveLocalSearchErrorLabel(payload.local.error, {
    streamTimeout: localTimedOutLabel
  });
  const localErrorProps = localErrorLabel === undefined ? {} : { error: localErrorLabel };
  const localIndexReady =
    localSearchReady ?? isSearchIndexReady(payload.local.payload.indexStatus);
  const titlebarContribution = useMemo(
    () => ({
      ariaLabel: headingLabel,
      content: (
        <>
            <span className="lyra-titlebar-context-chip">{payload.query}</span>
            <AppTabs
              ariaLabel={`${sourceFilterLabel} options`}
              className="lyra-titlebar-context-tabs"
              selectionMode="multiple"
              value={sourceFilter === "local"
                ? "local"
                : searchEngineSelectionMode === "manual"
                  ? searchSelectedEngineIds[0] ?? "auto"
                  : "auto"}
              activeValues={sourceFilter === "local"
                ? ["local"]
                : searchEngineSelectionMode === "manual"
                  ? searchSelectedEngineIds
                  : ["auto"]}
              options={[
                {
                  value: "local",
                  label: localTabLabel,
                  ariaLabel: `${sourceFilterLabel}: ${localTabLabel}`,
                  disabled: !localIndexReady,
                  ...(localIndexReady ? {} : { title: localIndexNotReadyLabel })
                },
                {
                  value: "auto",
                  label: autoSearchLabel,
                  ariaLabel: `${sourceFilterLabel}: ${autoSearchLabel}`
                },
                ...searchEngines.map((engine) => ({
                  value: engine.id,
                  label: engine.label,
                  ariaLabel: `${sourceFilterLabel}: ${engine.label}`
                }))
              ]}
              onValueChange={(value) => {
                if (value === "local") {
                  if (!localIndexReady) return;
                  onSourceFilterChange("local");
                  return;
                }
                if (value === "auto") {
                  onSwitchToWebSearch();
                  return;
                }
                onSearchEngineSelectionChange(
                  resolveNextSearchEngineSelection({
                    currentMode: searchEngineSelectionMode,
                    currentEngineIds: searchSelectedEngineIds,
                    clickedEngineId: value
                  })
                );
              }}
            />
        </>
      )
    }),
    [
      headingLabel,
      localTabLabel,
      localIndexNotReadyLabel,
      localIndexReady,
      autoSearchLabel,
      onSearchEngineSelectionChange,
      onSwitchToWebSearch,
      onSourceFilterChange,
      payload.query,
      searchEngineSelectionMode,
      searchEngines,
      searchSelectedEngineIds,
      sourceFilter,
      sourceFilterLabel,
      webTabLabel
    ]
  );
  useWorkbenchTitlebarContribution(titlebarContribution);

  void inputValue;
  void logoUrl;
  void localStatusLabel;
  void onInputChange;
  void onOpenUrl;
  void onSharedAnimationDone;
  void onSubmit;
  void placeholder;
  void searchActionLabel;
  void sharedStartRect;
  void sourceFilter;
  void allTabLabel;
  void officialResultLabel;
  void officialHomepageLabel;
  void officialSubsiteLabel;
  void officialDocsLabel;
  void officialLoginLabel;
  void officialDownloadLabel;
  void officialSupportLabel;
  void emptyLabel;
  void engineErrorLabel;
  void localPanelTitleLabel;
  void localScopeLabel;
  void localScannedFilesLabel;
  void localScannedDirsLabel;
  void localContentScansLabel;
  void localMatchedLabel;

  return (
    <section className="lyra-results-shell" aria-label="search-results-surface">
      <section className="lyra-results-main lyra-results-main-local">
        <ResultLocalSection
          payload={payload.local.payload}
          status={payload.local.status}
          showWebResults={false}
          localTitleLabel={localTitleLabel}
          localPanelTitleLabel={localPanelTitleLabel}
          localNoMatchesLabel={localNoMatchesLabel}
          localSearchingMoreLabel={localSearchingMoreLabel}
          localScopeLabel={localScopeLabel}
          localScannedFilesLabel={localScannedFilesLabel}
          localScannedDirsLabel={localScannedDirsLabel}
          localContentScansLabel={localContentScansLabel}
          localMatchedLabel={localMatchedLabel}
          localIndexLabel={localIndexLabel}
          localScoreLabel={localScoreLabel}
          localLineLabel={localLineLabel}
          {...localErrorProps}
        />
      </section>
    </section>
  );
};
