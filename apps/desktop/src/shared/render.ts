export type RenderTheme = "dark" | "light" | "auto";

export type RenderDocumentMode = "document" | "fragment";

export type RenderDocumentRequest = {
  readonly content: string;
  readonly mode?: RenderDocumentMode;
  readonly theme?: RenderTheme;
  readonly enableMath?: boolean;
  readonly enableMermaid?: boolean;
  readonly highlightCode?: boolean;
  readonly locale?: string;
};

export type HighlightSpan = {
  readonly start: number;
  readonly end: number;
  readonly scope: string;
};

export type HighlightRequest = {
  readonly language: string;
  readonly source: string;
  readonly theme?: RenderTheme;
};

export type InlineRenderNode =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "code"; readonly value: string }
  | { readonly kind: "strong"; readonly children: readonly InlineRenderNode[] }
  | { readonly kind: "emphasis"; readonly children: readonly InlineRenderNode[] }
  | { readonly kind: "strikethrough"; readonly children: readonly InlineRenderNode[] }
  | {
      readonly kind: "link";
      readonly href: string;
      readonly title?: string;
      readonly children: readonly InlineRenderNode[];
    }
  | {
      readonly kind: "image";
      readonly src: string;
      readonly alt: string;
      readonly title?: string;
    }
  | {
      readonly kind: "mathInline";
      readonly latex: string;
      readonly svg?: string;
      readonly error?: string;
    }
  | { readonly kind: "softBreak" }
  | { readonly kind: "hardBreak" };

export type RenderBlock =
  | { readonly kind: "paragraph"; readonly children: readonly InlineRenderNode[] }
  | { readonly kind: "heading"; readonly level: number; readonly children: readonly InlineRenderNode[] }
  | { readonly kind: "blockquote"; readonly children: readonly RenderBlock[] }
  | {
      readonly kind: "list";
      readonly ordered: boolean;
      readonly items: readonly {
        readonly checked?: boolean;
        readonly children: readonly RenderBlock[];
      }[];
    }
  | {
      readonly kind: "codeBlock";
      readonly language?: string;
      readonly source: string;
      readonly spans: readonly HighlightSpan[];
    }
  | {
      readonly kind: "mermaid";
      readonly source: string;
      readonly svg?: string;
      readonly error?: string;
    }
  | {
      readonly kind: "mathBlock";
      readonly latex: string;
      readonly svg?: string;
      readonly error?: string;
    }
  | {
      readonly kind: "table";
      readonly headers: readonly InlineRenderNode[][];
      readonly rows: readonly InlineRenderNode[][][];
    }
  | {
      readonly kind: "details";
      readonly summary: readonly InlineRenderNode[];
      readonly children: readonly RenderBlock[];
    }
  | { readonly kind: "thematicBreak" };

export type LyraRenderDocument = {
  readonly blocks: readonly RenderBlock[];
};

export type RenderApi = {
  readonly renderDocument: (request: RenderDocumentRequest) => Promise<LyraRenderDocument>;
  readonly highlightSpans: (request: HighlightRequest) => Promise<readonly HighlightSpan[]>;
  readonly invalidateCache: () => Promise<void>;
};