import type { LyraRuntimeClient } from "../runtime-client";
import type {
  RuntimeActivity,
  RuntimeUpdateCoordinator
} from "../runtime-update/coordinator";
import type {
  ComponentRegistryStore,
  InstalledComponentV1
} from "./registry";
import type { ModuleDataSchemaTransaction } from "./data-schema";
import {
  LANGUAGE_RESOURCE_COMPONENT_PREFIX,
  readLanguageResourceBundle,
  type ResourceComponentManager,
  type ResolvedResourceComponent
} from "./resource-components";

export type ResourceComponentUpdateService = {
  readonly activatePending: (
    componentId: string,
    dataTransaction?: ModuleDataSchemaTransaction
  ) => Promise<InstalledComponentV1>;
  readonly rollbackActive: (
    componentId: string
  ) => Promise<InstalledComponentV1>;
  /**
   * Runs a signed first-use install or repair only after Runtime and resource
   * consumers reach a safe point, then activates any resulting pending
   * version and performs the normal restart/health/replay transaction.
   */
  readonly installOrRepairAtSafePoint: <T>(
    componentId: string,
    installOrRepair: () => Promise<T>
  ) => Promise<{ readonly component: InstalledComponentV1; readonly result: T }>;
};

export type ResourceComponentRecoveryResult = {
  readonly componentId: string;
  readonly fromVersion: string;
  readonly status: "healthy" | "rolled-back" | "unrecoverable";
  readonly activeVersion: string;
  readonly error?: string;
};

type ResourceSwitchOperation = {
  readonly component: InstalledComponentV1;
  readonly targetVersion: string;
  readonly switchVersion: () => Promise<InstalledComponentV1>;
  readonly dataTransaction?: ModuleDataSchemaTransaction;
};

const isRuntimeBackedResource = (componentId: string): boolean =>
  !componentId.startsWith(LANGUAGE_RESOURCE_COMPONENT_PREFIX);

const assertSelectedVersion = (
  component: InstalledComponentV1,
  expectedVersion: string
): void => {
  if (component.active !== expectedVersion) {
    throw new Error(
      `Resource activation selected ${component.active ?? "no version"}; expected ${expectedVersion}.`
    );
  }
};

