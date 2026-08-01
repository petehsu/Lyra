import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";

import type { LyraRuntimeClient } from "../runtime-client";
import type { InstalledComponentV1 } from "../components/registry";
import type { ModuleDataSchemaTransaction } from "../components/data-schema";
import type { RuntimeActivity, RuntimeUpdateCoordinator } from "./coordinator";
import type { RuntimeUpdateJournal } from "./journal";

export type RuntimeComponentUpdateService = {
  readonly activatePending: (input: {
    readonly component: InstalledComponentV1;
    readonly activate: () => Promise<InstalledComponentV1>;
    readonly rollback: () => Promise<InstalledComponentV1>;
    readonly read: () => Promise<InstalledComponentV1>;
    readonly dataTransaction?: ModuleDataSchemaTransaction;
  }) => Promise<InstalledComponentV1>;
  readonly rollbackActive: (input: {
    readonly component: InstalledComponentV1;
    readonly rollback: () => Promise<InstalledComponentV1>;
    readonly restore: () => Promise<InstalledComponentV1>;
    readonly read: () => Promise<InstalledComponentV1>;
  }) => Promise<InstalledComponentV1>;
};

export const assertInstalledRuntimeExecutable = async (
  runtimeBinaryPath: string,
  platform: NodeJS.Platform = process.platform
): Promise<void> => {
  await access(
    runtimeBinaryPath,
    platform === "win32" ? constants.F_OK : constants.X_OK
  );
};

export const resolveInstalledRuntimeEntry = (
  componentsRoot: string,
  component: InstalledComponentV1,
  version: string | undefined
): string => {
  if (component.kind !== "runtime" || component.componentId !== "lyra.runtime") {
    throw new Error(`Component is not a runtime: ${component.componentId}`);
  }
  if (version === undefined) {
    throw new Error(`Runtime component has no selected version: ${component.componentId}`);
  }
  const installed = component.versions[version];
  const entry = installed?.manifest.entry;
  if (installed === undefined || entry === undefined) {
    throw new Error(`Runtime component has no executable entry: ${component.componentId}@${version}`);
  }
  const versionRoot = path.resolve(
    componentsRoot,
    component.componentId,
    version,
    installed.target
  );
  const entryPath = path.resolve(versionRoot, entry);
  if (entryPath !== versionRoot && !entryPath.startsWith(`${versionRoot}${path.sep}`)) {
    throw new Error(`Runtime component entry escapes its package: ${component.componentId}@${version}`);
  }
  return entryPath;
};

export const resolveRuntimeStartupEntry = ({
  componentsRoot,
  component,
  allowDevelopmentFallback
}: {
  readonly componentsRoot: string;
  readonly component: InstalledComponentV1 | null;
  readonly allowDevelopmentFallback: boolean;
}): string | undefined => {
  if (
    component?.kind === "runtime"
    && component.componentId === "lyra.runtime"
    && component.active !== undefined
  ) {
    return resolveInstalledRuntimeEntry(
      componentsRoot,
      component,
      component.active
    );
  }
  if (allowDevelopmentFallback) {
    return undefined;
  }
  throw new Error(
    "Packaged Lyra requires an active, signed lyra.runtime component."
  );
};

const assertRuntimeHealth = async (
  runtimeClient: LyraRuntimeClient,
  expectedComponentVersion: string
): Promise<void> => {
  const result = await runtimeClient.request<unknown>("runtime.identity", {});
  if (
    result === null
    || typeof result !== "object"
    || (result as { componentVersion?: unknown }).componentVersion !== expectedComponentVersion
    || typeof (result as { buildId?: unknown }).buildId !== "string"
    || (result as { buildId: string }).buildId.trim().length === 0
  ) {
    throw new Error(
      `Lyra runtime health check did not identify ${expectedComponentVersion}.`
    );
  }
};

