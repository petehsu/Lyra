import type { BrowserSettingsSurfaceProps } from "./settings-surface-types";

export type SettingsCategoryId =
  | "general"
  | "appearance"
  | "workspace"
  | "notifications"
  | "search"
  | "ai";

export type SettingsFieldKind =
  | "choice"
  | "boolean-choice"
  | "multi-choice"
  | "text"
  | "textarea"
  | "action"
  | "custom";

export type SettingsFieldId =
  | "locale"
  | "preventSleep"
  | "theme"
  | "uiStyle"
  | "terminalTheme"
  | "forceWebPageTheming"
  | "splitTriggerMode"
  | "splitThreePaneLayout"
  | "splitOverflowPolicy"
  | "systemNotificationMode"
  | "systemNotificationClickBehavior"
  | "systemNotificationActions"
  | "omniboxNonBrowserSubmitTarget"
  | "searchScope"
  | "searchCustomRoots"
  | "searchWebEngines"
  | "searchDeepBudget"
  | "deepSearchRestoreViewport"
  | "deepSearchLocalOpenBehavior"
  | "deepSearchSiteExpansion"
  | "deepSearchCrawlPolicy"
  | "searchSearxngEndpoint"
  | "searchIndexingFlags"
  | "jsRepl"
  | "aiRichRender"
  | "aiStopBehavior"
  | "aiProviderSettings";

export type WorkbenchSettingsCategory = {
  readonly id: SettingsCategoryId;
  readonly label: string;
  readonly sectionIds: readonly SettingsFieldId[];
};

export type WorkbenchSettingsSection = {
  readonly id: SettingsFieldId;
  readonly categoryId: SettingsCategoryId;
  readonly label: string;
  readonly fieldIds: readonly SettingsFieldId[];
  readonly visible: boolean;
};

export type WorkbenchSettingsField = {
  readonly id: SettingsFieldId;
  readonly categoryId: SettingsCategoryId;
  readonly label: string;
  readonly kind: SettingsFieldKind;
  readonly visible: boolean;
};

export type WorkbenchSettingsSchema = {
  readonly categories: readonly WorkbenchSettingsCategory[];
  readonly sections: readonly WorkbenchSettingsSection[];
  readonly fields: readonly WorkbenchSettingsField[];
};

type WorkbenchSettingsSchemaInput = Pick<
  BrowserSettingsSurfaceProps,
  | "aiCategoryLabel"
  | "notificationsCategoryLabel"
  | "languageLabel"
  | "themeLabel"
  | "uiStyleLabel"
  | "terminalThemeLabel"
  | "splitTriggerModeLabel"
  | "splitThreePaneLayoutLabel"
  | "splitOverflowPolicyLabel"
  | "aiRichRenderLabel"
  | "aiStopBehaviorLabel"
  | "preventSleepLabel"
  | "jsReplLabel"
  | "forceWebPageThemingLabel"
  | "searchCategoryLabel"
  | "searchScopeLabel"
  | "searchCustomRootsLabel"
  | "searchWebEnginesLabel"
  | "searchSearxngEndpointLabel"
  | "searchDeepBudgetLabel"
  | "deepSearchRestoreViewportLabel"
  | "deepSearchLocalOpenBehaviorLabel"
  | "deepSearchSiteExpansionLabel"
  | "deepSearchCrawlPolicyLabel"
  | "searchEnableContentLabel"
  | "omniboxNonBrowserSubmitTargetLabel"
  | "systemNotificationModeLabel"
  | "systemNotificationClickBehaviorLabel"
  | "systemNotificationActionsLabel"
  | "uiStyleOptions"
>;

const createField = (
  id: SettingsFieldId,
  categoryId: SettingsCategoryId,
  label: string,
  kind: SettingsFieldKind,
  visible = true
): WorkbenchSettingsField => ({
  id,
  categoryId,
  label,
  kind,
  visible
});

