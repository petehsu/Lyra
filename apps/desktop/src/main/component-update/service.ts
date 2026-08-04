import { spawn, type ChildProcessByStdio } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";

import type {
  ComponentStageUpdateRequest,
  ComponentUpdateChannel,
  ComponentUpdateProgress,
  ComponentUpdateReport
} from "../../shared/desktop-bridge";
import type { TrustedComponentRoots } from "../components";
import { resolveNativeResourceCandidates } from "../native-resource-paths";
import { resolveDesktopTarget } from "../platform-target";

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const COMPONENT_ID_PATTERN = /^[a-z0-9._-]{1,128}$/u;
const COMPONENT_TARGETS = new Set([
  "darwin-x64",
  "darwin-arm64",
  "windows-x64",
  "windows-arm64",
  "linux-x64",
  "linux-arm64"
]);
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_ERROR_BYTES = 128 * 1024;

type ComponentUpdateServiceOptions = {
  readonly installRoot: string;
  readonly stateRoot: string;
  readonly trustedRoots: TrustedComponentRoots;
  readonly catalogUrls: Readonly<Partial<Record<ComponentUpdateChannel, string>>>;
  readonly cwd?: string;
  readonly resourcesPath?: string;
  readonly platform?: NodeJS.Platform;
  readonly arch?: NodeJS.Architecture;
  readonly executablePath?: string;
  readonly onTrustUpdated?: () => Promise<void>;
  readonly onStageCompleted?: (report: ComponentUpdateReport) => Promise<void>;
  readonly spawnProcess?: typeof spawn;
};

export type ComponentUpdateService = {
  readonly stage: (
    request: ComponentStageUpdateRequest,
    onProgress: (progress: ComponentUpdateProgress) => void
  ) => Promise<ComponentUpdateReport>;
  readonly stageOnDemandFromActiveRelease: (
    request: ComponentOnDemandStageRequest,
    onProgress: (progress: ComponentUpdateProgress) => void
  ) => Promise<ComponentUpdateReport>;
  readonly cancel: () => void;
  readonly dispose: () => void;
};

export type ComponentOnDemandStageRequest = {
  readonly componentId: string;
  readonly releaseVersion: string;
  readonly catalogSequence: number;
  readonly proxy?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const resolveComponentTarget = (
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture
): string => {
  const target = resolveDesktopTarget({ platform, arch });
  if (target.supportTier !== "tier1") {
    throw new Error(`Component updates are unavailable for unsupported target ${target.id}.`);
  }
  return target.platform === "win32" ? `windows-${target.resourceArch}` : target.id;
};

const validateCatalogUrl = (value: string): string => {
  const url = new URL(value);
  if (
    url.protocol !== "https:"
    || url.username.length > 0
    || url.password.length > 0
    || url.hash.length > 0
  ) {
    throw new Error("Component catalog URL must be credential-free HTTPS.");
  }
  return url.toString();
};

const validateProxy = (value: string | undefined): void => {
  if (value === undefined) {
    return;
  }
  const proxy = new URL(value);
  if (!new Set(["http:", "https:"]).has(proxy.protocol) || proxy.hash.length > 0) {
    throw new Error("Component update proxy URL is invalid.");
  }
};

export const resolveVerifiedReleaseCatalogPath = ({
  stateRoot,
  target,
  releaseVersion,
  catalogSequence
}: {
  readonly stateRoot: string;
  readonly target: string;
  readonly releaseVersion: string;
  readonly catalogSequence: number;
}): string => {
  if (
    !COMPONENT_TARGETS.has(target)
    || !SEMVER_PATTERN.test(releaseVersion)
    || !Number.isSafeInteger(catalogSequence)
    || catalogSequence < 1
  ) {
    throw new Error("Verified release catalog identity is invalid.");
  }
  return path.join(
    stateRoot,
    "verified-releases-v1",
    target,
    releaseVersion,
    String(catalogSequence).padStart(20, "0"),
    "catalog.json"
  );
};

const readVerifiedReleaseCatalogPath = async (
  stateRoot: string,
  target: string,
  releaseVersion: string,
  catalogSequence: number
): Promise<string> => {
  const candidate = resolveVerifiedReleaseCatalogPath({
    stateRoot,
    target,
    releaseVersion,
    catalogSequence
  });
  const metadata = await lstat(candidate).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        "The active release has no verified Catalog/BOM receipt; run signed repair before first-use acquisition."
      );
    }
    throw error;
  });
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("Verified release catalog receipt is not a regular file.");
  }
  const [root, resolved] = await Promise.all([realpath(stateRoot), realpath(candidate)]);
  const relative = path.relative(root, resolved);
  if (relative.length === 0 || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error("Verified release catalog receipt escaped the component state root.");
  }
  return resolved;
};

