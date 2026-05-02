import type { ReactNode } from "react";

import { SettingsAiView } from "../settings-ai";
import type { SettingsCategoryId } from "./settings-schema";
import type {
  SettingsBooleanChoiceControlDescriptor,
  SettingsChoiceControlDescriptor,
  SettingsControlDescriptor,
  SettingsInlineStatusActionControlDescriptor,
  SettingsMultiChoiceControlDescriptor,
  SettingsRenderedSection,
  SettingsSurfaceModel,
  SettingsTextControlDescriptor,
  SettingsToggleGroupControlDescriptor
} from "./settings-render-model";

type SettingsSurfaceViewProps = {
  readonly model: SettingsSurfaceModel;
  readonly activeCategory: SettingsCategoryId;
  readonly onActivateCategory: (categoryId: SettingsCategoryId) => void;
  readonly onCategoryPointerEnter: (categoryId: SettingsCategoryId) => void;
};

const buildThemePreviewClassName = (value: string): string =>
  `lyra-settings-theme-preview-${value}`;

const buildTerminalThemePreviewClassName = (value: string): string =>
  `lyra-settings-terminal-preview-${value}`;

const buildSplitLayoutPreviewClassName = (value: string): string =>
  `lyra-settings-split-layout-preview-${value}`;

const SettingsGroup = ({
  label,
  children,
  cluster = false
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly cluster?: boolean;
}) => (
  <section className={cluster ? "lyra-settings-group lyra-settings-group-cluster" : "lyra-settings-group"}>
    <header className="lyra-settings-group-header">
      <h3>{label}</h3>
    </header>
    {children}
  </section>
);

const SettingsToggleButton = ({
  label,
  active,
  onClick
}: {
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
}) => (
  <button
    className={active ? "lyra-settings-choice lyra-settings-choice-active" : "lyra-settings-choice"}
    type="button"
    onClick={onClick}
  >
    <span className="lyra-settings-choice-main">
      <strong>{label}</strong>
    </span>
  </button>
);

const renderThemePreview = (value: string): ReactNode => (
  <span
    className={`lyra-settings-theme-preview ${buildThemePreviewClassName(value)}`}
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
);

