import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, realpath, rm } from "node:fs/promises";
import path from "node:path";

import type {
  ComponentExecutionClassV1,
  ComponentManifestV1
} from "@lyra/app-runtime";

import type {
  ComponentRegistryStore,
  InstalledComponentV1,
  InstalledComponentVersionV1
} from "../components";
import {
  createThirdPartyAppHost,
  type ThirdPartyAppHost,
  type ThirdPartyAppHostOptions
} from "./host";
import {
  THIRD_PARTY_APP_PERMISSIONS,
  type ThirdPartyAppPermission
} from "./permission-policy";
import {
  THIRD_PARTY_WASI_PERMISSIONS,
  createThirdPartyWasiRunnerService,
  type ThirdPartyWasiLimits,
  type ThirdPartyWasiPermission,
  type ThirdPartyWasiRunResult,
  type ThirdPartyWasiRunnerService
} from "./wasi-runner";

const COMPONENT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const INSTANCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SANDBOX_EXECUTION_CLASSES = new Set<ComponentExecutionClassV1>([
  "sandboxed-web",
  "sandboxed-web-wasi"
]);
const WEB_PERMISSIONS = new Set<string>(THIRD_PARTY_APP_PERMISSIONS);
const WASI_PERMISSIONS = new Set<string>(THIRD_PARTY_WASI_PERMISSIONS);

type ThirdPartyAppHostFactory = (
  options: ThirdPartyAppHostOptions
) => ThirdPartyAppHost;

type ThirdPartyAppOpenRequest = {
  readonly componentId: string;
  readonly instanceId: string;
  /**
   * Origins approved by Core for this instance. A signed `network`
   * permission is still required; origins are never inferred from page code.
   */
  readonly networkOrigins?: readonly string[];
};

type ThirdPartyAppLifecycleTransition = {
  readonly status: "activated" | "deferred" | "unchanged";
  readonly component: InstalledComponentV1;
};

type ThirdPartyAppInstance = {
  readonly componentId: string;
  readonly version: string;
  readonly instanceId: string;
  readonly executionClass: "sandboxed-web" | "sandboxed-web-wasi";
  readonly appDataRoot: string;
  readonly temporaryRoot: string;
  readonly host: ThirdPartyAppHost;
  readonly runWasi: (
    componentPath: string,
    limits?: ThirdPartyWasiLimits
  ) => Promise<ThirdPartyWasiRunResult>;
  readonly close: () => Promise<void>;
};

type ThirdPartyAppLifecycleService = {
  readonly open: (request: ThirdPartyAppOpenRequest) => Promise<ThirdPartyAppInstance>;
  readonly activatePending: (
    componentId: string
  ) => Promise<ThirdPartyAppLifecycleTransition>;
  readonly rollback: (componentId: string) => Promise<InstalledComponentV1>;
  readonly uninstallVersion: (componentId: string, version: string) => Promise<void>;
  readonly references: (componentId: string, version: string) => number;
  readonly dispose: () => Promise<void>;
};

type ThirdPartyAppLifecycleServiceOptions = {
  readonly componentsRoot: string;
  readonly dataRoot: string;
  readonly temporaryRoot: string;
  readonly registryStore: ComponentRegistryStore;
  readonly resourcesRoot?: string;
  readonly hostFeatureEnabled?: boolean;
  readonly wasiFeatureEnabled?: boolean;
  readonly hostFactory?: ThirdPartyAppHostFactory;
  readonly wasiRunner?: ThirdPartyWasiRunnerService;
};

type ValidatedThirdPartyVersion = {
  readonly component: InstalledComponentV1;
  readonly installed: InstalledComponentVersionV1;
  readonly manifest: ComponentManifestV1;
  readonly packageRoot: string;
  readonly entryFile: string;
  readonly executionClass: "sandboxed-web" | "sandboxed-web-wasi";
  readonly webPermissions: readonly ThirdPartyAppPermission[];
  readonly wasiPermissions: readonly ThirdPartyWasiPermission[];
};

