import { join } from "node:path";

import {
  createComponentUpdateService,
  createCoreProjectionCoordinator,
  readComponentUpdateChannels,
  resolveBootstrapExecutable,
  resolveComponentUpdateChannelConfigPath,
  resolveComponentTarget,
  resolveDesktopProgramRoot,
  type CoreProjectionCoordinator
} from "./component-update";
import {
  applyRuntimeResourceComponentEnvironment,
  createBoundResourceConsumerLease,
  createCanonicalActivationRegistryClient,
  createComponentRegistryStore,
  createComponentsIpcBridge,
  createModuleDataSchemaStore,
  createPlaywrightResourceAcquisitionService,
  createResourceComponentManager,
  createResourceComponentUpdateService,
  RUST_ANALYZER_RESOURCE_COMPONENT_ID,
  readActiveLanguageResourceBundles,
  readTrustedComponentRoots,
  readVerifiedReleaseKeys,
  recoverUnhealthyActiveResourceComponents,
  type PlaywrightResourceAcquisitionService
} from "./components";
import { validateComponentLanguagePackBundle } from "./language-packs";
import {
  configureLanguageServerEnvironment,
  type RustAnalyzerResourceLeaseRunner
} from "./lsp";
import { createAria2ResourceLeaseHostService } from "./download-manager/aria2-resource-leases";
import type { LyraRuntimeClient } from "./runtime-client";
import {
  assertInstalledRuntimeExecutable,
  createRestartableRuntimeClient,
  createRuntimeActivityTrackingClient,
  createRuntimeComponentUpdateService,
  createRuntimeUpdateCoordinator,
  createRuntimeUpdateJournal,
  createUnavailableRuntimeClient,
  recoverInterruptedRuntimeUpdate,
  resolveRuntimeStartupEntry
} from "./runtime-update";
import { createSharedProcessClient } from "./shared-process/shared-process-client";
import type { LyraStorageRoots } from "./storage";
import { createThirdPartyAppLifecycleService } from "./third-party-apps";

export { LYRA_APP_MODULE_SCHEME } from "./components";

export type ModularRuntimeHost = {
  readonly runtimeClient: LyraRuntimeClient;
  readonly coreProjection: CoreProjectionCoordinator;
  readonly withRustAnalyzerResource: RustAnalyzerResourceLeaseRunner;
  readonly readLanguageResourceBundles: () => Promise<
    Readonly<Record<string, Record<string, string>>>
  >;
  readonly ensurePlaywrightResource: PlaywrightResourceAcquisitionService["ensureAvailable"];
  readonly repairPlaywrightResource: PlaywrightResourceAcquisitionService["repair"];
  readonly registerComponentServices: (input: {
    readonly reloadLanguageResources: () => Promise<void>;
  }) => Promise<{ readonly dispose: () => void }>;
  readonly disposeRuntime: () => void;
};

