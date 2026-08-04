import { execFile, type ExecFileException } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

import { resolveDesktopTarget } from "../platform-target";

const WASI_RUNNER_PROTOCOL_VERSION = 1;
const MAX_RUNNER_OUTPUT_BYTES = 64 * 1024;
const OUTER_TIMEOUT_GRACE_MS = 2_000;
const MAX_OUTER_TIMEOUT_MS = 32_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/iu;

const THIRD_PARTY_WASI_PERMISSIONS = [
  "wasi:app-data.read",
  "wasi:app-data.write",
  "wasi:temp.read",
  "wasi:temp.write"
] as const;

type ThirdPartyWasiPermission = (typeof THIRD_PARTY_WASI_PERMISSIONS)[number];

type ThirdPartyWasiLimits = {
  readonly maxComponentBytes: number;
  readonly maxMemoryBytes: number;
  readonly maxTableElements: number;
  readonly maxInstances: number;
  readonly maxTables: number;
  readonly maxMemories: number;
  readonly maxRandomBytes: number;
  readonly fuel: number;
  readonly timeoutMillis: number;
};

const DEFAULT_THIRD_PARTY_WASI_LIMITS: ThirdPartyWasiLimits = Object.freeze({
  maxComponentBytes: 64 * 1024 * 1024,
  maxMemoryBytes: 256 * 1024 * 1024,
  maxTableElements: 100_000,
  maxInstances: 100,
  maxTables: 100,
  maxMemories: 16,
  maxRandomBytes: 1024 * 1024,
  fuel: 100_000_000,
  timeoutMillis: 30_000
});

type ThirdPartyWasiRunRequest = {
  readonly componentPackageRoot: string;
  readonly componentPath: string;
  readonly expectedSha256: string;
  readonly appDataRoot: string;
  readonly temporaryRoot: string;
  readonly permissions: readonly ThirdPartyWasiPermission[];
  readonly limits?: ThirdPartyWasiLimits;
};

type ThirdPartyWasiRunResult = {
  readonly status: "success" | "guestFailure";
};

type ExecFileOptions = {
  readonly cwd: string;
  readonly encoding: "utf8";
  readonly env: NodeJS.ProcessEnv;
  readonly killSignal: NodeJS.Signals;
  readonly maxBuffer: number;
  readonly shell: false;
  readonly timeout: number;
  readonly windowsHide: true;
};

type ExecFileResult = {
  readonly exitCode: number | null;
  readonly killed: boolean;
  readonly signal: NodeJS.Signals | null;
  readonly spawnErrorCode?: string;
  readonly stderr: string;
  readonly stdout: string;
};

type ExecuteFile = (
  executable: string,
  args: readonly string[],
  options: ExecFileOptions
) => Promise<ExecFileResult>;

type ThirdPartyWasiRunnerServiceOptions = {
  readonly resourcesRoot?: string;
  readonly allowedAppDataRoot: string;
  readonly allowedTemporaryRoot: string;
  readonly platform?: NodeJS.Platform;
  readonly arch?: NodeJS.Architecture;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly featureEnabled?: boolean;
  readonly executeFile?: ExecuteFile;
};

type ThirdPartyWasiRunnerService = {
  readonly run: (request: ThirdPartyWasiRunRequest) => Promise<ThirdPartyWasiRunResult>;
};

class ThirdPartyWasiRunnerError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`Third-party WASI execution failed (${code}).`);
    this.name = "ThirdPartyWasiRunnerError";
    this.code = code;
  }
}

const isThirdPartyWasiEnabled = (
  env: Readonly<Record<string, string | undefined>> = process.env
): boolean => env.LYRA_ENABLE_THIRD_PARTY_WASI === "1";

const isPathWithin = (parent: string, candidate: string): boolean => {
  const pathFromParent = relative(parent, candidate);
  return pathFromParent === "" || (
    pathFromParent !== ".."
    && !pathFromParent.startsWith("../")
    && !pathFromParent.startsWith("..\\")
    && !isAbsolute(pathFromParent)
  );
};

const resolveRealDirectory = (label: string, path: string): string => {
  if (!isAbsolute(path)) {
    throw new Error(`${label} must be an absolute path.`);
  }
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`${label} must be a real directory.`);
  }
  return realpathSync(path);
};

const resolveContainedDirectory = (
  label: string,
  allowedRoot: string,
  candidate: string
): string => {
  if (!isAbsolute(candidate)) {
    throw new Error(`${label} is outside its authorized root.`);
  }
  const resolved = resolveRealDirectory(label, candidate);
  if (!isPathWithin(allowedRoot, resolved)) {
    throw new Error(`${label} is outside its authorized root.`);
  }
  return resolved;
};

