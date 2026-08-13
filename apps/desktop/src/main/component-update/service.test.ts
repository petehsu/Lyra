import type { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  createComponentUpdateService,
  resolveComponentTarget,
  resolveVerifiedReleaseCatalogPath
} from "./service";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const executableFixture = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lyra-component-update-test-"));
  roots.push(root);
  const executable = path.join(
    root,
    process.platform === "win32" ? "lyra-bootstrap.exe" : "lyra-bootstrap"
  );
  await writeFile(executable, "fixture\n");
  if (process.platform !== "win32") {
    await chmod(executable, 0o755);
  }
  return executable;
};

const fakeChild = () => {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => true);
  return child;
};

const options = async (child: ReturnType<typeof fakeChild>) => {
  const executablePath = await executableFixture();
  const fixtureRoot = path.dirname(executablePath);
  const stateRoot = path.join(fixtureRoot, "state");
  const installRoot = path.join(fixtureRoot, "install");
  await mkdir(stateRoot, { recursive: true });
  const spawnProcess = vi.fn((..._args: Parameters<typeof spawn>) => child);
  const onTrustUpdated = vi.fn(async () => undefined);
  return {
    service: createComponentUpdateService({
      installRoot,
      stateRoot,
      trustedRoots: { rawBase64: { "root-1": "A".repeat(43) + "=" }, pem: {} },
      catalogUrls: { preview: "https://releases.lyra.ltd/preview/catalog.json" },
      executablePath,
      spawnProcess: spawnProcess as unknown as typeof spawn,
      onTrustUpdated
    }),
    spawnProcess,
    onTrustUpdated,
    stateRoot,
    installRoot
  };
};

