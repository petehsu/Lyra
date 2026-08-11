import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  readFile,
  readdir,
  stat
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { ComponentManifestV1 } from "@lyra/app-runtime";

import {
  readVerifiedAria2BundleManifest,
  resolveCurrentAria2BundleTarget
} from "../download-manager/aria2-runtime";
import type {
  ComponentRegistryStore,
  InstalledComponentV1,
  InstalledComponentVersionV1
} from "./registry";

export const RUST_ANALYZER_RESOURCE_COMPONENT_ID =
  "lyra.resource.rust-analyzer" as const;
export const ARIA2_RESOURCE_COMPONENT_ID = "lyra.resource.aria2" as const;
export const PLAYWRIGHT_RESOURCE_COMPONENT_ID =
  "lyra.resource.playwright" as const;
export const LANGUAGE_RESOURCE_COMPONENT_PREFIX = "lyra.language." as const;

export type ResourceComponentFamily =
  | "rust-analyzer"
  | "aria2"
  | "playwright"
  | "language"
  | "generic";

export type ResolvedResourceComponent = {
  readonly componentId: string;
  readonly version: string;
  readonly installedAt: string;
  readonly rootPath: string;
  readonly entryPath: string;
  readonly runtimePath: string;
  readonly family: ResourceComponentFamily;
  readonly manifest: ComponentManifestV1;
};

export type ResourceComponentLease = ResolvedResourceComponent & {
  readonly release: () => void;
};

export type ResourceComponentReference = {
  readonly componentId: string;
  readonly version: string;
  readonly count: number;
};

export type ResourceComponentExclusiveLock = {
  readonly componentId: string;
  readonly release: () => void;
};

export type ResourceComponentManager = {
  readonly resolveActive: (
    componentId: string
  ) => Promise<ResolvedResourceComponent | null>;
  readonly resolveVersion: (
    componentId: string,
    version: string
  ) => Promise<ResolvedResourceComponent>;
  readonly acquire: (componentId: string) => Promise<ResourceComponentLease>;
  readonly withResource: <T>(
    componentId: string,
    operation: (resource: ResolvedResourceComponent) => Promise<T> | T
  ) => Promise<T>;
  readonly acquireExclusive: (
    componentId: string,
    timeoutMs?: number
  ) => Promise<ResourceComponentExclusiveLock>;
  readonly assertHealthy: (
    resource: ResolvedResourceComponent
  ) => Promise<void>;
  readonly listReferences: () => readonly ResourceComponentReference[];
  readonly dispose: () => void;
};

export class ResourceComponentBusyError extends Error {
  readonly code = "RESOURCE_COMPONENT_BUSY";

  constructor(componentId: string, timeoutMs: number) {
    super(
      `Resource component ${componentId} did not become idle within ${timeoutMs}ms.`
    );
    this.name = "ResourceComponentBusyError";
  }
}

export class ResourceComponentUpdatePendingError extends Error {
  readonly code = "RESOURCE_COMPONENT_UPDATE_PENDING";

  constructor(componentId: string) {
    super(`Resource component ${componentId} is waiting to switch versions.`);
    this.name = "ResourceComponentUpdatePendingError";
  }
}

