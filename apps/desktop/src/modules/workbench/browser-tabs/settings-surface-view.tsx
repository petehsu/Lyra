import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Bell,
  BookText,
  KeyRound,
  AppWindow,
  Monitor,
  Moon,
  Package,
  Palette,
  ScrollText,
  Search,
  Settings2,
  Sparkles,
  Sun,
  Terminal,
  Webhook,
  type LucideIcon
} from "lucide-react";

import {
  AppButton,
  AppInput,
  AppSelect,
  type AppSelectOption,
  AppSettingsRow,
  AppSettingsSection,
  AppSwitch,
  AppTextarea
} from "@renderer/ui/components";
import { SettingsAiMcpView, SettingsAiModelsView, SettingsAiSkillsView, SettingsAiView } from "../settings-ai";
import { LoginManagerSurface } from "../login-manager";
import { SoftwareStoreSurface } from "../software-store";
import type { SettingsCategoryId } from "./settings-schema";
import type {
  SettingsBooleanChoiceControlDescriptor,
  SettingsChoiceControlDescriptor,
  SettingsControlDescriptor,
  SettingsInlineStatusActionControlDescriptor,
  SettingsLegalNoticesCustomControlDescriptor,
  SettingsMultiChoiceControlDescriptor,
  SettingsRenderedSection,
  SettingsStatusListControlDescriptor,
  SettingsSurfaceModel,
  SettingsTextControlDescriptor,
  SettingsToggleGroupControlDescriptor
} from "./settings-render-model";
import type {
  ThirdPartyNoticeItem,
  ThirdPartyNoticesDocument
} from "../../../shared/desktop-bridge";

type SettingsSurfaceViewProps = {
  readonly model: SettingsSurfaceModel;
  readonly activeCategory: SettingsCategoryId;
  readonly onActivateCategory: (categoryId: SettingsCategoryId) => void;
  readonly docsNavLabel: string;
  readonly onOpenDocs: () => void;
};

const SETTINGS_CATEGORY_ICONS: Partial<Record<SettingsCategoryId, LucideIcon>> = {
  appearance: Palette,
  general: Settings2,
  legal: ScrollText,
  linux: Terminal,
  loginManager: KeyRound,
  models: Package,
  mcp: Webhook,
  notifications: Bell,
  softwareStore: AppWindow,
  search: Search,
  skills: Sparkles,
  workspace: Monitor
};

const THEME_SELECT_ICONS: Partial<Record<string, LucideIcon>> = {
  "lyra-dark": Moon,
  "lyra-light": Sun,
  "lyra-system": Monitor
};

const resolveSelectedChoiceDescription = (
  control: SettingsChoiceControlDescriptor
): string | undefined => {
  if (control.description !== undefined) {
    return control.description;
  }
  return control.options.find((option) => option.value === control.value)?.description;
};

const buildSelectOptions = (
  control: SettingsChoiceControlDescriptor
): readonly AppSelectOption[] => control.options.map((option) => {
  const Icon = control.previewKind === "theme"
    ? THEME_SELECT_ICONS[option.value]
    : undefined;

  return {
    ...option,
    ...(Icon === undefined
      ? {}
      : {
          icon: <Icon aria-hidden="true" />
        })
  };
});

const SettingsChoiceSelect = ({ control }: { readonly control: SettingsChoiceControlDescriptor }) => (
  <AppSettingsRow
    title={control.label}
    description={resolveSelectedChoiceDescription(control)}
    control={(
      <AppSelect
        ariaLabel={control.label}
        className="lyra-settings-select"
        contentClassName={control.options.some((option) => option.description !== undefined)
          ? "lyra-settings-select-content lyra-settings-select-content-rich"
          : "lyra-settings-select-content"}
        value={control.value}
        options={buildSelectOptions(control)}
        onValueChange={control.onChange}
      />
    )}
  />
);

const SettingsBooleanChoice = ({ control }: { readonly control: SettingsBooleanChoiceControlDescriptor }) => (
  <AppSettingsRow
    title={control.label}
    description={control.description}
    control={(
      <AppSwitch
        checked={control.value}
        aria-label={control.label}
        onCheckedChange={control.onChange}
      />
    )}
  />
);