const isPathWithin = (parent: string, candidate: string): boolean => {
  const relativePath = path.relative(parent, candidate);
  return relativePath === "" || (
    relativePath !== ".."
    && !relativePath.startsWith("../")
    && !relativePath.startsWith("..\\")
    && !path.isAbsolute(relativePath)
  );
};

const assertIdentifier = (
  value: string,
  pattern: RegExp,
  label: string
): void => {
  if (!pattern.test(value)) {
    throw new Error(`Invalid third-party application ${label}.`);
  }
};

const ensureRealDirectory = async (
  root: string,
  candidate: string,
  label: string
): Promise<string> => {
  const resolvedRoot = await realpath(root);
  const normalizedCandidate = path.resolve(candidate);
  if (!isPathWithin(resolvedRoot, normalizedCandidate)) {
    throw new Error(`${label} is outside its authorized root.`);
  }
  const relativePath = path.relative(resolvedRoot, normalizedCandidate);
  let current = resolvedRoot;
  for (const segment of relativePath === "" ? [] : relativePath.split(path.sep)) {
    const resolvedParent = await realpath(current);
    if (resolvedParent !== current || !isPathWithin(resolvedRoot, resolvedParent)) {
      throw new Error(`${label} has an unsafe parent directory.`);
    }
    current = path.join(current, segment);
    let metadata;
    try {
      metadata = await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      try {
        await mkdir(current);
      } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST") {
          throw mkdirError;
        }
      }
      metadata = await lstat(current);
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error(`${label} must contain real directories only.`);
    }
    const resolved = await realpath(current);
    if (resolved !== current || !isPathWithin(resolvedRoot, resolved)) {
      throw new Error(`${label} is outside its authorized root.`);
    }
  }
  return current;
};

const resolveSignedFile = async (
  version: Pick<ValidatedThirdPartyVersion, "manifest" | "packageRoot">,
  relativePath: string,
  expectedExtension: string
): Promise<{ readonly path: string; readonly sha256: string }> => {
  if (
    path.isAbsolute(relativePath)
    || relativePath.includes("\\")
    || !relativePath.toLowerCase().endsWith(expectedExtension)
  ) {
    throw new Error(`Third-party application file must be a relative ${expectedExtension} path.`);
  }
  const declared = version.manifest.files.find((file) => file.path === relativePath);
  if (declared === undefined) {
    throw new Error("Third-party application file is not covered by the signed inventory.");
  }
  const candidate = path.resolve(version.packageRoot, relativePath);
  const candidateMetadata = await lstat(candidate);
  if (candidateMetadata.isSymbolicLink() || !candidateMetadata.isFile()) {
    throw new Error("Third-party application file is not a signed regular file.");
  }
  const resolved = await realpath(candidate);
  if (!isPathWithin(version.packageRoot, resolved)) {
    throw new Error("Third-party application file escapes its signed package.");
  }
  const metadata = await lstat(resolved);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size !== declared.size) {
    throw new Error("Third-party application file is not a signed regular file.");
  }
  const digest = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(resolved);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  if (digest.digest("hex") !== declared.sha256) {
    throw new Error("Third-party application file differs from its signed inventory.");
  }
  return { path: resolved, sha256: declared.sha256 };
};

const classifyPermissions = (
  manifest: ComponentManifestV1
): {
  readonly web: readonly ThirdPartyAppPermission[];
  readonly wasi: readonly ThirdPartyWasiPermission[];
} => {
  const web: ThirdPartyAppPermission[] = [];
  const wasi: ThirdPartyWasiPermission[] = [];
  for (const permission of manifest.permissions) {
    if (WEB_PERMISSIONS.has(permission)) {
      web.push(permission as ThirdPartyAppPermission);
    } else if (WASI_PERMISSIONS.has(permission)) {
      wasi.push(permission as ThirdPartyWasiPermission);
    } else {
      throw new Error(
        `Unsupported sandboxed application permission in signed manifest: ${permission}`
      );
    }
  }
  if (manifest.executionClass === "sandboxed-web" && wasi.length > 0) {
    throw new Error("A web-only sandboxed application cannot declare WASI permissions.");
  }
  return { web, wasi };
};