const execFileAsync = promisify(execFile);
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
const EXECUTABLE_HEALTH_TIMEOUT_MS = 10_000;
const MAX_RESOURCE_METADATA_BYTES = 1024 * 1024;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const resolveContainedPath = (root: string, relativePath: string): string => {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Resource component entry escapes its package: ${relativePath}`);
  }
  return resolved;
};

const familyForComponent = (componentId: string): ResourceComponentFamily => {
  if (componentId === RUST_ANALYZER_RESOURCE_COMPONENT_ID) {
    return "rust-analyzer";
  }
  if (componentId === ARIA2_RESOURCE_COMPONENT_ID) {
    return "aria2";
  }
  if (componentId === PLAYWRIGHT_RESOURCE_COMPONENT_ID) {
    return "playwright";
  }
  if (componentId.startsWith(LANGUAGE_RESOURCE_COMPONENT_PREFIX)) {
    return "language";
  }
  return "generic";
};

const assertResourceComponent = (
  component: InstalledComponentV1,
  version: string
): InstalledComponentVersionV1 => {
  if (component.kind !== "resource") {
    throw new Error(`Component is not a resource: ${component.componentId}`);
  }
  const installed = component.versions[version];
  if (installed === undefined) {
    throw new Error(
      `Resource component version is not installed: ${component.componentId}@${version}`
    );
  }
  if (installed.manifest.activation !== "resource-idle") {
    throw new Error(
      `Resource component does not use resource-idle activation: ${component.componentId}`
    );
  }
  if (installed.manifest.entry === undefined) {
    throw new Error(
      `Resource component has no entry: ${component.componentId}@${version}`
    );
  }
  return installed;
};

const readBoundedJson = async (filePath: string): Promise<unknown> => {
  const metadata = await stat(filePath);
  if (!metadata.isFile() || metadata.size > MAX_RESOURCE_METADATA_BYTES) {
    throw new Error(`Resource metadata is not a bounded regular file: ${filePath}`);
  }
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
};

const resolveAria2RuntimePath = (
  entryPath: string,
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture
): string => {
  const target = resolveCurrentAria2BundleTarget(platform, arch);
  if (target === null) {
    throw new Error(`aria2 resource is unsupported on ${platform}-${arch}.`);
  }
  const result = readVerifiedAria2BundleManifest(entryPath, target, platform, {
    verifyAllFiles: true
  });
  if (result === null) {
    throw new Error(`aria2 resource manifest is invalid: ${entryPath}`);
  }
  return result.binaryPath;
};

const resolveInstalledResource = ({
  componentsRoot,
  component,
  version,
  platform,
  arch
}: {
  readonly componentsRoot: string;
  readonly component: InstalledComponentV1;
  readonly version: string;
  readonly platform: NodeJS.Platform;
  readonly arch: NodeJS.Architecture;
}): ResolvedResourceComponent => {
  const installed = assertResourceComponent(component, version);
  const rootPath = path.resolve(
    componentsRoot,
    component.componentId,
    version,
    installed.target
  );
  const entryPath = resolveContainedPath(rootPath, installed.manifest.entry!);
  const family = familyForComponent(component.componentId);
  const runtimePath = family === "aria2"
    ? resolveAria2RuntimePath(entryPath, platform, arch)
    : family === "playwright"
      ? rootPath
      : entryPath;
  return {
    componentId: component.componentId,
    version,
    installedAt: installed.installedAt,
    rootPath,
    entryPath,
    runtimePath,
    family,
    manifest: installed.manifest
  };
};

const assertExecutable = async (
  filePath: string,
  platform: NodeJS.Platform
): Promise<void> => {
  await access(filePath, platform === "win32" ? constants.F_OK : constants.X_OK);
};

const assertExecutableVersion = async (
  filePath: string,
  expectedPattern: RegExp,
  platform: NodeJS.Platform
): Promise<void> => {
  await assertExecutable(filePath, platform);
  const result = await execFileAsync(filePath, ["--version"], {
    timeout: EXECUTABLE_HEALTH_TIMEOUT_MS,
    maxBuffer: 64 * 1024,
    windowsHide: true
  });
  const output = `${result.stdout}\n${result.stderr}`;
  if (!expectedPattern.test(output)) {
    throw new Error(`Resource executable returned an unexpected version: ${filePath}`);
  }
};

const assertPlaywrightHealth = async (
  resource: ResolvedResourceComponent
): Promise<void> => {
  const metadata = await readBoundedJson(resource.entryPath);
  if (
    !isRecord(metadata)
    || metadata.schemaVersion !== 1
    || metadata.family !== "playwright"
    || metadata.target !== resource.manifest.target
    || metadata.version !== resource.version
  ) {
    throw new Error(
      `Playwright resource metadata does not match ${resource.componentId}@${resource.version}.`
    );
  }
  const entries = await readdir(resource.rootPath, { withFileTypes: true });
  const chromiumDirectories = entries.filter(
    (entry) => entry.isDirectory()
      && (entry.name.startsWith("chromium-")
        || entry.name.startsWith("chromium_headless_shell-"))
  );
  if (chromiumDirectories.length === 0) {
    throw new Error("Playwright resource does not contain Chromium.");
  }
  const completed = await Promise.all(
    chromiumDirectories.map(async (entry) => {
      try {
        const marker = await stat(
          path.join(resource.rootPath, entry.name, "INSTALLATION_COMPLETE")
        );
        return marker.isFile();
      } catch {
        return false;
      }
    })
  );
  if (!completed.some(Boolean)) {
    throw new Error("Playwright Chromium installation is incomplete.");
  }
};

export type LanguageResourceBundle = {
  readonly locale: string;
  readonly bundle: Record<string, string>;
};

export const readLanguageResourceBundle = async (
  resource: ResolvedResourceComponent
): Promise<LanguageResourceBundle> => {
  if (resource.family !== "language") {
    throw new Error(`Resource is not a language bundle: ${resource.componentId}`);
  }
  const bundle = await readBoundedJson(resource.entryPath);
  if (
    !isRecord(bundle)
    || Object.keys(bundle).length === 0
    || Object.values(bundle).some((value) => typeof value !== "string")
  ) {
    throw new Error(`Language resource bundle is invalid: ${resource.componentId}`);
  }
  const metadata = await readBoundedJson(path.join(resource.rootPath, "resource.json"));
  if (
    !isRecord(metadata)
    || metadata.schemaVersion !== 1
    || typeof metadata.locale !== "string"
    || metadata.locale.trim().length === 0
    || metadata.version !== resource.version
  ) {
    throw new Error(`Language resource metadata is invalid: ${resource.componentId}`);
  }
  return {
    locale: metadata.locale,
    bundle: bundle as Record<string, string>
  };
};

const assertLanguageHealth = async (
  resource: ResolvedResourceComponent
): Promise<void> => {
  await readLanguageResourceBundle(resource);
};

const defaultHealthCheck = async (
  resource: ResolvedResourceComponent,
  platform: NodeJS.Platform
): Promise<void> => {
  switch (resource.family) {
    case "rust-analyzer":
      await assertExecutableVersion(resource.runtimePath, /rust-analyzer/iu, platform);
      return;
    case "aria2":
      await assertExecutableVersion(resource.runtimePath, /aria2 version/iu, platform);
      return;
    case "playwright":
      await assertPlaywrightHealth(resource);
      return;
    case "language":
      await assertLanguageHealth(resource);
      return;
    case "generic": {
      const metadata = await stat(resource.entryPath);
      if (!metadata.isFile()) {
        throw new Error(`Resource component entry is not a regular file: ${resource.entryPath}`);
      }
    }
  }
};

const referenceKey = (componentId: string, version: string): string =>
  `${componentId}\u0000${version}`;

export const createResourceComponentManager = ({
  componentsRoot,
  registry,
  platform = process.platform,
  arch = process.arch,
  healthCheck
}: {
  readonly componentsRoot: string;
  readonly registry: ComponentRegistryStore;
  readonly platform?: NodeJS.Platform;
  readonly arch?: NodeJS.Architecture;
  readonly healthCheck?: (
    resource: ResolvedResourceComponent
  ) => Promise<void>;
}): ResourceComponentManager => {
  const references = new Map<string, number>();
  const exclusiveComponents = new Set<string>();
  const idleWaiters = new Map<string, Set<() => void>>();
  let disposed = false;

  const assertNotDisposed = (): void => {
    if (disposed) {
      throw new Error("Resource component manager is disposed.");
    }
  };

  const countReferences = (componentId: string): number => {
    let count = 0;
    for (const [key, value] of references) {
      if (key.startsWith(`${componentId}\u0000`)) {
        count += value;
      }
    }
    return count;
  };

  const notifyIdle = (componentId: string): void => {
    if (countReferences(componentId) !== 0) {
      return;
    }
    const waiters = idleWaiters.get(componentId);
    if (waiters === undefined) {
      return;
    }
    idleWaiters.delete(componentId);
    for (const resolve of waiters) {
      resolve();
    }
  };

  const resolveVersion = async (
    componentId: string,
    version: string
  ): Promise<ResolvedResourceComponent> => {
    assertNotDisposed();
    const component = await registry.read(componentId);
    if (component === null) {
      throw new Error(`Resource component is not installed: ${componentId}`);
    }
    await registry.verifyInstalledVersion(componentId, version);
    return resolveInstalledResource({
      componentsRoot,
      component,
      version,
      platform,
      arch
    });
  };

  const waitForIdle = async (
    componentId: string,
    timeoutMs: number
  ): Promise<void> => {
    if (countReferences(componentId) === 0) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      let waiters = idleWaiters.get(componentId);
      if (waiters === undefined) {
        waiters = new Set();
        idleWaiters.set(componentId, waiters);
      }
      const finish = (): void => {
        clearTimeout(timeout);
        resolve();
      };
      waiters.add(finish);
      const timeout = setTimeout(() => {
        waiters?.delete(finish);
        if (waiters?.size === 0) {
          idleWaiters.delete(componentId);
        }
        reject(new ResourceComponentBusyError(componentId, timeoutMs));
      }, timeoutMs);
    });
  };

  return {
    resolveActive: async (componentId) => {
      assertNotDisposed();
      const component = await registry.read(componentId);
      if (component === null) {
        return null;
      }
      if (component.kind !== "resource") {
        throw new Error(`Component is not a resource: ${componentId}`);
      }
      return component.active === undefined
        ? null
        : await resolveVersion(componentId, component.active);
    },
    resolveVersion,
    acquire: async (componentId) => {
      assertNotDisposed();
      if (exclusiveComponents.has(componentId)) {
        throw new ResourceComponentUpdatePendingError(componentId);
      }
      const resource = await (async () => {
        const component = await registry.read(componentId);
        if (component === null || component.active === undefined) {
          throw new Error(`Resource component has no active version: ${componentId}`);
        }
        return await resolveVersion(componentId, component.active);
      })();
      if (exclusiveComponents.has(componentId)) {
        throw new ResourceComponentUpdatePendingError(componentId);
      }
      const key = referenceKey(resource.componentId, resource.version);
      references.set(key, (references.get(key) ?? 0) + 1);
      let released = false;
      return {
        ...resource,
        release: () => {
          if (released) {
            return;
          }
          released = true;
          const current = references.get(key) ?? 0;
          if (current <= 1) {
            references.delete(key);
          } else {
            references.set(key, current - 1);
          }
          notifyIdle(resource.componentId);
        }
      };
    },
    withResource: async <T>(
      componentId: string,
      operation: (resource: ResolvedResourceComponent) => Promise<T> | T
    ): Promise<T> => {
      const lease = await (async () => {
        const component = await registry.read(componentId);
        if (component === null || component.active === undefined) {
          throw new Error(`Resource component has no active version: ${componentId}`);
        }
        if (exclusiveComponents.has(componentId)) {
          throw new ResourceComponentUpdatePendingError(componentId);
        }
        return component.active;
      })();
      const acquired = await (async () => {
        const resource = await resolveVersion(componentId, lease);
        if (exclusiveComponents.has(componentId)) {
          throw new ResourceComponentUpdatePendingError(componentId);
        }
        const key = referenceKey(resource.componentId, resource.version);
        references.set(key, (references.get(key) ?? 0) + 1);
        return {
          resource,
          release: () => {
            const current = references.get(key) ?? 0;
            if (current <= 1) {
              references.delete(key);
            } else {
              references.set(key, current - 1);
            }
            notifyIdle(resource.componentId);
          }
        };
      })();
      try {
        return await operation(acquired.resource);
      } finally {
        acquired.release();
      }
    },
    acquireExclusive: async (
      componentId,
      timeoutMs = DEFAULT_IDLE_TIMEOUT_MS
    ) => {
      assertNotDisposed();
      if (exclusiveComponents.has(componentId)) {
        throw new ResourceComponentUpdatePendingError(componentId);
      }
      exclusiveComponents.add(componentId);
      try {
        await waitForIdle(componentId, timeoutMs);
        assertNotDisposed();
      } catch (error) {
        exclusiveComponents.delete(componentId);
        throw error;
      }
      let released = false;
      return {
        componentId,
        release: () => {
          if (released) {
            return;
          }
          released = true;
          exclusiveComponents.delete(componentId);
        }
      };
    },
    assertHealthy: async (resource) => {
      assertNotDisposed();
      if (healthCheck === undefined) {
        await defaultHealthCheck(resource, platform);
      } else {
        await healthCheck(resource);
      }
    },
    listReferences: () => {
      const result: ResourceComponentReference[] = [];
      for (const [key, count] of references) {
        const separator = key.indexOf("\u0000");
        result.push({
          componentId: key.slice(0, separator),
          version: key.slice(separator + 1),
          count
        });
      }
      return result.sort((left, right) =>
        left.componentId === right.componentId
          ? left.version.localeCompare(right.version)
          : left.componentId.localeCompare(right.componentId)
      );
    },
    dispose: () => {
      disposed = true;
      references.clear();
      exclusiveComponents.clear();
      for (const waiters of idleWaiters.values()) {
        for (const resolve of waiters) {
          resolve();
        }
      }
      idleWaiters.clear();
    }
  };
};

// ponytail: deduplicate ENOENT warnings for stale bootstrap components.
// Ceiling: a component that becomes valid after re-install won't clear the set
// until process restart. Acceptable — re-install triggers a restart anyway.
const warnedStaleComponents = new Set<string>();

export const readActiveLanguageResourceBundles = async ({
  registry,
  manager,
  validateBundle
}: {
  readonly registry: ComponentRegistryStore;
  readonly manager: ResourceComponentManager;
  readonly validateBundle: (
    locale: string,
    bundle: unknown
  ) => Record<string, string>;
}): Promise<Readonly<Record<string, Record<string, string>>>> => {
  const result: Record<string, Record<string, string>> = {};
  const components = (await registry.list())
    .filter((component) =>
      component.kind === "resource"
      && component.active !== undefined
      && component.componentId.startsWith(LANGUAGE_RESOURCE_COMPONENT_PREFIX)
    )
    .sort((left, right) => left.componentId.localeCompare(right.componentId));
  for (const component of components) {
    try {
      await manager.withResource(component.componentId, async (resource) => {
        await manager.assertHealthy(resource);
        const { locale, bundle } = await readLanguageResourceBundle(resource);
        if (result[locale] !== undefined) {
          throw new Error(`Multiple active language resources provide ${locale}.`);
        }
        result[locale] = validateBundle(locale, bundle);
      });
    } catch (error) {
      if (!warnedStaleComponents.has(component.componentId)) {
        warnedStaleComponents.add(component.componentId);
        console.warn(`[language-packs] skipping component ${component.componentId}:`, error instanceof Error ? error.message : String(error));
      }
    }
  }
  return result;
};

export const resourceComponentInternalsForTests = {
  familyForComponent,
  resolveContainedPath,
  resolveInstalledResource
};
