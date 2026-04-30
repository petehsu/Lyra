import { useMemo, useState } from "react";

import type { AiProviderPreset, AiProviderProfile } from "../../../shared/ai";
import {
  additionalAuthFields,
  appendAdditionalConfiguredModelLines,
  parseConfiguredModelEntries,
  readAdditionalConfiguredModelLines,
  readPrimaryConfiguredModelLine,
  readPrimaryConnectionValue,
  replaceAdditionalConfiguredModelLines,
  replacePrimaryConfiguredModelLine,
  resolvePrimarySecretFieldId,
  toggleAdditionalConfiguredModelLine,
} from "./draft";
import { SettingsAiFieldRenderer } from "./field-renderer";
import { SettingsAiProviderIcon } from "./icon-registry";
import { SettingsAiAdditionalModelsPicker, SettingsAiModelPicker } from "./model-picker";
import type { SettingsAiLabels, SettingsAiModel } from "./types";

type SettingsAiViewProps = {
  readonly labels: SettingsAiLabels;
  readonly model: SettingsAiModel;
};

type SettingsAiEditorMode = "create" | "edit";

type SettingsAiDeleteTarget = {
  readonly id: string;
  readonly name: string;
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

const providerPresets = (model: SettingsAiModel): readonly AiProviderPreset[] =>
  model.presetSections.flatMap((section) => section.presets);

const resolveProfilePreset = (
  presets: readonly AiProviderPreset[],
  profile: AiProviderProfile
): AiProviderPreset | null =>
  presets.find((preset) => preset.id === profile.presetId)
  ?? presets.find((preset) => preset.providerId === profile.providerId && preset.protocolId === profile.protocolId)
  ?? null;

const profileStatusLabel = (
  labels: SettingsAiLabels,
  profile: AiProviderProfile
): string => {
  if (profile.discoveryState.status === "ready") {
    return labels.connectionReady;
  }
  if (profile.discoveryState.status === "error") {
    return labels.connectionError;
  }
  return labels.connectionUnchecked;
};

const profileStatusClassName = (profile: AiProviderProfile): string =>
  profile.discoveryState.status === "ready"
    ? "lyra-settings-ai-card-status lyra-settings-ai-card-status-ready"
    : profile.discoveryState.status === "error"
      ? "lyra-settings-ai-card-status lyra-settings-ai-card-status-error"
      : "lyra-settings-ai-card-status";

export const SettingsAiView = ({ labels, model }: SettingsAiViewProps) => {
  const [editorMode, setEditorMode] = useState<SettingsAiEditorMode | null>(null);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SettingsAiDeleteTarget | null>(null);
  const presets = useMemo(() => providerPresets(model), [model]);
  const selectedPreset = model.selectedPreset;
  const activeEditorMode = editorMode ?? (model.profiles.length === 0 ? "create" : null);
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
  const primaryModelValue = readPrimaryConfiguredModelLine(model.draft.modelsText);
  const additionalModelsText = readAdditionalConfiguredModelLines(model.draft.modelsText);
  const additionalModelIds = parseConfiguredModelEntries(additionalModelsText).map((entry) => entry.id);
  const additionalModelOptions = model.availableModels.filter((entry) => entry.id !== primaryModelValue);
  const helpText = model.availableModels.length > 0
    ? labels.modelsHelp
    : `${labels.modelsHelp} ${labels.noDiscoveredModels}`;
  const defaultModelName = model.defaultModelNames[0] ?? "-";

  const startCreate = (): void => {
    model.selectProfile(null);
    setDeleteTarget(null);
    setIsAdvancedOpen(false);
    setEditorMode("create");
  };

  const startEdit = (profileId: string): void => {
    model.selectProfile(profileId);
    setDeleteTarget(null);
    setIsAdvancedOpen(false);
    setEditorMode("edit");
  };

  const closeEditor = (): void => {
    setDeleteTarget(null);
    setEditorMode(null);
  };

  return (
    <section className="lyra-settings-group">
      <header className="lyra-settings-group-header lyra-settings-ai-header">
        <h3>{labels.profilesTitle}</h3>
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
            className="lyra-settings-ai-action lyra-settings-ai-action-primary"
            onClick={startCreate}
          >
            {labels.addProfile}
          </button>
        </div>
      </header>

      <div className={STATUS_CLASSNAME[model.statusTone]}>
        <div className="lyra-settings-ai-status-row-copy">
          <strong>{model.defaultProfileLabel ?? labels.emptyTitle}</strong>
          <small>
            {labels.defaultProfileLabel}: {model.defaultProfileLabel ?? "-"} · {labels.mainModelLabel}: {defaultModelName}
          </small>
          <small>
            {model.runtimeHealth === null
              ? "Lyra Agent runtime unavailable"
              : `${model.runtimeHealth.backend} · ${model.runtimeHealth.transport} · ${model.runtimeHealth.version}`}
          </small>
        </div>
        <div className="lyra-settings-ai-status-row-copy">
          <strong>{labels.statusTitle}</strong>
          <small>{model.statusMessage}</small>
        </div>
      </div>

      {model.profiles.length === 0 ? (
        <div className="lyra-settings-ai-empty lyra-settings-ai-empty-panel">
          <strong>{labels.emptyTitle}</strong>
          <small>{labels.emptyDescription}</small>
          <button
            type="button"
            className="lyra-settings-ai-action lyra-settings-ai-action-primary"
            onClick={startCreate}
          >
            {labels.addProfile}
          </button>
        </div>
      ) : (
        <ul className="lyra-settings-ai-profile-grid" aria-label={labels.profilesTitle}>
          {model.profiles.map((profile) => {
            const preset = resolveProfilePreset(presets, profile);
            const providerLabel = preset?.label ?? profile.providerId;
            const baseUrl = readPrimaryConnectionValue(preset, { ...profile.connectionConfig }).trim() || "-";
            const isActive = activeEditorMode === "edit" && model.selectedProfileId === profile.id;
            return (
              <li key={profile.id} className="lyra-settings-ai-profile-card-slot">
                <article className={isActive
                  ? "lyra-settings-ai-profile-card lyra-settings-ai-profile-card-active"
                  : "lyra-settings-ai-profile-card"}
                >
                  <header className="lyra-settings-ai-profile-card-header">
                    <span className="lyra-settings-ai-profile-card-title">
                      <SettingsAiProviderIcon iconKey={preset?.iconKey ?? profile.providerId} title={providerLabel} />
                      <span>
                        <strong>{profile.name}</strong>
                        <small>{providerLabel}</small>
                      </span>
                    </span>
                    {profile.isDefault ? (
                      <span className="lyra-settings-ai-badge">{labels.defaultBadge}</span>
                    ) : null}
                  </header>
                  <dl className="lyra-settings-ai-profile-card-meta">
                    <div>
                      <dt>{labels.mainModelLabel}</dt>
                      <dd>{profile.model || "-"}</dd>
                    </div>
                    <div>
                      <dt>{labels.urlLabel}</dt>
                      <dd>{baseUrl}</dd>
                    </div>
                  </dl>
                  <div className="lyra-settings-ai-profile-card-footer">
                    <span className={profileStatusClassName(profile)}>
                      {profileStatusLabel(labels, profile)}
                    </span>
                    <div className="lyra-settings-ai-actions">
                      <button
                        type="button"
                        className="lyra-settings-ai-action"
                        onClick={() => {
                          startEdit(profile.id);
                        }}
                      >
                        {labels.editProfile}
                      </button>
                      <button
                        type="button"
                        className="lyra-settings-ai-action"
                        onClick={() => {
                          void model.validateProfile(profile.id);
                        }}
                      >
                        {labels.testConnection}
                      </button>
                      <button
                        type="button"
                        className="lyra-settings-ai-action"
                        disabled={profile.isDefault || model.isSaving}
                        onClick={() => {
                          void model.setDefaultProfile(profile.id);
                        }}
                      >
                        {labels.setDefaultProfile}
                      </button>
                      <button
                        type="button"
                        className="lyra-settings-ai-action lyra-settings-ai-action-danger"
                        disabled={model.isSaving}
                        onClick={() => {
                          setDeleteTarget({ id: profile.id, name: profile.name });
                        }}
                      >
                        {labels.deleteProfile}
                      </button>
                    </div>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}

      {deleteTarget === null ? null : (
        <div className="lyra-settings-ai-delete-confirm" aria-label={labels.deleteProfileConfirmTitle}>
          <span className="lyra-settings-ai-delete-confirm-copy">
            <strong>{labels.deleteProfileConfirmTitle}</strong>
            <small>{labels.deleteProfileConfirmDescription} {deleteTarget.name}</small>
          </span>
          <div className="lyra-settings-ai-actions">
            <button
              type="button"
              className="lyra-settings-ai-action"
              onClick={() => {
                setDeleteTarget(null);
              }}
            >
              {labels.cancel}
            </button>
            <button
              type="button"
              className="lyra-settings-ai-action lyra-settings-ai-action-danger"
              disabled={model.isSaving}
              onClick={() => {
                const targetId = deleteTarget.id;
                void model.deleteProfile(targetId).then(() => {
                  setDeleteTarget(null);
                  if (activeEditorMode === "edit" && model.draft.id === targetId) {
                    closeEditor();
                  }
                });
              }}
            >
              {labels.deleteProfile}
            </button>
          </div>
        </div>
      )}

      {activeEditorMode === null ? null : (
        <div className="lyra-settings-ai-inline-editor">
          <header className="lyra-settings-ai-inline-editor-header">
            <div className="lyra-settings-ai-inline-editor-title-copy">
              <h3>{activeEditorMode === "create" ? labels.addProfile : labels.editProfile}</h3>
              {selectedPreset === null ? null : (
                <small>
                  {selectedPreset.label} · {labels.capabilityLabel}: {capabilityLabel(labels, selectedPreset.capability)}
                </small>
              )}
            </div>
            <button
              type="button"
              className="lyra-settings-ai-action"
              onClick={closeEditor}
            >
              {labels.cancel}
            </button>
          </header>

          {activeEditorMode === "create" ? (
            <div className="lyra-settings-ai-provider-picker">
              <span className="lyra-settings-ai-section-label">{labels.selectProviderLabel}</span>
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
            </div>
          ) : null}

          <div className="lyra-settings-ai-form">
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

            <SettingsAiModelPicker
              labels={labels}
              primaryValue={primaryModelValue}
              primaryPlaceholder={labels.modelPlaceholder}
              helpText={helpText}
              models={model.availableModels}
              isDiscovering={model.isRefreshingModels}
              discoverLabel={labels.discoverModels}
              onPrimaryChange={(value) => {
                model.updateDraftModelsText(replacePrimaryConfiguredModelLine(model.draft.modelsText, value));
              }}
              onDiscover={() => {
                void model.refreshModels();
              }}
            />

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

            <details
              className="lyra-settings-ai-field lyra-settings-ai-field-span-2"
              open={isAdvancedOpen}
              onToggle={(event) => {
                setIsAdvancedOpen(event.currentTarget.open);
              }}
            >
              <summary className="lyra-settings-ai-advanced-summary">{labels.advancedSettingsLabel}</summary>
              <div className="lyra-settings-ai-advanced-grid">
                <SettingsAiAdditionalModelsPicker
                  labels={labels}
                  value={additionalModelsText}
                  placeholder={labels.modelPlaceholder}
                  models={additionalModelOptions}
                  selectedModelIds={additionalModelIds}
                  onChange={(value) => {
                    model.updateDraftModelsText(replaceAdditionalConfiguredModelLines(model.draft.modelsText, value));
                  }}
                  onToggleModel={(modelId) => {
                    model.updateDraftModelsText(toggleAdditionalConfiguredModelLine(model.draft.modelsText, modelId));
                  }}
                  onAddAllModels={() => {
                    model.updateDraftModelsText(
                      appendAdditionalConfiguredModelLines(
                        model.draft.modelsText,
                        additionalModelOptions.map((entry) => entry.id)
                      )
                    );
                  }}
                />

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
          </div>

          <footer className="lyra-settings-ai-inline-editor-footer">
            {activeEditorMode === "edit" && model.draft.id !== null ? (
              <button
                type="button"
                className="lyra-settings-ai-action lyra-settings-ai-action-danger"
                disabled={model.isSaving}
                onClick={() => {
                  setDeleteTarget({ id: model.draft.id ?? "", name: model.draft.name });
                }}
              >
                {labels.deleteProfile}
              </button>
            ) : <span />}
            <div className="lyra-settings-ai-actions">
              <button
                type="button"
                className="lyra-settings-ai-action"
                onClick={closeEditor}
              >
                {labels.cancel}
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
                className="lyra-settings-ai-action lyra-settings-ai-action-primary"
                disabled={model.isSaving}
                onClick={() => {
                  void model.saveProfile().then(() => {
                    closeEditor();
                  });
                }}
              >
                {labels.saveProfile}
              </button>
            </div>
          </footer>
        </div>
      )}
    </section>
  );
};
