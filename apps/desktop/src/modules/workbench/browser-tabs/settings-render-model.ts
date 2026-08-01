import type { SettingsAiLabels, SettingsAiModel } from "../settings-ai";
import type { GlobalDialogModel } from "../global-dialog";
import type { LoginManagerSurfaceProps } from "../login-manager";
import type { SoftwareStoreSurfaceProps } from "../software-store";
import {
  createWorkbenchSettingsSchema,
  type SettingsCategoryId,
  type SettingsFieldId
} from "./settings-schema";
import type {
  BrowserSettingsSurfaceProps,
  LanguagePickerLabels,
  SettingsOption
} from "./settings-surface-types";

export type SettingsPreviewKind = "theme" | "split-layout";

export type SettingsChoiceControlDescriptor = {
  readonly kind: "choice";
  readonly label: string;
  readonly options: readonly SettingsOption[];
  readonly value: string;
  readonly gridClassName?: string | undefined;
  readonly optionClassName?: string | undefined;
  readonly previewKind?: SettingsPreviewKind | undefined;
  readonly showOptionText?: boolean | undefined;
  readonly description?: string | undefined;
  readonly onChange: (value: string) => void;
};

export type SettingsBooleanChoiceControlDescriptor = {
  readonly kind: "boolean-choice";
  readonly label: string;
  readonly value: boolean;
  readonly description: string;
  readonly enabledLabel: string;
  readonly disabledLabel: string;
  readonly onChange: (value: boolean) => void;
};

export type SettingsLanguagePickerControlDescriptor = {
  readonly kind: "language-picker";
  readonly label: string;
  readonly value: BrowserSettingsSurfaceProps["localeValue"];
  readonly options: BrowserSettingsSurfaceProps["localeOptions"];
  readonly labels: LanguagePickerLabels;
  readonly desktopApi: BrowserSettingsSurfaceProps["desktopApi"];
  readonly onChange: BrowserSettingsSurfaceProps["onLocaleChange"];
};

export type SettingsTextControlDescriptor = {
  readonly kind: "text" | "textarea";
  readonly label: string;
  readonly value: string;
  readonly placeholder?: string | undefined;
  readonly onChange: (value: string) => void;
};

export type SettingsToggleDescriptor = {
  readonly id: string;
  readonly label: string;
  readonly active: boolean;
  readonly onToggle: () => void;
};

export type SettingsToggleGroupControlDescriptor = {
  readonly kind: "toggle-group";
  readonly label: string;
  readonly gridClassName?: string | undefined;
  readonly toggles: readonly SettingsToggleDescriptor[];
};

export type SettingsMultiChoiceControlDescriptor = {
  readonly kind: "multi-choice";
  readonly label: string;
  readonly options: readonly SettingsOption[];
  readonly selectedValues: readonly string[];
  readonly onChange: (value: readonly string[]) => void;
};

export type SettingsInlineStatusActionControlDescriptor = {
  readonly kind: "inline-status-action";
  readonly label: string;
  readonly statusLabel: string;
  readonly statusValue: string;
  readonly actionLabel: string;
  readonly actionDisabled: boolean;
  readonly onAction: () => void;
};

export type SettingsAiCustomControlDescriptor = {
  readonly kind: "custom";
  readonly customKind: "ai-mcp" | "ai-models" | "ai-skills";
  readonly labels: SettingsAiLabels;
  readonly model: SettingsAiModel;
  readonly openDialog: GlobalDialogModel["openDialog"];
};

export type SettingsLoginManagerCustomControlDescriptor = {
  readonly kind: "custom";
  readonly customKind: "login-manager";
  readonly props: LoginManagerSurfaceProps;
};

export type SettingsSoftwareStoreCustomControlDescriptor = {
  readonly kind: "custom";
  readonly customKind: "software-store";
  readonly props: SoftwareStoreSurfaceProps;
};

export type SettingsCustomControlDescriptor =
  | SettingsAiCustomControlDescriptor
  | SettingsLoginManagerCustomControlDescriptor
  | SettingsSoftwareStoreCustomControlDescriptor;

