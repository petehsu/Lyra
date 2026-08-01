import { EventEmitter } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ChildProcess, spawn } from "node:child_process";

import { afterEach, describe, expect, test, vi } from "vitest";

import type { ComponentUpdateReport } from "../../shared/desktop-bridge";
import {
  createCoreProjectionCoordinator,
  resolveDesktopProgramRoot,
  type CoreProjectionCoordinatorOptions
} from "./core-projection";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true
  })));
  vi.restoreAllMocks();
});

const report = (
  releaseVersion: string,
  stagedComponents: readonly string[] = ["lyra.core"]
): ComponentUpdateReport => ({
  releaseVersion,
  catalogSequence: 1,
  target: "darwin-arm64",
  installedComponents: [],
  repairedComponents: [],
  stagedComponents,
  deferredComponents: []
});

const childProcess = (outcome: "spawn" | "error" = "spawn"): ChildProcess => {
  const child = new EventEmitter() as ChildProcess;
  child.unref = vi.fn(() => child);
  child.kill = vi.fn(() => true);
  queueMicrotask(() => {
    if (outcome === "spawn") {
      child.emit("spawn");
    } else {
      child.emit("error", new Error("exec denied"));
    }
  });
  return child;
};

const createFixture = async ({
  pendingVersion = "2.0.0",
  currentPid = 4242,
  spawnProcess,
  requestQuit = vi.fn(),
  scheduleQuit = vi.fn()
}: {
  readonly pendingVersion?: string | undefined;
  readonly currentPid?: number;
  readonly spawnProcess?: typeof spawn;
  readonly requestQuit?: () => void;
  readonly scheduleQuit?: (callback: () => void) => void;
} = {}) => {
  const root = await mkdtemp(path.join(tmpdir(), "lyra-core-projection-"));
  temporaryRoots.push(root);
  const installRoot = path.join(root, "install");
  const stateRoot = path.join(root, "state");
  const programRoot = path.join(root, "Lyra.app");
  const helperSource = path.join(root, "native", "lyra-bootstrap");
  await Promise.all([
    mkdir(installRoot, { recursive: true }),
    mkdir(stateRoot, { recursive: true }),
    mkdir(programRoot, { recursive: true }),
    mkdir(path.dirname(helperSource), { recursive: true })
  ]);
  await writeFile(helperSource, "verified helper\n", "utf8");
  await chmod(helperSource, 0o755);
  let registryPending: string | undefined = pendingVersion;
  const options: CoreProjectionCoordinatorOptions = {
    installRoot,
    stateRoot,
    programRoot,
    target: "darwin-arm64",
    platform: "darwin",
    currentPid,
    resolveBootstrapPath: async () => helperSource,
    readPendingVersion: async () => registryPending,
    requestQuit,
    scheduleQuit,
    spawnProcess: spawnProcess ?? (vi.fn(() => childProcess()) as unknown as typeof spawn)
  };
  return {
    coordinator: createCoreProjectionCoordinator(options),
    helperSource,
    installRoot,
    stateRoot,
    programRoot,
    requestQuit,
    scheduleQuit,
    setPendingVersion: (value: string | undefined) => {
      registryPending = value;
    },
    requestPath: path.join(stateRoot, "core-projection", "pending.v1.json")
  };
};