const renderTerminalThemePreview = (value: string): ReactNode => (
  <span
    className={`lyra-settings-terminal-preview ${buildTerminalThemePreviewClassName(value)}`}
    aria-hidden="true"
  >
    {value === "follow-app" ? (
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
    ) : value === "lyra-minimal" ? (
      <div className="lyra-settings-terminal-preview-line">
        <span className="lyra-term-seg-1">~/Lyra</span>
        <span className="lyra-term-seg-2">❯</span>
      </div>
    ) : value === "lyra-standard" ? (
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
    ) : value === "lyra-rich" ? (
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
);

const renderSplitLayoutPreview = (value: string): ReactNode => (
  <span
    className={`lyra-settings-split-layout-preview ${buildSplitLayoutPreviewClassName(value)}`}
    aria-hidden="true"
  >
    <i className="lyra-settings-split-layout-pane lyra-settings-split-layout-pane-1" />
    <i className="lyra-settings-split-layout-pane lyra-settings-split-layout-pane-2" />
    <i className="lyra-settings-split-layout-pane lyra-settings-split-layout-pane-3" />
  </span>
);

const renderPreview = (control: SettingsChoiceControlDescriptor, value: string): ReactNode => {
  switch (control.previewKind) {
    case "theme":
      return renderThemePreview(value);
    case "terminal-theme":
      return renderTerminalThemePreview(value);
    case "split-layout":
      return renderSplitLayoutPreview(value);
    default:
      return null;
  }
};

const SettingsChoiceGrid = ({ control }: { readonly control: SettingsChoiceControlDescriptor }) => (
  <>
    <div
      className={control.gridClassName ?? "lyra-settings-choice-grid"}
      role="radiogroup"
      aria-label={control.label}
    >
      {control.options.map((option) => {
        const active = option.value === control.value;
        const className = [
          "lyra-settings-choice",
          control.previewKind === undefined ? "" : "lyra-settings-choice-preview",
          control.optionClassName ?? "",
          active ? "lyra-settings-choice-active" : ""
        ]
          .filter((entry) => entry.length > 0)
          .join(" ");
        const showOptionText = control.showOptionText !== false;

        return (
          <button
            key={option.value}
            type="button"
            title={showOptionText ? undefined : option.label}
            aria-label={showOptionText ? undefined : option.label}
            className={className}
            role="radio"
            aria-checked={active}
            onClick={() => {
              control.onChange(option.value);
            }}
          >
            {renderPreview(control, option.value)}
            {showOptionText ? (
              <span className="lyra-settings-choice-main">
                <strong>{option.label}</strong>
                {option.description === undefined ? null : <small>{option.description}</small>}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
    {control.description === undefined ? null : (
      <p className="lyra-settings-description">{control.description}</p>
    )}
  </>
);

const SettingsBooleanChoice = ({ control }: { readonly control: SettingsBooleanChoiceControlDescriptor }) => (
  <div className="lyra-settings-choice-grid" role="radiogroup" aria-label={control.label}>
    <button
      type="button"
      className={control.value ? "lyra-settings-choice lyra-settings-choice-active" : "lyra-settings-choice"}
      role="radio"
      aria-checked={control.value}
      onClick={() => {
        control.onChange(true);
      }}
    >
      <span className="lyra-settings-choice-main">
        <strong>{control.enabledLabel}</strong>
        <small>{control.description}</small>
      </span>
    </button>
    <button
      type="button"
      className={control.value ? "lyra-settings-choice" : "lyra-settings-choice lyra-settings-choice-active"}
      role="radio"
      aria-checked={control.value === false}
      onClick={() => {
        control.onChange(false);
      }}
    >
      <span className="lyra-settings-choice-main">
        <strong>{control.disabledLabel}</strong>
        <small>{control.description}</small>
      </span>
    </button>
  </div>
);

const SettingsTextControl = ({ control }: { readonly control: SettingsTextControlDescriptor }) => {
  if (control.kind === "textarea") {
    return (
      <textarea
        className="lyra-settings-textarea"
        value={control.value}
        placeholder={control.placeholder}
        onChange={(event) => {
          control.onChange(event.target.value);
        }}
      />
    );
  }

  return (
    <input
      className="lyra-settings-input"
      value={control.value}
      placeholder={control.placeholder}
      onChange={(event) => {
        control.onChange(event.target.value);
      }}
    />
  );
};

const SettingsToggleGroup = ({ control }: { readonly control: SettingsToggleGroupControlDescriptor }) => (
  <div
    className={control.gridClassName ?? "lyra-settings-choice-grid"}
    role="group"
    aria-label={control.label}
  >
    {control.toggles.map((toggle) => (
      <SettingsToggleButton
        key={toggle.id}
        label={toggle.label}
        active={toggle.active}
        onClick={toggle.onToggle}
      />
    ))}
  </div>
);

const SettingsMultiChoice = ({ control }: { readonly control: SettingsMultiChoiceControlDescriptor }) => (
  <div className="lyra-settings-choice-grid" role="group" aria-label={control.label}>
    {control.options.map((option) => {
      const checked = control.selectedValues.includes(option.value);
      return (
        <button
          key={option.value}
          className={checked ? "lyra-settings-choice lyra-settings-choice-active" : "lyra-settings-choice"}
          type="button"
          onClick={() => {
            if (checked) {
              control.onChange(control.selectedValues.filter((value) => value !== option.value));
              return;
            }
            control.onChange([...control.selectedValues, option.value]);
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
);

const SettingsInlineStatusAction = ({
  control
}: {
  readonly control: SettingsInlineStatusActionControlDescriptor;
}) => (
  <div className="lyra-settings-inline-status-row" role="group" aria-label={control.label}>
    <div className="lyra-settings-inline-status-copy">
      <small>{control.statusLabel}</small>
      <strong>{control.statusValue}</strong>
    </div>
    <button
      className="lyra-settings-ai-action"
      type="button"
      disabled={control.actionDisabled}
      onClick={control.onAction}
    >
      {control.actionLabel}
    </button>
  </div>
);

const renderControl = (control: SettingsControlDescriptor): ReactNode => {
  switch (control.kind) {
    case "boolean-choice":
      return <SettingsBooleanChoice control={control} />;
    case "choice":
      return <SettingsChoiceGrid control={control} />;
    case "custom":
      return <SettingsAiView labels={control.labels} model={control.model} />;
    case "inline-status-action":
      return <SettingsInlineStatusAction control={control} />;
    case "multi-choice":
      return <SettingsMultiChoice control={control} />;
    case "text":
    case "textarea":
      return <SettingsTextControl control={control} />;
    case "toggle-group":
      return <SettingsToggleGroup control={control} />;
    default:
      return null;
  }
};

const renderSection = (section: SettingsRenderedSection): ReactNode => {
  const controls = section.controls.map((control, index) => (
    <div key={`${section.id}-${control.kind}-${index}`}>
      {renderControl(control)}
    </div>
  ));

  if (section.frame === "none") {
    return controls;
  }

  return (
    <SettingsGroup label={section.label} cluster={section.cluster}>
      {controls}
    </SettingsGroup>
  );
};

export const SettingsSurfaceView = ({
  model,
  activeCategory,
  onActivateCategory,
  onCategoryPointerEnter
}: SettingsSurfaceViewProps) => (
  <section className="lyra-settings-surface" aria-label="settings-surface">
    <div className="lyra-settings-shell">
      <aside className="lyra-settings-nav" aria-label="settings-nav">
        <div className="lyra-settings-nav-list">
          {model.categories.map((category) => (
            <button
              key={category.id}
              className={category.id === activeCategory
                ? "lyra-settings-nav-item lyra-settings-nav-item-active"
                : "lyra-settings-nav-item"}
              type="button"
              onClick={() => {
                onActivateCategory(category.id);
              }}
            >
              {category.navLabel}
            </button>
          ))}
        </div>
      </aside>

      <main className="lyra-settings-main">
        {model.categories.map((category) => (
          <section
            key={category.id}
            id={category.domId}
            className="lyra-settings-category"
            onMouseEnter={() => {
              onCategoryPointerEnter(category.id);
            }}
          >
            <header className="lyra-settings-category-header">
              <h2>{category.heading}</h2>
            </header>
            {category.sections.map((section) => (
              <div key={section.id}>
                {renderSection(section)}
              </div>
            ))}
          </section>
        ))}
      </main>
    </div>
  </section>
);
