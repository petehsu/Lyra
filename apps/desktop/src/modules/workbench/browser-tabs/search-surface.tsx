import { Search } from "lucide-react";

import { LyraBrandLogo } from "../brand";
import { LyraListPicker, type LyraListPickerOption } from "../list-picker";
import { SearchSilkBackground } from "./search-silk-background";

export type BrowserSearchSurfaceProps = {
  readonly logoUrl: string;
  readonly inputValue: string;
  readonly placeholder: string;
  readonly searchActionLabel: string;
  readonly deepSearchToggleLabel: string;
  readonly deepSearchEnabled: boolean;
  readonly deepSearchChipLabel: string;
  readonly onPillRef?: (element: HTMLDivElement | null) => void;
  readonly onInputChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onToggleDeepSearch: () => void;
};

export const BrowserSearchSurface = ({
  logoUrl,
  inputValue,
  placeholder,
  searchActionLabel,
  deepSearchToggleLabel,
  deepSearchEnabled,
  deepSearchChipLabel,
  onPillRef,
  onInputChange,
  onSubmit,
  onToggleDeepSearch
}: BrowserSearchSurfaceProps) => {
  type SearchMode = "standard" | "deep";
  const searchMode: SearchMode = deepSearchEnabled ? "deep" : "standard";
  const searchModeOptions: readonly LyraListPickerOption<SearchMode>[] = [
    { value: "standard", label: searchActionLabel },
    { value: "deep", label: deepSearchChipLabel }
  ];

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
        <LyraListPicker
          className="lyra-browser-search-mode-picker"
          ariaLabel={deepSearchToggleLabel}
          value={searchMode}
          options={searchModeOptions}
          variant="compact"
          shape="pill"
          onChange={(nextMode) => {
            const nextDeepSearchEnabled = nextMode === "deep";
            if (nextDeepSearchEnabled !== deepSearchEnabled) {
              onToggleDeepSearch();
            }
          }}
        />
      </div>
    </div>
  );
};
