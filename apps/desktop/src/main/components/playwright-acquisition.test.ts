import { describe, expect, test, vi } from "vitest";

import type { ComponentUpdateReport } from "../../shared/desktop-bridge";
import {
  createPlaywrightResourceAcquisitionService,
  playwrightAcquisitionInternalsForTests
} from "./playwright-acquisition";
import type { InstalledComponentV1 } from "./registry";
import type { ResolvedResourceComponent } from "./resource-components";

const componentId = "lyra.resource.playwright";

const resource = {
  componentId,
  version: "1.2.3",
  installedAt: "2026-07-31T00:00:00.000Z",
  rootPath: "/components/playwright/1.2.3",
  entryPath: "/components/playwright/1.2.3/resource.json",
  runtimePath: "/components/playwright/1.2.3",
  family: "playwright",
  manifest: {}
} as unknown as ResolvedResourceComponent;

const report = (overrides: Partial<ComponentUpdateReport> = {}): ComponentUpdateReport => ({
  releaseVersion: "1.2.3",
  catalogSequence: 12,
  target: "darwin-arm64",
  installedComponents: [componentId],
  repairedComponents: [],
  stagedComponents: [componentId],
  deferredComponents: [],
  ...overrides
});

const createFixture = () => {
  const registry = {
    read: vi.fn<(componentId: string) => Promise<InstalledComponentV1 | null>>(async () => null)
  };
  const canonicalRegistry = {
    read: vi.fn(async () => ({
      activeReleaseVersion: "1.2.3",
      catalogSequence: 12
    }))
  };
  const manager = {
    resolveActive: vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue(resource),
    assertHealthy: vi.fn(async () => undefined)
  };
  const componentUpdate = {
    stageOnDemandFromActiveRelease: vi.fn(async () => report())
  };
  const resourceUpdate = {
    activatePending: vi.fn(),
    installOrRepairAtSafePoint: vi.fn(async (_id: string, install: () => Promise<unknown>) => ({
      component: { componentId, kind: "resource", active: "1.2.3" },
      result: await install()
    }))
  };
  const service = createPlaywrightResourceAcquisitionService({
    registry: registry as never,
    canonicalRegistry: canonicalRegistry as never,
    manager: manager as never,
    resourceUpdate: resourceUpdate as never,
    componentUpdate: componentUpdate as never,
    developmentFallback: false
  });
  return {
    service,
    registry,
    canonicalRegistry,
    manager,
    componentUpdate,
    resourceUpdate
  };
};

describe("Playwright signed first-use acquisition", () => {
  test("downloads only the active BOM component through the resource safe point", async () => {
    const fixture = createFixture();
    await expect(fixture.service.ensureAvailable()).resolves.toEqual({
      source: "signed-component",
      runtimePath: resource.runtimePath,
      version: "1.2.3",
      report: report()
    });
    expect(fixture.resourceUpdate.installOrRepairAtSafePoint)
      .toHaveBeenCalledWith(componentId, expect.any(Function));
    expect(fixture.componentUpdate.stageOnDemandFromActiveRelease).toHaveBeenCalledWith({
      componentId,
      releaseVersion: "1.2.3",
      catalogSequence: 12
    }, expect.any(Function));
  });

  test("coalesces concurrent first-use requests", async () => {
    const fixture = createFixture();
    const first = fixture.service.ensureAvailable();
    const second = fixture.service.ensureAvailable();
    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(fixture.componentUpdate.stageOnDemandFromActiveRelease).toHaveBeenCalledOnce();
  });

  test("repairs a staged package after activation health failure", async () => {
    const fixture = createFixture();
    fixture.registry.read.mockResolvedValue({
      componentId,
      kind: "resource",
      pending: "1.2.3",
      versions: {}
    });
    fixture.resourceUpdate.activatePending.mockRejectedValue(new Error("package is unhealthy"));
    fixture.manager.resolveActive.mockReset().mockResolvedValue(resource);

    await expect(fixture.service.ensureAvailable()).resolves.toMatchObject({
      source: "signed-component",
      version: "1.2.3"
    });
    expect(fixture.resourceUpdate.activatePending).toHaveBeenCalledWith(componentId);
    expect(fixture.resourceUpdate.installOrRepairAtSafePoint).toHaveBeenCalledOnce();
  });

  test("does not turn a safe-point coordination failure into a repair download", async () => {
    const fixture = createFixture();
    fixture.registry.read.mockResolvedValue({
      componentId,
      kind: "resource",
      pending: "1.2.3",
      versions: {}
    });
    const error = Object.assign(new Error("resource is busy"), {
      code: "RESOURCE_COMPONENT_BUSY"
    });
    fixture.resourceUpdate.activatePending.mockRejectedValue(error);

    await expect(fixture.service.ensureAvailable()).rejects.toBe(error);
    expect(fixture.resourceUpdate.installOrRepairAtSafePoint).not.toHaveBeenCalled();
  });

  test("keeps development fallback and never starts a signed download", async () => {
    const fixture = createFixture();
    const service = createPlaywrightResourceAcquisitionService({
      registry: fixture.registry as never,
      canonicalRegistry: fixture.canonicalRegistry as never,
      manager: fixture.manager as never,
      resourceUpdate: fixture.resourceUpdate as never,
      componentUpdate: fixture.componentUpdate as never,
      developmentFallback: true,
      readDevelopmentRuntimePath: () => "/repo/playwright-browsers"
    });
    await expect(service.ensureAvailable()).resolves.toEqual({
      source: "development-fallback",
      runtimePath: "/repo/playwright-browsers"
    });
    expect(fixture.componentUpdate.stageOnDemandFromActiveRelease).not.toHaveBeenCalled();
  });

  test("does not report an empty development fallback as available", async () => {
    const fixture = createFixture();
    const service = createPlaywrightResourceAcquisitionService({
      registry: fixture.registry as never,
      canonicalRegistry: fixture.canonicalRegistry as never,
      manager: fixture.manager as never,
      resourceUpdate: fixture.resourceUpdate as never,
      componentUpdate: fixture.componentUpdate as never,
      developmentFallback: true,
      readDevelopmentRuntimePath: () => "  "
    });
    await expect(service.ensureAvailable()).rejects.toThrow(
      "development fallback path is unavailable"
    );
  });

  test("rejects a bootstrap report that selected any other component", () => {
    expect(() => playwrightAcquisitionInternalsForTests.assertPinnedAcquisitionReport(
      report({ installedComponents: [componentId, "lyra.core"] }),
      "1.2.3",
      12
    )).toThrow("escaped the pinned active BOM selection");
  });
});
