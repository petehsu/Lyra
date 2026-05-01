import { ListPlus, RefreshCw } from "lucide-react";
import { useId } from "react";

import type { AiProviderModelEntry } from "../../../shared/ai";
import type { SettingsAiLabels } from "./types";

type SettingsAiModelPickerProps = {
  readonly labels: SettingsAiLabels;
  readonly primaryValue: string;
  readonly primaryPlaceholder: string;
  readonly helpText: string;
  readonly models: readonly AiProviderModelEntry[];
  readonly isDiscovering: boolean;
  readonly discoverLabel: string;
  readonly onPrimaryChange: (value: string) => void;
  readonly onDiscover: () => void;
};

type SettingsAiAdditionalModelsPickerProps = {
  readonly labels: SettingsAiLabels;
  readonly value: string;
  readonly placeholder: string;
  readonly models: readonly AiProviderModelEntry[];
  readonly selectedModelIds: readonly string[];
  readonly onChange: (value: string) => void;
  readonly onToggleModel: (modelId: string) => void;
  readonly onAddAllModels: () => void;
};

const modelSourceLabel = (labels: SettingsAiLabels, source: AiProviderModelEntry["source"]): string =>
  source === "dynamic"
    ? labels.modelSourceDynamic
    : source === "custom"
      ? labels.modelSourceCustom
      : labels.modelSourcePreset;

export const SettingsAiModelPicker = ({
  labels,
  primaryValue,
  primaryPlaceholder,
  helpText,
  models,
  isDiscovering,
  discoverLabel,
  onPrimaryChange,
  onDiscover
}: SettingsAiModelPickerProps) => {
  const modelListId = useId();
  const inputId = useId();

  return (
    <div className="lyra-settings-ai-field lyra-settings-ai-field-span-2">
      <span className="lyra-settings-ai-field-heading">
        <label htmlFor={inputId}>{labels.mainModelLabel}</label>
        <button
          type="button"
          className="lyra-settings-ai-action lyra-settings-ai-action-inline lyra-settings-ai-action-icon"
          aria-label={discoverLabel}
          title={discoverLabel}
          disabled={isDiscovering}
          onClick={() => {
            onDiscover();
          }}
        >
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      </span>
      <input
        id={inputId}
        className="lyra-settings-ai-input"
        type="text"
        autoComplete="off"
        list={modelListId}
        value={primaryValue}
        placeholder={primaryPlaceholder}
        onChange={(event) => {
          onPrimaryChange(event.target.value);
        }}
      />
      <datalist id={modelListId}>
        {models.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name}
          </option>
        ))}
      </datalist>
      <small>{helpText}</small>
      {models.length > 0 ? (
        <ul
          className="lyra-settings-ai-model-list"
          role="listbox"
          aria-label={labels.mainModelLabel}
        >
          {models.map((entry) => (
            <li key={entry.id} className="lyra-settings-ai-model-list-item">
              <button
                type="button"
                role="option"
                aria-selected={primaryValue === entry.id}
                className={primaryValue === entry.id
                  ? "lyra-settings-ai-model-option lyra-settings-ai-model-option-active"
                  : "lyra-settings-ai-model-option"}
                onClick={() => {
                  onPrimaryChange(entry.id);
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
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};

export const SettingsAiAdditionalModelsPicker = ({
  labels,
  value,
  placeholder,
  models,
  selectedModelIds,
  onChange,
  onToggleModel,
  onAddAllModels
}: SettingsAiAdditionalModelsPickerProps) => {
  const textareaId = useId();

  return (
    <div className="lyra-settings-ai-field lyra-settings-ai-field-span-2">
      <span className="lyra-settings-ai-field-heading">
        <label htmlFor={textareaId}>{labels.additionalModelsLabel}</label>
        <button
          type="button"
          className="lyra-settings-ai-action lyra-settings-ai-action-inline lyra-settings-ai-action-icon"
          aria-label={labels.addAllModels}
          title={labels.addAllModels}
          disabled={models.length === 0}
          onClick={() => {
            onAddAllModels();
          }}
        >
          <ListPlus size={14} aria-hidden="true" />
        </button>
      </span>
      <textarea
        id={textareaId}
        className="lyra-settings-ai-input lyra-settings-ai-input-multiline lyra-settings-ai-model-input"
        value={value}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {models.length > 0 ? (
        <ul
          className="lyra-settings-ai-model-list"
          role="listbox"
          aria-label={labels.additionalModelsLabel}
          aria-multiselectable="true"
        >
          {models.map((entry) => (
            <li key={entry.id} className="lyra-settings-ai-model-list-item">
              <button
                type="button"
                role="option"
                aria-selected={selectedModelIds.includes(entry.id)}
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
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};
