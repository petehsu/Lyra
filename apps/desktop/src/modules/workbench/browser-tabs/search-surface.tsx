import { Search } from "lucide-react";
import { useMemo } from "react";

import type { SearchEngineDefinition } from "../browser-search/types";
import { LyraBrandLogo } from "../brand";
import { useWorkbenchTitlebarContribution } from "../shell/titlebar-context";
import { SearchSilkBackground } from "./search-silk-background";

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
          <div className="lyra-titlebar-context-controls">
            <button
              type="button"
              className="lyra-titlebar-context-text-button lyra-titlebar-context-button-active"
              aria-label={`${sourceFilterLabel}: ${autoSearchLabel}`}
              onClick={onSubmit}
            >
              {autoSearchLabel}
            </button>
            {searchEngines.map((engine) => (
              <button
                key={engine.id}
                type="button"
                className="lyra-titlebar-context-text-button"
                aria-label={`${sourceFilterLabel}: ${engine.label}`}
                onClick={() => {
                  onSearchEngineSubmit?.(engine.id);
                }}
              >
                {engine.label}
              </button>
            ))}
          </div>
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
      <SearchSilkBackground />
      <div className="lyra-browser-search-row">
        <div className="lyra-browser-pill" ref={onPillRef}>
          <span className="lyra-logo-circle lyra-logo-static">
            <LyraBrandLogo
              logoUrl={logoUrl}
              motion="ambient"
              spinIntensity="subtle"
              spinDurationMs={22000}
            />
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
          <button
            className="lyra-search-circle"
            aria-label={searchActionLabel}
            title={searchActionLabel}
            onClick={onSubmit}
          >
            <Search size={20} />
          </button>
        </div>
      </div>
    </div>
  );
};
