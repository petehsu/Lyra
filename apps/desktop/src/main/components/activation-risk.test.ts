import type { ComponentManifestV1 } from "@lyra/app-runtime";
import { describe, expect, test } from "vitest";

import type { InstalledComponentV1 } from "./registry";
import { assessComponentActivation } from "./activation-risk";

const manifest = (
  version: string,
  overrides: Partial<ComponentManifestV1> = {}
): ComponentManifestV1 => ({
  schemaVersion: 1,
  componentId: "lyra.images",
  kind: "app",
  version,
  target: "darwin-arm64",
  entry: "index.js",
  executionClass: "first-party-shared-renderer",
  activation: "module-idle",
  hostApiRange: { minInclusive: "1.0.0", maxExclusive: "2.0.0" },
  dataSchema: { readerMin: 1, readerMax: 1, writer: 1 },
  permissions: ["host:open-resource"],
  publisher: "Lyra",
  files: [],
  keyId: "release-test",
  signature: "A".repeat(86) + "==",
  ...overrides
});

const component = (
  activeManifest: ComponentManifestV1,
  pendingManifest: ComponentManifestV1
): InstalledComponentV1 => ({
  componentId: "lyra.images",
  kind: "app",
  active: activeManifest.version,
  pending: pendingManifest.version,
  versions: {
    [activeManifest.version]: {
      manifest: activeManifest,
      installedAt: "2026-07-30T00:00:00.000Z",
      target: activeManifest.target
    },
    [pendingManifest.version]: {
      manifest: pendingManifest,
      installedAt: "2026-07-30T01:00:00.000Z",
      target: pendingManifest.target
    }
  }
});

describe("component activation risk assessment", () => {
  test("does not require confirmation for a compatible patch update", () => {
    expect(assessComponentActivation(component(manifest("1.0.0"), manifest("1.0.1"))))
      .toEqual({
        componentId: "lyra.images",
        activeVersion: "1.0.0",
        pendingVersion: "1.0.1",
        reasons: [],
        addedPermissions: [],
        requiresConfirmation: false
      });
  });

  test("reports every signed security and migration boundary", () => {
    const assessment = assessComponentActivation(component(
      manifest("1.0.0"),
      manifest("2.0.0", {
        publisher: "Different Publisher",
        permissions: ["host:open-resource", "host:filesystem"],
        executionClass: "sandboxed-web-wasi",
        hostApiRange: { minInclusive: "2.0.0", maxExclusive: "3.0.0" },
        dataSchema: { readerMin: 1, readerMax: 2, writer: 2 }
      })
    ));

    expect(new Set(assessment.reasons)).toEqual(new Set([
      "publisher-change",
      "permission-increase",
      "execution-class-change",
      "component-major-change",
      "host-api-major-change",
      "data-migration"
    ]));
    expect(assessment.addedPermissions).toEqual(["host:filesystem"]);
    expect(assessment.requiresConfirmation).toBe(true);
  });

  test("rejects a stale pending pointer before activation", () => {
    const value = component(manifest("1.0.0"), manifest("1.1.0"));
    expect(() => assessComponentActivation({
      ...value,
      versions: { "1.0.0": value.versions["1.0.0"]! }
    })).toThrow("Pending component version is missing");
  });
});