const validateThirdPartyVersion = async ({
  componentsRoot,
  registryStore,
  component,
  version
}: {
  readonly componentsRoot: string;
  readonly registryStore: ComponentRegistryStore;
  readonly component: InstalledComponentV1;
  readonly version: string;
}): Promise<ValidatedThirdPartyVersion> => {
  if (component.kind !== "app") {
    throw new Error(`Component is not an application: ${component.componentId}`);
  }
  const installed = await registryStore.verifyInstalledVersion(
    component.componentId,
    version
  );
  const manifest = installed.manifest;
  if (
    !SANDBOX_EXECUTION_CLASSES.has(manifest.executionClass as ComponentExecutionClassV1)
  ) {
    throw new Error(
      `Component is not authorized for third-party sandbox execution: ${component.componentId}`
    );
  }
  if (manifest.activation !== "module-idle") {
    throw new Error("A sandboxed application must use module-idle activation.");
  }
  if (
    manifest.entry === undefined
    || !/\.html?$/iu.test(manifest.entry)
  ) {
    throw new Error("A sandboxed application must declare a signed HTML entry point.");
  }
  const packageRoot = await realpath(path.join(
    componentsRoot,
    component.componentId,
    version,
    installed.target
  ));
  const entry = await resolveSignedFile(
    { manifest, packageRoot },
    manifest.entry,
    manifest.entry.toLowerCase().endsWith(".html") ? ".html" : ".htm"
  );
  const permissions = classifyPermissions(manifest);
  return {
    component,
    installed,
    manifest,
    packageRoot,
    entryFile: entry.path,
    executionClass: manifest.executionClass as "sandboxed-web" | "sandboxed-web-wasi",
    webPermissions: permissions.web,
    wasiPermissions: permissions.wasi
  };
};

