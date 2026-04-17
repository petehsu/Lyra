import type { AiProviderModelEntry } from "../../../shared/ai";
import type { SettingsAiLabels } from "./types";

type SettingsAiModelPickerProps = {
  readonly labels: SettingsAiLabels;
  readonly value: string;
  readonly placeholder: string;
  readonly helpText: string;
  readonly models: readonly AiProviderModelEntry[];
  readonly selectedModelIds: readonly string[];
  readonly isDiscovering: boolean;
  readonly discoverLabel: string;
  readonly onChange: (value: string) => void;
  readonly onDiscover: () => void;
  readonly onToggleModel: (modelId: string) => void;
};

const modelSourceLabel = (labels: SettingsAiLabels, source: AiProviderModelEntry["source"]): string =>
  source === "dynamic"
    ? labels.modelSourceDynamic
    : source === "custom"
      ? labels.modelSourceCustom
      : labels.modelSourcePreset;

export const SettingsAiModelPicker = ({
  labels,
  value,
  placeholder,
  helpText,
  models,
  selectedModelIds,
  isDiscovering,
  discoverLabel,
  onChange,
  onDiscover,
  onToggleModel
}: SettingsAiModelPickerProps) => (
  <label className="lyra-settings-ai-field lyra-settings-ai-field-span-2">
    <span className="lyra-settings-ai-field-heading">
      <span>{labels.modelLabel}</span>
      <button
        type="button"
        className="lyra-settings-ai-action lyra-settings-ai-action-inline"
        disabled={isDiscovering}
        onClick={() => {
          onDiscover();
        }}
      >
        {discoverLabel}
      </button>
    </span>
    <textarea
      className="lyra-settings-ai-input lyra-settings-ai-input-multiline lyra-settings-ai-model-input"
      value={value}
      placeholder={placeholder}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    />
    <small>{helpText}</small>
    {models.length > 0 ? (
      <div className="lyra-settings-ai-model-list" role="listbox" aria-label={labels.modelLabel}>
        {models.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={selectedModelIds.includes(entry.id)
              ? "lyra-settings-ai-model-option lyra-settings-ai-model-option-active"
              : "lyra-settings-ai-model-option"}
            onClick={() => {
              onToggleModel(entry.id);
            }}
          >
            <span className="lyra-settings-ai-model-option-copy">
              <strong>{entry.name}</strong>
              <small>{entry.id}</small>
              {entry.description ? <small>{entry.description}</small> : null}
            </span>
            <span className="lyra-settings-ai-model-option-meta">
              <span className="lyra-settings-ai-badge lyra-settings-ai-badge-subtle">
                {modelSourceLabel(labels, entry.source)}
              </span>
            </span>
          </button>
        ))}
      </div>
    ) : null}
  </label>
);
