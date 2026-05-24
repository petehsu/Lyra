import { useState, useRef, useEffect, type FormEvent } from "react";
import { ArrowUp, CircleAlert, Plus } from "lucide-react";
import { LyraListPicker } from "../../../../list-picker";
import { t } from "../../core/i18n";
import type { ComposerModelControls } from "../../core/types";

const MIN_HEIGHT = 64;
const MAX_HEIGHT = 200;

export function Composer({
  onSend,
  modelControls,
  onOpenModelSettings,
}: {
  onSend: (text: string) => void;
  modelControls?: ComposerModelControls | null;
  onOpenModelSettings?: () => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue("");
  };

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = `${MIN_HEIGHT}px`;
    el.style.overflowY = "hidden";
    const scrollH = el.scrollHeight;
    if (scrollH > MAX_HEIGHT) {
      el.style.height = `${MAX_HEIGHT}px`;
      el.style.overflowY = "auto";
    } else {
      el.style.height = `${Math.max(MIN_HEIGHT, scrollH)}px`;
    }
  }, [value]);

  const canSend = value.trim().length > 0;
  const configuredModels = (modelControls?.models ?? []).filter((model) => model.available);
  const selectedModel =
    configuredModels.find((model) => model.id === modelControls?.currentModel)
    ?? configuredModels.find((model) => model.model === modelControls?.currentModel)
    ?? null;
  const modelPickerOptions = configuredModels.map((model) => ({
    value: model.id,
    label: model.label
  }));
  const selectedModelValue = selectedModel?.id ?? modelPickerOptions[0]?.value ?? "";
  const fastValue = modelControls?.serviceTier.current ?? "default";

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <textarea
        ref={textareaRef}
        className="composer-input"
        placeholder={t("composer.placeholder")}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={1}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            handleSubmit(e as unknown as FormEvent);
          }
        }}
      />
      <div className="composer-bottom">
        <button type="button" className="composer-action" aria-label={t("composer.attach")}>
          <Plus size={16} strokeWidth={2} />
        </button>
        {modelControls !== null && modelControls !== undefined ? (
          <div className="composer-model-controls">
            {modelPickerOptions.length > 0 ? (
              <LyraListPicker
                className="composer-model-picker"
                variant="compact"
                shape="rounded"
                ariaLabel={t("composer.modelControls")}
                listAriaLabel={t("composer.modelList")}
                value={selectedModelValue}
                displayLabel={selectedModel?.label ?? modelPickerOptions[0]?.label ?? ""}
                options={modelPickerOptions}
                visibleOptionCount={Math.min(6, modelPickerOptions.length)}
                disabled={modelControls.isSwitching}
                onChange={(nextModel) => {
                  void modelControls.switchModel(nextModel);
                }}
              />
            ) : (
              <button
                type="button"
                className="composer-model-settings-button"
                aria-label={t("composer.configureModel")}
                title={t("composer.configureModel")}
                onClick={() => {
                  void (modelControls.openModelSettings?.() ?? onOpenModelSettings?.());
                }}
              >
                <CircleAlert size={13} strokeWidth={2} />
                <span>{t("composer.configureModel")}</span>
              </button>
            )}
            {modelPickerOptions.length > 0 && modelControls.reasoningEffort.supported ? (
              <select
                className="composer-mini-select"
                value={modelControls.reasoningEffort.current ?? "none"}
                disabled={modelControls.isSwitching}
                title={t("composer.reasoningEffort")}
                aria-label={t("composer.reasoningEffort")}
                onChange={(event) => {
                  void modelControls.updateReasoningEffort(event.target.value);
                }}
              >
                {modelControls.reasoningEffort.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : null}
            {modelPickerOptions.length > 0 && modelControls.serviceTier.supported ? (
              <select
                className="composer-mini-select"
                value={fastValue}
                disabled={modelControls.isSwitching}
                title={t("composer.fastMode")}
                aria-label={t("composer.fastMode")}
                onChange={(event) => {
                  void modelControls.updateServiceTier(event.target.value);
                }}
              >
                <option value="default">{t("composer.serviceTierStandard")}</option>
                {modelControls.serviceTier.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        ) : null}
        <button
          type="submit"
          className="composer-send"
          disabled={!canSend}
          aria-label={t("composer.send")}
        >
          <ArrowUp size={14} strokeWidth={2.4} />
        </button>
      </div>
    </form>
  );
}
