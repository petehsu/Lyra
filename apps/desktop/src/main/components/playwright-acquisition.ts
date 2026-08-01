import type {
  ComponentUpdateProgress,
  ComponentUpdateReport
} from "../../shared/desktop-bridge";
import type { ComponentUpdateService } from "../component-update";
import type { CanonicalActivationRegistryClient } from "./bootstrap-registry-client";
import type { ComponentRegistryStore } from "./registry";
import {
  PLAYWRIGHT_RESOURCE_COMPONENT_ID,
  type ResourceComponentManager,
  type ResolvedResourceComponent
} from "./resource-components";
import type { ResourceComponentUpdateService } from "./resource-update";

export type PlaywrightResourceAvailability = {
  readonly source: "signed-component" | "development-fallback";
  readonly runtimePath: string;
  readonly version?: string;
  readonly report?: ComponentUpdateReport;
};

export type PlaywrightResourceAcquisitionService = {
  readonly ensureAvailable: (
    onProgress?: (progress: ComponentUpdateProgress) => void
  ) => Promise<PlaywrightResourceAvailability>;
  readonly repair: (
    onProgress?: (progress: ComponentUpdateProgress) => void
  ) => Promise<PlaywrightResourceAvailability>;
};

const reportComponentIds = (report: ComponentUpdateReport): readonly string[] => [
  ...report.installedComponents,
  ...report.repairedComponents,
  ...report.stagedComponents
];

const assertPinnedAcquisitionReport = (
  report: ComponentUpdateReport,
  releaseVersion: string,
  catalogSequence: number
): void => {
  if (
    report.releaseVersion !== releaseVersion
    || report.catalogSequence !== catalogSequence
    || reportComponentIds(report).some(
      (componentId) => componentId !== PLAYWRIGHT_RESOURCE_COMPONENT_ID
    )
    || report.deferredComponents.includes(PLAYWRIGHT_RESOURCE_COMPONENT_ID)
  ) {
    throw new Error("Playwright acquisition report escaped the pinned active BOM selection.");
  }
};

const resolveHealthyActive = async (
  manager: ResourceComponentManager
): Promise<ResolvedResourceComponent | null> => {
  const resource = await manager.resolveActive(PLAYWRIGHT_RESOURCE_COMPONENT_ID);
  if (resource === null) {
    return null;
  }
  await manager.assertHealthy(resource);
  return resource;
};

const toAvailability = (
  resource: ResolvedResourceComponent,
  report?: ComponentUpdateReport
): PlaywrightResourceAvailability => ({
  source: "signed-component",
  runtimePath: resource.runtimePath,
  version: resource.version,
  ...(report === undefined ? {} : { report })
});

const isCoordinationFailure = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" && (
    code === "RESOURCE_COMPONENT_BUSY"
    || code.startsWith("RUNTIME_UPDATE_")
    || code === "RUNTIME_SAFE_POINT_TIMEOUT"
  );
};

export const createPlaywrightResourceAcquisitionService = ({
  registry,
  canonicalRegistry,
  manager,
  resourceUpdate,
  componentUpdate,
  developmentFallback,
  readDevelopmentRuntimePath = () => process.env.PLAYWRIGHT_BROWSERS_PATH ?? ""
}: {
  readonly registry: ComponentRegistryStore;
  readonly canonicalRegistry: CanonicalActivationRegistryClient;
  readonly manager: ResourceComponentManager;
  readonly resourceUpdate: ResourceComponentUpdateService;
  readonly componentUpdate: ComponentUpdateService;
  readonly developmentFallback: boolean;
  readonly readDevelopmentRuntimePath?: () => string;
}): PlaywrightResourceAcquisitionService => {
  let activeRequest: Promise<PlaywrightResourceAvailability> | null = null;

  const acquire = async (
    forceRepair: boolean,
    onProgress: (progress: ComponentUpdateProgress) => void
  ): Promise<PlaywrightResourceAvailability> => {
    if (developmentFallback) {
      const runtimePath = readDevelopmentRuntimePath().trim();
      if (runtimePath.length === 0) {
        throw new Error("Playwright development fallback path is unavailable.");
      }
      return {
        source: "development-fallback",
        runtimePath
      };
    }

    const installed = await registry.read(PLAYWRIGHT_RESOURCE_COMPONENT_ID);
    let stagedRepairRequired = false;
    if (installed?.pending !== undefined) {
      try {
        await resourceUpdate.activatePending(PLAYWRIGHT_RESOURCE_COMPONENT_ID);
        return toAvailability(
          await resolveHealthyActive(manager).then((resource) => {
            if (resource === null) {
              throw new Error("Pending Playwright resource did not become active.");
            }
            return resource;
          })
        );
      } catch (error) {
        if (isCoordinationFailure(error)) {
          throw error;
        }
        // A staged but corrupt/interrupted package is repaired from the same
        // pinned BOM below. The resource coordinator already restored its
        // activation pointers before this retry begins.
        stagedRepairRequired = true;
      }
    }
    if (!forceRepair && !stagedRepairRequired) {
      try {
        const active = await resolveHealthyActive(manager);
        if (active !== null) {
          return toAvailability(active);
        }
      } catch {
        // A corrupt active package is repaired through the same signed and
        // safe-point coordinated path as first acquisition.
      }
    }

    const maintained = await resourceUpdate.installOrRepairAtSafePoint(
      PLAYWRIGHT_RESOURCE_COMPONENT_ID,
      async () => {
        const activation = await canonicalRegistry.read();
        if (
          activation.activeReleaseVersion === undefined
          || activation.catalogSequence < 1
          || activation.pendingReleaseVersion !== undefined
        ) {
          throw new Error(
            "Playwright first-use acquisition requires one settled signed active release."
          );
        }
        const report = await componentUpdate.stageOnDemandFromActiveRelease({
          componentId: PLAYWRIGHT_RESOURCE_COMPONENT_ID,
          releaseVersion: activation.activeReleaseVersion,
          catalogSequence: activation.catalogSequence
        }, onProgress);
        assertPinnedAcquisitionReport(
          report,
          activation.activeReleaseVersion,
          activation.catalogSequence
        );
        return report;
      }
    );
    const resource = await resolveHealthyActive(manager);
    if (resource === null || maintained.component.active !== resource.version) {
      throw new Error("Playwright resource activation did not select the verified package.");
    }
    return toAvailability(resource, maintained.result);
  };

  const run = (
    forceRepair: boolean,
    onProgress: (progress: ComponentUpdateProgress) => void = () => undefined
  ): Promise<PlaywrightResourceAvailability> => {
    if (activeRequest !== null) {
      return activeRequest;
    }
    const request = acquire(forceRepair, onProgress).finally(() => {
      if (activeRequest === request) {
        activeRequest = null;
      }
    });
    activeRequest = request;
    return request;
  };

  return {
    ensureAvailable: (onProgress) => run(false, onProgress),
    repair: (onProgress) => run(true, onProgress)
  };
};

export const playwrightAcquisitionInternalsForTests = {
  assertPinnedAcquisitionReport
};