describe("component update service", () => {
  test("checks a signed release without staging components", async () => {
    const child = fakeChild();
    const fixture = await options(child);
    const pending = fixture.service.check("preview");
    await vi.waitFor(() => expect(fixture.spawnProcess).toHaveBeenCalledOnce());
    child.stdout.write(JSON.stringify({
      type: "check",
      report: {
        releaseVersion: "1.2.3",
        catalogSequence: 12,
        target: resolveComponentTarget(process.platform, process.arch)
      }
    }));
    child.emit("exit", 0, null);

    await expect(pending).resolves.toMatchObject({ releaseVersion: "1.2.3" });
    const args = fixture.spawnProcess.mock.calls[0]?.[1] as string[];
    expect(args).toContain("--check-only");
    expect(args).not.toContain("--json-progress");
    expect(fixture.onTrustUpdated).not.toHaveBeenCalled();
  });

  test("parses bootstrap JSONL progress and completion before refreshing trust", async () => {
    const child = fakeChild();
    const fixture = await options(child);
    const progress = vi.fn();
    const pending = fixture.service.stage({ channel: "preview", releaseVersion: "1.2.3" }, progress);
    await vi.waitFor(() => expect(fixture.spawnProcess).toHaveBeenCalledOnce());
    child.stdout.write(`${JSON.stringify({
      type: "progress",
      progress: {
        phase: "download",
        componentId: "lyra.images",
        completed: 4,
        total: 10,
        completedComponents: 0,
        totalComponents: 1
      }
    })}\n`);
    child.stdout.write(`${JSON.stringify({
      type: "complete",
      report: {
        releaseVersion: "1.2.3",
        catalogSequence: 12,
        target: resolveComponentTarget(process.platform, process.arch),
        installedComponents: [],
        repairedComponents: [],
        stagedComponents: ["lyra.images"],
        deferredComponents: []
      }
    })}\n`);
    child.emit("exit", 0, null);

    await expect(pending).resolves.toMatchObject({
      releaseVersion: "1.2.3",
      stagedComponents: ["lyra.images"]
    });
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ phase: "download", completed: 4 }));
    expect(fixture.onTrustUpdated).toHaveBeenCalledOnce();
    const args = fixture.spawnProcess.mock.calls[0]?.[1] as string[];
    expect(args).toContain("--json-progress");
    expect(args).toContain("root-1=" + "A".repeat(43) + "=");
    expect(args).toContain("1.2.3");
  });

  test("cancels the active bootstrap process and reports its termination", async () => {
    const child = fakeChild();
    const fixture = await options(child);
    const pending = fixture.service.stage({ channel: "preview" }, vi.fn());
    await vi.waitFor(() => expect(fixture.spawnProcess).toHaveBeenCalledOnce());

    fixture.service.cancel();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    child.emit("exit", null, "SIGTERM");
    await expect(pending).rejects.toThrow("Component update failed (SIGTERM)");
  });

  test("rejects malformed JSONL and force-stops the bootstrap process", async () => {
    const child = fakeChild();
    const fixture = await options(child);
    const pending = fixture.service.stage({ channel: "preview" }, vi.fn());
    await vi.waitFor(() => expect(fixture.spawnProcess).toHaveBeenCalledOnce());

    child.stdout.write("{not-json}\n");

    await expect(pending).rejects.toThrow();
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  test("rejects impossible progress counters from the bootstrap process", async () => {
    const child = fakeChild();
    const fixture = await options(child);
    const pending = fixture.service.stage({ channel: "preview" }, vi.fn());
    await vi.waitFor(() => expect(fixture.spawnProcess).toHaveBeenCalledOnce());
    child.stdout.write(`${JSON.stringify({
      type: "progress",
      progress: {
        phase: "download",
        completed: 11,
        total: 10,
        completedComponents: 0,
        totalComponents: 1
      }
    })}\n`);

    await expect(pending).rejects.toThrow("Bootstrap progress fields are invalid");
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  test("rejects a bootstrap completion report for another target", async () => {
    const child = fakeChild();
    const fixture = await options(child);
    const currentTarget = resolveComponentTarget(process.platform, process.arch);
    const wrongTarget = currentTarget === "linux-x64" ? "linux-arm64" : "linux-x64";
    const pending = fixture.service.stage({ channel: "preview" }, vi.fn());
    await vi.waitFor(() => expect(fixture.spawnProcess).toHaveBeenCalledOnce());
    child.stdout.write(`${JSON.stringify({
      type: "complete",
      report: {
        releaseVersion: "1.2.3",
        catalogSequence: 12,
        target: wrongTarget,
        installedComponents: [],
        repairedComponents: [],
        stagedComponents: [],
        deferredComponents: []
      }
    })}\n`);

    await expect(pending).rejects.toThrow("report target mismatch");
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  test("includes bounded bootstrap stderr when the process fails", async () => {
    const child = fakeChild();
    const fixture = await options(child);
    const pending = fixture.service.stage({ channel: "preview" }, vi.fn());
    await vi.waitFor(() => expect(fixture.spawnProcess).toHaveBeenCalledOnce());
    child.stderr.write("catalog signature verification failed\n");
    child.emit("exit", 2, null);

    await expect(pending).rejects.toThrow("catalog signature verification failed");
    expect(fixture.onTrustUpdated).not.toHaveBeenCalled();
  });

  test("rejects a valid-shaped report for a different platform target", async () => {
    const child = fakeChild();
    const fixture = await options(child);
    const requestedTarget = resolveComponentTarget(process.platform, process.arch);
    const wrongTarget = requestedTarget === "darwin-arm64" ? "darwin-x64" : "darwin-arm64";
    const pending = fixture.service.stage({ channel: "preview" }, vi.fn());
    await vi.waitFor(() => expect(fixture.spawnProcess).toHaveBeenCalledOnce());
    child.stdout.write(`${JSON.stringify({
      type: "complete",
      report: {
        releaseVersion: "1.2.3",
        catalogSequence: 12,
        target: wrongTarget,
        installedComponents: [],
        repairedComponents: [],
        stagedComponents: [],
        deferredComponents: []
      }
    })}\n`);
    child.emit("exit", 0, null);

    await expect(pending).rejects.toThrow(
      `does not match requested target ${requestedTarget}`
    );
    expect(fixture.onTrustUpdated).not.toHaveBeenCalled();
  });

  test("acquires one on-demand component only from the active release receipt", async () => {
    const child = fakeChild();
    const fixture = await options(child);
    const target = resolveComponentTarget(process.platform, process.arch);
    const catalogPath = resolveVerifiedReleaseCatalogPath({
      stateRoot: fixture.stateRoot,
      target,
      releaseVersion: "1.2.3",
      catalogSequence: 12
    });
    await mkdir(path.dirname(catalogPath), { recursive: true });
    await writeFile(catalogPath, "signed catalog fixture\n");

    const pending = fixture.service.stageOnDemandFromActiveRelease({
      componentId: "lyra.resource.playwright",
      releaseVersion: "1.2.3",
      catalogSequence: 12
    }, vi.fn());
    await vi.waitFor(() => expect(fixture.spawnProcess).toHaveBeenCalledOnce());
    child.stdout.write(`${JSON.stringify({
      type: "complete",
      report: {
        releaseVersion: "1.2.3",
        catalogSequence: 12,
        target,
        installedComponents: ["lyra.resource.playwright"],
        repairedComponents: [],
        stagedComponents: ["lyra.resource.playwright"],
        deferredComponents: []
      }
    })}\n`);
    child.emit("exit", 0, null);

    await expect(pending).resolves.toMatchObject({
      installedComponents: ["lyra.resource.playwright"]
    });
    const args = fixture.spawnProcess.mock.calls[0]?.[1] as string[];
    expect(args).toEqual(expect.arrayContaining([
      "--catalog", await realpath(catalogPath),
      "--release", "1.2.3",
      "--on-demand-component", "lyra.resource.playwright",
      "--expected-catalog-sequence", "12"
    ]));
    expect(args).not.toContain("https://releases.lyra.ltd/preview/catalog.json");
  });

  test("fails closed when the active release has no verified receipt", async () => {
    const child = fakeChild();
    const fixture = await options(child);
    await expect(fixture.service.stageOnDemandFromActiveRelease({
      componentId: "lyra.resource.playwright",
      releaseVersion: "1.2.3",
      catalogSequence: 12
    }, vi.fn())).rejects.toThrow("no verified Catalog/BOM receipt");
    expect(fixture.spawnProcess).not.toHaveBeenCalled();
  });
});
