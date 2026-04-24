import { useMemo, useState } from "react";

import type {
  SearchDeepCrawlPolicy,
  SearchDeepBudgetPreset,
  SearchLocalScopePreset
} from "../../../shared/desktop-bridge";
import type { WorkbenchLocale } from "../i18n";
import type {
  WorkbenchOmniboxNonBrowserSubmitTarget,
  WorkbenchSplitOverflowPolicy,
  WorkbenchSplitThreePaneLayout,
  WorkbenchSplitTriggerMode
} from "../preferences";
import type { WorkbenchThemeId } from "../theme";
import type { TerminalThemeMode } from "../terminal-theme";
import { SettingsAiView, type SettingsAiLabels, type SettingsAiModel } from "../settings-ai";

type Option<T extends string> = {
  readonly value: T;
  readonly label: string;
  readonly description?: string;
};

export type BrowserSettingsSurfaceProps = {
  readonly title: string;
  readonly aiCategoryLabel: string;
  readonly languageLabel: string;
  readonly themeLabel: string;
  readonly terminalThemeLabel: string;
  readonly splitTriggerModeLabel: string;
  readonly splitThreePaneLayoutLabel: string;
  readonly splitOverflowPolicyLabel: string;
  readonly aiRichRenderLabel: string;
  readonly aiRichRenderDescription: string;
  readonly aiRichRenderEnabledLabel: string;
  readonly aiRichRenderDisabledLabel: string;
  readonly searchCategoryLabel: string;
  readonly searchScopeLabel: string;
  readonly searchCustomRootsLabel: string;
  readonly searchCustomRootsPlaceholder: string;
  readonly searchWebEnginesLabel: string;
  readonly searchSearxngEndpointLabel: string;
  readonly searchDeepBudgetLabel: string;
  readonly deepSearchRestoreViewportLabel: string;
  readonly deepSearchLocalOpenBehaviorLabel: string;
  readonly deepSearchSiteExpansionLabel: string;
  readonly deepSearchProactiveGuessLabel: string;
  readonly deepSearchCrawlPolicyLabel: string;
  readonly searchEnableFuzzyLabel: string;
  readonly searchEnableContentLabel: string;
  readonly searchIncludeHiddenLabel: string;
  readonly searchAutoIndexLabel: string;
  readonly searchIndexStatusLabel: string;
  readonly searchRebuildIndexLabel: string;
  readonly omniboxNonBrowserSubmitTargetLabel: string;
  readonly localeValue: WorkbenchLocale;
  readonly themeValue: WorkbenchThemeId;
  readonly terminalThemeValue: TerminalThemeMode;
  readonly splitTriggerModeValue: WorkbenchSplitTriggerMode;
  readonly splitThreePaneLayoutValue: WorkbenchSplitThreePaneLayout;
  readonly splitOverflowPolicyValue: WorkbenchSplitOverflowPolicy;
  readonly aiRichRenderValue: boolean;
  readonly searchScopeValue: SearchLocalScopePreset;
  readonly searchCustomRootsValue: string;
  readonly searchWebEngineIds: readonly string[];
  readonly searchSearxngEndpointValue: string;
  readonly searchDeepBudgetValue: SearchDeepBudgetPreset;
  readonly deepSearchRestoreViewportValue: boolean;
  readonly deepSearchLocalOpenBehaviorValue: "open_file" | "reveal_in_manager";
  readonly deepSearchSiteExpansionValue: boolean;
  readonly deepSearchProactiveGuessValue: boolean;
  readonly deepSearchCrawlPolicyValue: SearchDeepCrawlPolicy;
  readonly searchEnableFuzzyValue: boolean;
  readonly searchEnableContentValue: boolean;
  readonly searchIncludeHiddenValue: boolean;
  readonly searchAutoIndexValue: boolean;
  readonly searchIndexStatusValue: string;
  readonly searchRebuildIndexPending: boolean;
  readonly omniboxNonBrowserSubmitTargetValue: WorkbenchOmniboxNonBrowserSubmitTarget;
  readonly localeOptions: readonly Option<WorkbenchLocale>[];
  readonly themeOptions: readonly Option<WorkbenchThemeId>[];
  readonly terminalThemeOptions: readonly Option<TerminalThemeMode>[];
  readonly splitTriggerModeOptions: readonly Option<WorkbenchSplitTriggerMode>[];
  readonly splitThreePaneLayoutOptions: readonly Option<WorkbenchSplitThreePaneLayout>[];
  readonly splitOverflowPolicyOptions: readonly Option<WorkbenchSplitOverflowPolicy>[];
  readonly searchScopeOptions: readonly Option<SearchLocalScopePreset>[];
  readonly searchDeepBudgetOptions: readonly Option<SearchDeepBudgetPreset>[];
  readonly deepSearchLocalOpenBehaviorOptions: readonly Option<"open_file" | "reveal_in_manager">[];
  readonly deepSearchCrawlPolicyOptions: readonly Option<SearchDeepCrawlPolicy>[];
  readonly searchWebEngineOptions: readonly Option<string>[];
  readonly omniboxNonBrowserSubmitTargetOptions: readonly Option<WorkbenchOmniboxNonBrowserSubmitTarget>[];
  readonly aiLabels: SettingsAiLabels;
  readonly aiModel: SettingsAiModel;
  readonly onLocaleChange: (value: WorkbenchLocale) => void;
  readonly onThemeChange: (value: WorkbenchThemeId) => void;
  readonly onTerminalThemeChange: (value: TerminalThemeMode) => void;
  readonly onSplitTriggerModeChange: (value: WorkbenchSplitTriggerMode) => void;
  readonly onSplitThreePaneLayoutChange: (
    value: WorkbenchSplitThreePaneLayout
  ) => void;
  readonly onSplitOverflowPolicyChange: (value: WorkbenchSplitOverflowPolicy) => void;
  readonly onAiRichRenderChange: (value: boolean) => void;
  readonly onSearchScopeChange: (value: SearchLocalScopePreset) => void;
  readonly onSearchCustomRootsChange: (value: string) => void;
  readonly onSearchWebEnginesChange: (value: readonly string[]) => void;
  readonly onSearchSearxngEndpointChange: (value: string) => void;
  readonly onSearchDeepBudgetChange: (value: SearchDeepBudgetPreset) => void;
  readonly onDeepSearchRestoreViewportChange: (value: boolean) => void;
  readonly onDeepSearchLocalOpenBehaviorChange: (value: "open_file" | "reveal_in_manager") => void;
  readonly onDeepSearchSiteExpansionChange: (value: boolean) => void;
  readonly onDeepSearchProactiveGuessChange: (value: boolean) => void;
  readonly onDeepSearchCrawlPolicyChange: (value: SearchDeepCrawlPolicy) => void;
  readonly onSearchEnableFuzzyChange: (value: boolean) => void;
  readonly onSearchEnableContentChange: (value: boolean) => void;
  readonly onSearchIncludeHiddenChange: (value: boolean) => void;
  readonly onSearchAutoIndexChange: (value: boolean) => void;
  readonly onSearchRebuildIndex: () => void;
  readonly onOmniboxNonBrowserSubmitTargetChange: (
    value: WorkbenchOmniboxNonBrowserSubmitTarget
  ) => void;
};