export const createRuntimeComponentUpdateService = ({
  componentsRoot,
  runtimeClient,
  coordinator,
  restartRuntime,
  replayLspDocuments,
  journal,
  validateRuntimeEntry = assertInstalledRuntimeExecutable
}: {
  readonly componentsRoot: string;
  readonly runtimeClient: LyraRuntimeClient;
  readonly coordinator: RuntimeUpdateCoordinator;
  readonly restartRuntime: (
    runtimeBinaryPath: string,
    componentVersion: string
  ) => Promise<void>;
  readonly replayLspDocuments: (activities: readonly RuntimeActivity[]) => Promise<void>;
  readonly journal?: RuntimeUpdateJournal;
  readonly validateRuntimeEntry?: (runtimeBinaryPath: string) => Promise<void>;
}): RuntimeComponentUpdateService => {
  const switchRuntime = async ({
    component,
    targetVersion,
    switchVersion,
    restoreVersion,
    readCurrent,
    dataTransaction
  }: {
    readonly component: InstalledComponentV1;
    readonly targetVersion: string;
    readonly switchVersion: () => Promise<InstalledComponentV1>;
    readonly restoreVersion: () => Promise<InstalledComponentV1>;
    readonly readCurrent: () => Promise<InstalledComponentV1>;
    readonly dataTransaction?: ModuleDataSchemaTransaction;
  }): Promise<InstalledComponentV1> => {
    let runtimeBinaryPath = resolveInstalledRuntimeEntry(
      componentsRoot,
      component,
      targetVersion
    );
    let expectedComponentVersion = targetVersion;
    const originalVersion = component.active;
    if (originalVersion === undefined) {
      await dataTransaction?.rollback(async () => {
        const current = await readCurrent();
        if (current.active !== undefined) {
          throw new Error(
            `Runtime staged-data recovery found unexpected active version ${current.active}.`
          );
        }
      });
      throw new Error("Runtime update requires an active version to recover.");
    }
    const discardPreparedData = async (): Promise<void> => {
      await dataTransaction?.rollback(async () => {
        const current = await readCurrent();
        if (current.active !== component.active) {
          throw new Error(
            `Runtime staged-data recovery found unexpected active version ${current.active ?? "none"}.`
          );
        }
      });
    };
    try {
      await validateRuntimeEntry(runtimeBinaryPath);
    } catch (error) {
      await discardPreparedData();
      throw error;
    }
    let journalStarted = false;

    try {
      const activated = await coordinator.applyUpdate({
        stage: async () => {
          await journal?.begin({ fromVersion: originalVersion, targetVersion });
          journalStarted = journal !== undefined;
          return component;
        },
        activate: async () => {
          await journal?.setPhase("activating");
          const activated = await switchVersion();
          if (activated.active !== targetVersion) {
            throw new Error(
              `Runtime activation selected ${activated.active ?? "no version"}; expected ${targetVersion}.`
            );
          }
          runtimeBinaryPath = resolveInstalledRuntimeEntry(
            componentsRoot,
            activated,
            activated.active
          );
          await validateRuntimeEntry(runtimeBinaryPath);
          return activated;
        },
        restart: async () => {
          await journal?.setPhase("restarting");
          await restartRuntime(runtimeBinaryPath, expectedComponentVersion);
        },
        healthCheck: async () => {
          await journal?.setPhase("health-check");
          await assertRuntimeHealth(runtimeClient, expectedComponentVersion);
        },
        replayRestartable: replayLspDocuments,
        commit: async () => {
          // The Runtime journal's complete phase and the data transaction's
          // committed phase form the ordered crash-recovery boundary. Startup
          // will roll both back before this point and keep both after it.
          await journal?.setPhase("complete");
          await dataTransaction?.commit();
        },
        cancelStage: async () => {
          await journal?.setPhase("rolling-back");
          await discardPreparedData();
        },
        rollback: async () => {
          await journal?.setPhase("rolling-back");
          let restored: InstalledComponentV1 | undefined;
          const restoreActivation = async (): Promise<void> => {
            const current = await readCurrent();
            if (current.active === targetVersion) {
              restored = await restoreVersion();
            } else if (current.active === component.active) {
              restored = current;
            } else {
              throw new Error(
                `Runtime recovery found unexpected active version ${current.active ?? "none"}.`
              );
            }
          };
          if (dataTransaction === undefined) {
            await restoreActivation();
          } else {
            // The durable data journal remains present until the old component
            // pointer has also been restored.
            await dataTransaction.rollback(restoreActivation);
          }
          if (restored === undefined) {
            throw new Error("Runtime recovery did not restore a component version.");
          }
          runtimeBinaryPath = resolveInstalledRuntimeEntry(
            componentsRoot,
            restored,
            restored.active
          );
          expectedComponentVersion = restored.active ?? "";
          await validateRuntimeEntry(runtimeBinaryPath);
        }
      });
      if (journalStarted) {
        await journal?.clear().catch((error: unknown) => {
          console.warn(
            "[lyra-runtime] update committed but its completed journal could not be removed",
            error
          );
        });
      }
      return activated;
    } catch (error) {
      if (journalStarted) {
        const current = await readCurrent().catch(() => null);
        if (current?.active === originalVersion) {
          await journal?.setPhase("complete");
          await journal?.clear();
        }
      }
      throw error;
    }
  };

  return {
    activatePending: async ({
      component,
      activate,
      rollback,
      read,
      dataTransaction
    }) => {
      if (component.pending === undefined) {
        return component;
      }
      return await switchRuntime({
        component,
        targetVersion: component.pending,
        switchVersion: activate,
        restoreVersion: rollback,
        readCurrent: read,
        ...(dataTransaction === undefined ? {} : { dataTransaction })
      });
    },
    rollbackActive: async ({ component, rollback, restore, read }) => {
      if (component.previous === undefined) {
        return component;
      }
      return await switchRuntime({
        component,
        targetVersion: component.previous,
        switchVersion: rollback,
        restoreVersion: restore,
        readCurrent: read
      });
    }
  };
};

export const runtimeComponentUpdateInternalsForTests = {
  resolveRuntimeEntry: resolveInstalledRuntimeEntry,
  assertRuntimeHealth,
  assertInstalledRuntimeExecutable
};
