import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm
} from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import type { ComponentUpdateReport } from "../../shared/desktop-bridge";
import { readJsonFile, writeFileAtomic } from "../persistence";

const CORE_COMPONENT_ID = "lyra.core";
const REQUEST_SCHEMA_VERSION = 1 as const;
const REQUEST_DIRECTORY = "core-projection";
const REQUEST_FILE_NAME = "pending.v1.json";
const HELPER_DIRECTORY = "helpers";
const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_HELPER_BYTES = 32 * 1024 * 1024;
const DEFAULT_WAIT_TIMEOUT_SECONDS = 300;
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const TARGET_PATTERN =
  /^(?:darwin|windows|linux)-(?:x64|arm64)$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

type CoreProjectionRequestV1 = {
  readonly schemaVersion: typeof REQUEST_SCHEMA_VERSION;
  readonly requestId: string;
  readonly componentId: typeof CORE_COMPONENT_ID;
  readonly pendingVersion: string;
  readonly releaseVersion: string;
  readonly target: string;
  readonly installRoot: string;
  readonly stateRoot: string;
  readonly programRoot: string;
  readonly helperPath: string;
  readonly helperSha256: string;
  readonly createdAt: string;
  readonly status: "pending" | "spawned" | "failed";
  readonly spawnedByPid?: number;
  readonly spawnedBySessionId?: string;
  readonly failure?: string;
};

export type CoreProjectionStatus = {
  readonly state: "idle" | "pending" | "spawned" | "failed";
  readonly componentId: typeof CORE_COMPONENT_ID;
  readonly pendingVersion?: string;
  readonly requestId?: string;
  readonly error?: string;
};

export type CoreProjectionHandoff = CoreProjectionStatus & {
  readonly state: "spawned";
  readonly helperPath: string;
  readonly args: readonly string[];
};

export type CoreProjectionCoordinatorOptions = {
  readonly installRoot: string;
  readonly stateRoot: string;
  readonly programRoot: string;
  readonly target: string;
  readonly platform?: NodeJS.Platform;
  readonly resolveBootstrapPath: () => Promise<string>;
  readonly readPendingVersion: () => Promise<string | undefined>;
  readonly releaseVersion?: string;
  readonly waitTimeoutSeconds?: number;
  readonly currentPid?: number;
  readonly requestQuit: () => void;
  readonly scheduleQuit?: (callback: () => void) => void;
  readonly spawnProcess?: typeof spawn;
};

export type CoreProjectionCoordinator = {
  readonly noteStaged: (report: ComponentUpdateReport) => Promise<void>;
  readonly readStatus: () => Promise<CoreProjectionStatus>;
  readonly applyAndQuit: () => Promise<CoreProjectionHandoff>;
  readonly dispose: () => void;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requestPathFor = (stateRoot: string): string =>
  path.join(stateRoot, REQUEST_DIRECTORY, REQUEST_FILE_NAME);

const helperRootFor = (stateRoot: string): string =>
  path.join(stateRoot, REQUEST_DIRECTORY, HELPER_DIRECTORY);

const normalizeAbsolutePath = (value: string, field: string): string => {
  if (typeof value !== "string" || value.length === 0 || !path.isAbsolute(value)) {
    throw new Error(`Core projection ${field} must be an absolute path.`);
  }
  return path.resolve(value);
};

const assertOutsidePath = (root: string, candidate: string, field: string): void => {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (
    relative.length === 0
    || (
      relative !== ".."
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative)
    )
  ) {
    throw new Error(`Core projection ${field} must be outside the program root.`);
  }
};

const sha256File = async (filePath: string): Promise<string> =>
  createHash("sha256").update(await readFile(filePath)).digest("hex");

const validateRequest = (value: unknown): CoreProjectionRequestV1 | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (
    value.schemaVersion !== REQUEST_SCHEMA_VERSION
    || typeof value.requestId !== "string"
    || !UUID_PATTERN.test(value.requestId)
    || value.componentId !== CORE_COMPONENT_ID
    || typeof value.pendingVersion !== "string"
    || !SEMVER_PATTERN.test(value.pendingVersion)
    || typeof value.releaseVersion !== "string"
    || !SEMVER_PATTERN.test(value.releaseVersion)
    || typeof value.target !== "string"
    || !TARGET_PATTERN.test(value.target)
    || typeof value.installRoot !== "string"
    || !path.isAbsolute(value.installRoot)
    || typeof value.stateRoot !== "string"
    || !path.isAbsolute(value.stateRoot)
    || typeof value.programRoot !== "string"
    || !path.isAbsolute(value.programRoot)
    || typeof value.helperPath !== "string"
    || !path.isAbsolute(value.helperPath)
    || typeof value.helperSha256 !== "string"
    || !/^[0-9a-f]{64}$/u.test(value.helperSha256)
    || typeof value.createdAt !== "string"
    || Number.isNaN(Date.parse(value.createdAt))
    || !new Set(["pending", "spawned", "failed"]).has(value.status as string)
    || (
      value.spawnedByPid !== undefined
      && (!Number.isSafeInteger(value.spawnedByPid) || (value.spawnedByPid as number) <= 0)
    )
    || (
      value.spawnedBySessionId !== undefined
      && (
        typeof value.spawnedBySessionId !== "string"
        || !UUID_PATTERN.test(value.spawnedBySessionId)
      )
    )
    || (value.failure !== undefined && typeof value.failure !== "string")
  ) {
    return null;
  }
  return value as unknown as CoreProjectionRequestV1;
};

