import type { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, test, vi } from "vitest";

import {
  createCanonicalActivationRegistryClient,
  parseBootstrapActivationRegistry
} from "./bootstrap-registry-client";

const target = "darwin-arm64";

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

const createFixture = (child: ReturnType<typeof fakeChild>) => {
  const spawnProcess = vi.fn((..._args: Parameters<typeof spawn>) => child);
  return {
    client: createCanonicalActivationRegistryClient({
      installRoot: "/scope/components",
      stateRoot: "/scope/state",
      target,
      resolveExecutablePath: async () => "/helpers/lyra-bootstrap",
      spawnProcess: spawnProcess as unknown as typeof spawn
    }),
    spawnProcess
  };
};

const projection = {
  schemaVersion: 1,
  revision: 8,
  keyringSequence: 3,
  catalogSequence: 9,
  target,
  activeReleaseVersion: "1.0.0",
  pendingReleaseVersion: "1.1.0",
  components: {
    "lyra.images": {
      active: "1.0.0",
      pending: "1.1.0"
    }
  }
} as const;

describe("canonical activation registry client", () => {
  test("fails closed when the packaged bootstrap helper cannot be resolved", async () => {
    const client = createCanonicalActivationRegistryClient({
      installRoot: "/scope/components",
      stateRoot: "/scope/state",
      target,
      resolveExecutablePath: async () => {
        throw new Error("Packaged Lyra bootstrap executable is unavailable.");
      }
    });

    await expect(client.read()).rejects.toThrow(
      "Packaged Lyra bootstrap executable is unavailable"
    );
  });

  test("invokes the internal helper with race and pointer preconditions", async () => {
    const child = fakeChild();
    const fixture = createFixture(child);
    const pending = fixture.client.activate({
      componentId: "lyra.images",
      expectedRevision: 8,
      expectedPending: "1.1.0"
    });
    await vi.waitFor(() => expect(fixture.spawnProcess).toHaveBeenCalledOnce());
    child.stdout.end(`${JSON.stringify(projection)}\n`);
    child.emit("exit", 0, null);

    await expect(pending).resolves.toEqual(projection);
    expect(fixture.spawnProcess).toHaveBeenCalledWith(
      "/helpers/lyra-bootstrap",
      [
        "--registry-action", "activate",
        "--component-id", "lyra.images",
        "--expected-revision", "8",
        "--expected-version", "1.1.0",
        "--install-root", "/scope/components",
        "--state-root", "/scope/state",
        "--target", target
      ],
      expect.objectContaining({ shell: false, windowsHide: true })
    );
  });

  test("validates historical reads before restore", async () => {
    const child = fakeChild();
    const fixture = createFixture(child);
    const pending = fixture.client.readRevision(8);
    await vi.waitFor(() => expect(fixture.spawnProcess).toHaveBeenCalledOnce());
    child.stdout.end(`${JSON.stringify(projection)}\n`);
    child.emit("exit", 0, null);

    await expect(pending).resolves.toMatchObject({ revision: 8 });
    expect(fixture.spawnProcess.mock.calls[0]?.[1]).toEqual([
      "--registry-action", "read-revision",
      "--registry-revision", "8",
      "--install-root", "/scope/components",
      "--state-root", "/scope/state",
      "--target", target
    ]);
    expect(() => fixture.client.restore({
      componentId: "lyra.images",
      expectedRevision: 10,
      sourceRevision: 8
    })).toThrow("restore revision is invalid");
  });

  test("rejects malformed or unbounded helper output", async () => {
    expect(() => parseBootstrapActivationRegistry({
      ...projection,
      components: { "Lyra.Images": { pending: "1.1.0" } }
    }, target)).toThrow("pointer is invalid");

    const child = fakeChild();
    const fixture = createFixture(child);
    const pending = fixture.client.read();
    await vi.waitFor(() => expect(fixture.spawnProcess).toHaveBeenCalledOnce());
    child.stdout.write(Buffer.alloc(4 * 1024 * 1024 + 2));

    await expect(pending).rejects.toThrow("output exceeded its limit");
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });
});
