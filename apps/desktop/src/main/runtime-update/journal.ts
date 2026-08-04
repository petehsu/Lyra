import { randomUUID } from "node:crypto";
import { lstat, readFile, rm } from "node:fs/promises";
import path from "node:path";

import type { ComponentRegistryStore } from "../components/registry";
import { writeFileAtomic } from "../persistence";

const JOURNAL_SCHEMA_VERSION = 1 as const;
const JOURNAL_FILE = "runtime-update.v1.json";
const MAX_JOURNAL_BYTES = 64 * 1024;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

export type RuntimeUpdateJournalPhase =
  | "prepared"
  | "activating"
  | "restarting"
  | "health-check"
  | "rolling-back"
  | "complete";

export type RuntimeUpdateJournalEntryV1 = {
  readonly schemaVersion: typeof JOURNAL_SCHEMA_VERSION;
  readonly operationId: string;
  readonly componentId: "lyra.runtime";
  readonly fromVersion: string;
  readonly targetVersion: string;
  readonly phase: RuntimeUpdateJournalPhase;
  readonly startedAt: string;
  readonly updatedAt: string;
};

export type RuntimeUpdateJournal = {
  readonly read: () => Promise<RuntimeUpdateJournalEntryV1 | null>;
  readonly begin: (input: {
    readonly fromVersion: string;
    readonly targetVersion: string;
  }) => Promise<RuntimeUpdateJournalEntryV1>;
  readonly setPhase: (phase: RuntimeUpdateJournalPhase) => Promise<void>;
  readonly clear: () => Promise<void>;
};

const PHASES = new Set<RuntimeUpdateJournalPhase>([
  "prepared",
  "activating",
  "restarting",
  "health-check",
  "rolling-back",
  "complete"
]);

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key));

const parseJournal = (value: unknown): RuntimeUpdateJournalEntryV1 => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Runtime update journal must be an object.");
  }
  const entry = value as Record<string, unknown>;
  if (
    !hasOnlyKeys(entry, [
      "schemaVersion",
      "operationId",
      "componentId",
      "fromVersion",
      "targetVersion",
      "phase",
      "startedAt",
      "updatedAt"
    ])
    || entry.schemaVersion !== JOURNAL_SCHEMA_VERSION
    || typeof entry.operationId !== "string"
    || entry.operationId.length === 0
    || entry.componentId !== "lyra.runtime"
    || typeof entry.fromVersion !== "string"
    || !VERSION_PATTERN.test(entry.fromVersion)
    || typeof entry.targetVersion !== "string"
    || !VERSION_PATTERN.test(entry.targetVersion)
    || entry.fromVersion === entry.targetVersion
    || typeof entry.phase !== "string"
    || !PHASES.has(entry.phase as RuntimeUpdateJournalPhase)
    || typeof entry.startedAt !== "string"
    || Number.isNaN(Date.parse(entry.startedAt))
    || typeof entry.updatedAt !== "string"
    || Number.isNaN(Date.parse(entry.updatedAt))
  ) {
    throw new Error("Runtime update journal fields are invalid.");
  }
  return entry as RuntimeUpdateJournalEntryV1;
};

export const createRuntimeUpdateJournal = (systemRoot: string): RuntimeUpdateJournal => {
  const journalPath = path.join(systemRoot, JOURNAL_FILE);
  let current: RuntimeUpdateJournalEntryV1 | null | undefined;

  const read = async (): Promise<RuntimeUpdateJournalEntryV1 | null> => {
    if (current !== undefined) {
      return current;
    }
    let metadata;
    try {
      metadata = await lstat(journalPath);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        current = null;
        return null;
      }
      throw error;
    }
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_JOURNAL_BYTES) {
      throw new Error("Runtime update journal must be a bounded regular file.");
    }
    current = parseJournal(JSON.parse(await readFile(journalPath, "utf8")) as unknown);
    return current;
  };

  const persist = async (entry: RuntimeUpdateJournalEntryV1): Promise<void> => {
    await writeFileAtomic(journalPath, `${JSON.stringify(entry, null, 2)}\n`);
    current = entry;
  };

  return {
    read,
    begin: async ({ fromVersion, targetVersion }) => {
      if (await read() !== null) {
        throw new Error("A Runtime update journal is already active.");
      }
      if (!VERSION_PATTERN.test(fromVersion) || !VERSION_PATTERN.test(targetVersion)) {
        throw new Error("Runtime update journal versions are invalid.");
      }
      if (fromVersion === targetVersion) {
        throw new Error("Runtime update journal requires two different versions.");
      }
      const now = new Date().toISOString();
      const entry: RuntimeUpdateJournalEntryV1 = {
        schemaVersion: JOURNAL_SCHEMA_VERSION,
        operationId: randomUUID(),
        componentId: "lyra.runtime",
        fromVersion,
        targetVersion,
        phase: "prepared",
        startedAt: now,
        updatedAt: now
      };
      await persist(entry);
      return entry;
    },
    setPhase: async (phase) => {
      const entry = await read();
      if (entry === null) {
        throw new Error("Runtime update journal has not been started.");
      }
      await persist({ ...entry, phase, updatedAt: new Date().toISOString() });
    },
    clear: async () => {
      await rm(journalPath, { force: true });
      current = null;
    }
  };
};

export const recoverInterruptedRuntimeUpdate = async ({
  journal,
  registry
}: {
  readonly journal: RuntimeUpdateJournal;
  readonly registry: ComponentRegistryStore;
}): Promise<void> => {
  const entry = await journal.read();
  if (entry === null) {
    return;
  }
  if (entry.phase === "complete") {
    await journal.clear();
    return;
  }
  const component = await registry.read(entry.componentId);
  if (component === null || component.kind !== "runtime") {
    throw new Error("Runtime update recovery cannot find the recorded Runtime component.");
  }
  if (component.active === entry.fromVersion) {
    await registry.verifyInstalledVersion(entry.componentId, entry.fromVersion);
    await journal.clear();
    return;
  }
  if (
    component.active !== entry.targetVersion
    || component.previous !== entry.fromVersion
  ) {
    throw new Error(
      `Runtime update recovery found unexpected pointers: active=${component.active ?? "none"}, `
      + `previous=${component.previous ?? "none"}.`
    );
  }
  await journal.setPhase("rolling-back");
  const restored = await registry.rollback(entry.componentId);
  if (restored.active !== entry.fromVersion) {
    throw new Error("Runtime update recovery did not restore the recorded version.");
  }
  await registry.verifyInstalledVersion(entry.componentId, entry.fromVersion);
  await journal.setPhase("complete");
  await journal.clear();
};