export const resolveBootstrapExecutable = async ({
  explicit,
  cwd,
  resourcesPath,
  platform,
  arch
}: {
  readonly explicit?: string;
  readonly cwd: string;
  readonly resourcesPath?: string;
  readonly platform: NodeJS.Platform;
  readonly arch: NodeJS.Architecture;
}): Promise<string> => {
  const names = [platform === "win32" ? "lyra-bootstrap.exe" : "lyra-bootstrap"];
  const candidates = explicit === undefined
    ? resolveNativeResourceCandidates({
        cwd,
        fileNames: names,
        envVar: "LYRA_BOOTSTRAP_BIN",
        ...(resourcesPath === undefined ? {} : { resourcesPath }),
        platform,
        arch
      })
    : [path.resolve(explicit)];
  for (const candidate of candidates) {
    try {
      const metadata = await lstat(candidate);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        continue;
      }
      if (platform !== "win32" && (metadata.mode & 0o111) === 0) {
        continue;
      }
      return await realpath(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
  throw new Error("Packaged Lyra bootstrap executable is unavailable.");
};

const parseProgress = (value: unknown): ComponentUpdateProgress => {
  if (!isRecord(value)) {
    throw new Error("Bootstrap progress is invalid.");
  }
  const phases = new Set(["catalog", "bom", "download", "verify", "install", "complete"]);
  if (
    typeof value.phase !== "string"
    || !phases.has(value.phase)
    || (value.componentId !== undefined && typeof value.componentId !== "string")
    || !Number.isSafeInteger(value.completed)
    || !Number.isSafeInteger(value.total)
    || !Number.isSafeInteger(value.completedComponents)
    || !Number.isSafeInteger(value.totalComponents)
    || (value.completed as number) < 0
    || (value.total as number) < 0
    || (value.completedComponents as number) < 0
    || (value.totalComponents as number) < 0
    || (value.completed as number) > (value.total as number)
    || (value.completedComponents as number) > (value.totalComponents as number)
  ) {
    throw new Error("Bootstrap progress fields are invalid.");
  }
  return value as unknown as ComponentUpdateProgress;
};

const parseReport = (value: unknown): ComponentUpdateReport => {
  if (!isRecord(value)) {
    throw new Error("Bootstrap update report is invalid.");
  }
  const arrays = [
    value.installedComponents,
    value.repairedComponents,
    value.stagedComponents,
    value.deferredComponents
  ];
  if (
    typeof value.releaseVersion !== "string"
    || !SEMVER_PATTERN.test(value.releaseVersion)
    || !Number.isSafeInteger(value.catalogSequence)
    || (value.catalogSequence as number) < 1
    || typeof value.target !== "string"
    || !COMPONENT_TARGETS.has(value.target)
    || arrays.some((items) =>
      !Array.isArray(items)
      || items.some((item) => typeof item !== "string" || !COMPONENT_ID_PATTERN.test(item)))
  ) {
    throw new Error("Bootstrap update report fields are invalid.");
  }
  return value as unknown as ComponentUpdateReport;
};

export const createComponentUpdateService = (
  options: ComponentUpdateServiceOptions
): ComponentUpdateService => {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const cwd = options.cwd ?? process.cwd();
  const target = resolveComponentTarget(platform, arch);
  const spawnProcess = options.spawnProcess ?? spawn;
  let active: ChildProcessByStdio<null, Readable, Readable> | null = null;

  const cancel = (): void => {
    active?.kill("SIGTERM");
  };

  const runBootstrap = async (
    catalogSource: string,
    extraArguments: readonly string[],
    onProgress: (progress: ComponentUpdateProgress) => void
  ): Promise<ComponentUpdateReport> => {
    if (active !== null) {
      throw new Error("A component update is already running.");
    }
    const roots = Object.entries(options.trustedRoots.rawBase64);
    if (roots.length === 0) {
      throw new Error("No trusted offline component root is configured.");
    }
    const executable = await resolveBootstrapExecutable({
      ...(options.executablePath === undefined ? {} : { explicit: options.executablePath }),
      cwd,
      ...(options.resourcesPath === undefined ? {} : { resourcesPath: options.resourcesPath }),
      platform,
      arch
    });
    const args = [
      "--catalog", catalogSource,
      "--install-root", options.installRoot,
      "--state-root", options.stateRoot,
      "--target", target,
      "--json-progress",
      ...roots.flatMap(([keyId, publicKey]) => ["--trusted-root", `${keyId}=${publicKey}`]),
      ...extraArguments
    ];
      const child = spawnProcess(executable, args, {
        cwd,
        env: process.env,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      active = child;
      return new Promise<ComponentUpdateReport>((resolve, reject) => {
        let stdout = "";
        let stderr = "";
        let report: ComponentUpdateReport | null = null;
        let failed = false;
        const fail = (error: Error): void => {
          if (!failed) {
            failed = true;
            child.kill("SIGKILL");
            reject(error);
          }
        };
        const consumeLines = (): void => {
          while (stdout.includes("\n")) {
            const index = stdout.indexOf("\n");
            const line = stdout.slice(0, index).trim();
            stdout = stdout.slice(index + 1);
            if (line.length === 0) {
              continue;
            }
            try {
              const event = JSON.parse(line) as unknown;
              if (!isRecord(event) || typeof event.type !== "string") {
                throw new Error("Bootstrap emitted an invalid event.");
              }
              if (event.type === "progress") {
                onProgress(parseProgress(event.progress));
              } else if (event.type === "complete") {
                const parsedReport = parseReport(event.report);
                if (parsedReport.target !== target) {
                  throw new Error(
                    `Bootstrap update report target mismatch: received ${parsedReport.target} `
                    + `does not match requested target ${target}.`
                  );
                }
                report = parsedReport;
              } else {
                throw new Error(`Bootstrap emitted an unknown event: ${event.type}`);
              }
            } catch (error) {
              fail(error instanceof Error ? error : new Error(String(error)));
            }
          }
        };
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          stdout += chunk;
          if (Buffer.byteLength(stdout, "utf8") > MAX_OUTPUT_BYTES) {
            fail(new Error("Bootstrap output exceeded its limit."));
            return;
          }
          consumeLines();
        });
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => {
          stderr = `${stderr}${chunk}`.slice(-MAX_ERROR_BYTES);
        });
        child.once("error", fail);
        child.once("exit", (code, signal) => {
          active = null;
          consumeLines();
          if (failed) {
            return;
          }
          if (code !== 0 || report === null) {
            reject(new Error(
              `Component update failed (${signal ?? code ?? "unknown"}): ${stderr.trim() || "no detail"}`
            ));
            return;
          }
          if (report.target !== target) {
            reject(new Error(
              `Bootstrap report target ${report.target} does not match requested target ${target}.`
            ));
            return;
          }
          void (async () => {
            try {
              await options.onTrustUpdated?.();
              await options.onStageCompleted?.(report);
              resolve(report);
            } catch (error) {
              reject(error);
            }
          })();
        });
      }).finally(() => {
        if (active === child) {
          active = null;
        }
      });
  };

  return {
    stage: async (request, onProgress) => {
      const catalog = options.catalogUrls[request.channel];
      if (catalog === undefined) {
        throw new Error(`Component update channel is not configured: ${request.channel}`);
      }
      if (request.releaseVersion !== undefined && !SEMVER_PATTERN.test(request.releaseVersion)) {
        throw new Error("Requested component release version is invalid.");
      }
      validateProxy(request.proxy);
      return runBootstrap(
        validateCatalogUrl(catalog),
        [
          ...(request.releaseVersion === undefined ? [] : ["--release", request.releaseVersion]),
          ...(request.proxy === undefined ? [] : ["--proxy", request.proxy])
        ],
        onProgress
      );
    },
    stageOnDemandFromActiveRelease: async (request, onProgress) => {
      if (!COMPONENT_ID_PATTERN.test(request.componentId)) {
        throw new Error("On-demand component ID is invalid.");
      }
      if (!SEMVER_PATTERN.test(request.releaseVersion)) {
        throw new Error("On-demand release version is invalid.");
      }
      if (!Number.isSafeInteger(request.catalogSequence) || request.catalogSequence < 1) {
        throw new Error("On-demand catalog sequence is invalid.");
      }
      validateProxy(request.proxy);
      const catalogPath = await readVerifiedReleaseCatalogPath(
        options.stateRoot,
        target,
        request.releaseVersion,
        request.catalogSequence
      );
      return runBootstrap(
        catalogPath,
        [
          "--release", request.releaseVersion,
          "--on-demand-component", request.componentId,
          "--expected-catalog-sequence", String(request.catalogSequence),
          ...(request.proxy === undefined ? [] : ["--proxy", request.proxy])
        ],
        onProgress
      );
    },
    cancel,
    dispose: cancel
  };
};
