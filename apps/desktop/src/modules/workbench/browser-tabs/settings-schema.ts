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
  | "windowMaterial"
  | "uiStyle"
  | "splitTriggerMode"
  | "splitThreePaneLayout"
  | "splitOverflowPolicy"
  | "systemNotificationMode"
  | "systemNotificationClickBehavior"
  | "systemNotificationActions"
  | "loginManager"
  | "softwareStore"
  | "linuxCompatProfile"
  | "linuxCompatStatus"
  | "linuxCompatRestart"
  | "omniboxNonBrowserSubmitTarget"
  | "searchWebEngines"
  | "searchSearxngEndpoint"
  | "jsRepl"
  | "aiRichRender"
  | "aiStopBehavior"
  | "personaSignals"
  | "aiModels"
  | "aiSkills"
  | "aiMcp"
  | "actCache"
  | "codeGraphEmbedding"
  | "leanPromptDelivery"
  | "statefulPromptContract";

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
  | "modelsCategoryLabel"
  | "skillsCategoryLabel"
  | "mcpCategoryLabel"
  | "notificationsCategoryLabel"
  | "loginManagerCategoryLabel"
  | "softwareStoreCategoryLabel"
  | "linuxCategoryLabel"
  | "experimentalCategoryLabel"
  | "languageLabel"
  | "themeLabel"
  | "windowMaterialLabel"
  | "uiStyleLabel"
  | "splitTriggerModeLabel"
  | "splitThreePaneLayoutLabel"
  | "splitOverflowPolicyLabel"
  | "aiRichRenderLabel"
  | "aiStopBehaviorLabel"
  | "personaSignalsLabel"
  | "preventSleepLabel"
  | "jsReplLabel"
  | "actCacheLabel"
  | "codeGraphEmbeddingLabel"
  | "leanPromptDeliveryLabel"
  | "statefulPromptContractLabel"
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
    createField("windowMaterial", "appearance", props.windowMaterialLabel, "boolean-choice"),
    createField("uiStyle", "appearance", props.uiStyleLabel, "choice", props.uiStyleOptions.length > 1),
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
    createField("loginManager", "loginManager", props.loginManagerCategoryLabel, "custom"),
    createField("softwareStore", "softwareStore", props.softwareStoreCategoryLabel, "custom"),
    createField("linuxCompatProfile", "linux", props.linuxCompatProfileLabel, "choice", props.linuxCompatVisible),
    createField("linuxCompatStatus", "linux", props.linuxCompatStatusLabel, "custom", props.linuxCompatVisible),
    createField("linuxCompatRestart", "linux", props.linuxCompatRestartLabel, "action", props.linuxCompatVisible),
    createField("omniboxNonBrowserSubmitTarget", "search", props.omniboxNonBrowserSubmitTargetLabel, "choice"),
    createField("searchWebEngines", "search", props.searchWebEnginesLabel, "multi-choice"),
    createField("searchSearxngEndpoint", "search", props.searchSearxngEndpointLabel, "text"),
    createField("jsRepl", "ai", props.jsReplLabel, "boolean-choice"),
    createField("aiRichRender", "ai", props.aiRichRenderLabel, "boolean-choice"),
    createField("aiStopBehavior", "ai", props.aiStopBehaviorLabel, "choice"),
    createField("personaSignals", "ai", props.personaSignalsLabel, "boolean-choice"),
    createField("aiModels", "models", props.modelsCategoryLabel, "custom"),
    createField("aiSkills", "skills", props.skillsCategoryLabel, "custom"),
    createField("aiMcp", "mcp", props.mcpCategoryLabel, "custom"),
    createField("actCache", "experimental", props.actCacheLabel, "boolean-choice"),
    createField("codeGraphEmbedding", "experimental", props.codeGraphEmbeddingLabel, "boolean-choice"),
    createField("leanPromptDelivery", "experimental", props.leanPromptDeliveryLabel, "boolean-choice"),
    createField("statefulPromptContract", "experimental", props.statefulPromptContractLabel, "boolean-choice")
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
      id: "loginManager",
      label: props.loginManagerCategoryLabel,
      sectionIds: sections.filter((section) => section.categoryId === "loginManager").map((section) => section.id)
    },
    {
      id: "softwareStore",
      label: props.softwareStoreCategoryLabel,
      sectionIds: sections.filter((section) => section.categoryId === "softwareStore").map((section) => section.id)
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
    },
    {
      id: "models",
      label: props.modelsCategoryLabel,
      sectionIds: sections.filter((section) => section.categoryId === "models").map((section) => section.id)
    },
    {
      id: "skills",
      label: props.skillsCategoryLabel,
      sectionIds: sections.filter((section) => section.categoryId === "skills").map((section) => section.id)
    },
    {
      id: "mcp",
      label: props.mcpCategoryLabel,
      sectionIds: sections.filter((section) => section.categoryId === "mcp").map((section) => section.id)
    },
    {
      id: "experimental",
      label: props.experimentalCategoryLabel,
      sectionIds: sections.filter((section) => section.categoryId === "experimental").map((section) => section.id)
    }
  ];

  return {
    categories,
    sections,
    fields
  };
};
