export type CellState = {
  readonly value: string | number | boolean | null;
  readonly formula?: string;
};

export type CellEdit = {
  readonly sheetName: string;
  readonly row: number;
  readonly column: number;
  readonly writeValue: boolean;
  readonly cell: CellState;
};

export type ImportedXlsx = {
  readonly snapshot: {
    readonly sheets: readonly {
      readonly name: string;
      readonly cells: Readonly<Record<string, CellState>>;
    }[];
  };
};

export function readBasicWorkbook(buffer: Buffer): Promise<ImportedXlsx>;

export function applyCellEditsToXlsx(
  source: Buffer,
  edits: readonly CellEdit[]
): Promise<{ readonly buffer: Uint8Array }>;

export function parseAddress(address: string): { readonly row: number; readonly column: number };

export function blankXlsxBuffer(sheetName?: string): Promise<Buffer>;