const SettingsTextControl = ({ control }: { readonly control: SettingsTextControlDescriptor }) => {
  if (control.kind === "textarea") {
    return (
      <AppSettingsRow
        className="lyra-settings-row-block-control"
        title={control.label}
        control={(
          <AppTextarea
            aria-label={control.label}
            className="lyra-settings-textarea"
            value={control.value}
            placeholder={control.placeholder}
            onChange={(event) => {
              control.onChange(event.target.value);
            }}
          />
        )}
      />
    );
  }

  return (
    <AppSettingsRow
      title={control.label}
      control={(
        <AppInput
          aria-label={control.label}
          className="lyra-settings-input lyra-settings-inline-input"
          value={control.value}
          placeholder={control.placeholder}
          onChange={(event) => {
            control.onChange(event.target.value);
          }}
        />
      )}
    />
  );
};

const SettingsToggleGroup = ({ control }: { readonly control: SettingsToggleGroupControlDescriptor }) => (
  <div
    className="lyra-settings-row-list"
    role="group"
    aria-label={control.label}
  >
    {control.toggles.map((toggle) => (
      <AppSettingsRow
        key={toggle.id}
        title={toggle.label}
        control={(
          <AppSwitch
            checked={toggle.active}
            aria-label={toggle.label}
            onCheckedChange={toggle.onToggle}
          />
        )}
      />
    ))}
  </div>
);