const assertRuntimeHealth = async (
  runtimeClient: LyraRuntimeClient
): Promise<void> => {
  const identity = await runtimeClient.request<unknown>("runtime.identity", {});
  if (
    identity === null
    || typeof identity !== "object"
    || typeof (identity as { buildId?: unknown }).buildId !== "string"
    || (identity as { buildId: string }).buildId.trim().length === 0
  ) {
    throw new Error("Runtime did not pass its health check after a resource switch.");
  }
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const activationPointers = (component: InstalledComponentV1) => ({
  ...(component.active === undefined ? {} : { active: component.active }),
  ...(component.previous === undefined ? {} : { previous: component.previous }),
  ...(component.pending === undefined ? {} : { pending: component.pending })
});

export const recoverUnhealthyActiveResourceComponents = async ({
  registry,
  manager,
  validateLanguageBundle
}: {
  readonly registry: ComponentRegistryStore;
  readonly manager: ResourceComponentManager;
  readonly validateLanguageBundle?: (
    locale: string,
    bundle: unknown
  ) => unknown;
}): Promise<readonly ResourceComponentRecoveryResult[]> => {
  const results: ResourceComponentRecoveryResult[] = [];
  const validateResource = async (
    resource: ResolvedResourceComponent
  ): Promise<void> => {
    await manager.assertHealthy(resource);
    if (resource.family === "language" && validateLanguageBundle !== undefined) {
      const language = await readLanguageResourceBundle(resource);
      validateLanguageBundle(language.locale, language.bundle);
    }
  };

  const components = (await registry.list())
    .filter((component) =>
      component.kind === "resource" && component.active !== undefined
    )
    .sort((left, right) => left.componentId.localeCompare(right.componentId));

  for (const component of components) {
    const activeVersion = component.active!;
    try {
      await validateResource(
        await manager.resolveVersion(component.componentId, activeVersion)
      );
      results.push({
        componentId: component.componentId,
        fromVersion: activeVersion,
        status: "healthy",
        activeVersion
      });
      continue;
    } catch (activeError) {
      const previousVersion = component.previous;
      if (previousVersion === undefined) {
        results.push({
          componentId: component.componentId,
          fromVersion: activeVersion,
          status: "unrecoverable",
          activeVersion,
          error: errorMessage(activeError)
        });
        continue;
      }

      try {
        await validateResource(
          await manager.resolveVersion(component.componentId, previousVersion)
        );
      } catch (previousError) {
        results.push({
          componentId: component.componentId,
          fromVersion: activeVersion,
          status: "unrecoverable",
          activeVersion,
          error:
            `${errorMessage(activeError)} Previous ${previousVersion} is also unhealthy: `
            + errorMessage(previousError)
        });
        continue;
      }

      const originalActivation = activationPointers(component);
      let lock: Awaited<ReturnType<ResourceComponentManager["acquireExclusive"]>>
        | undefined;
      let activationChanged = false;
      try {
        lock = await manager.acquireExclusive(component.componentId);
        const current = await registry.read(component.componentId);
        if (
          current === null
          || current.active !== activeVersion
          || current.previous !== previousVersion
        ) {
          throw new Error(
            `Resource activation changed during recovery: ${component.componentId}.`
          );
        }
        const restored = await registry.rollback(component.componentId);
        activationChanged = true;
        assertSelectedVersion(restored, previousVersion);
        await validateResource(
          await manager.resolveVersion(component.componentId, previousVersion)
        );
        results.push({
          componentId: component.componentId,
          fromVersion: activeVersion,
          status: "rolled-back",
          activeVersion: previousVersion,
          error: errorMessage(activeError)
        });
      } catch (recoveryError) {
        if (activationChanged) {
          await registry.restoreActivation(
            component.componentId,
            originalActivation
          ).catch(() => undefined);
        }
        results.push({
          componentId: component.componentId,
          fromVersion: activeVersion,
          status: "unrecoverable",
          activeVersion,
          error:
            `${errorMessage(activeError)} Recovery failed: `
            + errorMessage(recoveryError)
        });
      } finally {
        lock?.release();
      }
    }
  }
  return results;
};

export const createResourceComponentUpdateService = ({
  registry,
  manager,
  runtimeClient,
  runtimeCoordinator,
  restartRuntime,
  replayLspDocuments,
  applyRuntimeEnvironment,
  reloadLanguageResources
}: {
  readonly registry: ComponentRegistryStore;
  readonly manager: ResourceComponentManager;
  readonly runtimeClient: LyraRuntimeClient;
  readonly runtimeCoordinator: RuntimeUpdateCoordinator;
  readonly restartRuntime: () => Promise<void>;
  readonly replayLspDocuments: (
    activities?: readonly RuntimeActivity[]
  ) => Promise<void>;
  readonly applyRuntimeEnvironment: () => Promise<void>;
  readonly reloadLanguageResources: () => Promise<void>;
}): ResourceComponentUpdateService => {
  const switchLanguageResource = async ({
    component,
    targetVersion,
    switchVersion,
    dataTransaction
  }: ResourceSwitchOperation): Promise<InstalledComponentV1> => {
    const originalActivation = {
      ...(component.active === undefined ? {} : { active: component.active }),
      ...(component.previous === undefined ? {} : { previous: component.previous }),
      ...(component.pending === undefined ? {} : { pending: component.pending })
    };
    let lock: Awaited<ReturnType<ResourceComponentManager["acquireExclusive"]>>;
    try {
      lock = await manager.acquireExclusive(component.componentId);
    } catch (error) {
      await dataTransaction?.rollback(async () => {
        await registry.restoreActivation(component.componentId, originalActivation);
      });
      throw error;
    }
    let lockHeld = true;
    let activationAttempted = false;
    try {
      const target = await manager.resolveVersion(component.componentId, targetVersion);
      await manager.assertHealthy(target);
      activationAttempted = true;
      const activated = await switchVersion();
      assertSelectedVersion(activated, targetVersion);
      const selected = await manager.resolveVersion(component.componentId, targetVersion);
      await manager.assertHealthy(selected);
      lock.release();
      lockHeld = false;
      await reloadLanguageResources();
      await dataTransaction?.commit();
      return activated;
    } catch (error) {
      if (activationAttempted || dataTransaction !== undefined) {
        if (!lockHeld) {
          lock = await manager.acquireExclusive(component.componentId);
          lockHeld = true;
        }
        const restoreActivation = async (): Promise<void> => {
          await registry.restoreActivation(component.componentId, originalActivation);
        };
        if (dataTransaction === undefined) {
          await restoreActivation();
        } else {
          // Restore module data while the resource is still exclusively
          // leased, then restore the registry pointers under the same journal.
          await dataTransaction.rollback(restoreActivation);
        }
        lock.release();
        lockHeld = false;
        if (activationAttempted) {
          await reloadLanguageResources();
        }
      }
      throw error;
    } finally {
      if (lockHeld) {
        lock.release();
      }
    }
  };

  const switchRuntimeResource = async ({
    component,
    targetVersion,
    switchVersion,
    dataTransaction
  }: ResourceSwitchOperation): Promise<InstalledComponentV1> => {
    const originalActivation = {
      ...(component.active === undefined ? {} : { active: component.active }),
      ...(component.previous === undefined ? {} : { previous: component.previous }),
      ...(component.pending === undefined ? {} : { pending: component.pending })
    };
    let lock: Awaited<ReturnType<ResourceComponentManager["acquireExclusive"]>>;
    try {
      lock = await manager.acquireExclusive(component.componentId);
    } catch (error) {
      await dataTransaction?.rollback(async () => {
        await registry.restoreActivation(component.componentId, originalActivation);
      });
      throw error;
    }
    let selectedResource: ResolvedResourceComponent | null = null;
    try {
      const target = await manager.resolveVersion(component.componentId, targetVersion);
      await manager.assertHealthy(target);
      return await runtimeCoordinator.applyUpdate({
        stage: async () => component,
        activate: async () => {
          const activated = await switchVersion();
          assertSelectedVersion(activated, targetVersion);
          selectedResource = await manager.resolveVersion(
            component.componentId,
            targetVersion
          );
          await applyRuntimeEnvironment();
          return activated;
        },
        restart: restartRuntime,
        healthCheck: async () => {
          if (selectedResource !== null) {
            await manager.assertHealthy(selectedResource);
          }
          await assertRuntimeHealth(runtimeClient);
        },
        replayRestartable: replayLspDocuments,
        commit: async () => {
          await dataTransaction?.commit();
        },
        cancelStage: async () => {
          await dataTransaction?.rollback(async () => {
            await registry.restoreActivation(
              component.componentId,
              originalActivation
            );
          });
        },
        rollback: async () => {
          let restored: InstalledComponentV1 | undefined;
          const restoreActivation = async (): Promise<void> => {
            restored = await registry.restoreActivation(
              component.componentId,
              originalActivation
            );
          };
          if (dataTransaction === undefined) {
            await restoreActivation();
          } else {
            await dataTransaction.rollback(restoreActivation);
          }
          if (restored === undefined) {
            throw new Error("Resource recovery did not restore activation pointers.");
          }
          selectedResource = restored.active === undefined
            ? null
            : await manager.resolveVersion(component.componentId, restored.active);
          await applyRuntimeEnvironment();
        }
      });
    } finally {
      lock.release();
    }
  };

  const switchResource = async (
    operation: ResourceSwitchOperation
  ): Promise<InstalledComponentV1> => {
    if (operation.component.kind !== "resource") {
      throw new Error(`Component is not a resource: ${operation.component.componentId}`);
    }
    return isRuntimeBackedResource(operation.component.componentId)
      ? await switchRuntimeResource(operation)
      : await switchLanguageResource(operation);
  };

  const installOrRepairAtSafePoint = async <T>(
    componentId: string,
    installOrRepair: () => Promise<T>
  ): Promise<{ readonly component: InstalledComponentV1; readonly result: T }> => {
    if (!isRuntimeBackedResource(componentId)) {
      throw new Error(
        `Safe-point acquisition is only available for Runtime-backed resources: ${componentId}`
      );
    }
    const lock = await manager.acquireExclusive(componentId);
    let selectedResource: ResolvedResourceComponent | null = null;
    let stagedActivation: ReturnType<typeof activationPointers> | undefined;
    let activationChanged = false;
    try {
      return await runtimeCoordinator.applyUpdate({
        stage: async () => undefined,
        activate: async () => {
          const result = await installOrRepair();
          const staged = await registry.read(componentId);
          if (staged === null || staged.kind !== "resource") {
            throw new Error(`Signed resource acquisition did not install ${componentId}.`);
          }
          stagedActivation = activationPointers(staged);
          const component = staged.pending === undefined
            ? staged
            : await registry.activate(componentId);
          activationChanged = staged.pending !== undefined;
          if (component.active === undefined) {
            throw new Error(`Signed resource acquisition did not activate ${componentId}.`);
          }
          selectedResource = await manager.resolveVersion(componentId, component.active);
          await applyRuntimeEnvironment();
          return { component, result };
        },
        restart: restartRuntime,
        healthCheck: async () => {
          if (selectedResource === null) {
            throw new Error(`Signed resource acquisition did not select ${componentId}.`);
          }
          await manager.assertHealthy(selectedResource);
          await assertRuntimeHealth(runtimeClient);
        },
        replayRestartable: replayLspDocuments,
        rollback: async () => {
          let restored = await registry.read(componentId);
          if (activationChanged && stagedActivation !== undefined) {
            restored = await registry.restoreActivation(componentId, stagedActivation);
          }
          selectedResource = restored?.active === undefined
            ? null
            : await manager.resolveVersion(componentId, restored.active);
          await applyRuntimeEnvironment();
        }
      });
    } finally {
      lock.release();
    }
  };

  return {
    activatePending: async (componentId, dataTransaction) => {
      const component = await registry.read(componentId);
      if (component === null) {
        throw new Error(`Component is not installed: ${componentId}`);
      }
      if (component.kind !== "resource" || component.pending === undefined) {
        return component;
      }
      return await switchResource({
        component,
        targetVersion: component.pending,
        switchVersion: () => registry.activate(componentId),
        ...(dataTransaction === undefined ? {} : { dataTransaction })
      });
    },
    rollbackActive: async (componentId) => {
      const component = await registry.read(componentId);
      if (component === null) {
        throw new Error(`Component is not installed: ${componentId}`);
      }
      if (component.kind !== "resource" || component.previous === undefined) {
        return component;
      }
      return await switchResource({
        component,
        targetVersion: component.previous,
        switchVersion: () => registry.rollback(componentId)
      });
    },
    installOrRepairAtSafePoint
  };
};

export const resourceUpdateInternalsForTests = {
  assertRuntimeHealth,
  isRuntimeBackedResource
};