describe("Core projection coordinator", () => {
  test("copies a verified helper outside Core and hands off once before scheduling quit", async () => {
    const spawnProcess = vi.fn(() => childProcess()) as unknown as typeof spawn;
    const fixture = await createFixture({ spawnProcess });

    await fixture.coordinator.noteStaged(report("2.0.0"));
    const pending = await fixture.coordinator.readStatus();
    expect(pending).toMatchObject({ state: "pending", pendingVersion: "2.0.0" });

    const [first, second] = await Promise.all([
      fixture.coordinator.applyAndQuit(),
      fixture.coordinator.applyAndQuit()
    ]);
    expect(first.state).toBe("spawned");
    expect(second.state).toBe("spawned");
    expect(spawnProcess).toHaveBeenCalledOnce();
    expect(first.helperPath.startsWith(`${fixture.stateRoot}${path.sep}`)).toBe(true);
    expect(first.helperPath.startsWith(`${fixture.programRoot}${path.sep}`)).toBe(false);
    expect(first.args).toContain("--wait-pid");
    expect(first.args).toContain("4242");
    expect(first.args).not.toContain("--automatic-core-replacement");
    expect(fixture.requestQuit).not.toHaveBeenCalled();
    expect(fixture.scheduleQuit).toHaveBeenCalledOnce();

    const scheduledQuit = vi.mocked(fixture.scheduleQuit).mock.calls[0]?.[0];
    scheduledQuit?.();
    expect(fixture.requestQuit).toHaveBeenCalledOnce();

    const persisted = JSON.parse(await readFile(fixture.requestPath, "utf8")) as {
      readonly helperPath: string;
      readonly helperSha256: string;
      readonly spawnedByPid: number;
      readonly status: string;
    };
    expect(persisted).toMatchObject({ status: "spawned", spawnedByPid: 4242 });
    expect(persisted.helperPath).toBe(first.helperPath);
    expect(persisted.helperSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  test("records an asynchronous spawn failure and permits an explicit retry", async () => {
    let attempt = 0;
    const spawnProcess = vi.fn(
      () => childProcess(attempt++ === 0 ? "error" : "spawn")
    ) as unknown as typeof spawn;
    const fixture = await createFixture({ spawnProcess });
    await fixture.coordinator.noteStaged(report("2.0.0"));

    await expect(fixture.coordinator.applyAndQuit()).rejects.toThrow("exec denied");
    await expect(fixture.coordinator.readStatus()).resolves.toMatchObject({
      state: "failed",
      pendingVersion: "2.0.0",
      error: "exec denied"
    });
    expect(fixture.scheduleQuit).not.toHaveBeenCalled();

    await expect(fixture.coordinator.applyAndQuit()).resolves.toMatchObject({
      state: "spawned",
      pendingVersion: "2.0.0"
    });
    expect(spawnProcess).toHaveBeenCalledTimes(2);
    expect(fixture.scheduleQuit).toHaveBeenCalledOnce();
  });

  test("removes a completed request after the registry clears pending Core", async () => {
    const fixture = await createFixture();
    await fixture.coordinator.noteStaged(report("2.0.0"));
    await fixture.coordinator.applyAndQuit();

    fixture.setPendingVersion(undefined);
    await expect(fixture.coordinator.readStatus()).resolves.toEqual({
      state: "idle",
      componentId: "lyra.core"
    });
    await expect(readFile(fixture.requestPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("replaces an old handoff for a new pending version and retries it in a later process", async () => {
    const firstSpawn = vi.fn(() => childProcess()) as unknown as typeof spawn;
    const fixture = await createFixture({ currentPid: 100, spawnProcess: firstSpawn });
    await fixture.coordinator.noteStaged(report("2.0.0"));
    const oldHandoff = await fixture.coordinator.applyAndQuit();

    const laterSpawn = vi.fn(() => childProcess()) as unknown as typeof spawn;
    const laterCoordinator = createCoreProjectionCoordinator({
      installRoot: fixture.installRoot,
      stateRoot: fixture.stateRoot,
      programRoot: fixture.programRoot,
      target: "darwin-arm64",
      platform: "darwin",
      currentPid: 101,
      resolveBootstrapPath: async () => fixture.helperSource,
      readPendingVersion: async () => "2.0.0",
      spawnProcess: laterSpawn,
      scheduleQuit: vi.fn(),
      requestQuit: vi.fn()
    });
    await expect(laterCoordinator.readStatus()).resolves.toMatchObject({
      state: "pending",
      pendingVersion: "2.0.0"
    });
    await laterCoordinator.applyAndQuit();
    expect(laterSpawn).toHaveBeenCalledOnce();

    fixture.setPendingVersion("3.0.0");
    await fixture.coordinator.noteStaged(report("3.0.0"));
    const next = await fixture.coordinator.readStatus();
    expect(next).toMatchObject({ state: "pending", pendingVersion: "3.0.0" });
    expect(next.requestId).not.toBe(oldHandoff.requestId);
  });
});

describe("resolveDesktopProgramRoot", () => {
  test("selects the app bundle on macOS and executable directory elsewhere", () => {
    expect(resolveDesktopProgramRoot({
      platform: "darwin",
      executablePath: "/Applications/Lyra.app/Contents/MacOS/Lyra"
    })).toBe("/Applications/Lyra.app");
    expect(resolveDesktopProgramRoot({
      platform: "win32",
      executablePath: "/Program Files/Lyra/Lyra.exe"
    })).toBe("/Program Files/Lyra");
  });
});
