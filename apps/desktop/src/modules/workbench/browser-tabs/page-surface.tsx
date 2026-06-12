import { useCallback, useMemo } from "react";

import { AppButton } from "@renderer/ui/components";
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
  readonly localIndexNotReadyLabel?: string;
  readonly localSearchReady?: boolean;
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
  localIndexNotReadyLabel,
  localSearchReady = true,
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
              <AppButton
                variant="ghost"
                size="sm"
                className={
                  searchSource === "local"
                    ? "lyra-titlebar-context-text-button lyra-titlebar-context-button-active"
                    : "lyra-titlebar-context-text-button"
                }
                aria-label={`${sourceFilterLabel}: ${localTabLabel}`}
                disabled={!localSearchReady}
                title={localSearchReady ? undefined : localIndexNotReadyLabel}
                onClick={() => {
                  if (!localSearchReady) {
                    return;
                  }
                  onSwitchToLocalSearch?.();
                }}
              >
                {localTabLabel}
              </AppButton>
              <AppButton
                variant="ghost"
                size="sm"
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
              </AppButton>
              {searchEngines.map((engine) => (
                <AppButton
                  key={engine.id}
                  variant="ghost"
                  size="sm"
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
                </AppButton>
              ))}
            </div>
          </>
        )
      };
    },
    [
      localTabLabel,
      localIndexNotReadyLabel,
      localSearchReady,
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
