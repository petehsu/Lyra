import { Save, Trash2 } from "lucide-react";
import { useId, useState } from "react";

import { LyraListPicker } from "../list-picker";
import type { AiProviderFieldSchema } from "../../../shared/ai";
import {
  additionalConnectionFields,
  readPrimaryConnectionValue,
  readPrimarySecretValue,
  resolvePrimarySecretFieldId,
  resolvePrimaryUrlFieldId
} from "./draft";
import { SettingsAiProviderIcon } from "./icon-registry";
import { SettingsAiModelPicker } from "./model-picker";
import type { SettingsAiLabels, SettingsAiModel } from "./types";

type SettingsAiConfiguredModelCard = {
  readonly cardId: string;
  readonly profileId: string;
  readonly profileName: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly modelLabel: string;
  readonly description: string | null;
};

type SettingsAiConfiguredProviderGroup = {
  readonly providerId: string;
  readonly profileNames: readonly string[];
  readonly cards: readonly SettingsAiConfiguredModelCard[];
};

type SettingsAiViewProps = {
  readonly labels: SettingsAiLabels;
  readonly model: SettingsAiModel;
};

const inputTypeForField = (field: AiProviderFieldSchema): "text" | "password" => {
  if (field.kind === "password") {
    return "password";
  }
  return "text";
};

const configuredModelCardsForProfile = (
  profile: SettingsAiModel["profiles"][number]
): readonly SettingsAiConfiguredModelCard[] => {
  const entriesById = new Map([
    ...profile.customModels.map((entry) => [entry.id, entry] as const),
    ...profile.discoveryState.models.map((entry) => [entry.id, entry] as const)
  ]);
  return [
    profile.model,
    ...profile.customModels.map((entry) => entry.id),
    ...profile.discoveryState.models.map((entry) => entry.id)
  ]
    .map((entry) => entry.trim())
    .filter((entry, index, entries) => entry.length > 0 && entries.indexOf(entry) === index)
    .map((modelId) => {
      const entry = entriesById.get(modelId);
      return {
        cardId: `${profile.id}:${modelId}`,
        profileId: profile.id,
        profileName: profile.name,
        providerId: profile.providerId,
        modelId,
        modelLabel: entry?.name.trim() || modelId,
        description: entry?.description?.trim() || null
      };
    });
};

const configuredProviderGroups = (
  cards: readonly SettingsAiConfiguredModelCard[]
): readonly SettingsAiConfiguredProviderGroup[] => {
  const groups = new Map<string, {
    profileNames: string[];
    cards: SettingsAiConfiguredModelCard[];
  }>();
  for (const card of cards) {
    const group = groups.get(card.providerId);
    if (group === undefined) {
      groups.set(card.providerId, {
        profileNames: [card.profileName],
        cards: [card]
      });
      continue;
    }
    if (!group.profileNames.includes(card.profileName)) {
      group.profileNames.push(card.profileName);
    }
    group.cards.push(card);
  }
  return [...groups.entries()].map(([providerId, group]) => ({
    providerId,
    profileNames: group.profileNames,
    cards: group.cards
  }));
};

