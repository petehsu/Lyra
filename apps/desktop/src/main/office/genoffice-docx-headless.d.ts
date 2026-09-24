export class DocxHeadlessError extends Error {
  readonly index: number;

  constructor(index: number, message: string);
}

export type DocxBlockSummary = {
  readonly index: number;
  readonly type: string;
  readonly preview: string;
};

export type DocxCommentSummary = {
  readonly id: string;
  readonly text: string;
  readonly author?: string;
  readonly parentId?: string;
  readonly blockIndex?: number;
};

export type DocxNoteSummary = {
  readonly kind: "footnote" | "endnote";
  readonly id: string;
  readonly text: string;
  readonly blockIndex?: number;
};

export type DocxHeaderFooterSummary = {
  readonly header: string;
  readonly footer: string;
  readonly headerFirst: string | null;
  readonly footerFirst: string | null;
  readonly headerEven: string | null;
  readonly footerEven: string | null;
};

export type DocxRevisionSummary = {
  readonly id: string;
  readonly type: string;
  readonly blockIndex: number;
  readonly text: string;
  readonly author: string;
  readonly date?: string;
  readonly change?: string;
};

export type DocxStyleSummary = {
  readonly styleId: string;
  readonly name: string;
  readonly type: string;
  readonly headingLevel?: number;
};

export type DocxSectionSummary = {
  readonly index: number;
  readonly firstBlock: number;
  readonly lastBlock: number;
  readonly summary: string;
};

export type DocxDescription = {
  readonly blocks: readonly DocxBlockSummary[];
  readonly comments: readonly DocxCommentSummary[];
  readonly notes: readonly DocxNoteSummary[];
  readonly headerFooter: DocxHeaderFooterSummary;
  readonly revisions: readonly DocxRevisionSummary[];
  readonly sections: readonly DocxSectionSummary[];
  readonly styles: readonly DocxStyleSummary[];
};

export function validateOps(ops: readonly unknown[]): void;

export function open(bytes: Uint8Array): Promise<unknown>;

export function describe(doc: unknown): DocxDescription;

export function apply(doc: unknown, ops: readonly unknown[]): Promise<void>;

export function save(doc: unknown): Promise<Uint8Array>;

export function close(doc: unknown): void;
