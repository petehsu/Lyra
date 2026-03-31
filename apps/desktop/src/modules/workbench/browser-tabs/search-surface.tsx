import { Search } from "lucide-react";

import { LyraBrandLogo } from "../brand";

export type BrowserSearchSurfaceProps = {
  readonly logoUrl: string;
  readonly inputValue: string;
  readonly placeholder: string;
  readonly searchActionLabel: string;
  readonly onPillRef?: (element: HTMLDivElement | null) => void;
  readonly onInputChange: (value: string) => void;
  readonly onSubmit: () => void;
};

export const BrowserSearchSurface = ({
  logoUrl,
  inputValue,
  placeholder,
  searchActionLabel,
  onPillRef,
  onInputChange,
  onSubmit
}: BrowserSearchSurfaceProps) => (
  <div className="lyra-workspace-browser-shell">
    <div className="lyra-browser-pill" ref={onPillRef}>
      <span className="lyra-logo-circle">
        <LyraBrandLogo logoUrl={logoUrl} />
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
      <button className="lyra-search-circle" aria-label={searchActionLabel} onClick={onSubmit}>
        <Search size={14} />
      </button>
    </div>
  </div>
);