const SettingsMultiChoice = ({ control }: { readonly control: SettingsMultiChoiceControlDescriptor }) => (
  <div className="lyra-settings-row-list" role="group" aria-label={control.label}>
    {control.options.map((option) => {
      const checked = control.selectedValues.includes(option.value);
      return (
        <AppSettingsRow
          key={option.value}
          title={option.label}
          description={option.description}
          control={(
            <AppSwitch
              checked={checked}
              aria-label={option.label}
              onCheckedChange={(nextChecked) => {
                if (!nextChecked) {
                  control.onChange(control.selectedValues.filter((value) => value !== option.value));
                  return;
                }
                control.onChange([...control.selectedValues, option.value]);
              }}
            />
          )}
        />
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
    <AppButton
      variant="outline"
      size="sm"
      className="lyra-settings-ai-action"
      type="button"
      disabled={control.actionDisabled}
      onClick={control.onAction}
    >
      {control.actionLabel}
    </AppButton>
  </div>
);

const SettingsStatusList = ({
  control
}: {
  readonly control: SettingsStatusListControlDescriptor;
}) => (
  <div className="lyra-settings-status-list" role="group" aria-label={control.label}>
    <div className="lyra-settings-status-list-rows">
      {control.rows.map((row) => (
        <div key={row.label} className="lyra-settings-status-list-row">
          <small>{row.label}</small>
          <strong>{row.value}</strong>
        </div>
      ))}
    </div>
    {control.actionLabel !== undefined && control.onAction !== undefined ? (
      <AppButton
        variant="outline"
        size="sm"
        className="lyra-settings-ai-action"
        type="button"
        onClick={control.onAction}
      >
        {control.actionLabel}
      </AppButton>
    ) : null}
  </div>
);

type LegalNoticesState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly document: ThirdPartyNoticesDocument };

const buildLegalNoticeKey = (item: ThirdPartyNoticeItem): string =>
  `${item.ecosystem}:${item.name}:${item.version ?? ""}`;

const formatLegalUpdatedAt = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(date);
};

const legalNoticeBody = (item: ThirdPartyNoticeItem): string =>
  [item.noticeText, item.licenseText]
    .filter((value): value is string => value !== undefined && value.trim().length > 0)
    .map((value) => value.trim())
    .join("\n\n");

const LegalNoticesView = ({
  control
}: {
  readonly control: SettingsLegalNoticesCustomControlDescriptor;
}) => {
  const [state, setState] = useState<LegalNoticesState>({ kind: "loading" });

  useEffect(() => {
    const legalApi = control.desktopApi?.legal;
    if (legalApi === undefined) {
      setState({ kind: "error" });
      return;
    }

    let cancelled = false;
    setState({ kind: "loading" });
    void legalApi.readThirdPartyNotices()
      .then((document) => {
        if (cancelled) {
          return;
        }
        setState({ kind: "ready", document });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        console.warn("[lyra-legal] failed to read third-party notices", error);
        setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [control.desktopApi]);

  if (state.kind === "loading") {
    return (
      <div className="lyra-settings-ai-empty-panel" role="status">
        <strong>{control.labels.legalNoticesLoadingLabel}</strong>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="lyra-settings-ai-error" role="alert">
        {control.labels.legalNoticesErrorLabel}
      </div>
    );
  }

  if (state.document.items.length === 0) {
    return (
      <div className="lyra-settings-ai-empty-panel" role="status">
        <strong>{control.labels.legalNoticesEmptyLabel}</strong>
      </div>
    );
  }

  return (
    <div className="lyra-settings-legal" role="group" aria-label={control.labels.legalNoticesLabel}>
      <header className="lyra-settings-legal-header">
        <h2>{control.labels.legalNoticesLabel}</h2>
        <p className="lyra-settings-legal-updated">
          {control.labels.legalLastUpdatedPrefix} {formatLegalUpdatedAt(state.document.generatedAt)}
        </p>
      </header>
      <p className="lyra-settings-legal-intro">{control.labels.legalNoticesIntro}</p>
      {state.document.items.map((item, index) => {
        const body = legalNoticeBody(item);
        return (
          <section key={`${buildLegalNoticeKey(item)}:${index}`} className="lyra-settings-legal-notice">
            <h3>{item.name}</h3>
            <p className="lyra-settings-legal-license">{item.license}</p>
            {body.length > 0 ? (
              <div className="lyra-settings-legal-body">{body}</div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
};

const renderControl = (control: SettingsControlDescriptor): ReactNode => {
  switch (control.kind) {
    case "boolean-choice":
      return <SettingsBooleanChoice control={control} />;
    case "choice":
      return <SettingsChoiceSelect control={control} />;
    case "custom":
      if (control.customKind === "login-manager") {
        return <LoginManagerSurface {...control.props} embedded />;
      }
      if (control.customKind === "software-store") {
        return <SoftwareStoreSurface {...control.props} embedded />;
      }
      if (control.customKind === "ai-models") {
        return (
          <SettingsAiModelsView
            labels={control.labels}
            model={control.model}
            openDialog={control.openDialog}
          />
        );
      }
      if (control.customKind === "ai-skills") {
        return <SettingsAiSkillsView labels={control.labels} model={control.model} />;
      }
      if (control.customKind === "ai-mcp") {
        return <SettingsAiMcpView labels={control.labels} model={control.model} />;
      }
      if (control.customKind === "legal-notices") {
        return <LegalNoticesView control={control} />;
      }
      return <SettingsAiView labels={control.labels} model={control.model} />;
    case "inline-status-action":
      return <SettingsInlineStatusAction control={control} />;
    case "multi-choice":
      return <SettingsMultiChoice control={control} />;
    case "status-list":
      return <SettingsStatusList control={control} />;
    case "text":
    case "textarea":
      return <SettingsTextControl control={control} />;
    case "toggle-group":
      return <SettingsToggleGroup control={control} />;
    default:
      return null;
  }
};

const resolveSectionTitlePlacement = (
  section: SettingsRenderedSection
): "inside" | "outside" | "none" => {
  if (section.controls.length !== 1) {
    return "outside";
  }

  switch (section.controls[0]?.kind) {
    case "multi-choice":
    case "status-list":
    case "toggle-group":
      return "outside";
    case "custom":
      return "inside";
    default:
      return "none";
  }
};

const renderSectionControlSlots = (section: SettingsRenderedSection): readonly ReactNode[] =>
  section.controls.map((control, index) => (
    <div
      className={[
        "lyra-settings-control-slot",
        `lyra-settings-control-slot-${control.kind}`,
        control.kind === "custom" ? `lyra-settings-control-slot-custom-${control.customKind}` : ""
      ].filter(Boolean).join(" ")}
      key={`${section.id}-${control.kind}-${index}`}
    >
      {renderControl(control)}
    </div>
  ));

const isCompactSection = (section: SettingsRenderedSection): boolean =>
  section.frame !== "none" && resolveSectionTitlePlacement(section) === "none";

const renderSection = (section: SettingsRenderedSection): ReactNode => {
  const controls = renderSectionControlSlots(section);

  if (section.frame === "none") {
    return controls;
  }

  return (
    <AppSettingsSection
      label={section.label}
      cluster={section.cluster}
      titlePlacement={resolveSectionTitlePlacement(section)}
    >
      {controls}
    </AppSettingsSection>
  );
};

const renderCategorySections = (category: SettingsSurfaceModel["categories"][number]): readonly ReactNode[] => {
  const nodes: ReactNode[] = [];
  let compactRun: SettingsRenderedSection[] = [];

  const flushCompactRun = () => {
    if (compactRun.length === 0) return;
    const run = compactRun;
    compactRun = [];
    nodes.push(
      <AppSettingsSection
        key={`compact-${run.map((section) => section.id).join("-")}`}
        label={category.heading}
        cluster
        titlePlacement="none"
      >
        {run.flatMap(renderSectionControlSlots)}
      </AppSettingsSection>
    );
  };

  for (const section of category.sections) {
    if (isCompactSection(section)) {
      compactRun.push(section);
      continue;
    }
    flushCompactRun();
    nodes.push(<div key={section.id}>{renderSection(section)}</div>);
  }

  flushCompactRun();
  return nodes;
};

export const SettingsSurfaceView = ({
  model,
  activeCategory,
  onActivateCategory,
  docsNavLabel,
  onOpenDocs
}: SettingsSurfaceViewProps) => {
  const selectedCategory =
    model.categories.find((category) => category.id === activeCategory)
    ?? model.categories[0]
    ?? null;

  return (
    <section className="lyra-settings-surface" aria-label="settings-surface">
      <div className="lyra-settings-shell">
        <aside className="lyra-settings-nav" aria-label="settings-nav">
          <div className="lyra-settings-nav-list">
            {model.categories.map((category) => (
              (() => {
                const Icon = SETTINGS_CATEGORY_ICONS[category.id];
                return (
                  <AppButton
                    key={category.id}
                    variant="ghost"
                    size="sm"
                    className={category.id === selectedCategory?.id
                      ? "lyra-settings-nav-item lyra-settings-nav-item-active"
                      : "lyra-settings-nav-item"}
                    onClick={() => {
                      onActivateCategory(category.id);
                    }}
                  >
                    {category.id === "ai" ? (
                      <span className="lyra-settings-nav-icon lyra-settings-nav-logo" aria-hidden="true" />
                    ) : Icon === undefined ? null : (
                      <Icon className="lyra-settings-nav-icon" size={15} aria-hidden="true" />
                    )}
                    <span>{category.navLabel}</span>
                  </AppButton>
                );
              })()
            ))}
          </div>
          <div className="lyra-settings-nav-actions">
            <AppButton
              className="lyra-settings-nav-item lyra-settings-nav-item-jump"
              variant="ghost"
              size="sm"
              onClick={onOpenDocs}
            >
              <BookText className="lyra-settings-nav-icon" size={15} aria-hidden="true" />
              <span className="lyra-settings-nav-jump-label">
                <span>{docsNavLabel}</span>
                <ArrowUpRight
                  className="lyra-settings-nav-jump-icon"
                  size={12}
                  aria-hidden="true"
                />
              </span>
            </AppButton>
          </div>
        </aside>

        <main className="lyra-settings-main">
          {selectedCategory === null ? null : (
            <section
              key={selectedCategory.id}
              id={selectedCategory.domId}
              className={`lyra-settings-category lyra-settings-category-${selectedCategory.id}`}
              aria-labelledby={`${selectedCategory.domId}-heading`}
            >
              <header className="lyra-settings-category-header">
                <h2 id={`${selectedCategory.domId}-heading`}>{selectedCategory.heading}</h2>
              </header>
              {renderCategorySections(selectedCategory)}
            </section>
          )}
        </main>
      </div>
    </section>
  );
};
