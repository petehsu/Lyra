import { ipcMain, protocol } from "electron";
import path from "node:path";

import {
  LYRA_CHANNELS,
  type ComponentActivateRequest,
  type ComponentActivationAssessment,
  type ComponentActivationRisk,
  type ComponentActivationResponse,
  type ComponentInstallFromDirectoryRequest,
  type ComponentResolveAppModuleRequest,
  type ComponentStageUpdateRequest,
  type ComponentSummary,
  type ComponentVersionRequest
} from "../../shared/desktop-bridge";
import type {
  ComponentRegistryStore,
  ComponentReleaseKeyScope,
  InstalledComponentV1
} from "./registry";
import type {
  ModuleDataActivationState,
  ModuleDataSchemaStore,
  ModuleDataSchemaTransaction
} from "./data-schema";
import { createComponentRegistryStore } from "./registry";
import type { RuntimeComponentUpdateService } from "../runtime-update/service";
import type { ComponentUpdateService } from "../component-update";
import type { CoreProjectionCoordinator } from "../component-update";
import type { ResourceComponentUpdateService } from "./resource-update";
import type { ThirdPartyAppLifecycleService } from "../third-party-apps";
import { createAppModuleAssetService, LYRA_APP_MODULE_SCHEME } from "./app-module-assets";
import { assessComponentActivation } from "./activation-risk";

const COMPONENT_ID_PATTERN = /^[a-z0-9._-]{1,128}$/u;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const ACTIVATION_RISKS = new Set<ComponentActivationRisk>([
  "publisher-change",
  "permission-increase",
  "host-api-major-change",
  "component-major-change",
  "data-migration",
  "execution-class-change"
]);

const normalizeComponentId = (value: unknown): string => {
  if (typeof value !== "string" || !COMPONENT_ID_PATTERN.test(value)) {
    throw new Error("Component id is invalid.");
  }
  return value;
};

const parseActivationRequest = (value: unknown): ComponentActivateRequest => {
  if (
    typeof value !== "object"
    || value === null
    || !("componentId" in value)
    || !("confirmedReasons" in value)
    || !Array.isArray(value.confirmedReasons)
    || value.confirmedReasons.some((reason) => !ACTIVATION_RISKS.has(reason))
  ) {
    throw new Error("Component activation request is invalid.");
  }
  return {
    componentId: normalizeComponentId(value.componentId),
    confirmedReasons: value.confirmedReasons
  };
};

const assertActivationConfirmed = (
  assessment: ComponentActivationAssessment,
  request: ComponentActivateRequest
): void => {
  if (
    assessment.requiresConfirmation
    && assessment.reasons.some((reason) => !request.confirmedReasons.includes(reason))
  ) {
    throw new Error(`Component activation requires confirmation: ${assessment.reasons.join(", ")}`);
  }
};

const toSummary = (component: InstalledComponentV1): ComponentSummary => ({
  componentId: component.componentId,
  kind: component.kind,
  ...(component.active === undefined ? {} : { active: component.active }),
  ...(component.previous === undefined ? {} : { previous: component.previous }),
  ...(component.pending === undefined ? {} : { pending: component.pending }),
  versions: Object.entries(component.versions)
    .map(([version, installed]) => ({
      version,
      installedAt: installed.installedAt,
      target: installed.target
    }))
    .sort((left, right) => right.version.localeCompare(left.version))
});