const createThirdPartyAppLifecycleService = async (
  options: ThirdPartyAppLifecycleServiceOptions
): Promise<ThirdPartyAppLifecycleService> => {
  for (const [label, root] of [
    ["component", options.componentsRoot],
    ["data", options.dataRoot],
    ["temporary", options.temporaryRoot]
  ] as const) {
    if (!path.isAbsolute(root)) {
      throw new Error(`Third-party application ${label} root must be absolute.`);
    }
    await mkdir(root, { recursive: true });
    const metadata = await lstat(root);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error(`Third-party application ${label} root must be a real directory.`);
    }
  }
  const componentsRoot = await realpath(options.componentsRoot);
  const dataRoot = await realpath(options.dataRoot);
  const temporaryRoot = await realpath(options.temporaryRoot);
  if (
    isPathWithin(dataRoot, temporaryRoot)
    || isPathWithin(temporaryRoot, dataRoot)
  ) {
    throw new Error("Third-party application data and temporary roots must not overlap.");
  }

  const hostFactory = options.hostFactory ?? createThirdPartyAppHost;
  const wasiRunner = options.wasiRunner ?? createThirdPartyWasiRunnerService({
    ...(options.resourcesRoot === undefined ? {} : { resourcesRoot: options.resourcesRoot }),
    allowedAppDataRoot: dataRoot,
    allowedTemporaryRoot: temporaryRoot,
    ...(options.wasiFeatureEnabled === undefined
      ? {}
      : { featureEnabled: options.wasiFeatureEnabled })
  });
  const referencesByVersion = new Map<string, number>();
  const instances = new Map<string, {
    readonly instance: ThirdPartyAppInstance;
    readonly closeInternal: () => Promise<void>;
  }>();
  let disposed = false;
  let mutationQueue = Promise.resolve();

  const enqueue = async <T>(operation: () => Promise<T>): Promise<T> => {
    const previous = mutationQueue;
    let release!: () => void;
    mutationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  };
  const versionKey = (componentId: string, version: string): string =>
    `${componentId}\0${version}`;
  const instanceKey = (componentId: string, instanceId: string): string =>
    `${componentId}\0${instanceId}`;
  const references = (componentId: string, version: string): number =>
    referencesByVersion.get(versionKey(componentId, version)) ?? 0;
  const updateReferences = (
    componentId: string,
    version: string,
    delta: 1 | -1
  ): void => {
    const key = versionKey(componentId, version);
    const next = references(componentId, version) + delta;
    if (next < 0) {
      throw new Error(`Third-party application lease underflow: ${componentId}@${version}`);
    }
    if (next === 0) {
      referencesByVersion.delete(key);
    } else {
      referencesByVersion.set(key, next);
    }
  };
  const readRequired = async (componentId: string): Promise<InstalledComponentV1> => {
    const component = await options.registryStore.read(componentId);
    if (component === null) {
      throw new Error(`Component is not installed: ${componentId}`);
    }
    return component;
  };
  const validateVersion = async (
    component: InstalledComponentV1,
    version: string
  ): Promise<ValidatedThirdPartyVersion> =>
    await validateThirdPartyVersion({
      componentsRoot,
      registryStore: options.registryStore,
      component,
      version
    });
  const maybeActivatePending = async (
    componentId: string
  ): Promise<ThirdPartyAppLifecycleTransition> => {
    const component = await readRequired(componentId);
    if (component.pending === undefined) {
      return { status: "unchanged", component };
    }
    await validateVersion(component, component.pending);
    if (
      component.active !== undefined
      && references(componentId, component.active) > 0
    ) {
      return { status: "deferred", component };
    }
    return {
      status: "activated",
      component: await options.registryStore.activate(componentId)
    };
  };

  const service: ThirdPartyAppLifecycleService = {
    open: async (request) => await enqueue(async () => {
      if (disposed) {
        throw new Error("Third-party application lifecycle has been disposed.");
      }
      assertIdentifier(request.componentId, COMPONENT_ID_PATTERN, "ID");
      assertIdentifier(request.instanceId, INSTANCE_ID_PATTERN, "instance ID");
      const key = instanceKey(request.componentId, request.instanceId);
      if (instances.has(key)) {
        throw new Error("Third-party application instance is already open.");
      }
      const component = await readRequired(request.componentId);
      if (component.active === undefined) {
        throw new Error(`Component has no active version: ${request.componentId}`);
      }
      const version = await validateVersion(component, component.active);
      const networkOrigins = request.networkOrigins ?? [];
      if (networkOrigins.length > 0 && !version.webPermissions.includes("network")) {
        throw new Error("Network origins require a signed network permission.");
      }
      const appDataRoot = await ensureRealDirectory(
        dataRoot,
        path.join(dataRoot, request.componentId),
        "Third-party application data root"
      );
      const versionTemporaryRoot = await ensureRealDirectory(
        temporaryRoot,
        path.join(temporaryRoot, request.componentId, version.manifest.version),
        "Third-party application version temporary root"
      );
      const instanceTemporaryRoot = await ensureRealDirectory(
        temporaryRoot,
        path.join(versionTemporaryRoot, request.instanceId),
        "Third-party application instance temporary root"
      );
      let host: ThirdPartyAppHost | undefined;
      try {
        host = hostFactory({
          appId: request.componentId,
          instanceId: request.instanceId,
          appRoot: version.packageRoot,
          entryFile: version.entryFile,
          permissions: version.webPermissions,
          networkOrigins,
          ...(options.hostFeatureEnabled === undefined
            ? {}
            : { featureEnabled: options.hostFeatureEnabled })
        });
        await host.load();
      } catch (error) {
        host?.dispose();
        await rm(instanceTemporaryRoot, { recursive: true, force: true });
        throw error;
      }
      if (host === undefined) {
        throw new Error("Third-party application host was not created.");
      }
      const loadedHost = host;
      updateReferences(request.componentId, version.manifest.version, 1);

      let closing = false;
      let closed = false;
      const activeWasiRuns = new Set<Promise<ThirdPartyWasiRunResult>>();
      const runWasi = (
        componentPath: string,
        limits?: ThirdPartyWasiLimits
      ): Promise<ThirdPartyWasiRunResult> => {
        if (closing || closed) {
          return Promise.reject(new Error("Third-party application instance is closing."));
        }
        if (version.executionClass !== "sandboxed-web-wasi") {
          return Promise.reject(
            new Error("This third-party application has no WASI execution class.")
          );
        }
        const running = (async () => {
          const componentFile = await resolveSignedFile(version, componentPath, ".wasm");
          return await wasiRunner.run({
            componentPackageRoot: version.packageRoot,
            componentPath: componentFile.path,
            expectedSha256: componentFile.sha256,
            appDataRoot,
            temporaryRoot: instanceTemporaryRoot,
            permissions: version.wasiPermissions,
            ...(limits === undefined ? {} : { limits })
          });
        })();
        activeWasiRuns.add(running);
        void running.then(() => {
          activeWasiRuns.delete(running);
        }, () => {
          activeWasiRuns.delete(running);
        });
        return running;
      };
      const closeInternal = async (): Promise<void> => {
        if (closed) {
          return;
        }
        closing = true;
        await Promise.allSettled(activeWasiRuns);
        await enqueue(async () => {
          if (closed) {
            return;
          }
          closed = true;
          instances.delete(key);
          loadedHost.dispose();
          updateReferences(request.componentId, version.manifest.version, -1);
          await rm(instanceTemporaryRoot, { recursive: true, force: true });
          if (!disposed) {
            await maybeActivatePending(request.componentId);
          }
        });
      };
      const instance: ThirdPartyAppInstance = Object.freeze({
        componentId: request.componentId,
        version: version.manifest.version,
        instanceId: request.instanceId,
        executionClass: version.executionClass,
        appDataRoot,
        temporaryRoot: instanceTemporaryRoot,
        host: loadedHost,
        runWasi,
        close: closeInternal
      });
      instances.set(key, { instance, closeInternal });
      return instance;
    }),
    activatePending: async (componentId) => await enqueue(async () => {
      assertIdentifier(componentId, COMPONENT_ID_PATTERN, "ID");
      return await maybeActivatePending(componentId);
    }),
    rollback: async (componentId) => await enqueue(async () => {
      assertIdentifier(componentId, COMPONENT_ID_PATTERN, "ID");
      const component = await readRequired(componentId);
      if (component.previous === undefined) {
        return component;
      }
      if (
        component.active !== undefined
        && references(componentId, component.active) > 0
      ) {
        throw new Error(
          `Cannot roll back a running third-party application: ${componentId}@${component.active}`
        );
      }
      await validateVersion(component, component.previous);
      return await options.registryStore.rollback(componentId);
    }),
    uninstallVersion: async (componentId, version) => await enqueue(async () => {
      assertIdentifier(componentId, COMPONENT_ID_PATTERN, "ID");
      if (references(componentId, version) > 0) {
        throw new Error(
          `Cannot remove a leased third-party application version: ${componentId}@${version}`
        );
      }
      const component = await readRequired(componentId);
      await validateVersion(component, version);
      await options.registryStore.uninstallVersion(componentId, version);
    }),
    references,
    dispose: async () => {
      if (disposed) {
        return;
      }
      disposed = true;
      // Wait for any in-flight open/transition to publish its instance before
      // taking the disposal snapshot. Close operations enqueue separately.
      await enqueue(async () => undefined);
      await Promise.allSettled(
        [...instances.values()].map(({ closeInternal }) => closeInternal())
      );
    }
  };
  return service;
};

export { createThirdPartyAppLifecycleService };
export type {
  ThirdPartyAppHostFactory,
  ThirdPartyAppInstance,
  ThirdPartyAppLifecycleService,
  ThirdPartyAppLifecycleServiceOptions,
  ThirdPartyAppLifecycleTransition,
  ThirdPartyAppOpenRequest
};
