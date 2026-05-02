import "@xyflow/react/dist/style.css";

import { useMemo } from "react";

import type { SearchDeepSnapshot } from "../../../shared/desktop-bridge";
import { DeepSearchCanvas } from "./deep-search-canvas";
import {
  DeepSearchOverview,
  type DeepSearchOverviewLabels
} from "./deep-search-overview";
import type {
  DeepSearchLocalOpenBehavior,
  DeepSearchSourceFilter
} from "./deep-search-surface-model";
import { useDeepSearchSurfaceRuntime } from "./use-deep-search-surface-runtime";
import { useWorkbenchTitlebarContribution } from "../shell/titlebar-context";

export type DeepSearchResultSurfaceLabels = DeepSearchOverviewLabels & {
  readonly headingLabel: string;
  readonly deepSearchToggleLabel: string;
  readonly deepSearchChipLabel: string;
  readonly stopLabel: string;
  readonly fitViewLabel: string;
  readonly resetLayoutLabel: string;
  readonly loadingLabel: string;
  readonly emptyLabel: string;
  readonly officialResultLabel: string;
  readonly officialHomepageLabel: string;
  readonly officialSubsiteLabel: string;
  readonly officialDocsLabel: string;
  readonly officialLoginLabel: string;
  readonly officialDownloadLabel: string;
  readonly officialSupportLabel: string;
  readonly allLabel: string;
};

export type DeepSearchResultSurfaceProps = {
  readonly logoUrl: string;
  readonly inputValue: string;
  readonly placeholder: string;
  readonly searchActionLabel: string;
  readonly deepSearchEnabled: boolean;
  readonly labels: DeepSearchResultSurfaceLabels;
  readonly snapshot: SearchDeepSnapshot;
  readonly searching: boolean;
  readonly viewportMemoryKey: string;
  readonly restoreViewportEnabled: boolean;
  readonly localOpenBehavior: DeepSearchLocalOpenBehavior;
  readonly sourceFilter: DeepSearchSourceFilter;
  readonly sharedStartRect?: DOMRect | null;
  readonly onInputChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onToggleDeepSearch: () => void;
  readonly onCancel: () => void;
  readonly onExpandNode: (nodeId: string) => void;
  readonly onSourceFilterChange: (value: DeepSearchSourceFilter) => void;
  readonly onOpenUrl?: (url: string, title: string) => void;
  readonly onOpenLocalPath?: (path: string) => void;
  readonly onRevealLocalPath?: (path: string) => void;
  readonly onSharedAnimationDone?: () => void;
};

