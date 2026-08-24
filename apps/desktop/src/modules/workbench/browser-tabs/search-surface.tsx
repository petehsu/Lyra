import { useMemo } from "react";

import { AppSearchField, AppTabs } from "@renderer/ui/components";
import type { SearchEngineDefinition } from "../browser-search/types";
import { LyraBrandLogo } from "../brand";
import { useWorkbenchTitlebarContribution } from "../shell/titlebar-context";

export type BrowserSearchSurfaceProps = {
  readonly logoUrl: string;
  readonly inputValue: string;
  readonly placeholder: string;
  readonly searchActionLabel: string;
  readonly autoSearchLabel?: string;
  readonly sourceFilterLabel?: string;
  readonly searchEngines?: readonly SearchEngineDefinition[];
  readonly onPillRef?: (element: HTMLDivElement | null) => void;
  readonly onInputChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onSearchEngineSubmit?: (engineId: string) => void;
};

export const BrowserSearchSurface = ({
  logoUrl,
  inputValue,
  placeholder,
  searchActionLabel,
  autoSearchLabel,
  sourceFilterLabel,
  searchEngines = [],
  onPillRef,
  onInputChange,
  onSubmit,
  onSearchEngineSubmit
}: BrowserSearchSurfaceProps) => {
  const titlebarContribution = useMemo(
    () => {
      if (autoSearchLabel === undefined || sourceFilterLabel === undefined) {
        return null;
      }
      return {
        ariaLabel: sourceFilterLabel,
        content: (
          <AppTabs
            ariaLabel={`${sourceFilterLabel} options`}
            className="lyra-titlebar-context-tabs"
            selectionMode="multiple"
            value="auto"
            activeValues={["auto"]}
            options={[
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
              if (value === "auto") {
                onSubmit();
                return;
              }
              onSearchEngineSubmit?.(value);
            }}
          />
        )
      };
    },
    [
      autoSearchLabel,
      onSearchEngineSubmit,
      onSubmit,
      searchEngines,
      sourceFilterLabel
    ]
  );
  useWorkbenchTitlebarContribution(titlebarContribution);

  return (
    <div className="lyra-workspace-browser-shell">
      <div className="lyra-browser-search-row">
        <AppSearchField
          ariaLabel="browser-address-input"
          value={inputValue}
          placeholder={placeholder}
          submitLabel={searchActionLabel}
          {...(onPillRef === undefined ? {} : { containerRef: onPillRef })}
          className="lyra-browser-pill lyra-browser-pill-app-field"
          leading={(
            <LyraBrandLogo
              logoUrl={logoUrl}
              motion="ambient"
              spinIntensity="subtle"
              spinDurationMs={22000}
            />
          )}
          onValueChange={onInputChange}
          onSubmit={onSubmit}
        />
      </div>
    </div>
  );
};
