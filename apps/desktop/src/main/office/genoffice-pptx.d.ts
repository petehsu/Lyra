export type SlideElement = {
  readonly id: string;
  readonly type: string;
  readonly transform: {
    readonly offset: { readonly x: number; readonly y: number; readonly cx: number; readonly cy: number };
  };
  readonly text?: {
    readonly paragraphs: readonly {
      readonly runs: readonly { readonly text: string }[];
    }[];
  };
};

export type SlideModel = {
  readonly path: string;
  readonly elements: readonly SlideElement[];
};

export type OpenedPptx = {
  readonly archive: unknown;
  readonly deck: {
    readonly size: { readonly cx: number; readonly cy: number };
    readonly slides: readonly SlideModel[];
  };
};

export function openPptx(bytes: Uint8Array): Promise<OpenedPptx>;

export function savePptx(opened: OpenedPptx): Promise<Uint8Array>;

export function elementDurableId(element: SlideElement): string | null;

export function slideDurableId(slide: { readonly path: string }): string;

export function getSlideNotes(archive: unknown, slidePath: string): string;

export type PptxTxnResult = {
  readonly applied: boolean;
  readonly failures?: readonly { readonly index: number; readonly error: string }[];
};

export function runTxn(
  opened: OpenedPptx,
  request: { readonly ops: readonly Record<string, unknown>[] }
): PptxTxnResult;

export function mergeSlideFromPptx(
  target: OpenedPptx,
  sourceBytes: Uint8Array,
  opts?: { readonly layoutFrom?: SlideModel }
): Promise<SlideModel | null>;

export function promoteSlideBackground(
  slide: SlideModel,
  size: { readonly cx: number; readonly cy: number }
): void;

export function moveSlide(opened: OpenedPptx, fromIndex: number, toIndex: number): boolean;

export function deleteSlide(opened: OpenedPptx, index: number): boolean;
