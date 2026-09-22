import { statSync } from "node:fs";
import { createRequire } from "node:module";

import { isSqliteDocumentPath } from "../../shared/sqlite-documents";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

const ROW_LIMIT = 200;
const TEXT_LIMIT = 500;

export type SqliteCell = string | number | null;

export type SqliteInspectResult = {
  readonly tables: readonly { readonly name: string }[];
  readonly table: string | null;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly SqliteCell[])[];
  readonly truncated: boolean;
};

const quoteIdent = (name: string): string => `"${name.replaceAll("\"", "\"\"")}"`;

const cellValue = (value: unknown): SqliteCell => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (value instanceof Uint8Array) {
    return `blob (${value.byteLength} bytes)`;
  }
  const text = typeof value === "string" ? value : String(value);
  return text.length <= TEXT_LIMIT ? text : `${text.slice(0, TEXT_LIMIT)}…`;
};

export const inspectSqliteFile = (filePath: string, table?: string): SqliteInspectResult => {
  if (!isSqliteDocumentPath(filePath)) {
    throw new Error("sqlite preview is available for sqlite, sqlite3, db, and db3 files");
  }
  if (!statSync(filePath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error("sqlite file was not found");
  }
  const db = new DatabaseSync(filePath, { readOnly: true });
  try {
    const listed = db.prepare(
      "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all() as { name: string }[];
    const tables = listed.map((entry) => ({ name: entry.name }));
    const active = table ?? tables[0]?.name ?? null;
    if (active === null) {
      return { tables, table: null, columns: [], rows: [], truncated: false };
    }
    if (!tables.some((entry) => entry.name === active)) {
      throw new Error(`table ${active} was not found`);
    }
    const ident = quoteIdent(active);
    const info = db.prepare(`PRAGMA table_info(${ident})`).all() as { name: string }[];
    const columns = info.map((column) => column.name);
    // ponytail: no COUNT(*). A full scan would freeze the Electron main process.
    // Upgrade path: page with a keyset once a viewer needs more than this window.
    const loaded = db.prepare(`SELECT * FROM ${ident} LIMIT ${ROW_LIMIT + 1}`).all() as Record<string, unknown>[];
    const truncated = loaded.length > ROW_LIMIT;
    const page = truncated ? loaded.slice(0, ROW_LIMIT) : loaded;
    return {
      tables,
      table: active,
      columns,
      rows: page.map((row) => columns.map((column) => cellValue(row[column]))),
      truncated
    };
  } finally {
    db.close();
  }
};
