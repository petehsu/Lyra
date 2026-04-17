import type { AiProviderPreset } from "../../../shared/ai";
import { SettingsAiProviderIcon } from "./icon-registry";
import { SettingsAiFieldRenderer } from "./field-renderer";
import {
  additionalAuthFields,
  additionalConnectionFields,
  hasConfiguredPrimarySecret,
  readPrimaryConnectionValue,
  resolveConfiguredModels,
  resolvePrimarySecretFieldId,
  resolvePrimaryUrlFieldId
} from "./draft";
import { buildModelOptions } from "./model-options";
import { SettingsAiModelPicker } from "./model-picker";
import { resolvePreset } from "./preset";
import type { SettingsAiLabels, SettingsAiModel } from "./types";

type SettingsAiViewProps = {
  readonly labels: SettingsAiLabels;
  readonly model: SettingsAiModel;
};

const formatCheckedAt = (timestamp: number): string => {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(timestamp);
  } catch {
    return new Date(timestamp).toLocaleString();
  }
};

const ProviderList = ({
  labels,
  presets,
  selectedPresetId,
  onSelect
}: {
  readonly labels: SettingsAiLabels;
  readonly presets: readonly AiProviderPreset[];
  readonly selectedPresetId: string | null;
  readonly onSelect: (presetId: string) => void;
}) => (
  <div
    className="lyra-settings-ai-selection-list lyra-settings-ai-selection-list-grid"
    role="listbox"
    aria-label={labels.providerTitle}
  >
    {presets.map((preset) => (
      <button
        key={preset.id}
        type="button"
        className={preset.id === selectedPresetId
          ? "lyra-settings-ai-selection-item lyra-settings-ai-selection-item-active"
          : "lyra-settings-ai-selection-item"}
        onClick={() => {
          onSelect(preset.id);
        }}
      >
        <span className="lyra-settings-ai-selection-copy">
          <span className="lyra-settings-ai-selection-heading">
            <SettingsAiProviderIcon iconKey={preset.iconKey} title={preset.label} />
            <strong>{preset.label}</strong>
          </span>
          <small>{preset.description}</small>
        </span>
      </button>
    ))}
  </div>
);

