import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { inspectSqliteFile } from "./inspect";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const tempDir = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "lyra-sqlite-"));
  directories.push(directory);
  return directory;
};

describe("sqlite inspect", () => {
  test("reads tables and the first page without writing", async () => {
    const directory = await tempDir();
    const filePath = join(directory, "notes.sqlite");
    const db = new DatabaseSync(filePath);
    db.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)");
    db.exec("INSERT INTO notes (body) VALUES ('hello')");
    db.exec("CREATE TABLE \"odd\"\"name\" (c TEXT)");
    db.close();

    const read = inspectSqliteFile(filePath);
    expect(read.tables.map((table) => table.name)).toEqual(["notes", "odd\"name"]);
    expect(read.table).toBe("notes");
    expect(read.columns).toEqual(["id", "body"]);
    expect(read.rows).toEqual([[1, "hello"]]);
    expect(read.truncated).toBe(false);

    const quoted = inspectSqliteFile(filePath, "odd\"name");
    expect(quoted.table).toBe("odd\"name");
    expect(quoted.columns).toEqual(["c"]);
  });

  test("rejects a non-database and a non-sqlite path", async () => {
    const directory = await tempDir();
    const fake = join(directory, "notes.sqlite");
    await writeFile(fake, "not a database");
    expect(() => inspectSqliteFile(fake)).toThrow();
    expect(() => inspectSqliteFile(join(directory, "notes.txt"))).toThrow(/sqlite/);
  });
});