export const createComponentsIpcBridge = ({
  componentsRoot,
  systemRoot,
  publicKeys,
  releaseKeyScopes,
  allowLocalInstall,
  runtimeUpdate,
  resourceUpdate,
  componentUpdate,
  coreProjection,
  dataSchemaStore,
  dataMigrators = {},
  registryStore,
  thirdPartyApps
}: {
  readonly componentsRoot: string;
  readonly systemRoot: string;
  readonly publicKeys: Readonly<Record<string, string>>;
  readonly releaseKeyScopes: Readonly<Record<string, ComponentReleaseKeyScope>>;
  readonly allowLocalInstall: boolean;
  readonly runtimeUpdate?: RuntimeComponentUpdateService;
  readonly resourceUpdate?: ResourceComponentUpdateService;
  readonly componentUpdate?: ComponentUpdateService;
  readonly coreProjection?: CoreProjectionCoordinator;
  readonly dataSchemaStore?: ModuleDataSchemaStore;
  readonly dataMigrators?: Readonly<Record<
    string,
    (stagedDataRoot: string, fromSchema: number, toSchema: number) => Promise<void>
  >>;
  readonly registryStore?: ComponentRegistryStore;
  readonly thirdPartyApps?: ThirdPartyAppLifecycleService;
}) => {
  const store = registryStore
    ?? createComponentRegistryStore({
      componentsRoot,
      systemRoot,
      publicKeys,
      releaseKeyScopes,
      allowLocalActivation: allowLocalInstall
    });
  const appModules = createAppModuleAssetService({ componentsRoot, registryStore: store });
  const readRequired = async (componentId: string): Promise<InstalledComponentV1> => {
    const component = await store.read(componentId);
    if (component === null) {
      throw new Error(`Component is not installed: ${componentId}`);
    }
    return component;
  };
  const readComponentData = async (componentId: string, version: string): Promise<void> => {
    if (dataSchemaStore === undefined) {
      return;
    }
    const component = await readRequired(componentId);
    const installed = component.versions[version];
    if (installed === undefined) {
      throw new Error(`Component version is not installed: ${componentId}@${version}`);
    }
    await dataSchemaStore.readOrInitialize(componentId, installed.manifest.dataSchema);
  };
  const activationPointers = (
    component: InstalledComponentV1
  ): ModuleDataActivationState => ({
    ...(component.active === undefined ? {} : { active: component.active }),
    ...(component.previous === undefined ? {} : { previous: component.previous }),
    ...(component.pending === undefined ? {} : { pending: component.pending })
  });
  const prepareComponentData = async (
    component: InstalledComponentV1,
    version: string
  ): Promise<ModuleDataSchemaTransaction | undefined> => {
    if (dataSchemaStore === undefined) {
      return undefined;
    }
    const installed = component.versions[version];
    if (installed === undefined) {
      throw new Error(`Component version is not installed: ${component.componentId}@${version}`);
    }
    const migrator = dataMigrators[component.componentId];
    return await dataSchemaStore.prepare(
      component.componentId,
      installed.manifest.dataSchema,
      {
        ...(migrator === undefined ? {} : { migration: migrator }),
        activationBefore: activationPointers(component)
      }
    );
  };
  const assessActivation = async (componentId: string): Promise<ComponentActivationAssessment> => {
    return assessComponentActivation(await readRequired(componentId));
  };

  ipcMain.handle(LYRA_CHANNELS.componentsList, async () =>
    (await store.list()).map(toSummary));
  ipcMain.handle(
    LYRA_CHANNELS.componentsResolveAppModule,
    async (_event, request: ComponentResolveAppModuleRequest) => {
      if (typeof request !== "object" || request === null) {
        throw new Error("App module request is invalid.");
      }
      if (typeof request.version !== "string" || !VERSION_PATTERN.test(request.version)) {
        throw new Error("App module version is invalid.");
      }
      const componentId = normalizeComponentId(request.componentId);
      await readComponentData(componentId, request.version);
      return appModules.resolveEntry({ componentId, version: request.version });
    }
  );
  ipcMain.handle(LYRA_CHANNELS.componentsAssessActivation, async (_event, value: unknown) =>
    assessActivation(normalizeComponentId(value)));
  ipcMain.handle(
    LYRA_CHANNELS.componentsStageUpdate,
    async (event, request: ComponentStageUpdateRequest) => {
      if (componentUpdate === undefined) {
        throw new Error("Component update service is unavailable.");
      }
      if (
        typeof request !== "object"
        || request === null
        || !new Set(["stable", "preview"]).has(request.channel)
        || (request.releaseVersion !== undefined && typeof request.releaseVersion !== "string")
        || (request.proxy !== undefined && typeof request.proxy !== "string")
      ) {
        throw new Error("Component update request is invalid.");
      }
      return componentUpdate.stage(request, (progress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(LYRA_CHANNELS.componentsUpdateProgress, progress);
        }
      });
    }
  );
  ipcMain.handle(LYRA_CHANNELS.componentsCancelUpdate, async () => {
    componentUpdate?.cancel();
  });
  ipcMain.handle(LYRA_CHANNELS.componentsCoreProjectionStatus, async () =>
    coreProjection?.readStatus() ?? {
      state: "failed",
      componentId: "lyra.core",
      error: "Core projection coordinator is unavailable."
    });
  ipcMain.handle(LYRA_CHANNELS.componentsApplyCore, async (_event, value: unknown) => {
    if (coreProjection === undefined) {
      throw new Error("Core projection coordinator is unavailable.");
    }
    const request = parseActivationRequest(value);
    if (request.componentId !== "lyra.core") {
      throw new Error("Core projection can only apply lyra.core.");
    }
    const component = await readRequired(request.componentId);
    if (component.kind !== "core" || component.pending === undefined) {
      throw new Error("No pending Core update is available.");
    }
    assertActivationConfirmed(await assessActivation(request.componentId), request);
    const handoff = await coreProjection.applyAndQuit();
    return {
      state: handoff.state,
      componentId: handoff.componentId,
      pendingVersion: handoff.pendingVersion,
      requestId: handoff.requestId
    };
  });
  protocol.handle(LYRA_APP_MODULE_SCHEME, async (request) => {
    try {
      const asset = await appModules.readAsset(request.url);
      if (asset === null) {
        return new Response(new Uint8Array(), { status: 404 });
      }
      return new Response(Uint8Array.from(asset.bytes).buffer, {
        status: 200,
        headers: {
          "access-control-allow-origin": "*",
          "cache-control": "private, max-age=31536000, immutable",
          "content-type": asset.contentType,
          "cross-origin-resource-policy": "cross-origin",
          "x-content-type-options": "nosniff"
        }
      });
    } catch (error) {
      console.error("[lyra-components] refused app module asset", error);
      return new Response(new Uint8Array(), { status: 403 });
    }
  });
  ipcMain.handle(
    LYRA_CHANNELS.componentsInstallFromDirectory,
    async (_event, request: ComponentInstallFromDirectoryRequest): Promise<ComponentSummary> => {
      if (!allowLocalInstall) {
        throw new Error("Local component installation is disabled in production builds.");
      }
      if (
        typeof request !== "object"
        || request === null
        || typeof request.path !== "string"
        || !path.isAbsolute(request.path)
      ) {
        throw new Error("Component directory must be an absolute path.");
      }
      return toSummary(await store.installFromDirectory(request.path));
    }
  );
  ipcMain.handle(
    LYRA_CHANNELS.componentsActivate,
    async (_event, value: unknown): Promise<ComponentActivationResponse> => {
    const request = parseActivationRequest(value);
    const componentId = request.componentId;
    const assessment = await assessActivation(componentId);
    assertActivationConfirmed(assessment, request);
    const component = await store.read(componentId);
    if (component?.kind === "core" && component.pending !== undefined) {
      return {
        ...toSummary(component),
        status: "restart-required",
        restartRequired: true,
        coreProjection: await (
          coreProjection?.readStatus() ?? Promise.resolve({
            state: "failed" as const,
            componentId: "lyra.core" as const,
            error: "Core projection coordinator is unavailable."
          })
        )
      };
    }
    if (component !== null && component.kind === "runtime" && component.pending !== undefined) {
      if (runtimeUpdate === undefined) {
        throw new Error("Runtime update coordinator is unavailable.");
      }
      const dataTransaction = await prepareComponentData(component, component.pending);
      return toSummary(await runtimeUpdate.activatePending({
        component,
        activate: () => store.activate(componentId),
        rollback: () => store.rollback(componentId),
        read: () => readRequired(componentId),
        ...(dataTransaction === undefined ? {} : { dataTransaction })
      }));
    }
    if (component !== null && component.kind === "resource" && component.pending !== undefined) {
      if (resourceUpdate === undefined) {
        throw new Error("Resource update coordinator is unavailable.");
      }
      const dataTransaction = await prepareComponentData(component, component.pending);
      return toSummary(await resourceUpdate.activatePending(componentId, dataTransaction));
    }
    if (
      component?.pending !== undefined
      && ["sandboxed-web", "sandboxed-web-wasi"].includes(
        component.versions[component.pending]?.manifest.executionClass ?? ""
      )
    ) {
      if (thirdPartyApps === undefined) {
        throw new Error("Third-party application lifecycle is unavailable.");
      }
      const dataTransaction = await prepareComponentData(component, component.pending);
      try {
        const activated = await thirdPartyApps.activatePending(componentId);
        await dataTransaction?.commit();
        return toSummary(activated.component);
      } catch (error) {
        const restoreActivation = async (): Promise<void> => {
          await store.restoreActivation(componentId, activationPointers(component));
        };
        if (dataTransaction === undefined) {
          await restoreActivation();
        } else {
          await dataTransaction.rollback(restoreActivation);
        }
        throw error;
      }
    }
    if (component?.pending === undefined) {
      return toSummary(await store.activate(componentId));
    }
    const dataTransaction = await prepareComponentData(component, component.pending);
    try {
      const activated = await store.activate(componentId);
      await dataTransaction?.commit();
      return toSummary(activated);
    } catch (error) {
      const restoreActivation = async (): Promise<void> => {
        await store.restoreActivation(componentId, activationPointers(component));
      };
      if (dataTransaction === undefined) {
        await restoreActivation();
      } else {
        await dataTransaction.rollback(restoreActivation);
      }
      throw error;
    }
    }
  );
  ipcMain.handle(LYRA_CHANNELS.componentsRollback, async (_event, value: unknown) => {
    const componentId = normalizeComponentId(value);
    const component = await store.read(componentId);
    if (component?.kind === "core") {
      throw new Error(
        "Core rollback requires an external projection helper and is not available in this build."
      );
    }
    if (component !== null && component.kind === "runtime" && component.previous !== undefined) {
      if (runtimeUpdate === undefined) {
        throw new Error("Runtime update coordinator is unavailable.");
      }
      return toSummary(await runtimeUpdate.rollbackActive({
        component,
        rollback: () => store.rollback(componentId),
        restore: () => store.rollback(componentId),
        read: () => readRequired(componentId)
      }));
    }
    if (component !== null && component.kind === "resource" && component.previous !== undefined) {
      if (resourceUpdate === undefined) {
        throw new Error("Resource update coordinator is unavailable.");
      }
      return toSummary(await resourceUpdate.rollbackActive(componentId));
    }
    if (
      component?.previous !== undefined
      && [component.active, component.previous].some((version) =>
        version !== undefined
        && ["sandboxed-web", "sandboxed-web-wasi"].includes(
          component.versions[version]?.manifest.executionClass ?? ""
        )
      )
    ) {
      if (thirdPartyApps === undefined) {
        throw new Error("Third-party application lifecycle is unavailable.");
      }
      return toSummary(await thirdPartyApps.rollback(componentId));
    }
    return toSummary(await store.rollback(componentId));
  });
  ipcMain.handle(
    LYRA_CHANNELS.componentsUninstallVersion,
    async (_event, request: ComponentVersionRequest): Promise<void> => {
      if (
        typeof request !== "object"
        || request === null
        || typeof request.version !== "string"
        || !VERSION_PATTERN.test(request.version)
      ) {
        throw new Error("Component version request is invalid.");
      }
      const componentId = normalizeComponentId(request.componentId);
      const component = await store.read(componentId);
      const executionClass = component?.versions[request.version]?.manifest.executionClass;
      if (executionClass === "sandboxed-web" || executionClass === "sandboxed-web-wasi") {
        if (thirdPartyApps === undefined) {
          throw new Error("Third-party application lifecycle is unavailable.");
        }
        await thirdPartyApps.uninstallVersion(componentId, request.version);
        return;
      }
      await store.uninstallVersion(componentId, request.version);
    }
  );

  return {
    store,
    dispose: () => {
      ipcMain.removeHandler(LYRA_CHANNELS.componentsList);
      ipcMain.removeHandler(LYRA_CHANNELS.componentsResolveAppModule);
      ipcMain.removeHandler(LYRA_CHANNELS.componentsInstallFromDirectory);
      ipcMain.removeHandler(LYRA_CHANNELS.componentsAssessActivation);
      ipcMain.removeHandler(LYRA_CHANNELS.componentsActivate);
      ipcMain.removeHandler(LYRA_CHANNELS.componentsRollback);
      ipcMain.removeHandler(LYRA_CHANNELS.componentsUninstallVersion);
      ipcMain.removeHandler(LYRA_CHANNELS.componentsStageUpdate);
      ipcMain.removeHandler(LYRA_CHANNELS.componentsCancelUpdate);
      ipcMain.removeHandler(LYRA_CHANNELS.componentsCoreProjectionStatus);
      ipcMain.removeHandler(LYRA_CHANNELS.componentsApplyCore);
      protocol.unhandle(LYRA_APP_MODULE_SCHEME);
      componentUpdate?.dispose();
    }
  };
};
