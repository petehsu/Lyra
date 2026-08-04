import { cp, lstat, mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { ComponentDataSchemaV1 } from "@lyra/app-runtime";

import { writeFileAtomic } from "../persistence";

export const MODULE_DATA_METADATA_FILE = ".lyra-data-schema.v1.json";

export type ModuleDataMetadataV1 = {
  readonly schemaVersion: 1;
  readonly componentId: string;
  readonly dataSchema: number;
  readonly updatedAt: string;
};

export type ModuleDataActivationState = {
  readonly active?: string;
  readonly previous?: string;
  readonly pending?: string;
};

export type ModuleDataRecoveryRecord = {
  readonly componentId: string;
  readonly activationBefore?: ModuleDataActivationState;
};

export type ModuleDataSchemaTransaction = {
  readonly componentId: string;
  readonly before: ModuleDataMetadataV1 | null;
  readonly prepared: ModuleDataMetadataV1;
  readonly changed: boolean;
  readonly commit: () => Promise<ModuleDataMetadataV1>;
  readonly rollback: (
    restoreActivation?: () => Promise<void>
  ) => Promise<ModuleDataMetadataV1 | null>;
};

export type ModuleDataSchemaStore = {
  readonly readOrInitialize: (
    componentId: string,
    contract: ComponentDataSchemaV1
  ) => Promise<ModuleDataMetadataV1>;
  readonly prepare: (
    componentId: string,
    contract: ComponentDataSchemaV1,
    options?: {
      readonly migration?: (
        stagedDataRoot: string,
        fromSchema: number,
        toSchema: number
      ) => Promise<void>;
      readonly activationBefore?: ModuleDataActivationState;
    }
  ) => Promise<ModuleDataSchemaTransaction>;
  readonly recoverInterruptedTransactions: (
    restoreActivation?: (
      recovery: ModuleDataRecoveryRecord
    ) => Promise<void>
  ) => Promise<readonly string[]>;
};

type ModuleDataTransactionMarkerV1 = {
  readonly schemaVersion: 1;
  readonly componentId: string;
  readonly transactionId: string;
  readonly phase: "staging" | "prepared" | "committed";
  readonly sourceExisted: boolean;
  readonly dataChanged: boolean;
  readonly fromDataSchema: number | null;
  readonly toDataSchema: number;
  readonly preparedAt: string;
  readonly activationBefore?: ModuleDataActivationState;
};

const COMPONENT_ID_PATTERN = /^[a-z0-9._-]{1,128}$/u;
const TRANSACTION_ID_PATTERN =
  /^\d{10,}-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TRANSACTION_DIRECTORY = "transactions";
const TRANSACTION_MARKER_SUFFIX = ".data-transaction.v1.json";

const assertComponentId = (componentId: string): void => {
  if (!COMPONENT_ID_PATTERN.test(componentId)) {
    throw new Error(`Invalid component data id: ${componentId}`);
  }
};

const assertContract = (contract: ComponentDataSchemaV1): void => {
  if (
    !Number.isSafeInteger(contract.readerMin)
    || !Number.isSafeInteger(contract.readerMax)
    || !Number.isSafeInteger(contract.writer)
    || contract.readerMin < 1
    || contract.readerMin > contract.writer
    || contract.writer > contract.readerMax
  ) {
    throw new Error("Invalid component data schema contract.");
  }
};

const assertActivationState = (
  value: unknown
): ModuleDataActivationState | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid component activation recovery state.");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => !["active", "previous", "pending"].includes(key))
    || ["active", "previous", "pending"].some((key) =>
      record[key] !== undefined && typeof record[key] !== "string"
    )
  ) {
    throw new Error("Invalid component activation recovery state.");
  }
  return {
    ...(typeof record.active === "string" ? { active: record.active } : {}),
    ...(typeof record.previous === "string" ? { previous: record.previous } : {}),
    ...(typeof record.pending === "string" ? { pending: record.pending } : {})
  };
};

const writeMetadata = async (
  dataRoot: string,
  metadata: ModuleDataMetadataV1
): Promise<void> => {
  await writeFileAtomic(
    path.join(dataRoot, MODULE_DATA_METADATA_FILE),
    `${JSON.stringify(metadata, null, 2)}\n`
  );
};

