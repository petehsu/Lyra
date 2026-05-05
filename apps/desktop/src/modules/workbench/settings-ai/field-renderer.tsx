import type { AiProviderFieldSchema } from "../../../shared/ai";
import { LyraListPicker } from "../list-picker";
import type { SettingsAiLabels, SettingsAiModel } from "./types";

type SettingsAiFieldRendererProps = {
  readonly field: AiProviderFieldSchema;
  readonly model: SettingsAiModel;
  readonly labels: SettingsAiLabels;
  readonly target: "connection" | "auth";
};

export const SettingsAiFieldRenderer = ({
  field,
  model,
  labels,
  target
}: SettingsAiFieldRendererProps) => {
  const isSecret = field.secret === true;
  const value = isSecret
    ? model.draft.secretValues[field.id] ?? ""
    : target === "connection"
      ? model.draft.connectionConfig[field.id] ?? ""
      : model.draft.authConfig[field.id] ?? "";

  const helperText = isSecret
    ? model.draft.configuredSecretFields.includes(field.id)
      ? labels.secretConfigured
      : labels.secretMissing
    : field.description;

  if (field.kind === "textarea") {
    return (
      <label key={field.id} className="lyra-settings-ai-field">
        <span>{field.label}</span>
        <textarea
          className="lyra-settings-ai-input lyra-settings-ai-input-multiline"
          value={value}
          placeholder={field.placeholder}
          onChange={(event) => {
            model.updateDraftField(isSecret ? "secret" : target, field.id, event.target.value);
          }}
        />
        {helperText ? <small>{helperText}</small> : null}
      </label>
    );
  }

  if (field.kind === "select") {
    const availableOptions = field.options ?? [];
    const hasCurrentValue = availableOptions.some((option) => option.value === value);
    const resolvedOptions = value.trim().length > 0 && !hasCurrentValue
      ? [{ value, label: value }, ...availableOptions]
      : availableOptions;
    const fallbackLabel = field.placeholder ?? field.label;
    const pickerOptions = resolvedOptions.length > 0
      ? resolvedOptions
      : [{ value: "", label: fallbackLabel, disabled: true }];
    const resolvedValue = pickerOptions.some((option) => option.value === value)
      ? value
      : pickerOptions[0]?.value ?? "";

    return (
      <label key={field.id} className="lyra-settings-ai-field">
        <span>{field.label}</span>
        <LyraListPicker
          className="lyra-settings-ai-list-picker"
          ariaLabel={field.label}
          listAriaLabel={field.label}
          value={resolvedValue}
          shape="rounded"
          options={pickerOptions}
          disabled={resolvedOptions.length === 0}
          onChange={(nextValue) => {
            model.updateDraftField(isSecret ? "secret" : target, field.id, nextValue);
          }}
        />
        {helperText ? <small>{helperText}</small> : null}
      </label>
    );
  }

  return (
    <label key={field.id} className="lyra-settings-ai-field">
      <span>{field.label}</span>
      {isSecret ? (
        <input
          className="lyra-settings-ai-input"
          type="password"
          autoComplete="off"
          value={value}
          placeholder={field.placeholder}
          onChange={(event) => {
            model.updateDraftField("secret", field.id, event.target.value);
          }}
        />
      ) : (
        <input
          className="lyra-settings-ai-input"
          type="text"
          autoComplete="off"
          value={value}
          placeholder={field.placeholder}
          onChange={(event) => {
            model.updateDraftField(target, field.id, event.target.value);
          }}
        />
      )}
      {helperText ? <small>{helperText}</small> : null}
    </label>
  );
};
