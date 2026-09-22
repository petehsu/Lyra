export type SlideElement = {
  readonly id: string;
  readonly type: string;
  readonly text?: {
    readonly paragraphs: readonly {
      readonly runs: readonly { readonly text: string }[];
    }[];
  };
};

export type OpenedPptx = {
  readonly deck: {
    readonly slides: readonly {
      readonly elements: readonly SlideElement[];
    }[];
  };
};

export function openPptx(bytes: Uint8Array): Promise<OpenedPptx>;

export function savePptx(opened: OpenedPptx): Promise<Uint8Array>;

export function elementDurableId(element: SlideElement): string | null;

export type PptxTxnResult = {
  readonly applied: boolean;
  readonly failures?: readonly { readonly index: number; readonly error: string }[];
};

export function runTxn(
  opened: OpenedPptx,
  request: { readonly ops: readonly Record<string, unknown>[] }
): PptxTxnResult;