const resolveComponent = (
  componentPackageRoot: string,
  componentPath: string,
  maximumBytes: number
): string => {
  if (!isAbsolute(componentPackageRoot)) {
    throw new Error("WASI component package root must be an absolute path.");
  }
  const packageRoot = resolveRealDirectory("WASI component package root", componentPackageRoot);
  if (
    !isAbsolute(componentPath)
    || !componentPath.toLowerCase().endsWith(".wasm")
    || !isPathWithin(componentPackageRoot, componentPath)
  ) {
    throw new Error("WASI component must be an absolute .wasm file inside its package.");
  }
  const metadata = lstatSync(componentPath);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > maximumBytes) {
    throw new Error("WASI component must be a bounded real file inside its package.");
  }
  const resolved = realpathSync(componentPath);
  if (!isPathWithin(packageRoot, resolved)) {
    throw new Error("WASI component is outside its package.");
  }
  return resolved;
};

const resolvePackagedWasiRunner = (input: {
  readonly resourcesRoot: string;
  readonly platform: NodeJS.Platform;
  readonly arch: NodeJS.Architecture;
}): string => {
  const resourcesRoot = resolveRealDirectory("Lyra resources root", input.resourcesRoot);
  const target = resolveDesktopTarget({ platform: input.platform, arch: input.arch });
  if (target.supportTier !== "tier1") {
    throw new Error(`Third-party WASI is unavailable for unsupported target ${target.id}.`);
  }
  const fileName = input.platform === "win32" ? "lyra-wasi-runner.exe" : "lyra-wasi-runner";
  const candidate = join(resourcesRoot, "native", target.id, fileName);
  const metadata = lstatSync(candidate);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error("Packaged WASI runner must be a real file.");
  }
  if (input.platform !== "win32" && (metadata.mode & 0o111) === 0) {
    throw new Error("Packaged WASI runner is not executable.");
  }
  const resolved = realpathSync(candidate);
  if (!isPathWithin(resourcesRoot, resolved)) {
    throw new Error("Packaged WASI runner resolved outside Lyra resources.");
  }
  return resolved;
};

const validatePermissions = (
  permissions: readonly ThirdPartyWasiPermission[]
): readonly ThirdPartyWasiPermission[] => {
  if (permissions.length > THIRD_PARTY_WASI_PERMISSIONS.length) {
    throw new Error("Too many WASI permissions were supplied.");
  }
  const allowed = new Set<string>(THIRD_PARTY_WASI_PERMISSIONS);
  const unique = new Set<string>();
  for (const permission of permissions) {
    if (!allowed.has(permission) || unique.has(permission)) {
      throw new Error("WASI permissions contain an unsupported or duplicate value.");
    }
    unique.add(permission);
  }
  return [...permissions];
};

const validateLimits = (limits: ThirdPartyWasiLimits): ThirdPartyWasiLimits => {
  for (const key of Object.keys(DEFAULT_THIRD_PARTY_WASI_LIMITS) as Array<keyof ThirdPartyWasiLimits>) {
    const value = limits[key];
    const maximum = DEFAULT_THIRD_PARTY_WASI_LIMITS[key];
    if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
      throw new Error(`Invalid third-party WASI resource limit: ${key}.`);
    }
  }
  return Object.freeze({ ...limits });
};

const executeFileWithoutShell: ExecuteFile = async (executable, args, options) =>
  await new Promise<ExecFileResult>((resolve) => {
    execFile(executable, [...args], options, (error, stdout, stderr) => {
      const failure = error as ExecFileException | null;
      resolve({
        exitCode: typeof failure?.code === "number" ? failure.code : failure === null ? 0 : null,
        killed: failure?.killed === true,
        signal: failure?.signal ?? null,
        ...(typeof failure?.code === "string" ? { spawnErrorCode: failure.code } : {}),
        stdout,
        stderr
      });
    });
  });

type RunnerResponse = {
  readonly protocolVersion: number;
  readonly status: "success" | "guestFailure" | "error";
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
};

const parseRunnerResponse = (stdout: string): RunnerResponse => {
  if (Buffer.byteLength(stdout, "utf8") > MAX_RUNNER_OUTPUT_BYTES) {
    throw new ThirdPartyWasiRunnerError("invalidRunnerResponse");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new ThirdPartyWasiRunnerError("invalidRunnerResponse");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ThirdPartyWasiRunnerError("invalidRunnerResponse");
  }
  const response = parsed as Partial<RunnerResponse>;
  if (
    response.protocolVersion !== WASI_RUNNER_PROTOCOL_VERSION
    || !["success", "guestFailure", "error"].includes(response.status ?? "")
  ) {
    throw new ThirdPartyWasiRunnerError("invalidRunnerResponse");
  }
  if (response.status === "error") {
    if (
      typeof response.error !== "object"
      || response.error === null
      || typeof response.error.code !== "string"
      || !/^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(response.error.code)
      || typeof response.error.message !== "string"
    ) {
      throw new ThirdPartyWasiRunnerError("invalidRunnerResponse");
    }
  } else if (response.error !== undefined) {
    throw new ThirdPartyWasiRunnerError("invalidRunnerResponse");
  }
  return response as RunnerResponse;
};