export type SettingsStatusListControlDescriptor = {
  readonly kind: "status-list";
  readonly label: string;
  readonly rows: readonly {
    readonly label: string;
    readonly value: string;
  }[];
  readonly actionLabel?: string;
  readonly onAction?: () => void;
};

export type SettingsControlDescriptor =
  | SettingsBooleanChoiceControlDescriptor
  | SettingsChoiceControlDescriptor
  | SettingsCustomControlDescriptor
  | SettingsInlineStatusActionControlDescriptor
  | SettingsLanguagePickerControlDescriptor
  | SettingsMultiChoiceControlDescriptor
  | SettingsStatusListControlDescriptor
  | SettingsTextControlDescriptor
  | SettingsToggleGroupControlDescriptor;

export type SettingsRenderedSection = {
  readonly id: SettingsFieldId;
  readonly label: string;
  readonly frame: "group" | "none";
  readonly cluster: boolean;
  readonly controls: readonly SettingsControlDescriptor[];
};

export type SettingsRenderedCategory = {
  readonly id: SettingsCategoryId;
  readonly domId: string;
  readonly navLabel: string;
  readonly heading: string;
  readonly sections: readonly SettingsRenderedSection[];
};

export type SettingsSurfaceModel = {
  readonly title: string;
  readonly categories: readonly SettingsRenderedCategory[];
};

export const buildSettingsCategoryDomId = (categoryId: SettingsCategoryId): string =>
  `lyra-settings-category-${categoryId}`;

const castOptions = <T extends string>(options: readonly SettingsOption<T>[]): readonly SettingsOption[] =>
  options;

const createChoiceControl = <T extends string>({
  label,
  options,
  value,
  onChange,
  gridClassName,
  optionClassName,
  previewKind,
  showOptionText,
  description
}: {
  readonly label: string;
  readonly options: readonly SettingsOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly gridClassName?: string;
  readonly optionClassName?: string;
  readonly previewKind?: SettingsPreviewKind;
  readonly showOptionText?: boolean;
  readonly description?: string;
}): SettingsChoiceControlDescriptor => ({
  kind: "choice",
  label,
  options: castOptions(options),
  value,
  gridClassName,
  optionClassName,
  previewKind,
  showOptionText,
  description,
  onChange: (nextValue) => {
    onChange(nextValue as T);
  }
});

const createBooleanChoiceControl = ({
  label,
  value,
  description,
  enabledLabel,
  disabledLabel,
  onChange
}: Omit<SettingsBooleanChoiceControlDescriptor, "kind">): SettingsBooleanChoiceControlDescriptor => ({
  kind: "boolean-choice",
  label,
  value,
  description,
  enabledLabel,
  disabledLabel,
  onChange
});

const createTextControl = ({
  kind,
  label,
  value,
  placeholder,
  onChange
}: SettingsTextControlDescriptor): SettingsTextControlDescriptor => ({
  kind,
  label,
  value,
  placeholder,
  onChange
});

const createToggleGroupControl = ({
  label,
  gridClassName,
  toggles
}: Omit<SettingsToggleGroupControlDescriptor, "kind">): SettingsToggleGroupControlDescriptor => ({
  kind: "toggle-group",
  label,
  gridClassName,
  toggles
});

const createSettingsSection = ({
  id,
  label,
  controls,
  cluster = false,
  frame = "group"
}: {
  readonly id: SettingsFieldId;
  readonly label: string;
  readonly controls: readonly SettingsControlDescriptor[];
  readonly cluster?: boolean;
  readonly frame?: SettingsRenderedSection["frame"];
}): SettingsRenderedSection => ({
  id,
  label,
  controls,
  cluster,
  frame
});

