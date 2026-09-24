export type Block = {
  readonly type: string;
  readonly docxIndex: number | null;
  readonly originalXml: string | null;
  readonly hidden?: boolean;
  readonly runs?: readonly { readonly text: string }[];
  readonly previewText?: string;
  readonly label?: string;
};

export type ParsedDocx = {
  readonly blocks: readonly Block[];
};

export type SaveBlock =
  | { readonly kind: "original"; readonly docxIndex: number }
  | { readonly kind: "xml"; readonly xml: string; readonly docxIndex: number };

export function parseDocx(bytes: Uint8Array): Promise<ParsedDocx>;

export function saveDocx(
  parsed: ParsedDocx,
  finalBlocks: readonly SaveBlock[]
): Promise<Uint8Array>;

export function patchParagraphTexts(entryXml: string, newText: string): string | null;

export function buildBlankDocx(): Promise<Uint8Array>;
