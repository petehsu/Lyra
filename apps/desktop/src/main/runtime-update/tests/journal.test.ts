import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import type {
  ComponentRegistryStore,
  InstalledComponentV1
} from "../../components/registry";
import {
  createRuntimeUpdateJournal,
  recoverInterruptedRuntimeUpdate
} from "../journal";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const createRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lyra-runtime-journal-"));
  roots.push(root);
  return root;
};

const runtimeComponent = (
  active: string,
  previous: string
): InstalledComponentV1 => ({
  componentId: "lyra.runtime",
  kind: "runtime",
  active,
  previous,
  versions: {}
});

const fakeRegistry = ({
  current,
  restored
}: {
  readonly current: InstalledComponentV1;
  readonly restored?: InstalledComponentV1;
}) => ({
  read: vi.fn(async () => current),
  rollback: vi.fn(async () => restored ?? current),
  verifyInstalledVersion: vi.fn(async () => ({}) as never)
}) as unknown as ComponentRegistryStore;

describe("runtime update recovery journal", () => {
  test("persists phase changes and clears a completed operation", async () => {
    const root = await createRoot();
    const journal = createRuntimeUpdateJournal(root);
    await journal.begin({ fromVersion: "1.0.0", targetVersion: "1.1.0" });
    await journal.setPhase("health-check");

    expect(await createRuntimeUpdateJournal(root).read()).toMatchObject({
      fromVersion: "1.0.0",
      targetVersion: "1.1.0",
      phase: "health-check"
    });

    await journal.setPhase("complete");
    await recoverInterruptedRuntimeUpdate({
      journal: createRuntimeUpdateJournal(root),
      registry: fakeRegistry({ current: runtimeComponent("1.1.0", "1.0.0") })
    });
    await expect(access(path.join(root, "runtime-update.v1.json"))).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  test("rolls back when Core stopped after activation but before confirmation", async () => {
    const root = await createRoot();
    const journal = createRuntimeUpdateJournal(root);
    await journal.begin({ fromVersion: "1.0.0", targetVersion: "1.1.0" });
    await journal.setPhase("restarting");
    const restored = runtimeComponent("1.0.0", "1.1.0");
    const registry = fakeRegistry({
      current: runtimeComponent("1.1.0", "1.0.0"),
      restored
    });

    await recoverInterruptedRuntimeUpdate({ journal, registry });

    expect(registry.rollback).toHaveBeenCalledWith("lyra.runtime");
    expect(registry.verifyInstalledVersion).toHaveBeenCalledWith("lyra.runtime", "1.0.0");
    expect(await journal.read()).toBeNull();
  });

  test("fails closed when registry pointers do not match the recorded operation", async () => {
    const root = await createRoot();
    const journal = createRuntimeUpdateJournal(root);
    await journal.begin({ fromVersion: "1.0.0", targetVersion: "1.1.0" });
    const registry = fakeRegistry({ current: runtimeComponent("2.0.0", "1.1.0") });

    await expect(recoverInterruptedRuntimeUpdate({ journal, registry }))
      .rejects.toThrow("unexpected pointers");
    expect(await journal.read()).not.toBeNull();
  });
});
