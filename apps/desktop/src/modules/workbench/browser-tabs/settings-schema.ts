import type {
  BrowserSettingsCategoryId,
  BrowserSettingsSurfaceProps
} from "./settings-surface-types";

export type SettingsCategoryId = BrowserSettingsCategoryId;

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
  | "forceWebPageTheming"
  | "splitTriggerMode"
  | "splitThreePaneLayout"
  | "splitOverflowPolicy"
  | "systemNotificationMode"
  | "systemNotificationClickBehavior"
  | "systemNotificationActions"
  | "linuxCompatProfile"
  | "linuxCompatStatus"
  | "linuxCompatRestart"
  | "omniboxNonBrowserSubmitTarget"
  | "searchWebEngines"
  | "searchSearxngEndpoint"
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
  | "generalCategoryLabel"
  | "appearanceCategoryLabel"
  | "workspaceCategoryLabel"
  | "aiCategoryLabel"
  | "notificationsCategoryLabel"
  | "linuxCategoryLabel"
  | "languageLabel"
  | "themeLabel"
  | "uiStyleLabel"
  | "splitTriggerModeLabel"
  | "splitThreePaneLayoutLabel"
  | "splitOverflowPolicyLabel"
  | "aiRichRenderLabel"
  | "aiStopBehaviorLabel"
  | "preventSleepLabel"
  | "jsReplLabel"
  | "forceWebPageThemingLabel"
  | "searchCategoryLabel"
  | "searchWebEnginesLabel"
  | "searchSearxngEndpointLabel"
  | "omniboxNonBrowserSubmitTargetLabel"
  | "systemNotificationModeLabel"
  | "systemNotificationClickBehaviorLabel"
  | "systemNotificationActionsLabel"
  | "linuxCompatProfileLabel"
  | "linuxCompatStatusLabel"
  | "linuxCompatRestartLabel"
  | "linuxCompatVisible"
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
    createField("linuxCompatProfile", "linux", props.linuxCompatProfileLabel, "choice", props.linuxCompatVisible),
    createField("linuxCompatStatus", "linux", props.linuxCompatStatusLabel, "custom", props.linuxCompatVisible),
    createField("linuxCompatRestart", "linux", props.linuxCompatRestartLabel, "action", props.linuxCompatVisible),
    createField("omniboxNonBrowserSubmitTarget", "search", props.omniboxNonBrowserSubmitTargetLabel, "choice"),
    createField("searchWebEngines", "search", props.searchWebEnginesLabel, "multi-choice"),
    createField("searchSearxngEndpoint", "search", props.searchSearxngEndpointLabel, "text"),
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
      label: props.generalCategoryLabel,
      sectionIds: sections.filter((section) => section.categoryId === "general").map((section) => section.id)
    },
    {
      id: "appearance",
      label: props.appearanceCategoryLabel,
      sectionIds: sections.filter((section) => section.categoryId === "appearance").map((section) => section.id)
    },
    {
      id: "workspace",
      label: props.workspaceCategoryLabel,
      sectionIds: sections.filter((section) => section.categoryId === "workspace").map((section) => section.id)
    },
    {
      id: "notifications",
      label: props.notificationsCategoryLabel,
      sectionIds: sections.filter((section) => section.categoryId === "notifications").map((section) => section.id)
    },
    {
      id: "linux",
      label: props.linuxCategoryLabel,
      sectionIds: sections.filter((section) => section.categoryId === "linux").map((section) => section.id)
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
