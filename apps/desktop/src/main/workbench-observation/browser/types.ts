export type BrowserDomSummaryReadOptions = {
  readonly maxChars?: number;
  readonly maxLinks?: number;
  readonly maxHeadings?: number;
  readonly maxForms?: number;
};

export type BrowserTextExtractionScope = "main" | "full";

export type BrowserTextExtractOptions = {
  readonly scope?: BrowserTextExtractionScope;
  readonly maxChars?: number;
  readonly cursor?: number;
};