const parseMetadata = (value: unknown, componentId: string): ModuleDataMetadataV1 => {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
    || (value as Record<string, unknown>).schemaVersion !== 1
    || (value as Record<string, unknown>).componentId !== componentId
    || !Number.isSafeInteger((value as Record<string, unknown>).dataSchema)
    || ((value as Record<string, unknown>).dataSchema as number) < 1
    || typeof (value as Record<string, unknown>).updatedAt !== "string"
  ) {
    throw new Error(`Invalid module data metadata: ${componentId}`);
  }
  return value as ModuleDataMetadataV1;
};

const parseTransactionMarker = (
  value: unknown,
  expectedComponentId: string
): ModuleDataTransactionMarkerV1 => {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
  ) {
    throw new Error(`Invalid module data transaction marker: ${expectedComponentId}`);
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => ![
      "schemaVersion",
      "componentId",
      "transactionId",
      "phase",
      "sourceExisted",
      "dataChanged",
      "fromDataSchema",
      "toDataSchema",
      "preparedAt",
      "activationBefore"
    ].includes(key))
    || record.schemaVersion !== 1
    || record.componentId !== expectedComponentId
    || typeof record.transactionId !== "string"
    || !TRANSACTION_ID_PATTERN.test(record.transactionId)
    || !["staging", "prepared", "committed"].includes(String(record.phase))
    || typeof record.sourceExisted !== "boolean"
    || typeof record.dataChanged !== "boolean"
    || (
      record.fromDataSchema !== null
      && (
        !Number.isSafeInteger(record.fromDataSchema)
        || (record.fromDataSchema as number) < 1
      )
    )
    || !Number.isSafeInteger(record.toDataSchema)
    || (record.toDataSchema as number) < 1
    || typeof record.preparedAt !== "string"
  ) {
    throw new Error(`Invalid module data transaction marker: ${expectedComponentId}`);
  }
  const activationBefore = assertActivationState(record.activationBefore);
  return {
    schemaVersion: 1,
    componentId: expectedComponentId,
    transactionId: record.transactionId,
    phase: record.phase as ModuleDataTransactionMarkerV1["phase"],
    sourceExisted: record.sourceExisted,
    dataChanged: record.dataChanged,
    fromDataSchema: record.fromDataSchema as number | null,
    toDataSchema: record.toDataSchema as number,
    preparedAt: record.preparedAt,
    ...(activationBefore === undefined
      ? {}
      : { activationBefore })
  };
};