export const SettingsAiView = ({ labels, model }: SettingsAiViewProps) => {
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const selectedPreset = model.selectedPreset ?? null;
  const profileNameInputId = useId();
  const primaryUrlInputId = useId();
  const primarySecretInputId = useId();
  const urlFieldId = resolvePrimaryUrlFieldId(selectedPreset);
  const secretFieldId = resolvePrimarySecretFieldId(selectedPreset);
  const extraConnectionFields = additionalConnectionFields(selectedPreset);
  const providerOptions = model.presetSections.flatMap((section) =>
    section.presets.map((preset) => ({
      value: preset.id,
      label: preset.label
    }))
  );
  const configuredModelCards = model.profiles.flatMap(configuredModelCardsForProfile);
  const providerGroups = configuredProviderGroups(configuredModelCards);
  const resolvedActiveProviderId = providerGroups.some((group) => group.providerId === activeProviderId)
    ? activeProviderId
    : providerGroups[0]?.providerId ?? null;
  const activeProviderGroup = providerGroups.find((group) => group.providerId === resolvedActiveProviderId) ?? null;

  return (
    <section className="lyra-settings-group">
      <header className="lyra-settings-group-header lyra-settings-ai-header">
        <h3>{labels.profilesTitle}</h3>
      </header>

      {model.profiles.length === 0 || configuredModelCards.length === 0 ? (
        <div className="lyra-settings-ai-empty lyra-settings-ai-empty-panel">
          <strong>{model.profiles.length === 0 ? labels.emptyTitle : labels.noDiscoveredModels}</strong>
          <small>{model.profiles.length === 0 ? labels.emptyDescription : labels.modelsHelp}</small>
        </div>
      ) : (
        <div className="lyra-settings-ai-profile-grid">
          <div className="lyra-settings-ai-provider-list" aria-label={labels.providerTitle}>
            {providerGroups.map((group) => (
              <div
                key={group.providerId}
                className="lyra-settings-ai-provider-row"
              >
                <button
                  type="button"
                  className={
                    group.providerId === resolvedActiveProviderId
                      ? "lyra-settings-ai-provider-tab lyra-settings-ai-provider-tab-active"
                      : "lyra-settings-ai-provider-tab"
                  }
                  onClick={() => {
                    setActiveProviderId(group.providerId);
                  }}
                >
                  <SettingsAiProviderIcon iconKey={group.providerId} title={group.providerId} />
                  <span>
                    <strong>{group.providerId}</strong>
                    <small title={group.profileNames.join(", ")}>
                      {group.profileNames.join(", ")}
                    </small>
                  </span>
                </button>
                <button
                  type="button"
                  className="lyra-settings-ai-row-delete"
                  aria-label={`${labels.deleteProfile}: ${group.providerId}`}
                  title={labels.deleteProfile}
                  onClick={() => {
                    void model.deleteProviderModels(group.providerId);
                  }}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
          <div className="lyra-settings-ai-provider-models">
            {activeProviderGroup?.cards.map((card) => (
              <div
                key={card.cardId}
                className="lyra-settings-ai-model-row"
              >
                <button
                  type="button"
                  className={
                    card.profileId === model.selectedProfileId
                      ? "lyra-settings-ai-model-card lyra-settings-ai-model-card-active"
                      : "lyra-settings-ai-model-card"
                  }
                  onClick={() => {
                    model.selectProfile(card.profileId);
                  }}
                >
                  <strong title={card.modelId}>{card.modelLabel}</strong>
                  {card.description === null && card.modelLabel === card.modelId ? null : (
                    <small title={card.description ?? card.modelId}>
                      {card.description ?? card.modelId}
                    </small>
                  )}
                </button>
                <button
                  type="button"
                  className="lyra-settings-ai-row-delete"
                  aria-label={`${labels.deleteProfile}: ${card.modelLabel}`}
                  title={labels.deleteProfile}
                  onClick={() => {
                    void model.deleteConfiguredModel(card.profileId, card.modelId);
                  }}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            )) ?? null}
          </div>
        </div>
      )}

      <div className="lyra-settings-ai-inline-editor">
        <header className="lyra-settings-ai-inline-editor-header">
          <span className="lyra-settings-ai-inline-editor-title-copy">
            <h3>{model.draft.id === null ? labels.addProfile : labels.editProfile}</h3>
          </span>
        </header>

        <div className="lyra-settings-ai-form">
          <label className="lyra-settings-ai-field">
            <span id={profileNameInputId}>{labels.profileNameLabel}</span>
            <input
              aria-labelledby={profileNameInputId}
              className="lyra-settings-ai-input"
              type="text"
              value={model.draft.name}
              placeholder={labels.profileNamePlaceholder}
              onChange={(event) => {
                model.updateDraftName(event.target.value);
              }}
            />
          </label>

          <label className="lyra-settings-ai-field">
            <span>{labels.selectProviderLabel}</span>
            <LyraListPicker
              className="lyra-settings-ai-provider-picker"
              ariaLabel={labels.selectProviderLabel}
              listAriaLabel={labels.selectProviderLabel}
              value={model.selectedPresetId ?? providerOptions[0]?.value ?? ""}
              shape="rounded"
              options={providerOptions.length > 0 ? providerOptions : [{ value: "", label: labels.selectProviderLabel }]}
              onChange={(presetId) => {
                model.applyPreset(presetId);
              }}
            />
          </label>

          {urlFieldId === null ? null : (
            <label className="lyra-settings-ai-field">
              <span id={primaryUrlInputId}>{labels.urlLabel}</span>
              <input
                aria-labelledby={primaryUrlInputId}
                className="lyra-settings-ai-input"
                type="text"
                value={readPrimaryConnectionValue(selectedPreset, model.draft.connectionConfig)}
                placeholder={selectedPreset?.connectionFields.find((field) => field.id === urlFieldId)?.placeholder ?? labels.urlPlaceholder}
                onChange={(event) => {
                  model.updateDraftField("connection", urlFieldId, event.target.value);
                }}
              />
            </label>
          )}

          {extraConnectionFields.map((field) => (
            <label key={field.id} className="lyra-settings-ai-field">
              <span>{field.label}</span>
              <input
                className="lyra-settings-ai-input"
                type={inputTypeForField(field)}
                value={model.draft.connectionConfig[field.id] ?? ""}
                placeholder={field.placeholder}
                onChange={(event) => {
                  model.updateDraftField("connection", field.id, event.target.value);
                }}
              />
              {field.description === undefined ? null : (
                <small>{field.description}</small>
              )}
            </label>
          ))}

          {secretFieldId === null ? null : (
            <div className="lyra-settings-ai-field">
              <label id={primarySecretInputId}>{labels.keyLabel}</label>
              <input
                aria-labelledby={primarySecretInputId}
                className="lyra-settings-ai-input"
                type="password"
                autoComplete="off"
                value={readPrimarySecretValue(selectedPreset, model.draft.secretValues)}
                placeholder={labels.keyPlaceholder}
                onChange={(event) => {
                  model.updateDraftField("secret", secretFieldId, event.target.value);
                }}
              />
            </div>
          )}

          <SettingsAiModelPicker
            labels={labels}
            mode={model.modelSelectionMode}
            modelsText={model.draft.modelsText}
            onModeChange={model.updateDraftModelSelectionMode}
            onModelsTextChange={model.updateDraftModelsText}
          />
        </div>

        {model.errorMessage === null ? null : (
          <div className="lyra-settings-ai-error" role="alert">
            {model.errorMessage}
          </div>
        )}

        <footer className="lyra-settings-ai-inline-editor-footer">
          <span className="lyra-settings-ai-actions">
            <button
              type="button"
              className="lyra-settings-ai-action lyra-settings-ai-action-primary"
              disabled={model.isSaving}
              onClick={() => {
                void model.saveProfile();
              }}
            >
              <Save size={14} aria-hidden="true" />
              {labels.saveProfile}
            </button>
          </span>
        </footer>
      </div>
    </section>
  );
};
