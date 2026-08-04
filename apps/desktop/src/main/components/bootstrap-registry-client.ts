import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

const COMPONENT_ID_PATTERN = /^[a-z0-9._-]{1,128}$/u;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const MAX_REGISTRY_OUTPUT_BYTES = 4 * 1024 * 1024 + 1;
const MAX_ERROR_BYTES = 128 * 1024;

export type BootstrapActivationStateV1 = {
  readonly active?: string;
  readonly previous?: string;
  readonly pending?: string;
};

export type BootstrapActivationRegistryV1 = {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly keyringSequence: number;
  readonly catalogSequence: number;
  readonly target: string;
  readonly activeReleaseVersion?: string;
  readonly pendingReleaseVersion?: string;
  readonly components: Readonly<Record<string, BootstrapActivationStateV1>>;
};

export type CanonicalActivationRegistryClient = {
  readonly read: () => Promise<BootstrapActivationRegistryV1>;
  readonly readRevision: (revision: number) => Promise<BootstrapActivationRegistryV1>;
  readonly activate: (request: {
    readonly componentId: string;
    readonly expectedRevision: number;
    readonly expectedPending: string;
  }) => Promise<BootstrapActivationRegistryV1>;
  readonly rollback: (request: {
    readonly componentId: string;
    readonly expectedRevision: number;
    readonly expectedPrevious: string;
  }) => Promise<BootstrapActivationRegistryV1>;
  readonly restore: (request: {
    readonly componentId: string;
    readonly expectedRevision: number;
    readonly sourceRevision: number;
  }) => Promise<BootstrapActivationRegistryV1>;
};

type BootstrapRegistryClientOptions = {
  readonly installRoot: string;
  readonly stateRoot: string;
  readonly target: string;
  readonly resolveExecutablePath: () => Promise<string>;
  readonly cwd?: string;
  readonly spawnProcess?: typeof spawn;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOnlyKeys = (
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[]
): boolean => Object.keys(value).every((key) => allowed.includes(key));

const optionalSemver = (
  value: Readonly<Record<string, unknown>>,
  key: string
): boolean => value[key] === undefined
  || (typeof value[key] === "string" && SEMVER_PATTERN.test(value[key]));

export const parseBootstrapActivationRegistry = (
  value: unknown,
  expectedTarget?: string
): BootstrapActivationRegistryV1 => {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "schemaVersion",
    "revision",
    "keyringSequence",
    "catalogSequence",
    "target",
    "activeReleaseVersion",
    "pendingReleaseVersion",
    "components"
  ])) {
    throw new Error("Bootstrap activation registry is invalid.");
  }
  if (
    value.schemaVersion !== 1
    || !Number.isSafeInteger(value.revision)
    || (value.revision as number) < 0
    || !Number.isSafeInteger(value.keyringSequence)
    || (value.keyringSequence as number) < 0
    || !Number.isSafeInteger(value.catalogSequence)
    || (value.catalogSequence as number) < 0
    || typeof value.target !== "string"
    || (expectedTarget !== undefined && value.target !== expectedTarget)
    || !optionalSemver(value, "activeReleaseVersion")
    || !optionalSemver(value, "pendingReleaseVersion")
    || !isRecord(value.components)
  ) {
    throw new Error("Bootstrap activation registry fields are invalid.");
  }
  for (const [componentId, state] of Object.entries(value.components)) {
    if (
      !COMPONENT_ID_PATTERN.test(componentId)
      || !isRecord(state)
      || !hasOnlyKeys(state, ["active", "previous", "pending"])
      || !optionalSemver(state, "active")
      || !optionalSemver(state, "previous")
      || !optionalSemver(state, "pending")
    ) {
      throw new Error(`Bootstrap activation pointer is invalid: ${componentId}`);
    }
  }
  return value as unknown as BootstrapActivationRegistryV1;
};

const validateComponentMutation = (
  componentId: string,
  expectedRevision: number,
  expectedVersion?: string
): void => {
  if (!COMPONENT_ID_PATTERN.test(componentId)) {
    throw new Error("Bootstrap registry component ID is invalid.");
  }
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw new Error("Bootstrap registry expected revision is invalid.");
  }
  if (expectedVersion !== undefined && !SEMVER_PATTERN.test(expectedVersion)) {
    throw new Error("Bootstrap registry expected version is invalid.");
  }
};

export const createCanonicalActivationRegistryClient = (
  options: BootstrapRegistryClientOptions
): CanonicalActivationRegistryClient => {
  const spawnProcess = options.spawnProcess ?? spawn;

  const run = async (args: readonly string[]): Promise<BootstrapActivationRegistryV1> => {
    const executablePath = await options.resolveExecutablePath();
    const child: ChildProcessByStdio<null, Readable, Readable> = spawnProcess(
      executablePath,
      [
        ...args,
        "--install-root", options.installRoot,
        "--state-root", options.stateRoot,
        "--target", options.target
      ],
      {
        cwd: options.cwd ?? process.cwd(),
        env: process.env,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    return await new Promise<BootstrapActivationRegistryV1>((resolve, reject) => {
      let stdout = Buffer.alloc(0);
      let stderr = "";
      let settled = false;
      const fail = (error: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        child.kill("SIGKILL");
        reject(error);
      };
      child.stdout.on("data", (chunk: Buffer | string) => {
        stdout = Buffer.concat([stdout, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
        if (stdout.length > MAX_REGISTRY_OUTPUT_BYTES) {
          fail(new Error("Bootstrap activation registry output exceeded its limit."));
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr = `${stderr}${chunk}`.slice(-MAX_ERROR_BYTES);
      });
      child.once("error", fail);
      child.once("exit", (code, signal) => {
        if (settled) {
          return;
        }
        settled = true;
        if (code !== 0) {
          reject(new Error(
            `Bootstrap activation registry operation failed (${signal ?? code ?? "unknown"}): `
            + `${stderr.trim() || "no detail"}`
          ));
          return;
        }
        try {
          resolve(parseBootstrapActivationRegistry(JSON.parse(stdout.toString("utf8")), options.target));
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  };

  return {
    read: () => run(["--registry-action", "read"]),
    readRevision: (revision) => {
      if (!Number.isSafeInteger(revision) || revision < 1) {
        throw new Error("Bootstrap registry revision is invalid.");
      }
      return run([
        "--registry-action", "read-revision",
        "--registry-revision", String(revision)
      ]);
    },
    activate: (request) => {
      validateComponentMutation(
        request.componentId,
        request.expectedRevision,
        request.expectedPending
      );
      return run([
        "--registry-action", "activate",
        "--component-id", request.componentId,
        "--expected-revision", String(request.expectedRevision),
        "--expected-version", request.expectedPending
      ]);
    },
    rollback: (request) => {
      validateComponentMutation(
        request.componentId,
        request.expectedRevision,
        request.expectedPrevious
      );
      return run([
        "--registry-action", "rollback",
        "--component-id", request.componentId,
        "--expected-revision", String(request.expectedRevision),
        "--expected-version", request.expectedPrevious
      ]);
    },
    restore: (request) => {
      validateComponentMutation(request.componentId, request.expectedRevision);
      if (
        !Number.isSafeInteger(request.sourceRevision)
        || request.sourceRevision < 1
        || request.sourceRevision + 1 !== request.expectedRevision
      ) {
        throw new Error("Bootstrap registry restore revision is invalid.");
      }
      return run([
        "--registry-action", "restore",
        "--component-id", request.componentId,
        "--expected-revision", String(request.expectedRevision),
        "--restore-revision", String(request.sourceRevision)
      ]);
    }
  };
};