const readMetadata = async (
  dataRoot: string,
  componentId: string
): Promise<ModuleDataMetadataV1 | null> => {
  try {
    return parseMetadata(
      JSON.parse(await readFile(path.join(dataRoot, MODULE_DATA_METADATA_FILE), "utf8")) as unknown,
      componentId
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

const pathExists = async (candidate: string): Promise<boolean> => {
  try {
    await lstat(candidate);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
};

const validateReadable = (
  metadata: ModuleDataMetadataV1,
  contract: ComponentDataSchemaV1
): ModuleDataMetadataV1 => {
  if (metadata.dataSchema > contract.readerMax) {
    throw new Error(
      `Module data schema ${metadata.dataSchema} is newer than reader ${contract.readerMax}.`
    );
  }
  if (metadata.dataSchema < contract.readerMin) {
    throw new Error(
      `Module data schema ${metadata.dataSchema} requires a transactional migration to ${contract.writer}.`
    );
  }
  return metadata;
};

const activationStateIsEmpty = (
  activation: ModuleDataActivationState | undefined
): boolean => activation !== undefined && Object.keys(activation).length === 0;

export const createModuleDataSchemaStore = ({
  dataRoot,
  snapshotRoot
}: {
  readonly dataRoot: string;
  readonly snapshotRoot: string;
}): ModuleDataSchemaStore => {
  const queues = new Map<string, Promise<void>>();
  const activeTransactions = new Map<string, string>();
  const transactionRoot = path.join(snapshotRoot, TRANSACTION_DIRECTORY);

  const serialize = async <T>(componentId: string, operation: () => Promise<T>): Promise<T> => {
    const previous = queues.get(componentId) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    queues.set(componentId, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
      if (queues.get(componentId) === queued) {
        queues.delete(componentId);
      }
    }
  };

  const markerPathFor = (componentId: string): string =>
    path.join(transactionRoot, `${componentId}${TRANSACTION_MARKER_SUFFIX}`);

  const pathsFor = (
    marker: ModuleDataTransactionMarkerV1
  ): {
    readonly source: string;
    readonly staged: string;
    readonly backup: string;
  } => {
    const source = path.join(dataRoot, marker.componentId);
    const parent = path.dirname(source);
    return {
      source,
      staged: path.join(
        parent,
        `.${marker.componentId}.migration-${marker.transactionId}`
      ),
      backup: path.join(
        parent,
        `.${marker.componentId}.backup-${marker.transactionId}`
      )
    };
  };

  const writeTransactionMarker = async (
    marker: ModuleDataTransactionMarkerV1
  ): Promise<void> => {
    await mkdir(transactionRoot, { recursive: true });
    await writeFileAtomic(
      markerPathFor(marker.componentId),
      `${JSON.stringify(marker, null, 2)}\n`
    );
  };

  const readTransactionMarker = async (
    componentId: string
  ): Promise<ModuleDataTransactionMarkerV1 | null> => {
    try {
      return parseTransactionMarker(
        JSON.parse(await readFile(markerPathFor(componentId), "utf8")) as unknown,
        componentId
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  };

  const cleanCommittedTransaction = async (
    marker: ModuleDataTransactionMarkerV1
  ): Promise<void> => {
    const { staged, backup } = pathsFor(marker);
    await rm(staged, { recursive: true, force: true }).catch((error: unknown) => {
      console.warn(`[lyra-components] failed to remove committed data staging ${staged}`, error);
    });
    await rm(backup, { recursive: true, force: true }).catch((error: unknown) => {
      console.warn(`[lyra-components] failed to remove committed data backup ${backup}`, error);
    });
    await rm(markerPathFor(marker.componentId), { force: true }).catch((error: unknown) => {
      console.warn(
        `[lyra-components] failed to remove committed data transaction marker for ${marker.componentId}`,
        error
      );
    });
  };

  const restorePreparedData = async (
    marker: ModuleDataTransactionMarkerV1
  ): Promise<void> => {
    const { source, staged, backup } = pathsFor(marker);
    if (marker.dataChanged) {
      if (marker.sourceExisted) {
        if (await pathExists(backup)) {
          await rm(source, { recursive: true, force: true });
          await rename(backup, source);
        } else if (!(await pathExists(source))) {
          throw new Error(
            `Cannot recover module data transaction for ${marker.componentId}: original data is missing.`
          );
        }
      } else {
        await rm(source, { recursive: true, force: true });
      }
    }
    await rm(staged, { recursive: true, force: true });
  };

  const recoverMarker = async (
    marker: ModuleDataTransactionMarkerV1,
    restoreActivation: (
      recovery: ModuleDataRecoveryRecord
    ) => Promise<void>
  ): Promise<void> => {
    if (marker.phase === "committed") {
      await cleanCommittedTransaction(marker);
      return;
    }
    await restorePreparedData(marker);
    if (marker.activationBefore !== undefined) {
      await restoreActivation({
        componentId: marker.componentId,
        activationBefore: marker.activationBefore
      });
    }
    await rm(markerPathFor(marker.componentId), { force: true });
  };

  const assertNoInterruptedTransaction = async (
    componentId: string
  ): Promise<void> => {
    const marker = await readTransactionMarker(componentId);
    if (marker === null) {
      return;
    }
    if (marker.phase === "committed") {
      await cleanCommittedTransaction(marker);
      return;
    }
    throw new Error(
      `Module data transaction recovery is required before using ${componentId}.`
    );
  };

  const initialize = async (
    componentId: string,
    contract: ComponentDataSchemaV1
  ): Promise<ModuleDataMetadataV1> => {
    assertComponentId(componentId);
    assertContract(contract);
    if (activeTransactions.has(componentId)) {
      throw new Error(`A module data transaction is already active for ${componentId}.`);
    }
    await assertNoInterruptedTransaction(componentId);
    const componentDataRoot = path.join(dataRoot, componentId);
    await mkdir(componentDataRoot, { recursive: true });
    const existing = await readMetadata(componentDataRoot, componentId);
    if (existing !== null) {
      return validateReadable(existing, contract);
    }
    if ((await readdir(componentDataRoot)).length > 0) {
      throw new Error(
        `Unmanaged pre-v1 data exists for ${componentId}; Lyra will not migrate or delete it automatically.`
      );
    }
    const metadata: ModuleDataMetadataV1 = {
      schemaVersion: 1,
      componentId,
      dataSchema: 1,
      updatedAt: new Date().toISOString()
    };
    await writeMetadata(componentDataRoot, metadata);
    return validateReadable(metadata, contract);
  };

  const prepare = async (
    componentId: string,
    contract: ComponentDataSchemaV1,
    options: {
      readonly migration?: (
        stagedDataRoot: string,
        fromSchema: number,
        toSchema: number
      ) => Promise<void>;
      readonly activationBefore?: ModuleDataActivationState;
    } = {}
  ): Promise<ModuleDataSchemaTransaction> => serialize(componentId, async () => {
    assertComponentId(componentId);
    assertContract(contract);
    if (activeTransactions.has(componentId)) {
      throw new Error(`A module data transaction is already active for ${componentId}.`);
    }
    await assertNoInterruptedTransaction(componentId);
    const activationBefore = assertActivationState(options.activationBefore);
    if (activationStateIsEmpty(activationBefore)) {
      throw new Error("Component activation recovery state cannot be empty.");
    }

    await mkdir(dataRoot, { recursive: true });
    const source = path.join(dataRoot, componentId);
    const sourceExisted = await pathExists(source);
    if (sourceExisted) {
      const metadata = await lstat(source);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        throw new Error(`Module data root must be a real directory: ${componentId}`);
      }
    }
    const before = sourceExisted
      ? await readMetadata(source, componentId)
      : null;
    if (
      before === null
      && sourceExisted
      && (await readdir(source)).length > 0
    ) {
      throw new Error(
        `Unmanaged pre-v1 data exists for ${componentId}; Lyra will not migrate or delete it automatically.`
      );
    }
    const fromSchema = before?.dataSchema ?? 1;
    if (fromSchema > contract.readerMax) {
      throw new Error(
        `Module data schema ${fromSchema} is newer than reader ${contract.readerMax}.`
      );
    }
    if (options.migration !== undefined && fromSchema > contract.writer) {
      throw new Error("Module data schema downgrades are not allowed.");
    }
    const migrationRequired = fromSchema < contract.readerMin;
    const migrationWillRun =
      options.migration !== undefined && fromSchema < contract.writer;
    if (migrationRequired && !migrationWillRun) {
      throw new Error(
        `Module data schema ${fromSchema} requires a transactional migration to ${contract.writer}.`
      );
    }
    const toSchema = migrationWillRun ? contract.writer : fromSchema;
    const prepared: ModuleDataMetadataV1 = {
      schemaVersion: 1,
      componentId,
      dataSchema: toSchema,
      updatedAt: new Date().toISOString()
    };
    validateReadable(prepared, contract);

    const dataChanged = before === null || migrationWillRun;
    const transactionId = `${Date.now()}-${randomUUID()}`;
    let marker: ModuleDataTransactionMarkerV1 = {
      schemaVersion: 1,
      componentId,
      transactionId,
      phase: "staging",
      sourceExisted,
      dataChanged,
      fromDataSchema: before?.dataSchema ?? null,
      toDataSchema: toSchema,
      preparedAt: new Date().toISOString(),
      ...(activationBefore === undefined ? {} : { activationBefore })
    };
    activeTransactions.set(componentId, transactionId);

    try {
      await writeTransactionMarker(marker);
      if (dataChanged) {
        const { staged, backup } = pathsFor(marker);
        const snapshot = path.join(
          snapshotRoot,
          componentId,
          `${transactionId}-schema-${before?.dataSchema ?? "uninitialized"}`
        );
        await mkdir(path.dirname(snapshot), { recursive: true });
        if (sourceExisted) {
          await cp(source, snapshot, {
            recursive: true,
            errorOnExist: true,
            force: false
          });
          await cp(source, staged, {
            recursive: true,
            errorOnExist: true,
            force: false
          });
        } else {
          await mkdir(snapshot, { recursive: false });
          await mkdir(staged, { recursive: false });
        }
        if (before === null) {
          await writeMetadata(staged, {
            schemaVersion: 1,
            componentId,
            dataSchema: 1,
            updatedAt: marker.preparedAt
          });
        }
        if (migrationWillRun) {
          await options.migration?.(staged, fromSchema, contract.writer);
        }
        await writeMetadata(staged, prepared);
        if (sourceExisted) {
          await rename(source, backup);
        }
        try {
          await rename(staged, source);
        } catch (error) {
          if (sourceExisted) {
            await rename(backup, source);
          }
          throw error;
        }
      }
      marker = { ...marker, phase: "prepared" };
      await writeTransactionMarker(marker);
    } catch (error) {
      try {
        await restorePreparedData(marker);
        await rm(markerPathFor(componentId), { force: true });
      } catch (recoveryError) {
        console.error(
          `[lyra-components] failed to recover data preparation for ${componentId}`,
          recoveryError
        );
        activeTransactions.delete(componentId);
        throw new Error(
          `Module data preparation failed and ${componentId} still requires journal recovery.`,
          { cause: recoveryError }
        );
      }
      activeTransactions.delete(componentId);
      throw error;
    }

    let state: "prepared" | "committed" | "rolled-back" = "prepared";
    const assertPrepared = (): void => {
      if (state !== "prepared") {
        throw new Error(
          `Module data transaction for ${componentId} is already ${state}.`
        );
      }
      if (activeTransactions.get(componentId) !== transactionId) {
        throw new Error(`Module data transaction ownership was lost for ${componentId}.`);
      }
    };

    return {
      componentId,
      before,
      prepared,
      changed: dataChanged,
      commit: () => serialize(componentId, async () => {
        assertPrepared();
        const currentMarker = await readTransactionMarker(componentId);
        if (
          currentMarker === null
          || currentMarker.transactionId !== transactionId
          || currentMarker.phase !== "prepared"
        ) {
          throw new Error(`Module data transaction marker changed for ${componentId}.`);
        }
        const committedMarker: ModuleDataTransactionMarkerV1 = {
          ...currentMarker,
          phase: "committed"
        };
        await writeTransactionMarker(committedMarker);
        state = "committed";
        activeTransactions.delete(componentId);
        await cleanCommittedTransaction(committedMarker);
        return prepared;
      }),
      rollback: (restoreActivation) => serialize(componentId, async () => {
        assertPrepared();
        const currentMarker = await readTransactionMarker(componentId);
        if (
          currentMarker === null
          || currentMarker.transactionId !== transactionId
          || currentMarker.phase !== "prepared"
        ) {
          throw new Error(`Module data transaction marker changed for ${componentId}.`);
        }
        if (currentMarker.activationBefore !== undefined && restoreActivation === undefined) {
          throw new Error(
            `Component activation recovery callback is required for ${componentId}.`
          );
        }
        await restorePreparedData(currentMarker);
        await restoreActivation?.();
        await rm(markerPathFor(componentId), { force: true });
        state = "rolled-back";
        activeTransactions.delete(componentId);
        return before;
      })
    };
  });

  return {
    readOrInitialize: (componentId, contract) =>
      serialize(componentId, () => initialize(componentId, contract)),
    prepare,
    recoverInterruptedTransactions: async (restoreActivation) => {
      await mkdir(transactionRoot, { recursive: true });
      const markerFiles = (await readdir(transactionRoot))
        .filter((name) => name.endsWith(TRANSACTION_MARKER_SUFFIX))
        .sort();
      const recovered: string[] = [];
      for (const markerFile of markerFiles) {
        const componentId = markerFile.slice(0, -TRANSACTION_MARKER_SUFFIX.length);
        assertComponentId(componentId);
        await serialize(componentId, async () => {
          if (activeTransactions.has(componentId)) {
            throw new Error(`A module data transaction is already active for ${componentId}.`);
          }
          const marker = await readTransactionMarker(componentId);
          if (marker === null) {
            return;
          }
          if (marker.activationBefore !== undefined && restoreActivation === undefined) {
            throw new Error(
              `Component activation recovery callback is required for ${componentId}.`
            );
          }
          await recoverMarker(
            marker,
            restoreActivation ?? (async () => undefined)
          );
          recovered.push(componentId);
        });
      }
      return recovered;
    }
  };
};
