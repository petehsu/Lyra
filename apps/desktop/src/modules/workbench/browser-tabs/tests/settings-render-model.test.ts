import { describe, expect, test } from "vitest";

import {
  buildSettingsCategoryDomId,
  createSettingsSurfaceModel,
  type SettingsInlineStatusActionControlDescriptor
} from "../settings-render-model";
import { createBrowserSettingsSurfaceProps } from "./settings-test-helpers";

const findSection = (
  model: ReturnType<typeof createSettingsSurfaceModel>,
  sectionId: string
) =>
  model.categories
    .flatMap((category) => category.sections)
    .find((section) => section.id === sectionId);

describe("createSettingsSurfaceModel", () => {
  test("keeps settings categories ready for renderer replacement", () => {
    const model = createSettingsSurfaceModel(createBrowserSettingsSurfaceProps());

    expect(model.categories.map((category) => category.id)).toEqual([
      "general",
      "appearance",
      "workspace",
      "notifications",
      "search",
      "ai"
    ]);
    expect(model.categories.map((category) => category.domId)).toEqual([
      buildSettingsCategoryDomId("general"),
      buildSettingsCategoryDomId("appearance"),
      buildSettingsCategoryDomId("workspace"),
      buildSettingsCategoryDomId("notifications"),
      buildSettingsCategoryDomId("search"),
      buildSettingsCategoryDomId("ai")
    ]);
  });

  test("omits hidden sections before they reach the renderer", () => {
    const singlePackModel = createSettingsSurfaceModel(createBrowserSettingsSurfaceProps());
    const multiPackModel = createSettingsSurfaceModel(
      createBrowserSettingsSurfaceProps({
        uiStyleOptions: [
          { value: "classic", label: "Classic" },
          { value: "classic", label: "Classic alt" }
        ]
      })
    );

    expect(findSection(singlePackModel, "uiStyle")).toBeUndefined();
    expect(findSection(multiPackModel, "uiStyle")?.label).toBe("UI style");
  });

  test("describes search indexing as toggles plus a pending action", () => {
    const model = createSettingsSurfaceModel(
      createBrowserSettingsSurfaceProps({
        searchRebuildIndexPending: true,
        searchIndexStatusValue: "indexing"
      })
    );
    const section = findSection(model, "searchIndexingFlags");

    expect(section?.cluster).toBe(true);
    expect(section?.controls.map((control) => control.kind)).toEqual([
      "toggle-group",
      "inline-status-action"
    ]);

    const action = section?.controls.find(
      (control): control is SettingsInlineStatusActionControlDescriptor =>
        control.kind === "inline-status-action"
    );

    expect(action?.statusValue).toBe("indexing");
    expect(action?.actionLabel).toBe("Rebuild...");
    expect(action?.actionDisabled).toBe(true);
  });

  test("keeps AI provider settings as a custom renderer passthrough", () => {
    const model = createSettingsSurfaceModel(createBrowserSettingsSurfaceProps());
    const section = findSection(model, "aiProviderSettings");

    expect(section?.frame).toBe("none");
    expect(section?.controls).toHaveLength(1);
    expect(section?.controls[0]?.kind).toBe("custom");
  });

  test("does not expose AI tool display mode settings", () => {
    const model = createSettingsSurfaceModel(createBrowserSettingsSurfaceProps());

    expect(findSection(model, "aiToolDisplayMode")).toBeUndefined();
  });

  test("shows Linux compatibility sections only when Linux status is available", () => {
    const model = createSettingsSurfaceModel(createBrowserSettingsSurfaceProps({
      linuxCompatVisible: true,
      linuxCompatStatus: {
        platform: "linux",
        enabled: true,
        profile: "reliable",
        recommendedProfile: "native",
        safeMode: false,
        backend: "x11",
        gpuMode: "software",
        profileSource: "config",
        backendSource: "auto",
        gpuSource: "auto",
        warnings: [],
        notes: [],
        appliedEnv: {},
        appliedSwitches: { "ozone-platform": "x11" },
        facts: {
          sessionType: "wayland",
          architecture: "x64",
          kernelRelease: "6.8.0",
          libc: "glibc",
          desktop: "gnome",
          desktopRaw: "GNOME",
          distributionId: "ubuntu",
          distributionVersion: "24.04",
          distributionLike: ["debian"],
          packageType: "dev",
          waylandDisplay: "wayland-0",
          x11Display: ":1",
          isContainer: false,
          isRoot: false,
          gpu: {
            vendor: "intel",
            deviceCount: 1,
            hasDiscreteGpu: false,
            driverHint: null,
            hardwareAccelerationEnabled: null,
            featureStatus: null
          }
        },
        recovery: {
          active: false,
          autoRestarted: false,
          launchId: "test",
          previousFailureReason: null
        },
        generatedAt: "2026-05-04T00:00:00.000Z"
      }
    }));

    expect(model.categories.map((category) => category.id)).toContain("linux");
    expect(findSection(model, "linuxCompatProfile")?.controls[0]).toMatchObject({
      kind: "choice",
      value: "reliable"
    });
    expect(findSection(model, "linuxCompatStatus")?.controls[0]).toMatchObject({
      kind: "status-list"
    });
  });
});