const buildRunnerArguments = (input: {
  readonly componentPath: string;
  readonly expectedSha256: string;
  readonly appDataRoot: string;
  readonly temporaryRoot: string;
  readonly permissions: readonly ThirdPartyWasiPermission[];
  readonly limits: ThirdPartyWasiLimits;
}): readonly string[] => [
  "--component", input.componentPath,
  "--expected-sha256", input.expectedSha256,
  "--app-data-root", input.appDataRoot,
  "--temporary-root", input.temporaryRoot,
  ...input.permissions.flatMap((permission) => ["--permission", permission]),
  "--max-component-bytes", String(input.limits.maxComponentBytes),
  "--max-memory-bytes", String(input.limits.maxMemoryBytes),
  "--max-table-elements", String(input.limits.maxTableElements),
  "--max-instances", String(input.limits.maxInstances),
  "--max-tables", String(input.limits.maxTables),
  "--max-memories", String(input.limits.maxMemories),
  "--max-random-bytes", String(input.limits.maxRandomBytes),
  "--fuel", String(input.limits.fuel),
  "--timeout-millis", String(input.limits.timeoutMillis)
];

const createThirdPartyWasiRunnerService = (
  options: ThirdPartyWasiRunnerServiceOptions
): ThirdPartyWasiRunnerService => {
  const resourcesRoot = options.resourcesRoot ?? process.resourcesPath;
  const allowedAppDataRoot = resolveRealDirectory(
    "Authorized WASI application data root",
    options.allowedAppDataRoot
  );
  const allowedTemporaryRoot = resolveRealDirectory(
    "Authorized WASI temporary root",
    options.allowedTemporaryRoot
  );
  if (
    isPathWithin(allowedAppDataRoot, allowedTemporaryRoot)
    || isPathWithin(allowedTemporaryRoot, allowedAppDataRoot)
  ) {
    throw new Error("Authorized WASI data roots must not overlap.");
  }
  const featureEnabled = options.featureEnabled ?? isThirdPartyWasiEnabled(options.env);
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const executeFile = options.executeFile ?? executeFileWithoutShell;

  return {
    run: async (request) => {
      if (!featureEnabled) {
        throw new ThirdPartyWasiRunnerError("disabled");
      }
      const limits = validateLimits(request.limits ?? DEFAULT_THIRD_PARTY_WASI_LIMITS);
      const permissions = validatePermissions(request.permissions);
      if (!SHA256_PATTERN.test(request.expectedSha256)) {
        throw new Error("WASI component SHA-256 is invalid.");
      }
      const componentPath = resolveComponent(
        request.componentPackageRoot,
        request.componentPath,
        limits.maxComponentBytes
      );
      const appDataRoot = resolveContainedDirectory(
        "WASI application data root",
        allowedAppDataRoot,
        request.appDataRoot
      );
      const temporaryRoot = resolveContainedDirectory(
        "WASI temporary root",
        allowedTemporaryRoot,
        request.temporaryRoot
      );
      if (
        isPathWithin(appDataRoot, temporaryRoot)
        || isPathWithin(temporaryRoot, appDataRoot)
      ) {
        throw new Error("WASI component data roots must not overlap.");
      }
      const runner = resolvePackagedWasiRunner({ resourcesRoot, platform, arch });
      const timeout = Math.min(
        limits.timeoutMillis + OUTER_TIMEOUT_GRACE_MS,
        MAX_OUTER_TIMEOUT_MS
      );
      const execution = await executeFile(
        runner,
        buildRunnerArguments({
          componentPath,
          expectedSha256: request.expectedSha256.toLowerCase(),
          appDataRoot,
          temporaryRoot,
          permissions,
          limits
        }),
        {
          cwd: realpathSync(resourcesRoot),
          encoding: "utf8",
          env: {},
          killSignal: "SIGKILL",
          maxBuffer: MAX_RUNNER_OUTPUT_BYTES,
          shell: false,
          timeout,
          windowsHide: true
        }
      );
      if (execution.killed) {
        throw new ThirdPartyWasiRunnerError("outerTimeout");
      }
      if (execution.signal !== null) {
        throw new ThirdPartyWasiRunnerError("runnerCrashed");
      }
      if (execution.spawnErrorCode !== undefined) {
        throw new ThirdPartyWasiRunnerError("runnerUnavailable");
      }
      const response = parseRunnerResponse(execution.stdout);
      const expectedExitCode = response.status === "success"
        ? 0
        : response.status === "guestFailure"
          ? 10
          : 2;
      if (execution.exitCode !== expectedExitCode) {
        throw new ThirdPartyWasiRunnerError("invalidRunnerResponse");
      }
      if (response.status === "error") {
        throw new ThirdPartyWasiRunnerError(response.error?.code ?? "runnerRejected");
      }
      return { status: response.status };
    }
  };
};

export {
  DEFAULT_THIRD_PARTY_WASI_LIMITS,
  THIRD_PARTY_WASI_PERMISSIONS,
  ThirdPartyWasiRunnerError,
  createThirdPartyWasiRunnerService,
  isThirdPartyWasiEnabled,
  resolvePackagedWasiRunner
};
export type {
  ExecuteFile,
  ThirdPartyWasiLimits,
  ThirdPartyWasiPermission,
  ThirdPartyWasiRunRequest,
  ThirdPartyWasiRunResult,
  ThirdPartyWasiRunnerService,
  ThirdPartyWasiRunnerServiceOptions
};
