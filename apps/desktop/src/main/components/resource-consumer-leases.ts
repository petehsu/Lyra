import path from "node:path";

import type {
  ResolvedResourceComponent,
  ResourceComponentManager
} from "./resource-components";

export type ResourceConsumerLeaseRunner = <T>(
  operation: (
    resource: ResolvedResourceComponent | null
  ) => Promise<T> | T
) => Promise<T>;

export class ResourceConsumerUnavailableError extends Error {
  readonly code = "RESOURCE_CONSUMER_UNAVAILABLE";

  constructor(componentId: string) {
    super(`Required resource component is not active: ${componentId}`);
    this.name = "ResourceConsumerUnavailableError";
  }
}

export class ResourceConsumerBindingError extends Error {
  readonly code = "RESOURCE_CONSUMER_BINDING_MISMATCH";

  constructor(componentId: string) {
    super(
      `The running consumer is not bound to the active resource component: ${componentId}`
    );
    this.name = "ResourceConsumerBindingError";
  }
}

const normalizeRuntimePath = (
  value: string,
  platform: NodeJS.Platform
): string => {
  const normalized = path.resolve(value);
  return platform === "win32" ? normalized.toLowerCase() : normalized;
};

const runtimePathsMatch = (
  configuredPath: string | undefined,
  resourcePath: string,
  platform: NodeJS.Platform
): boolean =>
  typeof configuredPath === "string"
  && configuredPath.trim().length > 0
  && normalizeRuntimePath(configuredPath, platform)
    === normalizeRuntimePath(resourcePath, platform);

/**
 * Binds a production consumer request to the signed active resource version.
 *
 * The short lease prevents a resource-idle activation from changing the
 * selected version while the request is in flight. Long-lived Runtime work is
 * still coordinated by RuntimeUpdateCoordinator, so restartable LSP state can
 * be replayed without pinning an obsolete executable forever.
 */
export const createBoundResourceConsumerLease = ({
  manager,
  componentId,
  readConfiguredRuntimePath,
  developmentFallback,
  platform = process.platform
}: {
  readonly manager: ResourceComponentManager;
  readonly componentId: string;
  readonly readConfiguredRuntimePath: () => string | undefined;
  readonly developmentFallback: boolean;
  readonly platform?: NodeJS.Platform;
}): ResourceConsumerLeaseRunner =>
  async <T>(
    operation: (
      resource: ResolvedResourceComponent | null
    ) => Promise<T> | T
  ): Promise<T> => {
    const active = await manager.resolveActive(componentId);
    if (active === null) {
      if (developmentFallback) {
        return await operation(null);
      }
      throw new ResourceConsumerUnavailableError(componentId);
    }

    return await manager.withResource(componentId, async (resource) => {
      if (
        !runtimePathsMatch(
          readConfiguredRuntimePath(),
          resource.runtimePath,
          platform
        )
      ) {
        if (developmentFallback) {
          return await operation(null);
        }
        throw new ResourceConsumerBindingError(componentId);
      }
      return await operation(resource);
    });
  };

export const resourceConsumerLeaseInternalsForTests = {
  normalizeRuntimePath,
  runtimePathsMatch
};
