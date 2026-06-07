import { useCallback, useMemo } from "react";

import { useWorkbenchTitlebarContribution } from "../shell/titlebar-context";
import type { SearchEngineDefinition } from "../browser-search/types";
import { resolveNextSearchEngineSelection } from "../browser-search/service";

export type BrowserPageSurfaceProps = {
  readonly tabId: string;
  readonly searchQuery?: string;
  readonly searchSource?: "web" | "local";
  readonly searchEngineSelectionMode?: "auto" | "manual";
  readonly searchSelectedEngineIds?: readonly string[];
  readonly searchEngines?: readonly SearchEngineDefinition[];
  readonly sourceFilterLabel?: string;
  readonly autoSearchLabel?: string;
  readonly webTabLabel?: string;
  readonly localTabLabel?: string;
  readonly onSearchEngineSelectionChange?: (
    selection: {
      readonly mode: "auto" | "manual";
      readonly engineIds: readonly string[];
    }
  ) => void;
  readonly onSwitchToLocalSearch?: () => void;
  readonly onHostChange?: (tabId: string, element: HTMLElement | null) => void;
};

export const BrowserPageSurface = ({
  tabId,
  searchQuery,
  searchSource,
  searchEngineSelectionMode,
  searchSelectedEngineIds = [],
  searchEngines = [],
  sourceFilterLabel,
  autoSearchLabel,
  webTabLabel,
  localTabLabel,
  onSearchEngineSelectionChange,
  onSwitchToLocalSearch,
  onHostChange
}: BrowserPageSurfaceProps) => {
  const handleHostRef = useCallback(
    (element: HTMLElement | null) => {
      onHostChange?.(tabId, element);
    },
    [onHostChange, tabId]
  );
  const titlebarContribution = useMemo(
    () => {
      if (
        searchQuery === undefined ||
        sourceFilterLabel === undefined ||
        autoSearchLabel === undefined ||
        webTabLabel === undefined ||
        localTabLabel === undefined
      ) {
        return null;
      }
      return {
        ariaLabel: sourceFilterLabel,
        content: (
          <>
            <span className="lyra-titlebar-context-chip">{searchQuery}</span>
            <div className="lyra-titlebar-context-controls">
              <button
                type="button"
                className={
                  searchSource === "local"
                    ? "lyra-titlebar-context-text-button lyra-titlebar-context-button-active"
                    : "lyra-titlebar-context-text-button"
                }
                aria-label={`${sourceFilterLabel}: ${localTabLabel}`}
                onClick={onSwitchToLocalSearch}
              >
                {localTabLabel}
              </button>
              <button
                type="button"
                className={
                  searchEngineSelectionMode !== "manual"
                    ? "lyra-titlebar-context-text-button lyra-titlebar-context-button-active"
                    : "lyra-titlebar-context-text-button"
                }
                aria-label={`${sourceFilterLabel}: ${autoSearchLabel}`}
                onClick={() => {
                  onSearchEngineSelectionChange?.({ mode: "auto", engineIds: [] });
                }}
              >
                {autoSearchLabel}
              </button>
              {searchEngines.map((engine) => (
                <button
                  key={engine.id}
                  type="button"
                  className={
                    searchEngineSelectionMode === "manual" &&
                    searchSelectedEngineIds.includes(engine.id)
                      ? "lyra-titlebar-context-text-button lyra-titlebar-context-button-active"
                      : "lyra-titlebar-context-text-button"
                  }
                  aria-label={`${sourceFilterLabel}: ${engine.label}`}
                  onClick={() => {
                    onSearchEngineSelectionChange?.(
                      resolveNextSearchEngineSelection({
                        currentMode: searchEngineSelectionMode ?? "auto",
                        currentEngineIds: searchSelectedEngineIds,
                        clickedEngineId: engine.id
                      })
                    );
                  }}
                >
                  {engine.label}
                </button>
              ))}
            </div>
          </>
        )
      };
    },
    [
      localTabLabel,
      autoSearchLabel,
      onSearchEngineSelectionChange,
      onSwitchToLocalSearch,
      searchEngineSelectionMode,
      searchEngines,
      searchSelectedEngineIds,
      searchQuery,
      searchSource,
      sourceFilterLabel,
      webTabLabel
    ]
  );
  useWorkbenchTitlebarContribution(titlebarContribution);

  return (
    <section
      ref={handleHostRef}
      className="lyra-page-host"
      aria-label="page-surface"
      data-browser-page-host="true"
      data-tab-id={tabId}
    />
  );
};