const readRequest = async (
  filePath: string
): Promise<CoreProjectionRequestV1 | null> => {
  try {
    const metadata = await lstat(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_REQUEST_BYTES) {
      throw new Error("Core projection request is not a bounded regular file.");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  const parsed = validateRequest(await readJsonFile(filePath, "lyra-core-projection"));
  if (parsed === null) {
    throw new Error("Core projection request is invalid.");
  }
  return parsed;
};

const writeRequest = async (
  filePath: string,
  request: CoreProjectionRequestV1
): Promise<void> => {
  await writeFileAtomic(filePath, `${JSON.stringify(request, null, 2)}\n`);
};

const copyHelperOutsideProgram = async ({
  sourcePath,
  stateRoot,
  programRoot,
  platform
}: {
  readonly sourcePath: string;
  readonly stateRoot: string;
  readonly programRoot: string;
  readonly platform: NodeJS.Platform;
}): Promise<{ readonly path: string; readonly sha256: string }> => {
  const source = path.resolve(sourcePath);
  const sourceMetadata = await lstat(source);
  if (!sourceMetadata.isFile() || sourceMetadata.isSymbolicLink()) {
    throw new Error("Bootstrap helper must be a regular, non-symlink file.");
  }
  if (sourceMetadata.size <= 0 || sourceMetadata.size > MAX_HELPER_BYTES) {
    throw new Error("Bootstrap helper size is outside the allowed range.");
  }
  if (platform !== "win32" && (sourceMetadata.mode & 0o111) === 0) {
    throw new Error("Bootstrap helper is not executable.");
  }

  const digest = await sha256File(source);
  const helperDirectory = path.join(helperRootFor(stateRoot), digest);
  const helperName = platform === "win32" ? "lyra-bootstrap.exe" : "lyra-bootstrap";
  const destination = path.join(helperDirectory, helperName);
  assertOutsidePath(programRoot, destination, "helper");
  await mkdir(helperDirectory, { recursive: true });
  assertOutsidePath(
    await realpath(programRoot),
    path.join(await realpath(helperDirectory), helperName),
    "helper"
  );

  let destinationReady = false;
  try {
    const existing = await lstat(destination);
    destinationReady = existing.isFile() && !existing.isSymbolicLink();
    if (destinationReady && (await sha256File(destination)) !== digest) {
      destinationReady = false;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  if (!destinationReady) {
    const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`;
    await rm(temporary, { force: true });
    try {
      await copyFile(source, temporary);
      if (platform !== "win32") {
        await chmod(temporary, 0o755);
      }
      if ((await sha256File(temporary)) !== digest) {
        throw new Error("Bootstrap helper digest changed while copying.");
      }
      await rm(destination, { force: true });
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  const installed = await lstat(destination);
  if (!installed.isFile() || installed.isSymbolicLink() || (await sha256File(destination)) !== digest) {
    throw new Error("Copied bootstrap helper failed integrity verification.");
  }
  return { path: destination, sha256: digest };
};

const toStatus = (request: CoreProjectionRequestV1 | null): CoreProjectionStatus => {
  if (request === null) {
    return { state: "idle", componentId: CORE_COMPONENT_ID };
  }
  return {
    state: request.status,
    componentId: CORE_COMPONENT_ID,
    pendingVersion: request.pendingVersion,
    requestId: request.requestId,
    ...(request.failure === undefined ? {} : { error: request.failure })
  };
};

const safeErrorMessage = (error: unknown): string =>
  error instanceof Error && error.message.length > 0 ? error.message : String(error);

const waitForChildSpawn = async (child: ChildProcess): Promise<void> =>
  await new Promise<void>((resolve, reject) => {
    const onSpawn = (): void => {
      child.removeListener("error", onError);
      resolve();
    };
    const onError = (error: Error): void => {
      child.removeListener("spawn", onSpawn);
      reject(error);
    };
    child.once("spawn", onSpawn);
    child.once("error", onError);
  });

export const resolveDesktopProgramRoot = ({
  platform,
  executablePath
}: {
  readonly platform: NodeJS.Platform;
  readonly executablePath: string;
}): string => {
  const executable = path.resolve(executablePath);
  if (platform === "darwin") {
    const marker = `${path.sep}Contents${path.sep}MacOS${path.sep}`;
    const markerIndex = executable.lastIndexOf(marker);
    if (markerIndex >= 0) {
      return executable.slice(0, markerIndex);
    }
  }
  return path.dirname(executable);
};

export const createCoreProjectionCoordinator = (
  options: CoreProjectionCoordinatorOptions
): CoreProjectionCoordinator => {
  const installRoot = normalizeAbsolutePath(options.installRoot, "installRoot");
  const stateRoot = normalizeAbsolutePath(options.stateRoot, "stateRoot");
  const programRoot = normalizeAbsolutePath(options.programRoot, "programRoot");
  const requestFile = requestPathFor(stateRoot);
  const target = options.target;
  if (!TARGET_PATTERN.test(target)) {
    throw new Error(`Core projection target is invalid: ${target}`);
  }
  const waitTimeoutSeconds = options.waitTimeoutSeconds ?? DEFAULT_WAIT_TIMEOUT_SECONDS;
  if (!Number.isSafeInteger(waitTimeoutSeconds) || waitTimeoutSeconds <= 0) {
    throw new Error("Core projection wait timeout must be a positive integer.");
  }
  const currentPid = options.currentPid ?? process.pid;
  if (!Number.isSafeInteger(currentPid) || currentPid <= 0) {
    throw new Error("Core projection current PID is invalid.");
  }
  const spawnProcess = options.spawnProcess ?? spawn;
  const platform = options.platform ?? process.platform;
  const sessionId = randomUUID();
  const scheduleQuit = options.scheduleQuit ?? ((callback: () => void) => {
    // `ipcMain.handle` serializes the resolved value in the promise/microtask
    // checkpoint before timers run, so the renderer receives the handoff
    // acknowledgement before Electron begins its quit sequence.
    setTimeout(callback, 0);
  });
  let disposed = false;
  let operationQueue: Promise<void> = Promise.resolve();

  const assertRequestScope = (request: CoreProjectionRequestV1): void => {
    if (
      request.installRoot !== installRoot
      || request.stateRoot !== stateRoot
      || request.programRoot !== programRoot
      || request.target !== target
    ) {
      throw new Error("Core projection request does not match the current installation.");
    }
    const helperName = platform === "win32" ? "lyra-bootstrap.exe" : "lyra-bootstrap";
    const expectedHelper = path.join(
      helperRootFor(stateRoot),
      request.helperSha256,
      helperName
    );
    if (path.resolve(request.helperPath) !== path.resolve(expectedHelper)) {
      throw new Error("Core projection helper is outside its content-addressed store.");
    }
  };

  const mutate = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = operationQueue.then(operation, operation);
    operationQueue = result.then(() => undefined, () => undefined);
    return result;
  };

  const ensureRequest = async (
    releaseVersionOverride?: string
  ): Promise<CoreProjectionRequestV1 | null> => {
    const pendingVersion = await options.readPendingVersion();
    const existing = await readRequest(requestFile);
    if (existing !== null) {
      assertRequestScope(existing);
      if (pendingVersion === undefined) {
        await rm(requestFile, { force: true });
        return null;
      }
      if (
        existing.pendingVersion === pendingVersion
        && (releaseVersionOverride === undefined
          || existing.releaseVersion === releaseVersionOverride)
      ) {
        if (existing.status === "pending") {
          return existing;
        }
        if (
          existing.status === "spawned"
          && existing.spawnedByPid === currentPid
          && existing.spawnedBySessionId === sessionId
        ) {
          return existing;
        }
        const {
          failure: _failure,
          spawnedByPid: _spawnedByPid,
          spawnedBySessionId: _spawnedBySessionId,
          ...requestWithoutAttempt
        } = existing;
        const retryable: CoreProjectionRequestV1 = {
          ...requestWithoutAttempt,
          status: "pending"
        };
        await writeRequest(requestFile, retryable);
        return retryable;
      }
    }
    if (pendingVersion === undefined) {
      return null;
    }
    if (!SEMVER_PATTERN.test(pendingVersion)) {
      throw new Error("Pending Core version is invalid.");
    }
    const helper = await copyHelperOutsideProgram({
      sourcePath: await options.resolveBootstrapPath(),
      stateRoot,
      programRoot,
      platform
    });
    const request: CoreProjectionRequestV1 = {
      schemaVersion: REQUEST_SCHEMA_VERSION,
      requestId: randomUUID(),
      componentId: CORE_COMPONENT_ID,
      pendingVersion,
      releaseVersion: releaseVersionOverride ?? options.releaseVersion ?? pendingVersion,
      target,
      installRoot,
      stateRoot,
      programRoot,
      helperPath: helper.path,
      helperSha256: helper.sha256,
      createdAt: new Date().toISOString(),
      status: "pending"
    };
    await writeRequest(requestFile, request);
    return request;
  };

  const noteStaged = (report: ComponentUpdateReport): Promise<void> => mutate(async () => {
    if (!report.stagedComponents.includes(CORE_COMPONENT_ID)) {
      return;
    }
    await ensureRequest(report.releaseVersion);
  });

  const readStatus = (): Promise<CoreProjectionStatus> => mutate(async () => {
    try {
      const pendingVersion = await options.readPendingVersion();
      const request = await readRequest(requestFile);
      if (request !== null) {
        assertRequestScope(request);
      }
      if (pendingVersion === undefined) {
        if (request !== null) {
          await rm(requestFile, { force: true });
        }
        return toStatus(null);
      }
      if (request === null || request.pendingVersion !== pendingVersion) {
        return {
          state: "pending",
          componentId: CORE_COMPONENT_ID,
          pendingVersion
        };
      }
      if (
        request.status === "spawned"
        && (
          request.spawnedByPid !== currentPid
          || request.spawnedBySessionId !== sessionId
        )
      ) {
        return {
          state: "pending",
          componentId: CORE_COMPONENT_ID,
          pendingVersion,
          requestId: request.requestId
        };
      }
      return toStatus(request);
    } catch (error) {
      return {
        state: "failed",
        componentId: CORE_COMPONENT_ID,
        error: safeErrorMessage(error)
      };
    }
  });

  const applyAndQuit = (): Promise<CoreProjectionHandoff> => mutate(async () => {
    if (disposed) {
      throw new Error("Core projection coordinator is disposed.");
    }
    let request = await ensureRequest();
    if (request === null) {
      throw new Error("No pending Core update is available.");
    }
    if (request.status === "spawned") {
      return {
        ...toStatus(request),
        state: "spawned",
        helperPath: request.helperPath,
        args: []
      };
    }
    try {
      const helperMetadata = await lstat(request.helperPath);
      const resolvedHelper = await realpath(request.helperPath);
      assertOutsidePath(await realpath(programRoot), resolvedHelper, "helper");
      if (
        !helperMetadata.isFile()
        || helperMetadata.isSymbolicLink()
        || (await sha256File(request.helperPath)) !== request.helperSha256
      ) {
        throw new Error("Pending Core bootstrap helper failed integrity verification.");
      }
    } catch (error) {
      await writeRequest(requestFile, {
        ...request,
        status: "failed",
        failure: safeErrorMessage(error)
      });
      throw error;
    }
    const args = [
      "--apply-core",
      "--install-root", request.installRoot,
      "--state-root", request.stateRoot,
      "--target", request.target,
      "--program-root", request.programRoot,
      "--wait-pid", String(currentPid),
      "--wait-timeout-seconds", String(waitTimeoutSeconds)
    ];
    // Never opt into automatic replacement from a renderer request. The
    // compile-time Rust gate and platform signing attestation remain separate
    // release-only controls.
    let child: ChildProcess;
    try {
      child = spawnProcess(request.helperPath, args, {
        cwd: stateRoot,
        env: process.env,
        shell: false,
        detached: true,
        windowsHide: true,
        stdio: "ignore"
      }) as ChildProcess;
      await waitForChildSpawn(child);
    } catch (error) {
      const failedRequest: CoreProjectionRequestV1 = {
        ...request,
        status: "failed",
        failure: safeErrorMessage(error)
      };
      await writeRequest(requestFile, failedRequest);
      throw error;
    }
    const { failure: _ignoredFailure, ...requestWithoutFailure } = request;
    request = {
      ...requestWithoutFailure,
      status: "spawned",
      spawnedByPid: currentPid,
      spawnedBySessionId: sessionId
    };
    try {
      await writeRequest(requestFile, request);
    } catch (error) {
      child.kill("SIGTERM");
      throw error;
    }
    child.once("error", (error) => {
      console.error("[lyra-core-projection] detached bootstrap helper failed", error);
    });
    try {
      child.unref();
    } catch {
      // ChildProcess always supports unref; this protects narrow test doubles.
    }
    scheduleQuit(options.requestQuit);
    return {
      ...toStatus(request),
      state: "spawned",
      helperPath: request.helperPath,
      args
    };
  });

  return {
    noteStaged,
    readStatus,
    applyAndQuit,
    dispose: () => {
      disposed = true;
    }
  };
};

export { CORE_COMPONENT_ID };