export const SettingsAiView = ({
  labels,
  model
}: SettingsAiViewProps) => {
  const browserUseStatusLabel = model.browserUseRuntimeStatus.state === "healthy"
    ? labels.browserAutomationStatusHealthy
    : model.browserUseRuntimeStatus.state === "checking"
      ? labels.browserAutomationStatusChecking
      : labels.browserAutomationStatusUnavailable;
  const browserUseStatusReason = model.browserUseRuntimeStatus.reason === "missing_bundle"
    ? labels.browserAutomationStatusReasonMissingBundle
    : model.browserUseRuntimeStatus.reason === "integrity_failed"
      ? labels.browserAutomationStatusReasonIntegrityFailed
      : model.browserUseRuntimeStatus.reason === "daemon_launch_failed"
        ? labels.browserAutomationStatusReasonDaemonLaunchFailed
        : model.browserUseRuntimeStatus.reason === "bridge_unavailable"
          ? labels.browserAutomationStatusReasonBridgeUnavailable
          : model.browserUseRuntimeStatus.reason === "unsupported_platform"
            ? labels.browserAutomationStatusReasonUnsupportedPlatform
            : null;
  const hasProfiles = model.profiles.length > 0;
  const defaultProfile =
    model.profiles.find((profile) => profile.isDefault)
    ?? model.profiles[0]
    ?? null;
  const selectedPreset = resolvePreset(
    model.presetCatalog,
    model.draft.presetId,
    model.draft.providerId,
    model.draft.protocolId
  );
  const modelOptions = buildModelOptions(selectedPreset, model.discoveryResult, model.draft.modelsText);
  const resolvedModels = resolveConfiguredModels(
    model.draft.modelsText,
    modelOptions,
    selectedPreset?.defaultModel ?? ""
  );
  const primaryUrlFieldId = resolvePrimaryUrlFieldId(selectedPreset);
  const primarySecretFieldId = resolvePrimarySecretFieldId(selectedPreset);
  const primaryUrlValue = readPrimaryConnectionValue(selectedPreset, model.draft.connectionConfig);
  const primarySecretValue = primarySecretFieldId === null
    ? ""
    : (model.draft.secretValues[primarySecretFieldId] ?? "");
  const primarySecretConfigured = hasConfiguredPrimarySecret(
    selectedPreset,
    model.draft.configuredSecretFields
  );
  const extraConnectionFields = additionalConnectionFields(selectedPreset);
  const extraAuthFields = additionalAuthFields(selectedPreset);
  const hasAdditionalFields = extraConnectionFields.length > 0 || extraAuthFields.length > 0;
  const presetGroups = {
    recommended: model.presetCatalog.filter((preset) => preset.section === "recommended"),
    all: model.presetCatalog.filter((preset) => preset.section === "all"),
    custom: model.presetCatalog.filter((preset) => preset.section === "custom")
  };

  return (
    <>
      <section className="lyra-settings-group">
        <header className="lyra-settings-group-header">
          <h3>{labels.browserAutomationTitle}</h3>
        </header>
        <div className="lyra-settings-ai-status-row-copy">
          <span>{labels.browserAutomationDescription}</span>
        </div>
        <div
          className="lyra-settings-ai-selection-list lyra-settings-ai-selection-list-grid"
          role="radiogroup"
          aria-label={labels.browserAutomationTitle}
        >
          {[
            {
              value: "lyra_direct" as const,
              label: labels.browserAutomationOptionLyraDirect,
              description: labels.browserAutomationOptionLyraDirectDescription,
              badge: null,
            },
            {
              value: "browser_use" as const,
              label: labels.browserAutomationOptionBrowserUse,
              description: labels.browserAutomationOptionBrowserUseDescription,
              badge: browserUseStatusLabel,
            },
            {
              value: "smart" as const,
              label: labels.browserAutomationOptionSmart,
              description: labels.browserAutomationOptionSmartDescription,
              badge: browserUseStatusLabel,
            },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={model.browserAutomationEngine === option.value}
              className={model.browserAutomationEngine === option.value
                ? "lyra-settings-ai-selection-item lyra-settings-ai-selection-item-active"
                : "lyra-settings-ai-selection-item"}
              onClick={() => {
                model.setBrowserAutomationEngine(option.value);
              }}
            >
              <span className="lyra-settings-ai-selection-copy">
                <span className="lyra-settings-ai-selection-heading">
                  <strong>{option.label}</strong>
                </span>
                <small>{option.description}</small>
                {option.value === "browser_use" && browserUseStatusReason !== null ? (
                  <small>{browserUseStatusReason}</small>
                ) : null}
              </span>
              {option.badge === null ? null : (
                <span className="lyra-settings-ai-selection-meta">
                  <span className="lyra-settings-ai-badge">{option.badge}</span>
                </span>
              )}
            </button>
          ))}
        </div>
      </section>

      <section className="lyra-settings-group">
        <header className="lyra-settings-group-header">
          <h3>{labels.lyraDirectAdvancedTitle}</h3>
        </header>
        <div className="lyra-settings-ai-status-row-copy">
          <span>{labels.lyraDirectAdvancedDescription}</span>
        </div>
        <div className="lyra-settings-ai-selection-stack" role="group" aria-label={labels.lyraDirectMicroExecutorBudgetLabel}>
          <span className="lyra-settings-ai-selection-caption">
            {labels.lyraDirectMicroExecutorBudgetLabel}
          </span>
          <div
            className="lyra-settings-ai-selection-list lyra-settings-ai-selection-list-grid"
            role="radiogroup"
            aria-label={labels.lyraDirectMicroExecutorBudgetLabel}
          >
            {[
              {
                value: "1-2" as const,
                label: labels.lyraDirectMicroExecutorBudgetConservative,
                description: labels.lyraDirectMicroExecutorBudgetConservativeDescription
              },
              {
                value: "3-5" as const,
                label: labels.lyraDirectMicroExecutorBudgetBalanced,
                description: labels.lyraDirectMicroExecutorBudgetBalancedDescription
              },
              {
                value: "6-8" as const,
                label: labels.lyraDirectMicroExecutorBudgetAggressive,
                description: labels.lyraDirectMicroExecutorBudgetAggressiveDescription
              }
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={model.lyraDirectMicroExecutorBudget === option.value}
                className={model.lyraDirectMicroExecutorBudget === option.value
                  ? "lyra-settings-ai-selection-item lyra-settings-ai-selection-item-active"
                  : "lyra-settings-ai-selection-item"}
                onClick={() => {
                  model.setLyraDirectMicroExecutorBudget(option.value);
                }}
              >
                <span className="lyra-settings-ai-selection-copy">
                  <span className="lyra-settings-ai-selection-heading">
                    <strong>{option.label}</strong>
                  </span>
                  <small>{option.description}</small>
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="lyra-settings-group">
        <header className="lyra-settings-group-header">
          <h3>{labels.profilesTitle}</h3>
        </header>
        <div className="lyra-settings-ai-actions">
          {selectedPreset?.providerId === "openai" ? (
            <>
              <button
                type="button"
                className="lyra-settings-ai-action"
                disabled={model.isSaving || model.isLoading}
                onClick={() => {
                  void model.authorizeOpenAiChatGpt();
                }}
              >
                {labels.authorizeChatGpt}
              </button>
              <button
                type="button"
                className="lyra-settings-ai-action"
                disabled={model.isSaving || model.isLoading}
                onClick={() => {
                  void model.authorizeOpenAiChatGptDeviceCode();
                }}
              >
                {labels.authorizeChatGptDeviceCode}
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="lyra-settings-ai-action"
            onClick={model.createProfileDraft}
          >
            {labels.addProfile}
          </button>
          <button
            type="button"
            className="lyra-settings-ai-action"
            disabled={model.selectedProfileId === null || model.draft.isDefault}
            onClick={() => {
              void model.setDefaultProfile();
            }}
          >
            {labels.setDefaultProfile}
          </button>
          <button
            type="button"
            className="lyra-settings-ai-action lyra-settings-ai-action-danger"
            disabled={model.selectedProfileId === null}
            onClick={() => {
              void model.deleteProfile();
            }}
          >
            {labels.deleteProfile}
          </button>
        </div>
        {hasProfiles ? (
          <div
            className="lyra-settings-ai-selection-list lyra-settings-ai-selection-list-grid"
            role="listbox"
            aria-label={labels.profilesTitle}
          >
            {model.profiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                className={profile.id === model.selectedProfileId
                  ? "lyra-settings-ai-selection-item lyra-settings-ai-selection-item-active"
                  : "lyra-settings-ai-selection-item"}
                onClick={() => {
                  model.selectProfile(profile.id);
                }}
              >
                <span className="lyra-settings-ai-selection-copy">
                  <span className="lyra-settings-ai-selection-heading">
                    <SettingsAiProviderIcon iconKey={profile.providerId} title={profile.name} />
                    <strong>{profile.name}</strong>
                  </span>
                  <small>
                    {profile.providerId}
                    {" · "}
                    {[profile.model, ...profile.customModels.map((entry) => entry.id)].join(", ")}
                  </small>
                </span>
                <span className="lyra-settings-ai-selection-meta">
                  {profile.isDefault ? <span className="lyra-settings-ai-badge">{labels.defaultBadge}</span> : null}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="lyra-settings-ai-empty">
            <strong>{labels.emptyTitle}</strong>
            <span>{labels.emptyDescription}</span>
          </div>
        )}
      </section>

      <section className="lyra-settings-group">
        <header className="lyra-settings-group-header">
          <h3>{labels.providerTitle}</h3>
        </header>
        {[labels.recommendedSection, labels.allSection, labels.customSection].map((title, index) => {
          const key = index === 0 ? "recommended" : index === 1 ? "all" : "custom";
          const presets = presetGroups[key as keyof typeof presetGroups];
          if (presets.length === 0) {
            return null;
          }
          return (
            <div key={key} className="lyra-settings-ai-provider-group">
              <div className="lyra-settings-ai-provider-group-title">{title}</div>
              <ProviderList
                labels={labels}
                presets={presets}
                selectedPresetId={model.draft.presetId}
                onSelect={model.selectPreset}
              />
            </div>
          );
        })}
      </section>

      <section className="lyra-settings-group">
        <header className="lyra-settings-group-header">
          <h3>{labels.connectionTitle}</h3>
        </header>
        <div className="lyra-settings-ai-form">
          <label className="lyra-settings-ai-field">
            <span>{labels.profileNameLabel}</span>
            <input
              className="lyra-settings-ai-input"
              type="text"
              value={model.draft.name}
              placeholder={labels.profileNamePlaceholder}
              onChange={(event) => {
                model.updateName(event.target.value);
              }}
            />
          </label>
          <label className="lyra-settings-ai-field">
            <span>{labels.urlLabel}</span>
            <input
              className="lyra-settings-ai-input"
              type="url"
              value={primaryUrlValue}
              placeholder={labels.urlPlaceholder}
              disabled={primaryUrlFieldId === null}
              onChange={(event) => {
                model.updateUrl(event.target.value);
              }}
            />
          </label>
          <label className="lyra-settings-ai-field">
            <span>{labels.keyLabel}</span>
            <span className="lyra-settings-ai-secret-row">
              <input
                className="lyra-settings-ai-input"
                type="password"
                autoComplete="off"
                value={primarySecretValue}
                placeholder={labels.keyPlaceholder}
                disabled={primarySecretFieldId === null}
                onChange={(event) => {
                  model.updateKey(event.target.value);
                }}
              />
              <button
                type="button"
                className="lyra-settings-ai-action lyra-settings-ai-action-inline"
                disabled={primarySecretFieldId === null}
                onClick={() => {
                  if (primarySecretFieldId === null) {
                    return;
                  }
                  model.clearSecretField(primarySecretFieldId);
                }}
              >
                {labels.clearApiKey}
              </button>
            </span>
            <small>{primarySecretConfigured ? labels.secretConfigured : labels.secretMissing}</small>
          </label>
          <SettingsAiModelPicker
            labels={labels}
            value={model.draft.modelsText}
            placeholder={labels.modelPlaceholder}
            helpText={labels.modelsHelp}
            models={modelOptions}
            selectedModelIds={resolvedModels.modelIds}
            isDiscovering={model.isDiscovering || model.isLoading}
            discoverLabel={model.discoveryResult === null ? labels.discoverModels : labels.refreshModels}
            onChange={model.updateModelsText}
            onDiscover={() => {
              if (model.discoveryResult === null) {
                void model.discoverModels();
                return;
              }
              void model.refreshDiscoveredModels();
            }}
            onToggleModel={model.toggleModelOption}
          />
          <label className="lyra-settings-ai-field lyra-settings-ai-field-span-2">
            <span>{labels.headersLabel}</span>
            <textarea
              className="lyra-settings-ai-input lyra-settings-ai-input-multiline"
              value={model.draft.headersText}
              placeholder={labels.headersPlaceholder}
              onChange={(event) => {
                model.updateHeadersText(event.target.value);
              }}
            />
          </label>
          {hasAdditionalFields ? (
            <div className="lyra-settings-ai-extra-fields lyra-settings-ai-field-span-2">
              <div className="lyra-settings-ai-extra-fields-title">{labels.additionalFieldsTitle}</div>
              <div className="lyra-settings-ai-extra-fields-grid">
                {extraConnectionFields.map((field) => (
                  <SettingsAiFieldRenderer
                    key={field.id}
                    field={field}
                    model={model}
                    labels={labels}
                    target="connection"
                  />
                ))}
                {extraAuthFields.map((field) => (
                  <SettingsAiFieldRenderer
                    key={field.id}
                    field={field}
                    model={model}
                    labels={labels}
                    target="auth"
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <div className="lyra-settings-ai-actions">
          <button
            type="button"
            className="lyra-settings-ai-action"
            disabled={model.isSaving || model.isLoading}
            onClick={() => {
              void model.saveProfile();
            }}
          >
            {labels.saveProfile}
          </button>
          <button
            type="button"
            className="lyra-settings-ai-action"
            disabled={model.isTesting || model.isLoading}
            onClick={() => {
              void model.testConnection();
            }}
          >
            {labels.testConnection}
          </button>
        </div>
      </section>

      <section className="lyra-settings-group">
        <header className="lyra-settings-group-header">
          <h3>{labels.statusTitle}</h3>
        </header>
        <div className="lyra-settings-ai-status-list">
          <div className="lyra-settings-ai-status-row">
            <strong>{labels.defaultProfileLabel}</strong>
            <span>
              {defaultProfile === null ? labels.emptyTitle : defaultProfile.name}
            </span>
          </div>
          <div className="lyra-settings-ai-status-row">
            <strong>{labels.providerTitle}</strong>
            <span>{selectedPreset?.label ?? model.draft.providerId}</span>
          </div>
          <div className="lyra-settings-ai-status-row">
            <strong>{labels.modelLabel}</strong>
            {resolvedModels.modelIds.length === 0 ? (
              <span>{labels.emptyTitle}</span>
            ) : (
              <span>{resolvedModels.modelIds.join(", ")}</span>
            )}
          </div>
          <div className="lyra-settings-ai-status-row">
            <strong>{labels.statusTitle}</strong>
            <span className={`lyra-settings-ai-status-tone-${model.statusTone}`}>
              {model.statusMessage}
            </span>
          </div>
          <div className="lyra-settings-ai-status-row">
            <strong>{labels.statusLastChecked}</strong>
            <span>
              {model.lastCheckedAt === null
                ? labels.statusIdle
                : formatCheckedAt(model.lastCheckedAt)}
            </span>
          </div>
        </div>
      </section>

      <section className="lyra-settings-group">
        <header className="lyra-settings-group-header">
          <h3>{labels.memoryConfigTitle}</h3>
        </header>
        <div className="lyra-settings-ai-status-row-copy">
          <span>{labels.memoryConfigDescription}</span>
        </div>
        <div className="lyra-settings-ai-form">
          <label className="lyra-settings-ai-field lyra-settings-ai-field-span-2">
            <textarea
              className="lyra-settings-ai-input lyra-settings-ai-input-multiline"
              value={model.memoryConfigText}
              placeholder={labels.memoryConfigPlaceholder}
              onChange={(event) => {
                model.updateMemoryConfigText(event.target.value);
              }}
            />
          </label>
        </div>
        <div className="lyra-settings-ai-actions">
          <button
            type="button"
            className="lyra-settings-ai-action"
            disabled={model.isMemoryConfigLoading || model.isMemoryConfigSaving}
            onClick={() => {
              void model.loadMemoryConfig();
            }}
          >
            {labels.memoryConfigLoad}
          </button>
          <button
            type="button"
            className="lyra-settings-ai-action"
            disabled={model.isMemoryConfigLoading || model.isMemoryConfigSaving}
            onClick={() => {
              void model.saveMemoryConfig();
            }}
          >
            {labels.memoryConfigSave}
          </button>
        </div>
        <div className="lyra-settings-ai-status-row">
          <strong>{labels.statusTitle}</strong>
          <span className={`lyra-settings-ai-status-tone-${model.memoryConfigStatusTone}`}>
            {model.memoryConfigStatus}
          </span>
        </div>
      </section>
    </>
  );
};