const formatLinuxCompatStatusRows = (
  props: BrowserSettingsSurfaceProps
): SettingsStatusListControlDescriptor["rows"] => {
  const status = props.linuxCompatStatus;
  if (status === null) {
    return [
      {
        label: props.linuxCompatCurrentStatusLabel,
        value: "unknown"
      }
    ];
  }
  const distro = [
    status.facts.distributionId ?? "unknown",
    status.facts.distributionVersion ?? ""
  ].filter((entry) => entry.length > 0).join(" ");
  return [
    {
      label: props.linuxCompatCurrentStatusLabel,
      value: `${status.profile} · ${status.backend} · ${status.gpuMode}`
    },
    {
      label: props.linuxCompatSystemLabel,
      value: `${distro} · ${status.facts.architecture} · ${status.facts.libc ?? "unknown"}`
    },
    {
      label: props.linuxCompatDesktopLabel,
      value: `${status.facts.desktop} · ${status.facts.sessionType}`
    },
    {
      label: props.linuxCompatGpuLabel,
      value: `${status.facts.gpu.vendor} · ${status.facts.gpu.hardwareAccelerationEnabled ?? "unknown"}`
    },
    {
      label: props.linuxCompatSwitchesLabel,
      value: Object.keys(status.appliedSwitches).length === 0
        ? "none"
        : Object.entries(status.appliedSwitches)
            .map(([key, value]) => `${key}=${value}`)
            .join(" · ")
    },
    ...(status.warnings.length === 0
      ? []
      : [{
          label: props.linuxCompatWarningsLabel,
          value: status.warnings.map((warning) => warning.code).join(" · ")
        }])
  ];
};

const resolveCategoryHeading = (
  categoryId: SettingsCategoryId,
  props: BrowserSettingsSurfaceProps
): string => {
  switch (categoryId) {
    case "general":
      return props.generalCategoryLabel;
    case "appearance":
      return props.appearanceCategoryLabel;
    case "workspace":
      return props.workspaceCategoryLabel;
    case "notifications":
      return props.notificationsCategoryLabel;
    case "loginManager":
      return props.loginManagerCategoryLabel;
    case "softwareStore":
      return props.softwareStoreCategoryLabel;
    case "search":
      return props.searchCategoryLabel;
    case "linux":
      return props.linuxCategoryLabel;
    case "ai":
      return props.aiCategoryLabel;
    case "models":
      return props.modelsCategoryLabel;
    case "skills":
      return props.skillsCategoryLabel;
    case "mcp":
      return props.mcpCategoryLabel;
    case "experimental":
      return props.experimentalCategoryLabel;
    default:
      return props.title;
  }
};