const buildThemePreviewClassName = (value: WorkbenchThemeId): string =>
  `lyra-settings-theme-preview-${value}`;

const buildTerminalThemePreviewClassName = (value: TerminalThemeMode): string =>
  `lyra-settings-terminal-preview-${value}`;

const buildSplitLayoutPreviewClassName = (value: WorkbenchSplitThreePaneLayout): string =>
  `lyra-settings-split-layout-preview-${value}`;

type SettingsCategoryId = "general" | "appearance" | "workspace" | "search" | "ai";

type SettingsCategory = {
  readonly id: SettingsCategoryId;
  readonly label: string;
};

export const BrowserSettingsSurface = ({
  title,
  aiCategoryLabel,
  languageLabel,
  themeLabel,
  terminalThemeLabel,
  splitTriggerModeLabel,
  splitThreePaneLayoutLabel,
  splitOverflowPolicyLabel,
  aiRichRenderLabel,
  aiRichRenderDescription,
  aiRichRenderEnabledLabel,
  aiRichRenderDisabledLabel,
  searchCategoryLabel,
  searchScopeLabel,
  searchCustomRootsLabel,
  searchCustomRootsPlaceholder,
  searchWebEnginesLabel,
  searchSearxngEndpointLabel,
  searchDeepBudgetLabel,
  deepSearchRestoreViewportLabel,
  deepSearchLocalOpenBehaviorLabel,
  deepSearchSiteExpansionLabel,
  deepSearchProactiveGuessLabel,
  deepSearchCrawlPolicyLabel,
  searchEnableFuzzyLabel,
  searchEnableContentLabel,
  searchIncludeHiddenLabel,
  searchAutoIndexLabel,
  searchIndexStatusLabel,
  searchRebuildIndexLabel,
  omniboxNonBrowserSubmitTargetLabel,
  localeValue,
  themeValue,
  terminalThemeValue,
  splitTriggerModeValue,
  splitThreePaneLayoutValue,
  splitOverflowPolicyValue,
  aiRichRenderValue,
  searchScopeValue,
  searchCustomRootsValue,
  searchWebEngineIds,
  searchSearxngEndpointValue,
  searchDeepBudgetValue,
  deepSearchRestoreViewportValue,
  deepSearchLocalOpenBehaviorValue,
  deepSearchSiteExpansionValue,
  deepSearchProactiveGuessValue,
  deepSearchCrawlPolicyValue,
  searchEnableFuzzyValue,
  searchEnableContentValue,
  searchIncludeHiddenValue,
  searchAutoIndexValue,
  searchIndexStatusValue,
  searchRebuildIndexPending,
  omniboxNonBrowserSubmitTargetValue,
  localeOptions,
  themeOptions,
  terminalThemeOptions,
  splitTriggerModeOptions,
  splitThreePaneLayoutOptions,
  splitOverflowPolicyOptions,
  searchScopeOptions,
  searchDeepBudgetOptions,
  deepSearchLocalOpenBehaviorOptions,
  deepSearchCrawlPolicyOptions,
  searchWebEngineOptions,
  omniboxNonBrowserSubmitTargetOptions,
  aiLabels,
  aiModel,
  onLocaleChange,
  onThemeChange,
  onTerminalThemeChange,
  onSplitTriggerModeChange,
  onSplitThreePaneLayoutChange,
  onSplitOverflowPolicyChange,
  onAiRichRenderChange,
  onSearchScopeChange,
  onSearchCustomRootsChange,
  onSearchWebEnginesChange,
  onSearchSearxngEndpointChange,
  onSearchDeepBudgetChange,
  onDeepSearchRestoreViewportChange,
  onDeepSearchLocalOpenBehaviorChange,
  onDeepSearchSiteExpansionChange,
  onDeepSearchProactiveGuessChange,
  onDeepSearchCrawlPolicyChange,
  onSearchEnableFuzzyChange,
  onSearchEnableContentChange,
  onSearchIncludeHiddenChange,
  onSearchAutoIndexChange,
  onSearchRebuildIndex,
  onOmniboxNonBrowserSubmitTargetChange
}: BrowserSettingsSurfaceProps) => {
  const [activeCategory, setActiveCategory] = useState<SettingsCategoryId>("general");
  const categories = useMemo<readonly SettingsCategory[]>(
    () => [
      { id: "general", label: languageLabel },
      { id: "appearance", label: themeLabel },
      { id: "workspace", label: splitThreePaneLayoutLabel },
      { id: "search", label: searchCategoryLabel },
      { id: "ai", label: aiCategoryLabel }
    ],
    [aiCategoryLabel, languageLabel, searchCategoryLabel, splitThreePaneLayoutLabel, themeLabel]
  );

  const scrollToCategory = (categoryId: SettingsCategoryId): void => {
    const target = document.getElementById(`lyra-settings-category-${categoryId}`);
    target?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  };

  return (
    <section className="lyra-settings-surface" aria-label="settings-surface">
      <div className="lyra-settings-shell">
        <aside className="lyra-settings-nav" aria-label="settings-nav">
          <h2>{title}</h2>
          <div className="lyra-settings-nav-list">
            {categories.map((category) => (
              <button
                key={category.id}
                className={category.id === activeCategory
                  ? "lyra-settings-nav-item lyra-settings-nav-item-active"
                  : "lyra-settings-nav-item"}
                type="button"
                onClick={() => {
                  setActiveCategory(category.id);
                  scrollToCategory(category.id);
                }}
              >
                {category.label}
              </button>
            ))}
          </div>
        </aside>

        <main className="lyra-settings-main">
          <section
            id="lyra-settings-category-general"
            className="lyra-settings-category"
            onMouseEnter={() => {
              setActiveCategory("general");
            }}
          >
            <header className="lyra-settings-category-header">
              <h2>{languageLabel}</h2>
            </header>
            <section className="lyra-settings-group">
              <header className="lyra-settings-group-header">
                <h3>{languageLabel}</h3>
              </header>
              <div className="lyra-settings-choice-grid" role="radiogroup" aria-label={languageLabel}>
                {localeOptions.map((option) => (
                  <button
                    key={option.value}
                    className={
                      option.value === localeValue
                        ? "lyra-settings-choice lyra-settings-choice-active"
                        : "lyra-settings-choice"
                    }
                    role="radio"
                    aria-checked={option.value === localeValue}
                    onClick={() => {
                      onLocaleChange(option.value);
                    }}
                  >
                    <span className="lyra-settings-choice-main">
                      <strong>{option.label}</strong>
                      {option.description === undefined ? null : <small>{option.description}</small>}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </section>

          <section
            id="lyra-settings-category-appearance"
            className="lyra-settings-category"
            onMouseEnter={() => {
              setActiveCategory("appearance");
            }}
          >
            <header className="lyra-settings-category-header">
              <h2>{themeLabel}</h2>
            </header>
            <section className="lyra-settings-group">
              <header className="lyra-settings-group-header">
                <h3>{themeLabel}</h3>
              </header>
              <div className="lyra-settings-choice-grid lyra-settings-choice-grid-themes" role="radiogroup" aria-label={themeLabel}>
                {themeOptions.map((option) => (
                  <button
                    key={option.value}
                    className={
                      option.value === themeValue
                        ? "lyra-settings-choice lyra-settings-choice-preview lyra-settings-choice-active"
                        : "lyra-settings-choice lyra-settings-choice-preview"
                    }
                    role="radio"
                    aria-checked={option.value === themeValue}
                    onClick={() => {
                      onThemeChange(option.value);
                    }}
                  >
                    <span
                      className={`lyra-settings-theme-preview ${buildThemePreviewClassName(option.value)}`}
                      aria-hidden="true"
                    >
                      <i className="lyra-settings-theme-preview-titlebar" />
                      <i className="lyra-settings-theme-preview-sidebar" />
                      <i className="lyra-settings-theme-preview-content">
                        <em />
                        <em />
                        <em />
                      </i>
                    </span>
                    <span className="lyra-settings-choice-main">
                      <strong>{option.label}</strong>
                      {option.description === undefined ? null : <small>{option.description}</small>}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="lyra-settings-group">
              <header className="lyra-settings-group-header">
                <h3>{terminalThemeLabel}</h3>
              </header>
              <div
                className="lyra-settings-choice-grid lyra-settings-choice-grid-themes"
                role="radiogroup"
                aria-label={terminalThemeLabel}
              >
                {terminalThemeOptions.map((option) => (
                  <button
                    key={option.value}
                    className={
                      option.value === terminalThemeValue
                        ? "lyra-settings-choice lyra-settings-choice-preview lyra-settings-choice-active"
                        : "lyra-settings-choice lyra-settings-choice-preview"
                    }
                    role="radio"
                    aria-checked={option.value === terminalThemeValue}
                    onClick={() => {
                      onTerminalThemeChange(option.value);
                    }}
                  >
                    <span
                      className={`lyra-settings-terminal-preview ${buildTerminalThemePreviewClassName(option.value)}`}
                      aria-hidden="true"
                    >
                      {option.value === "follow-app" ? (
                        <>
                          <div className="lyra-settings-terminal-preview-line">
                            <span className="lyra-term-seg-1">petehsu</span>
                            <span className="lyra-term-seg-2">~/Documents/Lyra</span>
                          </div>
                          <div className="lyra-settings-terminal-preview-line lyra-settings-terminal-preview-line-secondary">
                            <span className="lyra-term-seg-3">❯</span>
                            <span className="lyra-term-seg-4">npm run build</span>
                          </div>
                        </>
                      ) : option.value === "lyra-minimal" ? (
                        <>
                          <div className="lyra-settings-terminal-preview-line">
                            <span className="lyra-term-seg-1">~/Lyra</span>
                            <span className="lyra-term-seg-2">❯</span>
                          </div>
                        </>
                      ) : option.value === "lyra-standard" ? (
                        <>
                          <div className="lyra-settings-terminal-preview-line">
                            <span className="lyra-term-seg-1">petehsu</span>
                            <span className="lyra-term-seg-2"> ~/Lyra</span>
                            <span className="lyra-term-seg-3"> main</span>
                          </div>
                          <div className="lyra-settings-terminal-preview-line lyra-settings-terminal-preview-line-secondary">
                            <span className="lyra-term-seg-4">❯</span>
                          </div>
                        </>
                      ) : option.value === "lyra-rich" ? (
                        <>
                          <div className="lyra-settings-terminal-preview-line">
                            <span className="lyra-term-seg-1">petehsu</span>
                            <span className="lyra-term-seg-2"> ~/Lyra</span>
                            <span className="lyra-term-seg-3"> main</span>
                          </div>
                          <div className="lyra-settings-terminal-preview-line lyra-settings-terminal-preview-line-secondary">
                            <span className="lyra-term-seg-4"> 10:26:03</span>
                          </div>
                          <div className="lyra-settings-terminal-preview-line">
                            <span className="lyra-term-seg-2">❯</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="lyra-settings-terminal-preview-line">
                            <span className="lyra-term-seg-1">petehsu</span>
                            <span className="lyra-term-seg-2"> ~/Lyra</span>
                            <span className="lyra-term-seg-3"> main</span>
                          </div>
                          <div className="lyra-settings-terminal-preview-line lyra-settings-terminal-preview-line-secondary">
                            <span className="lyra-term-seg-4"> 10:26:03</span>
                            <span className="lyra-term-seg-1">[code:0 dur:0s]</span>
                          </div>
                          <div className="lyra-settings-terminal-preview-line">
                            <span className="lyra-term-seg-2">❯</span>
                          </div>
                        </>
                      )}
                    </span>
                    <span className="lyra-settings-choice-main">
                      <strong>{option.label}</strong>
                      {option.description === undefined ? null : <small>{option.description}</small>}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </section>

          <section
            id="lyra-settings-category-workspace"
            className="lyra-settings-category"
            onMouseEnter={() => {
              setActiveCategory("workspace");
            }}
          >
            <header className="lyra-settings-category-header">
              <h2>{splitTriggerModeLabel}</h2>
            </header>
            <section className="lyra-settings-group">
              <header className="lyra-settings-group-header">
                <h3>{splitTriggerModeLabel}</h3>
              </header>
              <div
                className="lyra-settings-choice-grid"
                role="radiogroup"
                aria-label={splitTriggerModeLabel}
              >
                {splitTriggerModeOptions.map((option) => (
                  <button
                    key={option.value}
                    className={
                      option.value === splitTriggerModeValue
                        ? "lyra-settings-choice lyra-settings-choice-active"
                        : "lyra-settings-choice"
                    }
                    role="radio"
                    aria-checked={option.value === splitTriggerModeValue}
                    onClick={() => {
                      onSplitTriggerModeChange(option.value);
                    }}
                  >
                    <span className="lyra-settings-choice-main">
                      <strong>{option.label}</strong>
                      {option.description === undefined ? null : <small>{option.description}</small>}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="lyra-settings-group">
              <header className="lyra-settings-group-header">
                <h3>{splitThreePaneLayoutLabel}</h3>
              </header>
              <div
                className="lyra-settings-choice-grid lyra-settings-choice-grid-themes lyra-settings-choice-grid-split-layout"
                role="radiogroup"
                aria-label={splitThreePaneLayoutLabel}
              >
                {splitThreePaneLayoutOptions.map((option) => (
                  <button
                    key={option.value}
                    title={option.label}
                    aria-label={option.label}
                    className={
                      option.value === splitThreePaneLayoutValue
                        ? "lyra-settings-choice lyra-settings-choice-preview lyra-settings-choice-split-layout-option lyra-settings-choice-active"
                        : "lyra-settings-choice lyra-settings-choice-preview lyra-settings-choice-split-layout-option"
                    }
                    role="radio"
                    aria-checked={option.value === splitThreePaneLayoutValue}
                    onClick={() => {
                      onSplitThreePaneLayoutChange(option.value);
                    }}
                  >
                    <span
                      className={`lyra-settings-split-layout-preview ${buildSplitLayoutPreviewClassName(option.value)}`}
                      aria-hidden="true"
                    >
                      <i className="lyra-settings-split-layout-pane lyra-settings-split-layout-pane-1" />
                      <i className="lyra-settings-split-layout-pane lyra-settings-split-layout-pane-2" />
                      <i className="lyra-settings-split-layout-pane lyra-settings-split-layout-pane-3" />
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="lyra-settings-group">
              <header className="lyra-settings-group-header">
                <h3>{splitOverflowPolicyLabel}</h3>
              </header>
              <div
                className="lyra-settings-choice-grid"
                role="radiogroup"
                aria-label={splitOverflowPolicyLabel}
              >
                {splitOverflowPolicyOptions.map((option) => (
                  <button
                    key={option.value}
                    className={
                      option.value === splitOverflowPolicyValue
                        ? "lyra-settings-choice lyra-settings-choice-active"
                        : "lyra-settings-choice"
                    }
                    role="radio"
                    aria-checked={option.value === splitOverflowPolicyValue}
                    onClick={() => {
                      onSplitOverflowPolicyChange(option.value);
                    }}
                  >
                    <span className="lyra-settings-choice-main">
                      <strong>{option.label}</strong>
                      {option.description === undefined ? null : <small>{option.description}</small>}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </section>

          <section
            id="lyra-settings-category-search"
            className="lyra-settings-category"
            onMouseEnter={() => {
              setActiveCategory("search");
            }}
          >
            <header className="lyra-settings-category-header">
              <h2>{searchCategoryLabel}</h2>
            </header>

            <section className="lyra-settings-group">
              <header className="lyra-settings-group-header">
                <h3>{omniboxNonBrowserSubmitTargetLabel}</h3>
              </header>
              <div className="lyra-settings-choice-grid" role="radiogroup" aria-label={omniboxNonBrowserSubmitTargetLabel}>
                {omniboxNonBrowserSubmitTargetOptions.map((option) => (
                  <button
                    key={option.value}
                    className={
                      option.value === omniboxNonBrowserSubmitTargetValue
                        ? "lyra-settings-choice lyra-settings-choice-active"
                        : "lyra-settings-choice"
                    }
                    role="radio"
                    aria-checked={option.value === omniboxNonBrowserSubmitTargetValue}
                    onClick={() => {
                      onOmniboxNonBrowserSubmitTargetChange(option.value);
                    }}
                  >
                    <span className="lyra-settings-choice-main">
                      <strong>{option.label}</strong>
                      {option.description === undefined ? null : <small>{option.description}</small>}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="lyra-settings-group">
              <header className="lyra-settings-group-header">
                <h3>{searchScopeLabel}</h3>
              </header>
              <div className="lyra-settings-choice-grid" role="radiogroup" aria-label={searchScopeLabel}>
                {searchScopeOptions.map((option) => (
                  <button
                    key={option.value}
                    className={
                      option.value === searchScopeValue
                        ? "lyra-settings-choice lyra-settings-choice-active"
                        : "lyra-settings-choice"
                    }
                    role="radio"
                    aria-checked={option.value === searchScopeValue}
                    onClick={() => {
                      onSearchScopeChange(option.value);
                    }}
                  >
                    <span className="lyra-settings-choice-main">
                      <strong>{option.label}</strong>
                      {option.description === undefined ? null : <small>{option.description}</small>}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="lyra-settings-group">
              <header className="lyra-settings-group-header">
                <h3>{searchCustomRootsLabel}</h3>
              </header>
              <textarea
                className="lyra-settings-textarea"
                value={searchCustomRootsValue}
                placeholder={searchCustomRootsPlaceholder}
                onChange={(event) => {
                  onSearchCustomRootsChange(event.target.value);
                }}
              />
            </section>

            <section className="lyra-settings-group">
              <header className="lyra-settings-group-header">
                <h3>{searchWebEnginesLabel}</h3>
              </header>
              <div className="lyra-settings-choice-grid" role="group" aria-label={searchWebEnginesLabel}>
                {searchWebEngineOptions.map((option) => {
                  const checked = searchWebEngineIds.includes(option.value);
                  return (
                    <button
                      key={option.value}
                      className={
                        checked
                          ? "lyra-settings-choice lyra-settings-choice-active"
                          : "lyra-settings-choice"
                      }
                      type="button"
                      onClick={() => {
                        if (checked) {
                          onSearchWebEnginesChange(
                            searchWebEngineIds.filter((value) => value !== option.value)
                          );
                          return;
                        }
                        onSearchWebEnginesChange([...searchWebEngineIds, option.value]);
                      }}
                    >
                      <span className="lyra-settings-choice-main">
                        <strong>{option.label}</strong>
                        {option.description === undefined ? null : <small>{option.description}</small>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="lyra-settings-group">
              <header className="lyra-settings-group-header">
                <h3>{searchDeepBudgetLabel}</h3>
              </header>
              <div className="lyra-settings-choice-grid" role="radiogroup" aria-label={searchDeepBudgetLabel}>
                {searchDeepBudgetOptions.map((option) => (
                  <button
                    key={option.value}
                    className={
                      option.value === searchDeepBudgetValue
                        ? "lyra-settings-choice lyra-settings-choice-active"
                        : "lyra-settings-choice"
                    }
                    role="radio"
                    aria-checked={option.value === searchDeepBudgetValue}
                    onClick={() => {
                      onSearchDeepBudgetChange(option.value);
                    }}
                  >
                    <span className="lyra-settings-choice-main">
                      <strong>{option.label}</strong>
                      {option.description === undefined ? null : <small>{option.description}</small>}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="lyra-settings-group">
              <header className="lyra-settings-group-header">
                <h3>{deepSearchRestoreViewportLabel}</h3>
              </header>
              <div className="lyra-settings-choice-grid" role="group" aria-label={deepSearchRestoreViewportLabel}>
                <button
                  className={
                    deepSearchRestoreViewportValue
                      ? "lyra-settings-choice lyra-settings-choice-active"
                      : "lyra-settings-choice"
                  }
                  type="button"
                  onClick={() => {
                    onDeepSearchRestoreViewportChange(!deepSearchRestoreViewportValue);
                  }}
                >
                  <span className="lyra-settings-choice-main">
                    <strong>{deepSearchRestoreViewportLabel}</strong>
                  </span>
                </button>
              </div>
            </section>

            <section className="lyra-settings-group">
              <header className="lyra-settings-group-header">
                <h3>{deepSearchLocalOpenBehaviorLabel}</h3>
              </header>
              <div className="lyra-settings-choice-grid" role="radiogroup" aria-label={deepSearchLocalOpenBehaviorLabel}>
                {deepSearchLocalOpenBehaviorOptions.map((option) => (
                  <button
                    key={option.value}
                    className={
                      option.value === deepSearchLocalOpenBehaviorValue
                        ? "lyra-settings-choice lyra-settings-choice-active"
                        : "lyra-settings-choice"
                    }
                    role="radio"
                    aria-checked={option.value === deepSearchLocalOpenBehaviorValue}
                    onClick={() => {
                      onDeepSearchLocalOpenBehaviorChange(option.value);
                    }}
                  >
                    <span className="lyra-settings-choice-main">
                      <strong>{option.label}</strong>
                      {option.description === undefined ? null : <small>{option.description}</small>}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="lyra-settings-group">
              <header className="lyra-settings-group-header">
                <h3>{deepSearchSiteExpansionLabel}</h3>
              </header>
              <div className="lyra-settings-choice-grid" role="group" aria-label={deepSearchSiteExpansionLabel}>
                <button
                  className={
                    deepSearchSiteExpansionValue
                      ? "lyra-settings-choice lyra-settings-choice-active"
                      : "lyra-settings-choice"
                  }
                  type="button"
                  onClick={() => {
                    onDeepSearchSiteExpansionChange(!deepSearchSiteExpansionValue);
                  }}
                >
                  <span className="lyra-settings-choice-main">
                    <strong>{deepSearchSiteExpansionLabel}</strong>
                  </span>
                </button>
                <button
                  className={
                    deepSearchProactiveGuessValue
                      ? "lyra-settings-choice lyra-settings-choice-active"
                      : "lyra-settings-choice"
                  }
                  type="button"
                  onClick={() => {
                    onDeepSearchProactiveGuessChange(!deepSearchProactiveGuessValue);
                  }}
                >
                  <span className="lyra-settings-choice-main">
                    <strong>{deepSearchProactiveGuessLabel}</strong>
                  </span>
                </button>
              </div>
            </section>

            <section className="lyra-settings-group">
              <header className="lyra-settings-group-header">
                <h3>{deepSearchCrawlPolicyLabel}</h3>
              </header>
              <div className="lyra-settings-choice-grid" role="radiogroup" aria-label={deepSearchCrawlPolicyLabel}>
                {deepSearchCrawlPolicyOptions.map((option) => (
                  <button
                    key={option.value}
                    className={
                      option.value === deepSearchCrawlPolicyValue
                        ? "lyra-settings-choice lyra-settings-choice-active"
                        : "lyra-settings-choice"
                    }
                    role="radio"
                    aria-checked={option.value === deepSearchCrawlPolicyValue}
                    onClick={() => {
                      onDeepSearchCrawlPolicyChange(option.value);
                    }}
                  >
                    <span className="lyra-settings-choice-main">
                      <strong>{option.label}</strong>
                      {option.description === undefined ? null : <small>{option.description}</small>}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="lyra-settings-group">
              <header className="lyra-settings-group-header">
                <h3>{searchSearxngEndpointLabel}</h3>
              </header>
              <input
                className="lyra-settings-input"
                value={searchSearxngEndpointValue}
                placeholder="https://your-searxng.example.com"
                onChange={(event) => {
                  onSearchSearxngEndpointChange(event.target.value);
                }}
              />
            </section>

            <section className="lyra-settings-group lyra-settings-group-cluster">
              <header className="lyra-settings-group-header">
                <h3>{searchEnableContentLabel}</h3>
              </header>
              <div
                className="lyra-settings-choice-grid lyra-settings-choice-grid-flags"
                role="group"
                aria-label={searchEnableContentLabel}
              >
                <button
                  className={
                    searchEnableFuzzyValue
                      ? "lyra-settings-choice lyra-settings-choice-active"
                      : "lyra-settings-choice"
                  }
                  type="button"
                  onClick={() => {
                    onSearchEnableFuzzyChange(!searchEnableFuzzyValue);
                  }}
                >
                  <span className="lyra-settings-choice-main">
                    <strong>{searchEnableFuzzyLabel}</strong>
                  </span>
                </button>
                <button
                  className={
                    searchEnableContentValue
                      ? "lyra-settings-choice lyra-settings-choice-active"
                      : "lyra-settings-choice"
                  }
                  type="button"
                  onClick={() => {
                    onSearchEnableContentChange(!searchEnableContentValue);
                  }}
                >
                  <span className="lyra-settings-choice-main">
                    <strong>{searchEnableContentLabel}</strong>
                  </span>
                </button>
                <button
                  className={
                    searchIncludeHiddenValue
                      ? "lyra-settings-choice lyra-settings-choice-active"
                      : "lyra-settings-choice"
                  }
                  type="button"
                  onClick={() => {
                    onSearchIncludeHiddenChange(!searchIncludeHiddenValue);
                  }}
                >
                  <span className="lyra-settings-choice-main">
                    <strong>{searchIncludeHiddenLabel}</strong>
                  </span>
                </button>
                <button
                  className={
                    searchAutoIndexValue
                      ? "lyra-settings-choice lyra-settings-choice-active"
                      : "lyra-settings-choice"
                  }
                  type="button"
                  onClick={() => {
                    onSearchAutoIndexChange(!searchAutoIndexValue);
                  }}
                >
                  <span className="lyra-settings-choice-main">
                    <strong>{searchAutoIndexLabel}</strong>
                  </span>
                </button>
              </div>
              <div className="lyra-settings-inline-status-row" role="group" aria-label={searchIndexStatusLabel}>
                <div className="lyra-settings-inline-status-copy">
                  <small>{searchIndexStatusLabel}</small>
                  <strong>{searchIndexStatusValue}</strong>
                </div>
                <button
                  className="lyra-settings-ai-action"
                  type="button"
                  disabled={searchRebuildIndexPending}
                  onClick={onSearchRebuildIndex}
                >
                  {searchRebuildIndexPending ? `${searchRebuildIndexLabel}...` : searchRebuildIndexLabel}
                </button>
              </div>
            </section>
          </section>

          <section
            id="lyra-settings-category-ai"
            className="lyra-settings-category"
            onMouseEnter={() => {
              setActiveCategory("ai");
            }}
          >
            <header className="lyra-settings-category-header">
              <h2>{aiCategoryLabel}</h2>
            </header>
            <section className="lyra-settings-group">
              <header className="lyra-settings-group-header">
                <h3>{aiRichRenderLabel}</h3>
              </header>
              <div className="lyra-settings-choice-grid" role="radiogroup" aria-label={aiRichRenderLabel}>
                <button
                  type="button"
                  className={
                    aiRichRenderValue
                      ? "lyra-settings-choice lyra-settings-choice-active"
                      : "lyra-settings-choice"
                  }
                  role="radio"
                  aria-checked={aiRichRenderValue}
                  onClick={() => {
                    onAiRichRenderChange(true);
                  }}
                >
                  <span className="lyra-settings-choice-main">
                    <strong>{aiRichRenderEnabledLabel}</strong>
                    <small>{aiRichRenderDescription}</small>
                  </span>
                </button>
                <button
                  type="button"
                  className={
                    aiRichRenderValue
                      ? "lyra-settings-choice"
                      : "lyra-settings-choice lyra-settings-choice-active"
                  }
                  role="radio"
                  aria-checked={aiRichRenderValue === false}
                  onClick={() => {
                    onAiRichRenderChange(false);
                  }}
                >
                  <span className="lyra-settings-choice-main">
                    <strong>{aiRichRenderDisabledLabel}</strong>
                    <small>{aiRichRenderDescription}</small>
                  </span>
                </button>
              </div>
            </section>
            <SettingsAiView labels={aiLabels} model={aiModel} />
          </section>
        </main>
      </div>
    </section>
  );
};
