import path from "node:path";

import {
  readVerifiedAria2BundleManifest,
  resolveAria2Runtime
} from "../download-manager/aria2-runtime";

import {
  ARIA2_RESOURCE_COMPONENT_ID,
  PLAYWRIGHT_RESOURCE_COMPONENT_ID,
  RUST_ANALYZER_RESOURCE_COMPONENT_ID,
  type ResourceComponentManager,
  type ResolvedResourceComponent
} from "./resource-components";

export type RuntimeResourceEnvironmentStatus = {
  readonly componentId: string;
  readonly version?: string;
  readonly runtimePath: string;
  readonly source: "component" | "development-fallback" | "missing";
  readonly error?: string;
};

export type RuntimeResourceEnvironmentResult = {
  readonly resources: readonly RuntimeResourceEnvironmentStatus[];
};

const RESOURCE_ENVIRONMENT = {
  [RUST_ANALYZER_RESOURCE_COMPONENT_ID]: "LYRA_LSP_RUST_ANALYZER",
  [ARIA2_RESOURCE_COMPONENT_ID]: "LYRA_ARIA2_BINARY",
  [PLAYWRIGHT_RESOURCE_COMPONENT_ID]: "PLAYWRIGHT_BROWSERS_PATH"
} as const satisfies Readonly<Record<string, string>>;

const messageFor = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const ARIA2_IDENTITY_ENV_KEYS = [
  "LYRA_ARIA2_BINARY_SHA256",
  "LYRA_ARIA2_COMPONENT_ROOT",
  "LYRA_ARIA2_COMPONENT_VERSION",
  "LYRA_ARIA2_TRUST"
] as const;

const clearAria2Identity = (env: NodeJS.ProcessEnv): void => {
  for (const key of ARIA2_IDENTITY_ENV_KEYS) {
    delete env[key];
  }
};

const resolveAria2BinaryDigest = (
  resource: ResolvedResourceComponent
): string => {
  const relative = path.relative(resource.rootPath, resource.runtimePath);
  const manifestPath = relative.split(path.sep).join("/");
  if (
    relative.length === 0
    || path.isAbsolute(relative)
    || relative.split(path.sep).some((part) => part === "..")
  ) {
    throw new Error("aria2 binary is outside its verified component root.");
  }
  const file = resource.manifest.files.find(
    (candidate) => candidate.path === manifestPath
  );
  if (file === undefined || !/^[0-9a-f]{64}$/u.test(file.sha256)) {
    throw new Error("aria2 binary is not bound to the signed component manifest.");
  }
  return file.sha256;
};

const missingResourcePath = (
  componentsRoot: string,
  componentId: string
): string => path.join(componentsRoot, componentId, ".missing");

const applyResolvedResource = (
  env: NodeJS.ProcessEnv,
  resource: ResolvedResourceComponent
): void => {
  const envKey = RESOURCE_ENVIRONMENT[resource.componentId as keyof typeof RESOURCE_ENVIRONMENT];
  if (envKey !== undefined) {
    env[envKey] = resource.runtimePath;
  }
  if (resource.componentId === ARIA2_RESOURCE_COMPONENT_ID) {
    env.LYRA_ARIA2_BINARY_SHA256 = resolveAria2BinaryDigest(resource);
    env.LYRA_ARIA2_COMPONENT_ROOT = resource.rootPath;
    env.LYRA_ARIA2_COMPONENT_VERSION = resource.version;
    env.LYRA_ARIA2_TRUST = "verified-component-v1";
  }
};

const applyDevelopmentAria2Bundle = ({
  env,
  resourcesPath,
  cwd,
  platform,
  arch
}: {
  readonly env: NodeJS.ProcessEnv;
  readonly resourcesPath?: string;
  readonly cwd: string;
  readonly platform: NodeJS.Platform;
  readonly arch: NodeJS.Architecture;
}): RuntimeResourceEnvironmentStatus => {
  const resolved = resolveAria2Runtime({
    platform,
    arch,
    ...(resourcesPath === undefined ? {} : { resourcesPath }),
    cwd,
    env,
    // Do not treat an inherited path as a verified development bundle. The
    // fallback below must be described by the repository manifest.
    componentBinaryPath: "",
    allowPathFallback: false
  });
  if (
    !resolved.available
    || resolved.source !== "bundled"
    || resolved.manifest === null
    || resolved.target === null
  ) {
    throw new Error("Verified development aria2 bundle is unavailable.");
  }
  const binarySegments = resolved.manifest.binary.split("/");
  let rootPath = resolved.binaryPath;
  for (let index = 0; index < binarySegments.length; index += 1) {
    rootPath = path.dirname(rootPath);
  }
  const verified = readVerifiedAria2BundleManifest(
    path.join(rootPath, "manifest.json"),
    resolved.target,
    platform,
    { verifyAllFiles: true }
  );
  if (verified === null || path.resolve(verified.binaryPath) !== path.resolve(resolved.binaryPath)) {
    throw new Error("Development aria2 bundle failed its complete manifest verification.");
  }
  const binaryEntry = verified.manifest.files.find(
    (file) => file.path.split(path.sep).join("/") === verified.manifest.binary
  );
  if (binaryEntry === undefined || !/^[0-9a-f]{64}$/u.test(binaryEntry.sha256)) {
    throw new Error("Development aria2 binary is not bound to its bundle manifest.");
  }
  env.LYRA_ARIA2_BINARY = verified.binaryPath;
  env.LYRA_ARIA2_BINARY_SHA256 = binaryEntry.sha256;
  env.LYRA_ARIA2_COMPONENT_ROOT = rootPath;
  env.LYRA_ARIA2_COMPONENT_VERSION = verified.manifest.bundleVersion;
  env.LYRA_ARIA2_TRUST = "development-bundle-v1";
  return {
    componentId: ARIA2_RESOURCE_COMPONENT_ID,
    version: verified.manifest.bundleVersion,
    runtimePath: verified.binaryPath,
    source: "development-fallback"
  };
};

