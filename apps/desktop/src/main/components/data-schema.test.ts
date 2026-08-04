import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  MODULE_DATA_METADATA_FILE,
  createModuleDataSchemaStore
} from "./data-schema";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const fixture = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lyra-data-schema-"));
  roots.push(root);
  return {
    dataRoot: path.join(root, "data"),
    snapshotRoot: path.join(root, "snapshots")
  };
};

describe("module data schema store", () => {
  test("starts clean module data at schema v1", async () => {
    const paths = await fixture();
    const store = createModuleDataSchemaStore(paths);
    await expect(store.readOrInitialize("lyra.images", {
      readerMin: 1,
      readerMax: 1,
      writer: 1
    })).resolves.toMatchObject({ componentId: "lyra.images", dataSchema: 1 });
  });

  test("refuses unmanaged legacy data and future schemas", async () => {
    const paths = await fixture();
    const legacy = path.join(paths.dataRoot, "lyra.files");
    await mkdir(legacy, { recursive: true });
    await writeFile(path.join(legacy, "legacy.json"), "{}\n");
    const store = createModuleDataSchemaStore(paths);
    await expect(store.readOrInitialize("lyra.files", {
      readerMin: 1,
      readerMax: 1,
      writer: 1
    })).rejects.toThrow("Unmanaged pre-v1 data");

    const future = path.join(paths.dataRoot, "lyra.editor");
    await mkdir(future, { recursive: true });
    await writeFile(path.join(future, ".lyra-data-schema.v1.json"), JSON.stringify({
      schemaVersion: 1,
      componentId: "lyra.editor",
      dataSchema: 3,
      updatedAt: new Date().toISOString()
    }));
    await expect(store.readOrInitialize("lyra.editor", {
      readerMin: 1,
      readerMax: 2,
      writer: 2
    })).rejects.toThrow("newer than reader");
  });

  test("commits a staged migration only after the activation succeeds", async () => {
    const paths = await fixture();
    const store = createModuleDataSchemaStore(paths);
    await store.readOrInitialize("lyra.agent", { readerMin: 1, readerMax: 1, writer: 1 });
    await writeFile(path.join(paths.dataRoot, "lyra.agent", "session.json"), "v1");

    const transaction = await store.prepare(
      "lyra.agent",
      { readerMin: 1, readerMax: 2, writer: 2 },
      {
        migration: async (staged) =>
          writeFile(path.join(staged, "session.json"), "v2"),
        activationBefore: {
          active: "1.0.0",
          pending: "2.0.0"
        }
      }
    );
    expect(transaction.prepared).toMatchObject({ dataSchema: 2 });
    await expect(readFile(path.join(paths.dataRoot, "lyra.agent", "session.json"), "utf8"))
      .resolves.toBe("v2");
    await expect(transaction.commit()).resolves.toMatchObject({ dataSchema: 2 });
    await expect(transaction.commit()).rejects.toThrow("already committed");
    await expect(store.readOrInitialize("lyra.agent", {
      readerMin: 2,
      readerMax: 2,
      writer: 2
    })).resolves.toMatchObject({ dataSchema: 2 });
  });

  test("restores data and its schema marker before restoring activation pointers", async () => {
    const paths = await fixture();
    const store = createModuleDataSchemaStore(paths);
    await store.readOrInitialize("lyra.agent", { readerMin: 1, readerMax: 1, writer: 1 });
    await writeFile(path.join(paths.dataRoot, "lyra.agent", "session.json"), "v1");

    const transaction = await store.prepare(
      "lyra.agent",
      { readerMin: 1, readerMax: 2, writer: 2 },
      {
        migration: async (staged) =>
          writeFile(path.join(staged, "session.json"), "v2"),
        activationBefore: {
          active: "1.0.0",
          pending: "2.0.0"
        }
      }
    );
    let activationRestored = false;
    await expect(transaction.rollback(async () => {
      await expect(readFile(
        path.join(paths.dataRoot, "lyra.agent", "session.json"),
        "utf8"
      )).resolves.toBe("v1");
      await expect(readFile(
        path.join(paths.dataRoot, "lyra.agent", MODULE_DATA_METADATA_FILE),
        "utf8"
      )).resolves.toContain("\"dataSchema\": 1");
      activationRestored = true;
    })).resolves.toMatchObject({ dataSchema: 1 });
    expect(activationRestored).toBe(true);
    await expect(transaction.rollback()).rejects.toThrow("already rolled-back");
    await expect(readFile(
      path.join(paths.dataRoot, "lyra.agent", MODULE_DATA_METADATA_FILE),
      "utf8"
    )).resolves.toContain("\"dataSchema\": 1");
  });

  test("keeps active data untouched when migration preparation fails", async () => {
    const paths = await fixture();
    const store = createModuleDataSchemaStore(paths);
    await store.readOrInitialize("lyra.agent", { readerMin: 1, readerMax: 1, writer: 1 });
    await writeFile(path.join(paths.dataRoot, "lyra.agent", "session.json"), "v1");

    await expect(store.prepare(
      "lyra.agent",
      { readerMin: 1, readerMax: 2, writer: 2 },
      {
        migration: async (staged) => {
          await writeFile(path.join(staged, "session.json"), "broken");
          throw new Error("migration failed");
        }
      }
    )).rejects.toThrow("migration failed");
    await expect(readFile(path.join(paths.dataRoot, "lyra.agent", "session.json"), "utf8"))
      .resolves.toBe("v1");
  });

  test("rejects concurrent transactions for one module", async () => {
    const paths = await fixture();
    const store = createModuleDataSchemaStore(paths);
    await store.readOrInitialize("lyra.agent", { readerMin: 1, readerMax: 1, writer: 1 });
    const transaction = await store.prepare(
      "lyra.agent",
      { readerMin: 1, readerMax: 1, writer: 1 }
    );
    await expect(store.prepare(
      "lyra.agent",
      { readerMin: 1, readerMax: 1, writer: 1 }
    )).rejects.toThrow("already active");
    await transaction.rollback();
  });

  test("recovers data and exact activation state from a durable crash marker", async () => {
    const paths = await fixture();
    const firstProcess = createModuleDataSchemaStore(paths);
    await firstProcess.readOrInitialize(
      "lyra.agent",
      { readerMin: 1, readerMax: 1, writer: 1 }
    );
    await writeFile(path.join(paths.dataRoot, "lyra.agent", "session.json"), "v1");
    await firstProcess.prepare(
      "lyra.agent",
      { readerMin: 1, readerMax: 2, writer: 2 },
      {
        migration: async (staged) =>
          writeFile(path.join(staged, "session.json"), "v2"),
        activationBefore: {
          active: "1.0.0",
          previous: "0.9.0",
          pending: "2.0.0"
        }
      }
    );

    const recoveredActivation: unknown[] = [];
    const restartedProcess = createModuleDataSchemaStore(paths);
    await expect(restartedProcess.recoverInterruptedTransactions(async (record) => {
      await expect(readFile(
        path.join(paths.dataRoot, "lyra.agent", "session.json"),
        "utf8"
      )).resolves.toBe("v1");
      recoveredActivation.push(record);
    })).resolves.toEqual(["lyra.agent"]);
    expect(recoveredActivation).toEqual([{
      componentId: "lyra.agent",
      activationBefore: {
        active: "1.0.0",
        previous: "0.9.0",
        pending: "2.0.0"
      }
    }]);
    await expect(restartedProcess.recoverInterruptedTransactions())
      .resolves.toEqual([]);
  });
});
