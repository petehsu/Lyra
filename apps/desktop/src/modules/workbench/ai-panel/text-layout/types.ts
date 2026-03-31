import type { LayoutLine } from "./core/layout";

export type AiTextLayoutWhiteSpace = "normal" | "pre-wrap";

export type AiPreparedText = {
  readonly key: string;
  readonly text: string;
  readonly font: string;
  readonly locale?: string;
  readonly whiteSpace: AiTextLayoutWhiteSpace;
  readonly corePrepared: unknown | null;
};

export type AiTextLayoutPrepareOptions = {
  readonly whiteSpace?: AiTextLayoutWhiteSpace;
  readonly locale?: string;
};

export type AiTextLayoutMeasureOptions = {
  readonly text: string;
  readonly font: string;
  readonly maxWidthPx: number;
  readonly lineHeightPx: number;
  readonly whiteSpace?: AiTextLayoutWhiteSpace;
  readonly locale?: string;
  readonly maxLines?: number;
};

export type AiTextLayoutResult = {
  readonly lineCount: number;
  readonly heightPx: number;
  readonly isOverflowing: boolean;
};

export type AiTextLayoutLinesResult = AiTextLayoutResult & {
  readonly lines: readonly LayoutLine[];
};

export type AiTextLayoutService = {
  readonly prepare: (
    text: string,
    font: string,
    options?: AiTextLayoutPrepareOptions
  ) => AiPreparedText;
  readonly layout: (
    prepared: AiPreparedText,
    maxWidthPx: number,
    lineHeightPx: number,
    maxLines?: number
  ) => AiTextLayoutResult;
  readonly layoutWithLines: (
    prepared: AiPreparedText,
    maxWidthPx: number,
    lineHeightPx: number,
    maxLines?: number
  ) => AiTextLayoutLinesResult;
  readonly measureParagraph: (options: AiTextLayoutMeasureOptions) => AiTextLayoutResult;
  readonly isOverflowing: (options: AiTextLayoutMeasureOptions) => boolean;
  readonly clearCache: () => void;
};
