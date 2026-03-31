import { useMemo, useState } from "react";

import type { WorkbenchLocale } from "../i18n";
import type {
  WorkbenchSplitOverflowPolicy,
  WorkbenchSplitThreePaneLayout,
  WorkbenchSplitTriggerMode
} from "../preferences";
import type { WorkbenchThemeId } from "../theme";
import type { TerminalThemePresetId } from "../terminal-theme";
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
  readonly localeValue: WorkbenchLocale;
  readonly themeValue: WorkbenchThemeId;
  readonly terminalThemeValue: TerminalThemePresetId;
  readonly splitTriggerModeValue: WorkbenchSplitTriggerMode;
  readonly splitThreePaneLayoutValue: WorkbenchSplitThreePaneLayout;
  readonly splitOverflowPolicyValue: WorkbenchSplitOverflowPolicy;
  readonly localeOptions: readonly Option<WorkbenchLocale>[];
  readonly themeOptions: readonly Option<WorkbenchThemeId>[];
  readonly terminalThemeOptions: readonly (Option<TerminalThemePresetId> & { readonly swatches: readonly string[] })[];
  readonly splitTriggerModeOptions: readonly Option<WorkbenchSplitTriggerMode>[];
  readonly splitThreePaneLayoutOptions: readonly Option<WorkbenchSplitThreePaneLayout>[];
  readonly splitOverflowPolicyOptions: readonly Option<WorkbenchSplitOverflowPolicy>[];
  readonly aiLabels: SettingsAiLabels;
  readonly aiModel: SettingsAiModel;
  readonly onLocaleChange: (value: WorkbenchLocale) => void;
  readonly onThemeChange: (value: WorkbenchThemeId) => void;
  readonly onTerminalThemeChange: (value: TerminalThemePresetId) => void;
  readonly onSplitTriggerModeChange: (value: WorkbenchSplitTriggerMode) => void;
  readonly onSplitThreePaneLayoutChange: (
    value: WorkbenchSplitThreePaneLayout
  ) => void;
  readonly onSplitOverflowPolicyChange: (value: WorkbenchSplitOverflowPolicy) => void;
};

const buildThemePreviewClassName = (value: WorkbenchThemeId): string =>
  `lyra-settings-theme-preview-${value}`;

const buildTerminalPreviewClassName = (value: TerminalThemePresetId): string =>
  `lyra-settings-terminal-preview-${value}`;

const buildSplitLayoutPreviewClassName = (value: WorkbenchSplitThreePaneLayout): string =>
  `lyra-settings-split-layout-preview-${value}`;

type SettingsCategoryId = "general" | "appearance" | "workspace" | "ai";

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
  localeValue,
  themeValue,
  terminalThemeValue,
  splitTriggerModeValue,
  splitThreePaneLayoutValue,
  splitOverflowPolicyValue,
  localeOptions,
  themeOptions,
  terminalThemeOptions,
  splitTriggerModeOptions,
  splitThreePaneLayoutOptions,
  splitOverflowPolicyOptions,
  aiLabels,
  aiModel,
  onLocaleChange,
  onThemeChange,
  onTerminalThemeChange,
  onSplitTriggerModeChange,
  onSplitThreePaneLayoutChange,
  onSplitOverflowPolicyChange
}: BrowserSettingsSurfaceProps) => {
  const [activeCategory, setActiveCategory] = useState<SettingsCategoryId>("general");
  const categories = useMemo<readonly SettingsCategory[]>(
    () => [
      { id: "general", label: languageLabel },
      { id: "appearance", label: themeLabel },
      { id: "workspace", label: splitThreePaneLayoutLabel },
      { id: "ai", label: aiCategoryLabel }
    ],
    [aiCategoryLabel, languageLabel, splitThreePaneLayoutLabel, themeLabel]
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
              <div className="lyra-settings-choice-grid lyra-settings-choice-grid-themes" role="radiogroup" aria-label={terminalThemeLabel}>
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
                      className={`lyra-settings-terminal-preview ${buildTerminalPreviewClassName(option.value)}`}
                      aria-hidden="true"
                    >
                      <i className="lyra-settings-terminal-preview-line">
                        {option.swatches.map((swatch) => (
                          <em
                            key={`${option.value}-${swatch}`}
                            style={{ backgroundColor: swatch }}
                          />
                        ))}
                      </i>
                      <i className="lyra-settings-terminal-preview-line">
                        {option.swatches.map((swatch) => (
                          <em
                            key={`${option.value}-${swatch}-line-2`}
                            style={{ backgroundColor: swatch }}
                          />
                        ))}
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
            id="lyra-settings-category-ai"
            className="lyra-settings-category"
            onMouseEnter={() => {
              setActiveCategory("ai");
            }}
          >
            <header className="lyra-settings-category-header">
              <h2>{aiCategoryLabel}</h2>
            </header>
            <SettingsAiView labels={aiLabels} model={aiModel} />
          </section>
        </main>
      </div>
    </section>
  );
};
