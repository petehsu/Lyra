import { useState, useRef, useEffect, type ChangeEvent, type FormEvent } from "react";
import { ArrowUp, Camera, CircleAlert, Image as ImageIcon, Monitor, Plus, X } from "lucide-react";
import { LyraListPicker } from "../../../../list-picker";
import { t } from "../../core/i18n";
import type { AgentImageAttachment, ComposerModelControls } from "../../core/types";

const MIN_HEIGHT = 64;
const MAX_HEIGHT = 200;

const attachmentId = (prefix: string): string => {
  const randomId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return prefix + "-" + randomId;
};

const readImageAttachment = async (file: File): Promise<AgentImageAttachment> => {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Image file could not be read."));
      }
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Image file could not be read.")));
    reader.readAsDataURL(file);
  });
  const [header, data = dataUrl] = dataUrl.split(",", 2);
  const mediaType = /^data:([^;]+);base64$/u.exec(header ?? "")?.[1] ?? file.type ?? "image/png";
  return {
    id: attachmentId("local-image"),
    mediaType,
    data,
    label: file.name,
    source: "local-file"
  };
};

export function Composer({
  onSend,
  onCaptureBrowserScreenshot,
  onCaptureWindowScreenshot,
  modelControls,
  onOpenModelSettings,
  disabledReason,
}: {
  onSend: (text: string, images?: readonly AgentImageAttachment[]) => Promise<void> | void;
  onCaptureBrowserScreenshot?: () => Promise<AgentImageAttachment | null>;
  onCaptureWindowScreenshot?: () => Promise<AgentImageAttachment | null>;
  modelControls?: ComposerModelControls | null;
  onOpenModelSettings?: () => Promise<void>;
  disabledReason?: string | undefined;
}) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<AgentImageAttachment[]>([]);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (disabledReason !== undefined) return;
    const trimmed = value.trim();
    if (trimmed.length === 0 && attachments.length === 0) return;
    await onSend(trimmed, attachments);
    setValue("");
    setAttachments([]);
    setAttachmentMenuOpen(false);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit();
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).filter((file) => file.type.startsWith("image/"));
    event.target.value = "";
    if (files.length === 0) return;
    setAttachmentBusy(true);
    try {
      const next = await Promise.all(files.map(readImageAttachment));
      setAttachments((items) => [...items, ...next]);
      setAttachmentMenuOpen(false);
    } finally {
      setAttachmentBusy(false);
    }
  };

  const captureAttachment = async (
    capture: (() => Promise<AgentImageAttachment | null>) | undefined
  ) => {
    if (capture === undefined) return;
    setAttachmentBusy(true);
    try {
      const attachment = await capture();
      if (attachment !== null) {
        setAttachments((items) => [...items, attachment]);
      }
      setAttachmentMenuOpen(false);
    } finally {
      setAttachmentBusy(false);
    }
  };

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = MIN_HEIGHT + "px";
    el.style.overflowY = "hidden";
    const scrollH = el.scrollHeight;
    if (scrollH > MAX_HEIGHT) {
      el.style.height = MAX_HEIGHT + "px";
      el.style.overflowY = "auto";
    } else {
      el.style.height = Math.max(MIN_HEIGHT, scrollH) + "px";
    }
  }, [value]);

  const canSend = disabledReason === undefined && (value.trim().length > 0 || attachments.length > 0);
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
        placeholder={disabledReason ?? t("composer.placeholder")}
        value={value}
        disabled={disabledReason !== undefined}
        aria-disabled={disabledReason !== undefined}
        onChange={(e) => setValue(e.target.value)}
        rows={1}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      {attachments.length > 0 ? (
        <div className="composer-attachments">
          {attachments.map((attachment) => (
            <figure key={attachment.id} className="composer-attachment">
              <img
                src={"data:" + attachment.mediaType + ";base64," + attachment.data}
                alt={attachment.label ?? t("msg.imageAttachment")}
              />
              <figcaption>{attachment.label ?? t("msg.imageAttachment")}</figcaption>
              <button
                type="button"
                aria-label={t("composer.removeAttachment")}
                onClick={() => setAttachments((items) => items.filter((item) => item.id !== attachment.id))}
              >
                <X size={12} strokeWidth={2} />
              </button>
            </figure>
          ))}
        </div>
      ) : null}
      <input
        ref={fileInputRef}
        className="composer-file-input"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        tabIndex={-1}
        onChange={(event) => {
          void handleFileChange(event);
        }}
      />
      <div className="composer-bottom">
        <div className="composer-attach-menu-wrap">
          <button
            type="button"
            className="composer-action"
            aria-label={t("composer.attach")}
            aria-haspopup="menu"
            aria-expanded={attachmentMenuOpen}
            disabled={disabledReason !== undefined || attachmentBusy}
            onClick={() => setAttachmentMenuOpen((open) => !open)}
          >
            <Plus size={16} strokeWidth={2} />
          </button>
          {attachmentMenuOpen ? (
            <div className="composer-attach-menu" role="menu" aria-label={t("composer.attach")}>
              <button
                type="button"
                role="menuitem"
                onClick={() => fileInputRef.current?.click()}
              >
                <ImageIcon size={14} strokeWidth={1.9} />
                <span>{t("composer.attachImage")}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  void captureAttachment(onCaptureBrowserScreenshot);
                }}
              >
                <Camera size={14} strokeWidth={1.9} />
                <span>{t("composer.attachBrowserScreenshot")}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  void captureAttachment(onCaptureWindowScreenshot);
                }}
              >
                <Monitor size={14} strokeWidth={1.9} />
                <span>{t("composer.attachWindowScreenshot")}</span>
              </button>
            </div>
          ) : null}
        </div>
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
