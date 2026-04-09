import { Search } from "lucide-react";

import { LyraBrandLogo } from "../brand";

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
}: BrowserSearchSurfaceProps) => (
  <div className="lyra-workspace-browser-shell">
    <div className="lyra-browser-pill" ref={onPillRef}>
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
  </div>
);