const createSectionControl = (
  sectionId: SettingsFieldId,
  props: BrowserSettingsSurfaceProps
): SettingsRenderedSection | null => {
  switch (sectionId) {
    case "locale":
      return createSettingsSection({
        id: sectionId,
        label: props.languageLabel,
        controls: [
          {
            kind: "language-picker",
            label: props.languageLabel,
            options: props.localeOptions,
            value: props.localeValue,
            labels: props.languagePickerLabels,
            desktopApi: props.desktopApi,
            onChange: props.onLocaleChange
          }
        ]
      });
    case "preventSleep":
      return createSettingsSection({
        id: sectionId,
        label: props.preventSleepLabel,
        controls: [
          createBooleanChoiceControl({
            label: props.preventSleepLabel,
            value: props.preventSleepValue,
            description: props.preventSleepDescription,
            enabledLabel: props.preventSleepEnabledLabel,
            disabledLabel: props.preventSleepDisabledLabel,
            onChange: props.onPreventSleepChange
          })
        ]
      });
    case "theme":
      return createSettingsSection({
        id: sectionId,
        label: props.themeLabel,
        controls: [
          createChoiceControl({
            label: props.themeLabel,
            options: props.themeOptions,
            value: props.themeValue,
            onChange: props.onThemeChange,
            gridClassName: "lyra-settings-choice-grid lyra-settings-choice-grid-themes",
            previewKind: "theme"
          })
        ]
      });
    case "windowMaterial":
      return createSettingsSection({
        id: sectionId,
        label: props.windowMaterialLabel,
        controls: [
          createBooleanChoiceControl({
            label: props.windowMaterialLabel,
            value: props.windowMaterialValue,
            description: props.windowMaterialDescription,
            enabledLabel: props.windowMaterialEnabledLabel,
            disabledLabel: props.windowMaterialDisabledLabel,
            onChange: props.onWindowMaterialChange
          })
        ]
      });
    case "uiStyle":
      return createSettingsSection({
        id: sectionId,
        label: props.uiStyleLabel,
        controls: [
          createChoiceControl({
            label: props.uiStyleLabel,
            options: props.uiStyleOptions,
            value: props.uiStyleValue,
            onChange: props.onUiStyleChange
          })
        ]
      });
    case "splitTriggerMode":
      return createSettingsSection({
        id: sectionId,
        label: props.splitTriggerModeLabel,
        controls: [
          createChoiceControl({
            label: props.splitTriggerModeLabel,
            options: props.splitTriggerModeOptions,
            value: props.splitTriggerModeValue,
            onChange: props.onSplitTriggerModeChange
          })
        ]
      });
    case "splitThreePaneLayout":
      return createSettingsSection({
        id: sectionId,
        label: props.splitThreePaneLayoutLabel,
        controls: [
          createChoiceControl({
            label: props.splitThreePaneLayoutLabel,
            options: props.splitThreePaneLayoutOptions,
            value: props.splitThreePaneLayoutValue,
            onChange: props.onSplitThreePaneLayoutChange,
            gridClassName: "lyra-settings-choice-grid lyra-settings-choice-grid-themes lyra-settings-choice-grid-split-layout",
            optionClassName: "lyra-settings-choice-split-layout-option",
            previewKind: "split-layout",
            showOptionText: false
          })
        ]
      });
    case "splitOverflowPolicy":
      return createSettingsSection({
        id: sectionId,
        label: props.splitOverflowPolicyLabel,
        controls: [
          createChoiceControl({
            label: props.splitOverflowPolicyLabel,
            options: props.splitOverflowPolicyOptions,
            value: props.splitOverflowPolicyValue,
            onChange: props.onSplitOverflowPolicyChange
          })
        ]
      });
    case "systemNotificationMode":
      return createSettingsSection({
        id: sectionId,
        label: props.systemNotificationModeLabel,
        controls: [
          createChoiceControl({
            label: props.systemNotificationModeLabel,
            options: props.systemNotificationModeOptions,
            value: props.systemNotificationModeValue,
            onChange: props.onSystemNotificationModeChange
          })
        ]
      });
    case "systemNotificationClickBehavior":
      return createSettingsSection({
        id: sectionId,
        label: props.systemNotificationClickBehaviorLabel,
        controls: [
          createChoiceControl({
            label: props.systemNotificationClickBehaviorLabel,
            options: props.systemNotificationClickBehaviorOptions,
            value: props.systemNotificationClickBehaviorValue,
            onChange: props.onSystemNotificationClickBehaviorChange
          })
        ]
      });
    case "systemNotificationActions":
      return createSettingsSection({
        id: sectionId,
        label: props.systemNotificationActionsLabel,
        controls: [
          createBooleanChoiceControl({
            label: props.systemNotificationActionsLabel,
            value: props.systemNotificationActionsValue,
            description: props.systemNotificationActionsDescription,
            enabledLabel: props.systemNotificationActionsEnabled,
            disabledLabel: props.systemNotificationActionsDisabled,
            onChange: props.onSystemNotificationActionsChange
          })
        ]
      });
    case "loginManager":
      return createSettingsSection({
        id: sectionId,
        label: props.loginManagerCategoryLabel,
        frame: "none",
        controls: [
          {
            kind: "custom",
            customKind: "login-manager",
            props: props.loginManager
          }
        ]
      });
    case "softwareStore":
      return createSettingsSection({
        id: sectionId,
        label: props.softwareStoreCategoryLabel,
        frame: "none",
        controls: [
          {
            kind: "custom",
            customKind: "software-store",
            props: props.softwareStore
          }
        ]
      });
    case "linuxCompatProfile":
      return createSettingsSection({
        id: sectionId,
        label: props.linuxCompatProfileLabel,
        controls: [
          createChoiceControl({
            label: props.linuxCompatProfileLabel,
            options: props.linuxCompatProfileOptions,
            value: props.linuxCompatProfileValue,
            onChange: props.onLinuxCompatProfileChange,
            description: props.linuxCompatProfileDescription
          })
        ]
      });
    case "linuxCompatStatus":
      return createSettingsSection({
        id: sectionId,
        label: props.linuxCompatStatusLabel,
        controls: [
          {
            kind: "status-list",
            label: props.linuxCompatStatusLabel,
            rows: formatLinuxCompatStatusRows(props)
          }
        ]
      });
    case "linuxCompatRestart":
      return createSettingsSection({
        id: sectionId,
        label: props.linuxCompatRestartLabel,
        controls: [
          {
            kind: "inline-status-action",
            label: props.linuxCompatRestartLabel,
            statusLabel: props.linuxCompatRestartLabel,
            statusValue: props.linuxCompatRestartDescription,
            actionLabel: props.linuxCompatRestartNowLabel,
            actionDisabled: false,
            onAction: props.onLinuxCompatRestart
          }
        ]
      });
    case "omniboxNonBrowserSubmitTarget":
      return createSettingsSection({
        id: sectionId,
        label: props.omniboxNonBrowserSubmitTargetLabel,
        controls: [
          createChoiceControl({
            label: props.omniboxNonBrowserSubmitTargetLabel,
            options: props.omniboxNonBrowserSubmitTargetOptions,
            value: props.omniboxNonBrowserSubmitTargetValue,
            onChange: props.onOmniboxNonBrowserSubmitTargetChange
          })
        ]
      });
    case "searchWebEngines":
      return createSettingsSection({
        id: sectionId,
        label: props.searchWebEnginesLabel,
        controls: [
          {
            kind: "multi-choice",
            label: props.searchWebEnginesLabel,
            options: props.searchWebEngineOptions,
            selectedValues: props.searchWebEngineIds,
            onChange: props.onSearchWebEnginesChange
          }
        ]
      });
    case "searchSearxngEndpoint":
      return createSettingsSection({
        id: sectionId,
        label: props.searchSearxngEndpointLabel,
        controls: [
          createTextControl({
            kind: "text",
            label: props.searchSearxngEndpointLabel,
            value: props.searchSearxngEndpointValue,
            placeholder: "https://your-searxng.example.com",
            onChange: props.onSearchSearxngEndpointChange
          })
        ]
      });
    case "jsRepl":
      return createSettingsSection({
        id: sectionId,
        label: props.jsReplLabel,
        controls: [
          createBooleanChoiceControl({
            label: props.jsReplLabel,
            value: props.jsReplValue,
            description: props.jsReplDescription,
            enabledLabel: props.jsReplEnabledLabel,
            disabledLabel: props.jsReplDisabledLabel,
            onChange: props.onJsReplChange
          })
        ]
      });
    case "aiRichRender":
      return createSettingsSection({
        id: sectionId,
        label: props.aiRichRenderLabel,
        controls: [
          createBooleanChoiceControl({
            label: props.aiRichRenderLabel,
            value: props.aiRichRenderValue,
            description: props.aiRichRenderDescription,
            enabledLabel: props.aiRichRenderEnabledLabel,
            disabledLabel: props.aiRichRenderDisabledLabel,
            onChange: props.onAiRichRenderChange
          })
        ]
      });
    case "aiStopBehavior":
      return createSettingsSection({
        id: sectionId,
        label: props.aiStopBehaviorLabel,
        controls: [
          createChoiceControl({
            label: props.aiStopBehaviorLabel,
            options: [
              {
                value: "turn_only",
                label: props.aiStopBehaviorTurnOnlyLabel,
                description: props.aiStopBehaviorTurnOnlyDescription
              },
              {
                value: "turn_and_background",
                label: props.aiStopBehaviorTurnAndBackgroundLabel,
                description: props.aiStopBehaviorTurnAndBackgroundDescription
              }
            ],
            value: props.aiStopBehaviorValue,
            onChange: props.onAiStopBehaviorChange,
            description: props.aiStopBehaviorDescription
          })
        ]
      });
    case "personaSignals":
      return createSettingsSection({
        id: sectionId,
        label: props.personaSignalsLabel,
        controls: [
          createBooleanChoiceControl({
            label: props.personaSignalsLabel,
            value: props.personaSignalsValue,
            description: props.personaSignalsDescription,
            enabledLabel: props.personaSignalsEnabledLabel,
            disabledLabel: props.personaSignalsDisabledLabel,
            onChange: props.onPersonaSignalsChange
          })
        ]
      });
    case "aiModels":
      return createSettingsSection({
        id: sectionId,
        label: props.modelsCategoryLabel,
        frame: "none",
        controls: [
          {
            kind: "custom",
            customKind: "ai-models",
            labels: props.aiLabels,
            model: props.aiModel,
            openDialog: props.openDialog
          }
        ]
      });
    case "aiSkills":
      return createSettingsSection({
        id: sectionId,
        label: props.skillsCategoryLabel,
        frame: "none",
        controls: [
          {
            kind: "custom",
            customKind: "ai-skills",
            labels: props.aiLabels,
            model: props.aiModel,
            openDialog: props.openDialog
          }
        ]
      });
    case "aiMcp":
      return createSettingsSection({
        id: sectionId,
        label: props.mcpCategoryLabel,
        frame: "none",
        controls: [
          {
            kind: "custom",
            customKind: "ai-mcp",
            labels: props.aiLabels,
            model: props.aiModel,
            openDialog: props.openDialog
          }
        ]
      });
    case "actCache":
      return createSettingsSection({
        id: sectionId,
        label: props.actCacheLabel,
        controls: [
          createBooleanChoiceControl({
            label: props.actCacheLabel,
            value: props.actCacheValue,
            description: props.actCacheDescription,
            enabledLabel: props.actCacheEnabledLabel,
            disabledLabel: props.actCacheDisabledLabel,
            onChange: props.onActCacheChange
          })
        ]
      });
    case "codeGraphEmbedding":
      return createSettingsSection({
        id: sectionId,
        label: props.codeGraphEmbeddingLabel,
        controls: [
          createBooleanChoiceControl({
            label: props.codeGraphEmbeddingLabel,
            value: props.codeGraphEmbeddingValue,
            description: props.codeGraphEmbeddingDescription,
            enabledLabel: props.codeGraphEmbeddingEnabledLabel,
            disabledLabel: props.codeGraphEmbeddingDisabledLabel,
            onChange: props.onCodeGraphEmbeddingChange
          })
        ]
      });
    case "leanPromptDelivery":
      return createSettingsSection({
        id: sectionId,
        label: props.leanPromptDeliveryLabel,
        controls: [
          createBooleanChoiceControl({
            label: props.leanPromptDeliveryLabel,
            value: props.leanPromptDeliveryValue,
            description: props.leanPromptDeliveryDescription,
            enabledLabel: props.leanPromptDeliveryEnabledLabel,
            disabledLabel: props.leanPromptDeliveryDisabledLabel,
            onChange: props.onLeanPromptDeliveryChange
          })
        ]
      });
    case "statefulPromptContract":
      return createSettingsSection({
        id: sectionId,
        label: props.statefulPromptContractLabel,
        controls: [
          createBooleanChoiceControl({
            label: props.statefulPromptContractLabel,
            value: props.statefulPromptContractValue,
            description: props.statefulPromptContractDescription,
            enabledLabel: props.statefulPromptContractEnabledLabel,
            disabledLabel: props.statefulPromptContractDisabledLabel,
            onChange: props.onStatefulPromptContractChange
          })
        ]
      });
    default:
      return null;
  }
};

export const createSettingsSurfaceModel = (
  props: BrowserSettingsSurfaceProps
): SettingsSurfaceModel => {
  const schema = createWorkbenchSettingsSchema(props);
  const sectionById = new Map(schema.sections.map((section) => [section.id, section] as const));
  const categories = schema.categories
    .map((category) => ({
      id: category.id,
      domId: buildSettingsCategoryDomId(category.id),
      navLabel: category.label,
      heading: resolveCategoryHeading(category.id, props),
      sections: category.sectionIds.flatMap((sectionId) => {
        const section = sectionById.get(sectionId);
        if (section === undefined || section.visible === false) {
          return [];
        }
        const renderedSection = createSectionControl(sectionId, props);
        return renderedSection === null ? [] : [renderedSection];
      })
    }))
    .filter((category) => category.sections.length > 0);

  return {
    title: props.title,
    categories
  };
};
