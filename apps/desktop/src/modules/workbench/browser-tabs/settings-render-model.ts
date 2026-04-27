import type { SettingsAiLabels, SettingsAiModel } from "../settings-ai";
import {
  createWorkbenchSettingsSchema,
  type SettingsCategoryId,
  type SettingsFieldId
} from "./settings-schema";
import type { BrowserSettingsSurfaceProps, SettingsOption } from "./settings-surface-types";

export type SettingsPreviewKind = "theme" | "terminal-theme" | "split-layout";

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

export type SettingsCustomControlDescriptor = {
  readonly kind: "custom";
  readonly customKind: "ai-provider-settings";
  readonly labels: SettingsAiLabels;
  readonly model: SettingsAiModel;
};

export type SettingsControlDescriptor =
  | SettingsBooleanChoiceControlDescriptor
  | SettingsChoiceControlDescriptor
  | SettingsCustomControlDescriptor
  | SettingsInlineStatusActionControlDescriptor
  | SettingsMultiChoiceControlDescriptor
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

const resolveCategoryHeading = (
  categoryId: SettingsCategoryId,
  props: BrowserSettingsSurfaceProps
): string => {
  switch (categoryId) {
    case "general":
      return props.languageLabel;
    case "appearance":
      return props.themeLabel;
    case "workspace":
      return props.splitTriggerModeLabel;
    case "search":
      return props.searchCategoryLabel;
    case "ai":
      return props.aiCategoryLabel;
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
          createChoiceControl({
            label: props.languageLabel,
            options: props.localeOptions,
            value: props.localeValue,
            onChange: props.onLocaleChange
          })
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
    case "terminalTheme":
      return createSettingsSection({
        id: sectionId,
        label: props.terminalThemeLabel,
        controls: [
          createChoiceControl({
            label: props.terminalThemeLabel,
            options: props.terminalThemeOptions,
            value: props.terminalThemeValue,
            onChange: props.onTerminalThemeChange,
            gridClassName: "lyra-settings-choice-grid lyra-settings-choice-grid-themes",
            previewKind: "terminal-theme"
          })
        ]
      });
    case "forceWebPageTheming":
      return createSettingsSection({
        id: sectionId,
        label: props.forceWebPageThemingLabel,
        controls: [
          createBooleanChoiceControl({
            label: props.forceWebPageThemingLabel,
            value: props.forceWebPageThemingValue,
            description: props.forceWebPageThemingDescription,
            enabledLabel: props.forceWebPageThemingEnabledLabel,
            disabledLabel: props.forceWebPageThemingDisabledLabel,
            onChange: props.onForceWebPageThemingChange
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
    case "searchScope":
      return createSettingsSection({
        id: sectionId,
        label: props.searchScopeLabel,
        controls: [
          createChoiceControl({
            label: props.searchScopeLabel,
            options: props.searchScopeOptions,
            value: props.searchScopeValue,
            onChange: props.onSearchScopeChange
          })
        ]
      });
    case "searchCustomRoots":
      return createSettingsSection({
        id: sectionId,
        label: props.searchCustomRootsLabel,
        controls: [
          createTextControl({
            kind: "textarea",
            label: props.searchCustomRootsLabel,
            value: props.searchCustomRootsValue,
            placeholder: props.searchCustomRootsPlaceholder,
            onChange: props.onSearchCustomRootsChange
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
    case "searchDeepBudget":
      return createSettingsSection({
        id: sectionId,
        label: props.searchDeepBudgetLabel,
        controls: [
          createChoiceControl({
            label: props.searchDeepBudgetLabel,
            options: props.searchDeepBudgetOptions,
            value: props.searchDeepBudgetValue,
            onChange: props.onSearchDeepBudgetChange
          })
        ]
      });
    case "deepSearchRestoreViewport":
      return createSettingsSection({
        id: sectionId,
        label: props.deepSearchRestoreViewportLabel,
        controls: [
          createToggleGroupControl({
            label: props.deepSearchRestoreViewportLabel,
            toggles: [
              {
                id: "deepSearchRestoreViewport",
                label: props.deepSearchRestoreViewportLabel,
                active: props.deepSearchRestoreViewportValue,
                onToggle: () => {
                  props.onDeepSearchRestoreViewportChange(!props.deepSearchRestoreViewportValue);
                }
              }
            ]
          })
        ]
      });
    case "deepSearchLocalOpenBehavior":
      return createSettingsSection({
        id: sectionId,
        label: props.deepSearchLocalOpenBehaviorLabel,
        controls: [
          createChoiceControl({
            label: props.deepSearchLocalOpenBehaviorLabel,
            options: props.deepSearchLocalOpenBehaviorOptions,
            value: props.deepSearchLocalOpenBehaviorValue,
            onChange: props.onDeepSearchLocalOpenBehaviorChange
          })
        ]
      });
    case "deepSearchSiteExpansion":
      return createSettingsSection({
        id: sectionId,
        label: props.deepSearchSiteExpansionLabel,
        controls: [
          createToggleGroupControl({
            label: props.deepSearchSiteExpansionLabel,
            toggles: [
              {
                id: "deepSearchSiteExpansion",
                label: props.deepSearchSiteExpansionLabel,
                active: props.deepSearchSiteExpansionValue,
                onToggle: () => {
                  props.onDeepSearchSiteExpansionChange(!props.deepSearchSiteExpansionValue);
                }
              },
              {
                id: "deepSearchProactiveGuess",
                label: props.deepSearchProactiveGuessLabel,
                active: props.deepSearchProactiveGuessValue,
                onToggle: () => {
                  props.onDeepSearchProactiveGuessChange(!props.deepSearchProactiveGuessValue);
                }
              }
            ]
          })
        ]
      });
    case "deepSearchCrawlPolicy":
      return createSettingsSection({
        id: sectionId,
        label: props.deepSearchCrawlPolicyLabel,
        controls: [
          createChoiceControl({
            label: props.deepSearchCrawlPolicyLabel,
            options: props.deepSearchCrawlPolicyOptions,
            value: props.deepSearchCrawlPolicyValue,
            onChange: props.onDeepSearchCrawlPolicyChange
          })
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
    case "searchIndexingFlags":
      return createSettingsSection({
        id: sectionId,
        label: props.searchEnableContentLabel,
        cluster: true,
        controls: [
          createToggleGroupControl({
            label: props.searchEnableContentLabel,
            gridClassName: "lyra-settings-choice-grid lyra-settings-choice-grid-flags",
            toggles: [
              {
                id: "searchEnableFuzzy",
                label: props.searchEnableFuzzyLabel,
                active: props.searchEnableFuzzyValue,
                onToggle: () => {
                  props.onSearchEnableFuzzyChange(!props.searchEnableFuzzyValue);
                }
              },
              {
                id: "searchEnableContent",
                label: props.searchEnableContentLabel,
                active: props.searchEnableContentValue,
                onToggle: () => {
                  props.onSearchEnableContentChange(!props.searchEnableContentValue);
                }
              },
              {
                id: "searchIncludeHidden",
                label: props.searchIncludeHiddenLabel,
                active: props.searchIncludeHiddenValue,
                onToggle: () => {
                  props.onSearchIncludeHiddenChange(!props.searchIncludeHiddenValue);
                }
              },
              {
                id: "searchAutoIndex",
                label: props.searchAutoIndexLabel,
                active: props.searchAutoIndexValue,
                onToggle: () => {
                  props.onSearchAutoIndexChange(!props.searchAutoIndexValue);
                }
              }
            ]
          }),
          {
            kind: "inline-status-action",
            label: props.searchIndexStatusLabel,
            statusLabel: props.searchIndexStatusLabel,
            statusValue: props.searchIndexStatusValue,
            actionLabel: props.searchRebuildIndexPending
              ? `${props.searchRebuildIndexLabel}...`
              : props.searchRebuildIndexLabel,
            actionDisabled: props.searchRebuildIndexPending,
            onAction: props.onSearchRebuildIndex
          }
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
    case "aiProviderSettings":
      return createSettingsSection({
        id: sectionId,
        label: props.aiCategoryLabel,
        frame: "none",
        controls: [
          {
            kind: "custom",
            customKind: "ai-provider-settings",
            labels: props.aiLabels,
            model: props.aiModel
          }
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

  return {
    title: props.title,
    categories: schema.categories.map((category) => ({
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
  };
};