export const createModularRuntimeHost = async ({
  storageRoots,
  resourcesPath,
  sharedProcessModulePath,
  isPackaged,
  programRoot,
  requestQuit
}: {
  readonly storageRoots: LyraStorageRoots;
  readonly resourcesPath: string;
  readonly sharedProcessModulePath: string;
  readonly isPackaged: boolean;
  readonly programRoot?: string;
  readonly requestQuit: () => void;
}): Promise<ModularRuntimeHost> => {
  const componentTarget = resolveComponentTarget(process.platform, process.arch);
  const componentTrustRoots = await readTrustedComponentRoots({
    filePath: join(resourcesPath, "component-trust", "trusted-keys.json"),
    ...(isPackaged || process.env.LYRA_COMPONENT_PUBLIC_KEYS_JSON === undefined
      ? {}
      : { envJson: process.env.LYRA_COMPONENT_PUBLIC_KEYS_JSON })
  });
  const componentReleaseKeys = await readVerifiedReleaseKeys({
    systemRoot: storageRoots.systemRoot,
    roots: componentTrustRoots
  });
  const dynamicComponentReleaseKeys: Record<string, string> = {
    ...componentReleaseKeys.pem
  };
  const dynamicComponentReleaseKeyScopes = {
    ...componentReleaseKeys.scopes
  };
  const resolveBootstrapPath = () => resolveBootstrapExecutable({
    cwd: process.cwd(),
    resourcesPath,
    platform: process.platform,
    arch: process.arch
  });
  const canonicalActivationRegistry = createCanonicalActivationRegistryClient({
    installRoot: storageRoots.componentInstallRoot,
    stateRoot: storageRoots.systemRoot,
    target: componentTarget,
    resolveExecutablePath: resolveBootstrapPath
  });
  const componentRegistryStore = createComponentRegistryStore({
    componentsRoot: storageRoots.componentsRoot,
    systemRoot: storageRoots.systemRoot,
    publicKeys: dynamicComponentReleaseKeys,
    releaseKeyScopes: dynamicComponentReleaseKeyScopes,
    canonicalActivationRegistry,
    allowLocalActivation: isPackaged === false
  });
  const coreProjection = createCoreProjectionCoordinator({
    installRoot: storageRoots.componentInstallRoot,
    stateRoot: storageRoots.systemRoot,
    programRoot: programRoot ?? resolveDesktopProgramRoot({
      platform: process.platform,
      executablePath: process.execPath
    }),
    target: componentTarget,
    platform: process.platform,
    resolveBootstrapPath,
    readPendingVersion: async () => (await componentRegistryStore.read("lyra.core"))?.pending,
    requestQuit
  });
  const componentDataSchemaStore = createModuleDataSchemaStore({
    dataRoot: storageRoots.dataRoot,
    snapshotRoot: join(storageRoots.systemRoot, "component-data-snapshots")
  });
  const recoveredDataTransactions =
    await componentDataSchemaStore.recoverInterruptedTransactions(
      async ({ componentId, activationBefore }) => {
        if (activationBefore !== undefined) {
          await componentRegistryStore.restoreActivation(
            componentId,
            activationBefore
          );
        }
      }
    );
  for (const componentId of recoveredDataTransactions) {
    console.warn(
      `[lyra-components] recovered interrupted data and activation transaction for ${componentId}`
    );
  }

  const resourceComponentManager = createResourceComponentManager({
    componentsRoot: storageRoots.componentsRoot,
    registry: componentRegistryStore
  });
  const resourceRecovery = await recoverUnhealthyActiveResourceComponents({
    registry: componentRegistryStore,
    manager: resourceComponentManager,
    validateLanguageBundle: validateComponentLanguagePackBundle
  });
  for (const recovery of resourceRecovery) {
    if (recovery.status === "rolled-back") {
      console.warn(
        `[lyra-resources] restored ${recovery.componentId} `
        + `${recovery.fromVersion} -> ${recovery.activeVersion}: ${recovery.error ?? "unhealthy"}`
      );
    } else if (recovery.status === "unrecoverable") {
      console.error(
        `[lyra-resources] ${recovery.componentId}@${recovery.activeVersion} requires repair: `
        + `${recovery.error ?? "unhealthy"}`
      );
    }
  }

  const applyRuntimeResourceEnvironment = async (): Promise<void> => {
    const result = await applyRuntimeResourceComponentEnvironment({
      manager: resourceComponentManager,
      componentsRoot: storageRoots.componentsRoot,
      developmentFallback: isPackaged === false,
      resourcesPath
    });
    for (const resource of result.resources) {
      const detail = resource.version === undefined
        ? resource.source
        : `${resource.source}@${resource.version}`;
      if (resource.error === undefined) {
        console.info(
          `[lyra-resources] ${resource.componentId} ${detail}: ${resource.runtimePath}`
        );
      } else {
        console.warn(
          `[lyra-resources] ${resource.componentId} ${detail}: ${resource.error}`
        );
      }
    }
  };
  await applyRuntimeResourceEnvironment();
  // These paths must be fixed before forking the utility process. Packaged
  // builds never discover rust-analyzer from PATH or repository resources.
  configureLanguageServerEnvironment({
    allowRustAnalyzerFallback: isPackaged === false
  });
  const runWithRustAnalyzerResource = createBoundResourceConsumerLease({
    manager: resourceComponentManager,
    componentId: RUST_ANALYZER_RESOURCE_COMPONENT_ID,
    readConfiguredRuntimePath: () => process.env.LYRA_LSP_RUST_ANALYZER,
    developmentFallback: isPackaged === false
  });
  const withRustAnalyzerResource: RustAnalyzerResourceLeaseRunner =
    async <T>(operation: () => Promise<T>): Promise<T> =>
      await runWithRustAnalyzerResource(() => operation());

  const runtimeUpdateJournal = createRuntimeUpdateJournal(storageRoots.systemRoot);
  let runtimeStartupFailure: unknown;
  let installedRuntime: Awaited<ReturnType<typeof componentRegistryStore.read>> = null;
  let initialRuntimeBinaryPath: string | undefined;
  let initialRuntimeComponentVersion: string | undefined;
  try {
    await recoverInterruptedRuntimeUpdate({
      journal: runtimeUpdateJournal,
      registry: componentRegistryStore
    });
    installedRuntime = await componentRegistryStore.read("lyra.runtime");
    if (installedRuntime?.kind === "runtime" && installedRuntime.active !== undefined) {
      const installedVersion = await componentRegistryStore.verifyInstalledVersion(
        installedRuntime.componentId,
        installedRuntime.active
      );
      await componentDataSchemaStore.readOrInitialize(
        installedRuntime.componentId,
        installedVersion.manifest.dataSchema
      );
    }
    initialRuntimeBinaryPath = resolveRuntimeStartupEntry({
      componentsRoot: storageRoots.componentsRoot,
      component: installedRuntime,
      allowDevelopmentFallback: isPackaged === false
    });
    if (initialRuntimeBinaryPath !== undefined) {
      await assertInstalledRuntimeExecutable(initialRuntimeBinaryPath);
      initialRuntimeComponentVersion = installedRuntime?.active;
    }
  } catch (error) {
    runtimeStartupFailure = error;
    console.error(
      "[lyra-runtime] signed Runtime component requires repair; Core will continue without Runtime",
      error
    );
  }

  const createRuntimeProcessClient = (
    runtimeBinaryPath?: string,
    runtimeComponentVersion?: string
  ) =>
    createSharedProcessClient({
      modulePath: sharedProcessModulePath,
      storageRoot: storageRoots.modules.runtime,
      agentStorageRoot: storageRoots.modules.agent,
      ...(runtimeBinaryPath === undefined ? {} : { runtimeBinaryPath }),
      ...(runtimeComponentVersion === undefined
        ? {}
        : { runtimeComponentVersion })
    });
  const restartableRuntime = createRestartableRuntimeClient(
    () => runtimeStartupFailure === undefined
      ? createRuntimeProcessClient(
          initialRuntimeBinaryPath,
          initialRuntimeComponentVersion
        )
      : createUnavailableRuntimeClient(runtimeStartupFailure)
  );
  const runtimeUpdateCoordinator = createRuntimeUpdateCoordinator();
  const runtimeActivityTracker = createRuntimeActivityTrackingClient(
    restartableRuntime.client,
    runtimeUpdateCoordinator
  );
  const runtimeClient = runtimeActivityTracker.client;
  const aria2ResourceLeases = createAria2ResourceLeaseHostService({
    manager: resourceComponentManager,
    runtimeClient,
    readConfiguredRuntimePath: () => process.env.LYRA_ARIA2_BINARY,
    readConfiguredComponentVersion: () => process.env.LYRA_ARIA2_COMPONENT_VERSION,
    developmentFallback: isPackaged === false
  });
  const runtimeUpdate = createRuntimeComponentUpdateService({
    componentsRoot: storageRoots.componentsRoot,
    runtimeClient,
    coordinator: runtimeUpdateCoordinator,
    restartRuntime: async (runtimeBinaryPath, componentVersion) => {
      await restartableRuntime.restart(
        () => createRuntimeProcessClient(runtimeBinaryPath, componentVersion)
      );
    },
    replayLspDocuments: runtimeActivityTracker.replayLspDocuments,
    journal: runtimeUpdateJournal
  });

  let componentServicesRegistered = false;
  let playwrightAcquisition: PlaywrightResourceAcquisitionService | null = null;
  const registerComponentServices: ModularRuntimeHost["registerComponentServices"] =
    async ({ reloadLanguageResources }) => {
      if (componentServicesRegistered) {
        throw new Error("Modular component services are already registered.");
      }
      componentServicesRegistered = true;
      const resourceUpdate = createResourceComponentUpdateService({
        registry: componentRegistryStore,
        manager: resourceComponentManager,
        runtimeClient,
        runtimeCoordinator: runtimeUpdateCoordinator,
        restartRuntime: () => restartableRuntime.restart(),
        replayLspDocuments: runtimeActivityTracker.replayLspDocuments,
        applyRuntimeEnvironment: applyRuntimeResourceEnvironment,
        reloadLanguageResources
      });
      const componentUpdate = createComponentUpdateService({
        installRoot: storageRoots.componentInstallRoot,
        stateRoot: storageRoots.systemRoot,
        trustedRoots: componentTrustRoots,
        catalogUrls: await readComponentUpdateChannels({
          filePath: resolveComponentUpdateChannelConfigPath({
            resourcesPath,
            isPackaged,
            cwd: process.cwd()
          }),
          target: componentTarget,
          isPackaged,
          env: process.env
        }),
        resourcesPath,
        onStageCompleted: coreProjection.noteStaged,
        onTrustUpdated: async () => {
          const next = await readVerifiedReleaseKeys({
            systemRoot: storageRoots.systemRoot,
            roots: componentTrustRoots
          });
          for (const key of Object.keys(dynamicComponentReleaseKeys)) {
            delete dynamicComponentReleaseKeys[key];
          }
          for (const key of Object.keys(dynamicComponentReleaseKeyScopes)) {
            delete dynamicComponentReleaseKeyScopes[key];
          }
          Object.assign(dynamicComponentReleaseKeys, next.pem);
          Object.assign(dynamicComponentReleaseKeyScopes, next.scopes);
        }
      });
      playwrightAcquisition = createPlaywrightResourceAcquisitionService({
        registry: componentRegistryStore,
        canonicalRegistry: canonicalActivationRegistry,
        manager: resourceComponentManager,
        resourceUpdate,
        componentUpdate,
        developmentFallback: isPackaged === false,
        readDevelopmentRuntimePath: () =>
          process.env.PLAYWRIGHT_BROWSERS_PATH?.trim()
          || join(process.cwd(), "apps", "desktop", "resources", "playwright-browsers")
      });
      const thirdPartyApps = await createThirdPartyAppLifecycleService({
        componentsRoot: storageRoots.componentsRoot,
        dataRoot: storageRoots.dataRoot,
        temporaryRoot: join(storageRoots.systemRoot, "third-party-apps", "temporary"),
        registryStore: componentRegistryStore,
        resourcesRoot: resourcesPath,
        hostFeatureEnabled:
          isPackaged === false || process.env.LYRA_ENABLE_THIRD_PARTY_APPS === "1",
        wasiFeatureEnabled:
          isPackaged === false || process.env.LYRA_ENABLE_THIRD_PARTY_WASI === "1"
      });
      const componentsBridge = createComponentsIpcBridge({
        componentsRoot: storageRoots.componentsRoot,
        systemRoot: storageRoots.systemRoot,
        publicKeys: dynamicComponentReleaseKeys,
        releaseKeyScopes: dynamicComponentReleaseKeyScopes,
        allowLocalInstall:
          isPackaged === false || process.env.LYRA_ENABLE_LOCAL_COMPONENT_INSTALL === "1",
        runtimeUpdate,
        resourceUpdate,
        componentUpdate,
        dataSchemaStore: componentDataSchemaStore,
        registryStore: componentRegistryStore,
        thirdPartyApps,
        coreProjection
      });
      return {
        dispose: () => {
          void thirdPartyApps.dispose();
          componentsBridge.dispose();
          playwrightAcquisition = null;
          aria2ResourceLeases.dispose();
          resourceComponentManager.dispose();
        }
      };
    };

  return {
    runtimeClient,
    coreProjection,
    withRustAnalyzerResource,
    readLanguageResourceBundles: () => readActiveLanguageResourceBundles({
      registry: componentRegistryStore,
      manager: resourceComponentManager,
      validateBundle: validateComponentLanguagePackBundle
    }),
    ensurePlaywrightResource: (onProgress) => {
      if (playwrightAcquisition === null) {
        return Promise.reject(new Error("Playwright resource acquisition is not registered."));
      }
      return playwrightAcquisition.ensureAvailable(onProgress);
    },
    repairPlaywrightResource: (onProgress) => {
      if (playwrightAcquisition === null) {
        return Promise.reject(new Error("Playwright resource acquisition is not registered."));
      }
      return playwrightAcquisition.repair(onProgress);
    },
    registerComponentServices,
    disposeRuntime: () => {
      aria2ResourceLeases.dispose();
      runtimeActivityTracker.dispose();
      runtimeUpdateCoordinator.dispose();
      restartableRuntime.dispose();
      coreProjection.dispose();
    }
  };
};
