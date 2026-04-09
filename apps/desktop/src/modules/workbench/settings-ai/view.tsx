import type { AiProviderPreset } from "../../../shared/ai";
import { SettingsAiProviderIcon } from "./icon-registry";
import { SettingsAiFieldRenderer } from "./field-renderer";
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
  const modelOptions = buildModelOptions(selectedPreset, model.discoveryResult, model.draft.customModelsText);
  const presetGroups = {
    recommended: model.presetCatalog.filter((preset) => preset.section === "recommended"),
    all: model.presetCatalog.filter((preset) => preset.section === "all"),
    custom: model.presetCatalog.filter((preset) => preset.section === "custom")
  };

  return (
    <>
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
                  <small>{profile.providerId} · {profile.model}</small>
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
          <SettingsAiModelPicker
            labels={labels}
            value={model.draft.model}
            placeholder={labels.modelPlaceholder}
            models={modelOptions}
            onChange={model.updateModel}
          />
          {selectedPreset?.connectionFields.map((field) => (
            <SettingsAiFieldRenderer
              key={field.id}
              field={field}
              model={model}
              labels={labels}
              target="connection"
            />
          ))}
          {selectedPreset?.authFields.map((field) => (
            <SettingsAiFieldRenderer
              key={field.id}
              field={field}
              model={model}
              labels={labels}
              target="auth"
            />
          ))}
          {selectedPreset?.customHeadersSupported ? (
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
          ) : null}
          {selectedPreset?.customModelsSupported ? (
            <label className="lyra-settings-ai-field lyra-settings-ai-field-span-2">
              <span>{labels.customModelsLabel}</span>
              <textarea
                className="lyra-settings-ai-input lyra-settings-ai-input-multiline"
                value={model.draft.customModelsText}
                placeholder={labels.customModelsPlaceholder}
                onChange={(event) => {
                  model.updateCustomModelsText(event.target.value);
                }}
              />
            </label>
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
          <button
            type="button"
            className="lyra-settings-ai-action"
            disabled={model.isDiscovering || model.isLoading}
            onClick={() => {
              void model.discoverModels();
            }}
          >
            {labels.discoverModels}
          </button>
          <button
            type="button"
            className="lyra-settings-ai-action"
            disabled={model.isDiscovering || model.isLoading}
            onClick={() => {
              void model.refreshDiscoveredModels();
            }}
          >
            {labels.refreshModels}
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
            <span>{model.draft.model || labels.emptyTitle}</span>
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
        <div className="lyra-settings-ai-status-row">
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
