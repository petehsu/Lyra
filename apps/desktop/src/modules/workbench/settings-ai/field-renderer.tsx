import type { AiProviderFieldSchema } from "../../../shared/ai";
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
        {isSecret ? (
          <button
            type="button"
            className="lyra-settings-ai-action"
            onClick={() => {
              model.clearSecretField(field.id);
            }}
          >
            {labels.clearApiKey}
          </button>
        ) : null}
      </label>
    );
  }

  if (field.kind === "select") {
    return (
      <label key={field.id} className="lyra-settings-ai-field">
        <span>{field.label}</span>
        <select
          className="lyra-settings-ai-input"
          value={value}
          onChange={(event) => {
            model.updateDraftField(target, field.id, event.target.value);
          }}
        >
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        {helperText ? <small>{helperText}</small> : null}
      </label>
    );
  }

  return (
    <label key={field.id} className="lyra-settings-ai-field">
      <span>{field.label}</span>
      {isSecret ? (
        <span className="lyra-settings-ai-secret-row">
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
          <button
            type="button"
            className="lyra-settings-ai-action lyra-settings-ai-action-inline"
            onClick={() => {
              model.clearSecretField(field.id);
            }}
          >
            {labels.clearApiKey}
          </button>
        </span>
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
