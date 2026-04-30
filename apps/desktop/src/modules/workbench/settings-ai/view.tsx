import { additionalAuthFields, resolvePrimarySecretFieldId } from "./draft";
import { SettingsAiFieldRenderer } from "./field-renderer";
import { SettingsAiProviderIcon } from "./icon-registry";
import { SettingsAiModelPicker } from "./model-picker";
import type { SettingsAiLabels, SettingsAiModel } from "./types";

type SettingsAiViewProps = {
  readonly labels: SettingsAiLabels;
  readonly model: SettingsAiModel;
};

const STATUS_CLASSNAME: Record<SettingsAiModel["statusTone"], string> = {
  neutral: "lyra-settings-ai-status-row",
  success: "lyra-settings-ai-status-row lyra-settings-ai-status-row-success",
  error: "lyra-settings-ai-status-row lyra-settings-ai-status-row-error",
};

const capabilityLabel = (
  labels: SettingsAiLabels,
  capability: "full" | "static" | "pending"
): string => {
  switch (capability) {
    case "full":
      return labels.capabilityFull;
    case "static":
      return labels.capabilityStatic;
    case "pending":
      return labels.capabilityPending;
    default:
      return labels.capabilityPending;
  }
};

export const SettingsAiView = ({ labels, model }: SettingsAiViewProps) => {
  const selectedPreset = model.selectedPreset;
  const helpText = model.availableModels.length > 0
    ? labels.modelsHelp
    : `${labels.modelsHelp} ${labels.noDiscoveredModels}`;
  const primarySecretFieldId = resolvePrimarySecretFieldId(selectedPreset);
  const primarySecretField = selectedPreset?.authFields.find((field) => field.id === primarySecretFieldId) ?? null;
  const simpleFieldIdSet = new Set(selectedPreset?.simpleFields ?? []);
  const simpleConnectionFields = (selectedPreset?.connectionFields ?? []).filter((field) =>
    simpleFieldIdSet.has(field.id)
  );
  const showPrimarySecretField = primarySecretField !== null
    && (simpleFieldIdSet.size === 0 || simpleFieldIdSet.has(primarySecretField.id));
  const simpleAuthFields = additionalAuthFields(selectedPreset).filter((field) =>
    simpleFieldIdSet.has(field.id)
  );
  const advancedConnectionFields = (selectedPreset?.connectionFields ?? []).filter((field) =>
    !simpleFieldIdSet.has(field.id)
  );
  const advancedAuthFields = [
    ...(
      showPrimarySecretField || primarySecretField === null || simpleFieldIdSet.has(primarySecretField.id)
        ? []
        : [primarySecretField]
    ),
    ...additionalAuthFields(selectedPreset).filter((field) => !simpleFieldIdSet.has(field.id))
  ];
  const showAdvancedFields = advancedConnectionFields.length > 0 || advancedAuthFields.length > 0 || model.draft.headersText.trim().length > 0;

  return (
    <>
      <section className="lyra-settings-group">
        <header className="lyra-settings-group-header">
          <h3>{labels.profilesTitle}</h3>
        </header>
        <div className={STATUS_CLASSNAME[model.statusTone]}>
          <div className="lyra-settings-ai-status-row-copy">
            <strong>{labels.statusTitle}</strong>
            <small>
              {model.runtimeHealth === null
                ? "Lyra Agent runtime unavailable"
                : `${model.runtimeHealth.backend} · ${model.runtimeHealth.transport} · ${model.runtimeHealth.version}`}
            </small>
            <small>{model.statusMessage}</small>
            <small>
              {labels.defaultProfileLabel}: {model.defaultProfileLabel ?? "-"}
            </small>
            {selectedPreset === null ? null : (
              <small>
                {labels.capabilityLabel}: {capabilityLabel(labels, selectedPreset.capability)}
              </small>
            )}
          </div>
          <div className="lyra-settings-ai-actions">
            <button
              type="button"
              className="lyra-settings-ai-action"
              disabled={model.isLoading}
              onClick={() => {
                void model.refreshConfig();
              }}
            >
              {labels.refreshModels}
            </button>
            <button
              type="button"
              className="lyra-settings-ai-action"
              onClick={() => {
                model.selectProfile(null);
              }}
            >
              {labels.addProfile}
            </button>
            <button
              type="button"
              className="lyra-settings-ai-action"
              onClick={() => {
                void model.validateProfile();
              }}
            >
              {labels.testConnection}
            </button>
            <button
              type="button"
              className="lyra-settings-ai-action"
              disabled={model.isRefreshingModels}
              onClick={() => {
                void model.refreshModels();
              }}
            >
              {labels.discoverModels}
            </button>
            <button
              type="button"
              className="lyra-settings-ai-action"
              disabled={model.draft.id === null || model.draft.isDefault}
              onClick={() => {
                void model.setDefaultProfile();
              }}
            >
              {labels.setDefaultProfile}
            </button>
            <button
              type="button"
              className="lyra-settings-ai-action"
              disabled={model.draft.id === null || model.isSaving}
              onClick={() => {
                void model.deleteProfile();
              }}
            >
              {labels.deleteProfile}
            </button>
            <button
              type="button"
              className="lyra-settings-ai-action lyra-settings-ai-action-primary"
              disabled={model.isSaving}
              onClick={() => {
                void model.saveProfile();
              }}
            >
              {labels.saveProfile}
            </button>
          </div>
        </div>

        <div className="lyra-settings-ai-selection-stack" role="group" aria-label={labels.profilesTitle}>
          <span className="lyra-settings-ai-selection-caption">{labels.profilesTitle}</span>
          {model.profiles.length === 0 ? (
            <div className="lyra-settings-ai-empty">
              <strong>{labels.emptyTitle}</strong>
              <small>{labels.emptyDescription}</small>
            </div>
          ) : (
            <ul
              className="lyra-settings-ai-selection-list lyra-settings-ai-selection-list-grid"
              role="radiogroup"
              aria-label={labels.profilesTitle}
            >
              {model.profiles.map((profile) => (
                <li key={profile.id} className="lyra-settings-ai-selection-item-slot">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={model.selectedProfileId === profile.id}
                    className={model.selectedProfileId === profile.id
                      ? "lyra-settings-ai-selection-item lyra-settings-ai-selection-item-active"
                      : "lyra-settings-ai-selection-item"}
                    onClick={() => {
                      model.selectProfile(profile.id);
                    }}
                    >
                      <span className="lyra-settings-ai-selection-copy">
                        <span className="lyra-settings-ai-selection-heading">
                          <SettingsAiProviderIcon iconKey={profile.providerId} title={profile.providerId} />
                          <strong>{profile.name}</strong>
                        </span>
                        <small>{profile.providerId} · {profile.model}</small>
                      </span>
                    {profile.isDefault ? (
                      <span className="lyra-settings-ai-selection-meta">
                        <span className="lyra-settings-ai-badge">{labels.defaultBadge}</span>
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {model.presetSections.map((section) => (
          <div key={section.id} className="lyra-settings-ai-provider-group">
            <h4 className="lyra-settings-ai-provider-group-title">{section.label}</h4>
            <ul
              className="lyra-settings-ai-selection-list lyra-settings-ai-selection-list-grid"
              role="listbox"
              aria-label={section.label}
            >
              {section.presets.map((preset) => (
                <li key={preset.id} className="lyra-settings-ai-selection-item-slot">
                  <button
                    type="button"
                    role="option"
                    aria-selected={model.selectedPresetId === preset.id}
                    className={model.selectedPresetId === preset.id
                      ? "lyra-settings-ai-selection-item lyra-settings-ai-selection-item-active"
                      : "lyra-settings-ai-selection-item"}
                    onClick={() => {
                      model.applyPreset(preset.id);
                    }}
                  >
                    <span className="lyra-settings-ai-selection-copy">
                      <span className="lyra-settings-ai-selection-heading">
                        <SettingsAiProviderIcon iconKey={preset.iconKey} title={preset.label} />
                        <strong>{preset.label}</strong>
                      </span>
                      <small>{preset.protocolId}</small>
                    </span>
                    <span className="lyra-settings-ai-selection-meta">
                      <span className="lyra-settings-ai-badge lyra-settings-ai-badge-subtle">
                        {capabilityLabel(labels, preset.capability)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div className="lyra-settings-ai-form">
          <div className="lyra-settings-ai-grid">
            <label className="lyra-settings-ai-field">
              <span>{labels.profileNameLabel}</span>
              <input
                className="lyra-settings-ai-input"
                type="text"
                autoComplete="off"
                value={model.draft.name}
                placeholder={labels.profileNamePlaceholder}
                onChange={(event) => {
                  model.updateDraftName(event.target.value);
                }}
              />
            </label>

            <label className="lyra-settings-ai-field">
              <span>{labels.providerTitle}</span>
              <input
                className="lyra-settings-ai-input"
                type="text"
                readOnly
                value={selectedPreset === null
                  ? `${model.draft.providerId} · ${model.draft.protocolId}`
                  : `${selectedPreset.label} · ${selectedPreset.protocolId}`}
              />
            </label>

            {simpleConnectionFields.map((field) => (
              <SettingsAiFieldRenderer
                key={`connection-simple-${field.id}`}
                field={field}
                model={model}
                labels={labels}
                target="connection"
              />
            ))}

            {showPrimarySecretField && primarySecretField !== null ? (
              <SettingsAiFieldRenderer
                key={`auth-primary-${primarySecretField.id}`}
                field={primarySecretField}
                model={model}
                labels={labels}
                target="auth"
              />
            ) : null}

            {simpleAuthFields.map((field) => (
              <SettingsAiFieldRenderer
                key={`auth-simple-${field.id}`}
                field={field}
                model={model}
                labels={labels}
                target="auth"
              />
            ))}

            <SettingsAiModelPicker
              labels={labels}
              value={model.draft.modelsText}
              placeholder={labels.modelPlaceholder}
              helpText={helpText}
              models={model.availableModels}
              selectedModelIds={model.selectedModelIds}
              isDiscovering={model.isRefreshingModels}
              discoverLabel={labels.discoverModels}
              onChange={model.updateDraftModelsText}
              onDiscover={() => {
                void model.refreshModels();
              }}
              onToggleModel={model.toggleModelSelection}
            />

            {showAdvancedFields ? (
              <details className="lyra-settings-ai-field lyra-settings-ai-field-span-2">
                <summary className="lyra-settings-ai-advanced-summary">{labels.additionalFieldsTitle}</summary>
                <div className="lyra-settings-ai-advanced-grid">
                  {advancedConnectionFields.map((field) => (
                    <SettingsAiFieldRenderer
                      key={`connection-${field.id}`}
                      field={field}
                      model={model}
                      labels={labels}
                      target="connection"
                    />
                  ))}

                  {advancedAuthFields.map((field) => (
                    <SettingsAiFieldRenderer
                      key={`auth-${field.id}`}
                      field={field}
                      model={model}
                      labels={labels}
                      target="auth"
                    />
                  ))}

                  <label className="lyra-settings-ai-field lyra-settings-ai-field-span-2">
                    <span>{labels.headersLabel}</span>
                    <textarea
                      className="lyra-settings-ai-input lyra-settings-ai-input-multiline"
                      value={model.draft.headersText}
                      placeholder={labels.headersPlaceholder}
                      onChange={(event) => {
                        model.updateDraftHeadersText(event.target.value);
                      }}
                    />
                  </label>
                </div>
              </details>
            ) : null}
          </div>
        </div>
      </section>
    </>
  );
};
