import { useId } from "react";

import { AppSelect, AppTextarea } from "@renderer/ui/components";
import type { SettingsAiLabels, SettingsAiModelSelectionMode } from "./types";

type SettingsAiModelPickerProps = {
  readonly labels: SettingsAiLabels;
  readonly mode: SettingsAiModelSelectionMode;
  readonly modelsText: string;
  readonly onModeChange: (value: SettingsAiModelSelectionMode) => void;
  readonly onModelsTextChange: (value: string) => void;
};

const modelModeOptions = (
  labels: SettingsAiLabels
): readonly { readonly value: SettingsAiModelSelectionMode; readonly label: string }[] => [
  {
    value: "all",
    label: labels.modelModeAllLabel
  },
  {
    value: "custom",
    label: labels.modelModeCustomLabel
  }
];

export const SettingsAiModelPicker = ({
  labels,
  mode,
  modelsText,
  onModeChange,
  onModelsTextChange
}: SettingsAiModelPickerProps) => {
  const customInputId = useId();

  return (
    <div className="lyra-settings-ai-field">
      <span>{labels.mainModelLabel}</span>
      <AppSelect<SettingsAiModelSelectionMode>
        className="lyra-settings-ai-select lyra-settings-ai-model-mode-picker"
        ariaLabel={labels.mainModelLabel}
        value={mode}
        options={modelModeOptions(labels)}
        onValueChange={onModeChange}
      />
      {mode === "custom" ? (
        <>
          <AppTextarea
            id={customInputId}
            aria-label={labels.modelLabel}
            className="lyra-settings-ai-input lyra-settings-ai-input-multiline lyra-settings-ai-model-input"
            autoComplete="off"
            value={modelsText}
            placeholder={labels.modelPlaceholder}
            onChange={(event) => {
              onModelsTextChange(event.target.value);
            }}
          />
          <small>{labels.modelsHelp}</small>
        </>
      ) : null}
    </div>
  );
};