/**
 * Resolves only signed, active resource components in packaged builds.
 *
 * Development builds keep existing repository/PATH discovery for resources
 * that support it. aria2 always requires the signed identity fields below.
 * Packaged builds point missing consumers at a deliberately absent path so
 * Playwright and language servers cannot silently use an unsigned cache or
 * PATH executable.
 */
export const applyRuntimeResourceComponentEnvironment = async ({
  manager,
  componentsRoot,
  developmentFallback,
  resourcesPath,
  cwd = process.cwd(),
  platform = process.platform,
  arch = process.arch,
  env = process.env
}: {
  readonly manager: ResourceComponentManager;
  readonly componentsRoot: string;
  readonly developmentFallback: boolean;
  readonly resourcesPath?: string;
  readonly cwd?: string;
  readonly platform?: NodeJS.Platform;
  readonly arch?: NodeJS.Architecture;
  readonly env?: NodeJS.ProcessEnv;
}): Promise<RuntimeResourceEnvironmentResult> => {
  const resources: RuntimeResourceEnvironmentStatus[] = [];
  env.LYRA_RESOURCE_COMPONENT_MODE = developmentFallback
    ? "development-fallback"
    : "signed-components";
  clearAria2Identity(env);

  for (const [componentId, envKey] of Object.entries(RESOURCE_ENVIRONMENT)) {
    try {
      const resource = await manager.resolveActive(componentId);
      if (resource === null) {
        if (developmentFallback) {
          resources.push(componentId === ARIA2_RESOURCE_COMPONENT_ID
            ? applyDevelopmentAria2Bundle({
                env,
                ...(resourcesPath === undefined ? {} : { resourcesPath }),
                cwd,
                platform,
                arch
              })
            : {
                componentId,
                runtimePath: env[envKey] ?? "",
                source: "development-fallback"
              });
        } else {
          const missing = missingResourcePath(componentsRoot, componentId);
          env[envKey] = missing;
          resources.push({
            componentId,
            runtimePath: missing,
            source: "missing",
            error: "No signed active resource component is installed."
          });
        }
        continue;
      }
      await manager.assertHealthy(resource);
      applyResolvedResource(env, resource);
      resources.push({
        componentId,
        version: resource.version,
        runtimePath: resource.runtimePath,
        source: "component"
      });
    } catch (error) {
      if (developmentFallback) {
        if (componentId === ARIA2_RESOURCE_COMPONENT_ID) {
          try {
            resources.push(applyDevelopmentAria2Bundle({
              env,
              ...(resourcesPath === undefined ? {} : { resourcesPath }),
              cwd,
              platform,
              arch
            }));
          } catch (fallbackError) {
            clearAria2Identity(env);
            resources.push({
              componentId,
              runtimePath: env[envKey] ?? "",
              source: "development-fallback",
              error: `${messageFor(error)} ${messageFor(fallbackError)}`
            });
          }
        } else {
          resources.push({
            componentId,
            runtimePath: env[envKey] ?? "",
            source: "development-fallback",
            error: messageFor(error)
          });
        }
      } else {
        const missing = missingResourcePath(componentsRoot, componentId);
        env[envKey] = missing;
        resources.push({
          componentId,
          runtimePath: missing,
          source: "missing",
          error: messageFor(error)
        });
      }
    }
  }
  return { resources };
};

export const resourceEnvironmentInternalsForTests = {
  RESOURCE_ENVIRONMENT,
  applyDevelopmentAria2Bundle,
  resolveAria2BinaryDigest,
  missingResourcePath
};
