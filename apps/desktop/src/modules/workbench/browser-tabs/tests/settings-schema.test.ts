import { describe, expect, test } from "vitest";

import { createWorkbenchSettingsSchema } from "../settings-schema";

const createSchemaInput = (
  uiStyleOptionCount = 1
): Parameters<typeof createWorkbenchSettingsSchema>[0] => ({
  generalCategoryLabel: "General",
  appearanceCategoryLabel: "Appearance",
  workspaceCategoryLabel: "Workspace",
  loginManagerCategoryLabel: "Login Manager",
  softwareStoreCategoryLabel: "Lyra Software",
  aiCategoryLabel: "Lyra Agents",
  modelsCategoryLabel: "Models",
  languageLabel: "Language",
  themeLabel: "Theme",
  uiStyleLabel: "UI style",
  notificationsCategoryLabel: "Notifications",
  linuxCategoryLabel: "Linux",
  splitTriggerModeLabel: "Split trigger",
  splitThreePaneLayoutLabel: "Split layout",
  splitOverflowPolicyLabel: "Split overflow",
  aiRichRenderLabel: "Rich render",
  aiStopBehaviorLabel: "Stop behavior",
  preventSleepLabel: "Prevent sleep",
  jsReplLabel: "JS REPL",
  forceWebPageThemingLabel: "Web page theming",
  searchCategoryLabel: "Search",
  searchWebEnginesLabel: "Web engines",
  searchSearxngEndpointLabel: "SearXNG endpoint",
  omniboxNonBrowserSubmitTargetLabel: "Omnibox target",
  systemNotificationModeLabel: "System notifications",
  systemNotificationClickBehaviorLabel: "Notification click behavior",
  systemNotificationActionsLabel: "Notification actions",
  linuxCompatProfileLabel: "Linux startup profile",
  linuxCompatStatusLabel: "Linux status",
  linuxCompatRestartLabel: "Restart Lyra",
  linuxCompatVisible: false,
  uiStyleOptions: Array.from({ length: uiStyleOptionCount }, () => ({
    value: "classic" as const,
    label: "Classic"
  }))
});

describe("createWorkbenchSettingsSchema", () => {
  test("keeps the settings category order stable", () => {
    const schema = createWorkbenchSettingsSchema(createSchemaInput());

    expect(schema.categories.map((category) => category.id)).toEqual([
      "general",
      "appearance",
      "workspace",
      "notifications",
      "loginManager",
      "softwareStore",
      "linux",
      "search",
      "ai",
      "models"
    ]);
    expect(schema.categories.map((category) => category.label)).toEqual([
      "General",
      "Appearance",
      "Workspace",
      "Notifications",
      "Login Manager",
      "Lyra Software",
      "Linux",
      "Search",
      "Lyra Agents",
      "Models"
    ]);
  });

  test("keeps field metadata grouped by category", () => {
    const schema = createWorkbenchSettingsSchema(createSchemaInput(2));
    const searchCategory = schema.categories.find((category) => category.id === "search");

    expect(searchCategory?.sectionIds).toEqual([
      "omniboxNonBrowserSubmitTarget",
      "searchWebEngines",
      "searchSearxngEndpoint"
    ]);
  });

  test("hides the UI style field when there is only one pack", () => {
    const singlePackSchema = createWorkbenchSettingsSchema(createSchemaInput(1));
    const multiPackSchema = createWorkbenchSettingsSchema(createSchemaInput(2));

    expect(singlePackSchema.fields.find((field) => field.id === "uiStyle")?.visible).toBe(false);
    expect(multiPackSchema.fields.find((field) => field.id === "uiStyle")?.visible).toBe(true);
  });
});
