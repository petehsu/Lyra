import type { RefObject } from "react";
import { Search } from "lucide-react";

import { LyraBrandLogo } from "../brand";

type ResultSurfaceTopbarProps = {
  readonly pillRef: RefObject<HTMLDivElement>;
  readonly logoUrl: string;
  readonly inputValue: string;
  readonly placeholder: string;
  readonly searchActionLabel: string;
  readonly deepSearchToggleLabel: string;
  readonly deepSearchEnabled: boolean;
  readonly deepSearchChipLabel: string;
  readonly headingLabel: string;
  readonly query: string;
  readonly onInputChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onToggleDeepSearch: () => void;
};

export const ResultSurfaceTopbar = ({
  pillRef,
  logoUrl,
  inputValue,
  placeholder,
  searchActionLabel,
  deepSearchToggleLabel,
  deepSearchEnabled,
  deepSearchChipLabel,
  headingLabel,
  query,
  onInputChange,
  onSubmit,
  onToggleDeepSearch
}: ResultSurfaceTopbarProps) => (
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
      <span>{query}</span>
    </div>
  </header>
);
