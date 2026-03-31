import type {
  AiProviderCapability,
  AiProviderModelEntry
} from "../../../shared/ai";
import type { SettingsAiLabels } from "./types";

type SettingsAiModelPickerProps = {
  readonly labels: SettingsAiLabels;
  readonly value: string;
  readonly placeholder: string;
  readonly capability: AiProviderCapability;
  readonly models: readonly AiProviderModelEntry[];
  readonly onChange: (value: string) => void;
};

const capabilityLabel = (labels: SettingsAiLabels, capability: AiProviderCapability): string => {
  switch (capability) {
    case "full":
      return labels.capabilityFull;
    case "static":
      return labels.capabilityStatic;
    default:
      return labels.capabilityPending;
  }
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
  capability,
  models,
  onChange
}: SettingsAiModelPickerProps) => (
  <label className="lyra-settings-ai-field lyra-settings-ai-field-span-2">
    <span className="lyra-settings-ai-field-heading">
      <span>{labels.modelLabel}</span>
      <span className="lyra-settings-ai-badge">{capabilityLabel(labels, capability)}</span>
    </span>
    <input
      className="lyra-settings-ai-input"
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    />
    <small>
      {models.length === 0
        ? labels.noDiscoveredModels
        : models.map((entry) => entry.name).slice(0, 6).join(" · ")}
    </small>
    {models.length > 0 ? (
      <div className="lyra-settings-ai-model-list" role="listbox" aria-label={labels.modelLabel}>
        {models.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={entry.id === value
              ? "lyra-settings-ai-model-option lyra-settings-ai-model-option-active"
              : "lyra-settings-ai-model-option"}
            onClick={() => {
              onChange(entry.id);
            }}
          >
            <span className="lyra-settings-ai-model-option-copy">
              <strong>{entry.name}</strong>
              <small>{entry.id}</small>
              {entry.description ? <small>{entry.description}</small> : null}
            </span>
            <span className="lyra-settings-ai-model-option-meta">
              <span className="lyra-settings-ai-badge lyra-settings-ai-badge-subtle">{modelSourceLabel(labels, entry.source)}</span>
            </span>
          </button>
        ))}
      </div>
    ) : null}
  </label>
);