export const DeepSearchResultSurface = ({
  logoUrl,
  inputValue,
  placeholder,
  searchActionLabel,
  deepSearchEnabled,
  labels,
  snapshot,
  searching,
  viewportMemoryKey,
  restoreViewportEnabled,
  localOpenBehavior,
  sourceFilter,
  sharedStartRect,
  onInputChange,
  onSubmit,
  onToggleDeepSearch,
  onCancel,
  onExpandNode,
  onSourceFilterChange,
  onOpenUrl,
  onOpenLocalPath,
  onRevealLocalPath,
  onSharedAnimationDone
}: DeepSearchResultSurfaceProps) => {
  const runtime = useDeepSearchSurfaceRuntime({
    labels,
    snapshot,
    viewportMemoryKey,
    restoreViewportEnabled,
    localOpenBehavior,
    sourceFilter,
    sharedStartRect,
    onExpandNode,
    onOpenUrl,
    onOpenLocalPath,
    onRevealLocalPath,
    onSharedAnimationDone
  });
  const titlebarContribution = useMemo(
    () => ({
      ariaLabel: labels.headingLabel,
      content: (
        <>
          <span className="lyra-titlebar-context-chip">{snapshot.query}</span>
          <span className="lyra-titlebar-context-chip">
            {labels.budgetLabel} {snapshot.budgetPreset}
          </span>
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
              aria-label={labels.deepSearchToggleLabel}
              onClick={onToggleDeepSearch}
            >
              {labels.deepSearchChipLabel}
            </button>
            {([
              ["all", labels.allLabel],
              ["web", labels.webLabel],
              ["local", labels.localLabel]
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={
                  sourceFilter === value
                    ? "lyra-titlebar-context-text-button lyra-titlebar-context-button-active"
                    : "lyra-titlebar-context-text-button"
                }
                aria-label={`${labels.sourceFilterLabel}: ${label}`}
                onClick={() => {
                  onSourceFilterChange(value);
                }}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className="lyra-titlebar-context-text-button"
              onClick={onCancel}
              disabled={!searching}
            >
              {labels.stopLabel}
            </button>
            <button
              type="button"
              className="lyra-titlebar-context-text-button"
              onClick={runtime.onFitView}
            >
              {labels.fitViewLabel}
            </button>
            <button
              type="button"
              className="lyra-titlebar-context-text-button"
              onClick={runtime.onResetLayout}
            >
              {labels.resetLayoutLabel}
            </button>
          </div>
        </>
      )
    }),
    [
      deepSearchEnabled,
      labels,
      onCancel,
      onSourceFilterChange,
      onToggleDeepSearch,
      runtime.onFitView,
      runtime.onResetLayout,
      searching,
      snapshot.budgetPreset,
      snapshot.query,
      sourceFilter
    ]
  );
  useWorkbenchTitlebarContribution(titlebarContribution);

  void inputValue;
  void logoUrl;
  void onInputChange;
  void onSubmit;
  void placeholder;
  void searchActionLabel;
  void runtime.pillRef;

  return (
    <section className="lyra-results-shell lyra-deep-search-shell" aria-label="deep-search-results-surface">
      <div className="lyra-deep-search-grid">
        <DeepSearchCanvas
          snapshot={runtime.filteredSnapshot}
          selectedNodeId={runtime.selectedNodeId}
          loadingLabel={labels.loadingLabel}
          emptyLabel={labels.emptyLabel}
          officialResultLabel={labels.officialResultLabel}
          officialCategoryLabels={{
            official_homepage: labels.officialHomepageLabel,
            official_subsite: labels.officialSubsiteLabel,
            official_docs: labels.officialDocsLabel,
            official_login: labels.officialLoginLabel,
            official_download: labels.officialDownloadLabel,
            official_support: labels.officialSupportLabel
          }}
          fitViewNonce={runtime.fitViewNonce}
          focusSelectionNonce={runtime.focusSelectionNonce}
          resetLayoutNonce={runtime.resetLayoutNonce}
          connectedEdgeIds={runtime.connectedEdgeIds}
          highlightedEdgeId={runtime.highlightedEdgeId}
          edgeReasonLabels={runtime.edgeReasonLabels}
          savedViewport={runtime.savedViewport}
          restoreViewportEnabled={restoreViewportEnabled}
          onSelectNode={runtime.setSelectedNodeId}
          onHighlightEdge={runtime.setHighlightedEdgeId}
          onViewportChange={runtime.onViewportChange}
          onOpenWebResult={onOpenUrl}
          onOpenLocalResult={runtime.onOpenLocalPrimary}
          onExpandNode={onExpandNode}
        />

        <DeepSearchOverview
          labels={labels}
          snapshot={snapshot}
          selectedNode={runtime.selectedNode}
          connectedEdges={runtime.connectedEdges}
          lineage={runtime.lineage}
          sourceFilter={sourceFilter}
          edgeKindFilter={runtime.edgeKindFilter}
          edgeDirectionFilter={runtime.edgeDirectionFilter}
          localPrimaryAction={localOpenBehavior}
          onOpenSelected={runtime.onOpenSelected}
          onRevealSelected={runtime.onRevealSelected}
          onExpandSelected={runtime.onExpandSelected}
          onCenterSelected={runtime.onCenterSelected}
          onSourceFilterChange={onSourceFilterChange}
          onEdgeKindFilterChange={runtime.setEdgeKindFilter}
          onEdgeDirectionFilterChange={runtime.setEdgeDirectionFilter}
          onHighlightEdge={runtime.setHighlightedEdgeId}
        />
      </div>
    </section>
  );
};
