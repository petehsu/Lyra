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

  test("exposes AI tool display mode as a choice section", () => {
    const model = createSettingsSurfaceModel(createBrowserSettingsSurfaceProps({
      aiToolDisplayModeValue: "collapsed",
    }));
    const section = findSection(model, "aiToolDisplayMode");

    expect(section?.label).toBe("Tool display");
    expect(section?.controls[0]).toMatchObject({
      kind: "choice",
      value: "collapsed",
      options: [
        { value: "inner_scroll", label: "Inner scroll" },
        { value: "collapsed", label: "Collapsed" },
      ],
    });
  });
});
