import {
  clearCache as clearCoreCache,
  layout as layoutCore,
  layoutWithLines as layoutWithLinesCore,
  prepareWithSegments as prepareCore,
  setLocale as setCoreLocale,
  type LayoutLine,
  type PrepareOptions,
  type PreparedTextWithSegments
} from "./core/layout";
import type {
  AiPreparedText,
  AiTextLayoutLinesResult,
  AiTextLayoutMeasureOptions,
  AiTextLayoutPrepareOptions,
  AiTextLayoutResult,
  AiTextLayoutService,
  AiTextLayoutWhiteSpace
} from "./types";

const DEFAULT_LINE_HEIGHT_PX = 18;
const GRAPHEME_SEGMENTER =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

const normalizeWhiteSpace = (
  value: AiTextLayoutWhiteSpace | undefined
): AiTextLayoutWhiteSpace => value ?? "normal";

const normalizeLocale = (locale: string | undefined): string | undefined => {
  if (locale === undefined) {
    return undefined;
  }
  const normalized = locale.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const clampPositiveNumber = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? value : fallback;

const parseFontSizePx = (font: string): number => {
  const matched = font.match(/(\d+(?:\.\d+)?)\s*px/i);
  if (matched?.[1] === undefined) {
    return 16;
  }
  const parsed = Number.parseFloat(matched[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 16;
};

const toGraphemes = (text: string): string[] => {
  if (text.length === 0) {
    return [];
  }

  if (GRAPHEME_SEGMENTER !== null) {
    const segments: string[] = [];
    for (const segment of GRAPHEME_SEGMENTER.segment(text)) {
      segments.push(segment.segment);
    }
    return segments;
  }

  return Array.from(text);
};

const estimateGraphemeWidthPx = (grapheme: string, fontSizePx: number): number => {
  if (grapheme === "\t") {
    return fontSizePx * 2.8;
  }
  if (/\s/.test(grapheme)) {
    return fontSizePx * 0.36;
  }
  if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(grapheme)) {
    return fontSizePx;
  }
  if (/\p{Emoji_Presentation}|\p{Extended_Pictographic}/u.test(grapheme)) {
    return fontSizePx * 1.1;
  }
  return fontSizePx * 0.56;
};

const normalizeFallbackSourceText = (
  text: string,
  whiteSpace: AiTextLayoutWhiteSpace
): readonly string[] => {
  if (whiteSpace === "pre-wrap") {
    return text.split(/\r?\n/);
  }

  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length === 0 ? [""] : [collapsed];
};

const fallbackLayoutLines = (
  text: string,
  maxWidthPx: number,
  lineHeightPx: number,
  font: string,
  whiteSpace: AiTextLayoutWhiteSpace
): { readonly lines: readonly LayoutLine[]; readonly lineCount: number; readonly heightPx: number } => {
  const safeWidthPx = Math.max(1, Math.floor(clampPositiveNumber(maxWidthPx, 1)));
  const safeLineHeightPx = clampPositiveNumber(lineHeightPx, DEFAULT_LINE_HEIGHT_PX);
  const fontSizePx = parseFontSizePx(font);
  const sourceLines = normalizeFallbackSourceText(text, whiteSpace);

  const lines: LayoutLine[] = [];

  let globalSegmentIndex = 0;

  for (const sourceLine of sourceLines) {
    const graphemes = toGraphemes(sourceLine);
    if (graphemes.length === 0) {
      lines.push({
        text: "",
        width: 0,
        start: { segmentIndex: globalSegmentIndex, graphemeIndex: 0 },
        end: { segmentIndex: globalSegmentIndex, graphemeIndex: 0 }
      });
      globalSegmentIndex += 1;
      continue;
    }

    let rowText = "";
    let rowWidth = 0;
    let rowStart = 0;

    for (let index = 0; index < graphemes.length; index += 1) {
      const grapheme = graphemes[index] ?? "";
      const nextWidth = estimateGraphemeWidthPx(grapheme, fontSizePx);

      if (rowText.length > 0 && rowWidth + nextWidth > safeWidthPx) {
        lines.push({
          text: rowText,
          width: rowWidth,
          start: { segmentIndex: globalSegmentIndex, graphemeIndex: rowStart },
          end: { segmentIndex: globalSegmentIndex, graphemeIndex: index }
        });
        rowText = grapheme;
        rowWidth = nextWidth;
        rowStart = index;
        continue;
      }

      rowText += grapheme;
      rowWidth += nextWidth;
    }

    lines.push({
      text: rowText,
      width: rowWidth,
      start: { segmentIndex: globalSegmentIndex, graphemeIndex: rowStart },
      end: { segmentIndex: globalSegmentIndex, graphemeIndex: graphemes.length }
    });

    globalSegmentIndex += 1;
  }

  const lineCount = lines.length;
  return {
    lines,
    lineCount,
    heightPx: lineCount * safeLineHeightPx
  };
};

const createPrepareKey = (
  text: string,
  font: string,
  whiteSpace: AiTextLayoutWhiteSpace,
  locale: string | undefined
): string => `${locale ?? "<default>"}::${whiteSpace}::${font}::${text}`;

export const createAiTextLayoutService = (): AiTextLayoutService => {
  const preparedCache = new Map<string, AiPreparedText>();

  let activeLocale: string | undefined;
  let coreAvailable = true;

  const syncLocale = (locale: string | undefined): void => {
    const normalizedLocale = normalizeLocale(locale);
    if (normalizedLocale === activeLocale) {
      return;
    }

    activeLocale = normalizedLocale;
    preparedCache.clear();

    if (coreAvailable === false) {
      return;
    }

    try {
      setCoreLocale(normalizedLocale);
    } catch {
      coreAvailable = false;
    }
  };

  const prepare = (
    text: string,
    font: string,
    options?: AiTextLayoutPrepareOptions
  ): AiPreparedText => {
    const whiteSpace = normalizeWhiteSpace(options?.whiteSpace);
    const locale = normalizeLocale(options?.locale);

    syncLocale(locale);

    const key = createPrepareKey(text, font, whiteSpace, locale);
    const cached = preparedCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    let corePrepared: PreparedTextWithSegments | null = null;
    if (coreAvailable) {
      try {
        corePrepared = prepareCore(text, font, { whiteSpace } satisfies PrepareOptions);
      } catch {
        coreAvailable = false;
      }
    }

    const prepared: AiPreparedText = {
      key,
      text,
      font,
      whiteSpace,
      ...(locale === undefined ? {} : { locale }),
      corePrepared
    };

    preparedCache.set(key, prepared);
    return prepared;
  };

  const layout = (
    prepared: AiPreparedText,
    maxWidthPx: number,
    lineHeightPx: number,
    maxLines?: number
  ): AiTextLayoutResult => {
    const safeWidthPx = clampPositiveNumber(maxWidthPx, 1);
    const safeLineHeightPx = clampPositiveNumber(lineHeightPx, DEFAULT_LINE_HEIGHT_PX);
    const safeMaxLines = maxLines !== undefined && maxLines > 0 ? Math.floor(maxLines) : undefined;

    let lineCount = 0;

    if (prepared.corePrepared !== null && coreAvailable) {
      try {
        lineCount = layoutCore(
          prepared.corePrepared as PreparedTextWithSegments,
          safeWidthPx,
          safeLineHeightPx
        ).lineCount;
      } catch {
        coreAvailable = false;
      }
    }

    if (lineCount === 0 && prepared.text.length > 0) {
      lineCount = fallbackLayoutLines(
        prepared.text,
        safeWidthPx,
        safeLineHeightPx,
        prepared.font,
        prepared.whiteSpace
      ).lineCount;
    }

    const isOverflowing = safeMaxLines !== undefined && lineCount > safeMaxLines;
    const effectiveLineCount =
      safeMaxLines !== undefined
        ? Math.min(lineCount, safeMaxLines)
        : lineCount;

    return {
      lineCount,
      heightPx: effectiveLineCount * safeLineHeightPx,
      isOverflowing
    };
  };

  const layoutWithLines = (
    prepared: AiPreparedText,
    maxWidthPx: number,
    lineHeightPx: number,
    maxLines?: number
  ): AiTextLayoutLinesResult => {
    const safeWidthPx = clampPositiveNumber(maxWidthPx, 1);
    const safeLineHeightPx = clampPositiveNumber(lineHeightPx, DEFAULT_LINE_HEIGHT_PX);
    const safeMaxLines = maxLines !== undefined && maxLines > 0 ? Math.floor(maxLines) : undefined;

    let lines: readonly LayoutLine[] = [];
    let lineCount = 0;

    if (prepared.corePrepared !== null && coreAvailable) {
      try {
        const result = layoutWithLinesCore(
          prepared.corePrepared as PreparedTextWithSegments,
          safeWidthPx,
          safeLineHeightPx
        );
        lines = result.lines;
        lineCount = result.lineCount;
      } catch {
        coreAvailable = false;
      }
    }

    if (lineCount === 0 && prepared.text.length > 0) {
      const fallback = fallbackLayoutLines(
        prepared.text,
        safeWidthPx,
        safeLineHeightPx,
        prepared.font,
        prepared.whiteSpace
      );
      lines = fallback.lines;
      lineCount = fallback.lineCount;
    }

    const isOverflowing = safeMaxLines !== undefined && lineCount > safeMaxLines;
    const effectiveLines =
      safeMaxLines === undefined
        ? lines
        : lines.slice(0, safeMaxLines);

    return {
      lines: effectiveLines,
      lineCount,
      heightPx: effectiveLines.length * safeLineHeightPx,
      isOverflowing
    };
  };

  return {
    prepare,
    layout,
    layoutWithLines,
    measureParagraph: (options: AiTextLayoutMeasureOptions): AiTextLayoutResult => {
      const prepared = prepare(options.text, options.font, {
        ...(options.whiteSpace === undefined ? {} : { whiteSpace: options.whiteSpace }),
        ...(options.locale === undefined ? {} : { locale: options.locale })
      });
      return layout(prepared, options.maxWidthPx, options.lineHeightPx, options.maxLines);
    },
    isOverflowing: (options: AiTextLayoutMeasureOptions): boolean => {
      const result = layout(
        prepare(options.text, options.font, {
          ...(options.whiteSpace === undefined ? {} : { whiteSpace: options.whiteSpace }),
          ...(options.locale === undefined ? {} : { locale: options.locale })
        }),
        options.maxWidthPx,
        options.lineHeightPx,
        options.maxLines
      );
      return result.isOverflowing;
    },
    clearCache: (): void => {
      preparedCache.clear();
      if (coreAvailable) {
        clearCoreCache();
      }
    }
  };
};

export const aiTextLayoutService = createAiTextLayoutService();