export const createWorkbenchSettingsSchema = (
  props: WorkbenchSettingsSchemaInput
): WorkbenchSettingsSchema => {
  const fields: readonly WorkbenchSettingsField[] = [
    createField("locale", "general", props.languageLabel, "choice"),
    createField("preventSleep", "general", props.preventSleepLabel, "boolean-choice"),
    createField("theme", "appearance", props.themeLabel, "choice"),
    createField("uiStyle", "appearance", props.uiStyleLabel, "choice", props.uiStyleOptions.length > 1),
    createField("terminalTheme", "appearance", props.terminalThemeLabel, "choice"),
    createField("forceWebPageTheming", "appearance", props.forceWebPageThemingLabel, "boolean-choice"),
    createField("splitTriggerMode", "workspace", props.splitTriggerModeLabel, "choice"),
    createField("splitThreePaneLayout", "workspace", props.splitThreePaneLayoutLabel, "choice"),
    createField("splitOverflowPolicy", "workspace", props.splitOverflowPolicyLabel, "choice"),
    createField("systemNotificationMode", "notifications", props.systemNotificationModeLabel, "choice"),
    createField(
      "systemNotificationClickBehavior",
      "notifications",
      props.systemNotificationClickBehaviorLabel,
      "choice"
    ),
    createField("systemNotificationActions", "notifications", props.systemNotificationActionsLabel, "boolean-choice"),
    createField("omniboxNonBrowserSubmitTarget", "search", props.omniboxNonBrowserSubmitTargetLabel, "choice"),
    createField("searchScope", "search", props.searchScopeLabel, "choice"),
    createField("searchCustomRoots", "search", props.searchCustomRootsLabel, "textarea"),
    createField("searchWebEngines", "search", props.searchWebEnginesLabel, "multi-choice"),
    createField("searchDeepBudget", "search", props.searchDeepBudgetLabel, "choice"),
    createField("deepSearchRestoreViewport", "search", props.deepSearchRestoreViewportLabel, "boolean-choice"),
    createField("deepSearchLocalOpenBehavior", "search", props.deepSearchLocalOpenBehaviorLabel, "choice"),
    createField("deepSearchSiteExpansion", "search", props.deepSearchSiteExpansionLabel, "boolean-choice"),
    createField("deepSearchCrawlPolicy", "search", props.deepSearchCrawlPolicyLabel, "choice"),
    createField("searchSearxngEndpoint", "search", props.searchSearxngEndpointLabel, "text"),
    createField("searchIndexingFlags", "search", props.searchEnableContentLabel, "custom"),
    createField("jsRepl", "ai", props.jsReplLabel, "boolean-choice"),
    createField("aiRichRender", "ai", props.aiRichRenderLabel, "boolean-choice"),
    createField("aiStopBehavior", "ai", props.aiStopBehaviorLabel, "choice"),
    createField("aiProviderSettings", "ai", props.aiCategoryLabel, "custom")
  ];

  const sections: readonly WorkbenchSettingsSection[] = fields.map((field) => ({
    id: field.id,
    categoryId: field.categoryId,
    label: field.label,
    fieldIds: [field.id],
    visible: field.visible
  }));

  const categories: readonly WorkbenchSettingsCategory[] = [
    {
      id: "general",
      label: props.languageLabel,
      sectionIds: sections.filter((section) => section.categoryId === "general").map((section) => section.id)
    },
    {
      id: "appearance",
      label: props.themeLabel,
      sectionIds: sections.filter((section) => section.categoryId === "appearance").map((section) => section.id)
    },
    {
      id: "workspace",
      label: props.splitThreePaneLayoutLabel,
      sectionIds: sections.filter((section) => section.categoryId === "workspace").map((section) => section.id)
    },
    {
      id: "notifications",
      label: props.notificationsCategoryLabel,
      sectionIds: sections.filter((section) => section.categoryId === "notifications").map((section) => section.id)
    },
    {
      id: "search",
      label: props.searchCategoryLabel,
      sectionIds: sections.filter((section) => section.categoryId === "search").map((section) => section.id)
    },
    {
      id: "ai",
      label: props.aiCategoryLabel,
      sectionIds: sections.filter((section) => section.categoryId === "ai").map((section) => section.id)
    }
  ];

  return {
    categories,
    sections,
    fields
  };
};
