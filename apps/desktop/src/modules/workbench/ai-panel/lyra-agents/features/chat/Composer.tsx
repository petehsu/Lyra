import {
  useState,
  useRef,
  useEffect,
  type CSSProperties,
  type ChangeEvent,
  type FormEvent
} from "react";
import {
  ArrowUp,
  Camera,
  CircleAlert,
  Crosshair,
  Image as ImageIcon,
  Monitor,
  Plus,
  X
} from "lucide-react";
import {
  AppButton,
  AppIconButton,
  AppInput,
  AppMenu,
  AppMenuContent,
  AppMenuItem,
  AppMenuTrigger,
  AppModelMenu,
  AppSelect,
  AppTextarea,
  type AppModelMenuSubmenu
} from "@renderer/ui/components";
import { t } from "../../core/i18n";
import type {
  AgentImageAttachment,
  ComposerModelControls,
  ComposerPermissionModeControls
} from "../../core/types";

const MIN_HEIGHT = 64;
const MAX_HEIGHT = 200;
const TOOLBAR_ICON_SIZE = 14;
const TOOLBAR_ICON_STROKE_WIDTH = 2.1;
const SEND_LOGO_BURST_MS = 560;
const LYRA_COMPOSER_SEND_LOGO_URL = new URL(
  "../../../../../../renderer/assets/brand/lyra-mark.svg",
  import.meta.url
).toString();
const SEND_LOGO_STYLE = {
  "--lyra-agents-composer-send-logo-url": `url("${LYRA_COMPOSER_SEND_LOGO_URL}")`
} as CSSProperties;
type PermissionPickerValue = "approval" | "full_auto" | "custom";

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
  permissionModeControls,
  onOpenModelSettings,
  disabledReason,
  isTurnRunning,
  browserFollowModeEnabled,
  onToggleBrowserFollowMode,
  onCancelTurn,
}: {
  onSend: (text: string, images?: readonly AgentImageAttachment[]) => Promise<void> | void;
  onCaptureBrowserScreenshot?: () => Promise<AgentImageAttachment | null>;
  onCaptureWindowScreenshot?: () => Promise<AgentImageAttachment | null>;
  modelControls?: ComposerModelControls | null;
  permissionModeControls?: ComposerPermissionModeControls | null;
  onOpenModelSettings?: () => Promise<void>;
  disabledReason?: string | undefined;
  isTurnRunning: boolean;
  browserFollowModeEnabled: boolean;
  onToggleBrowserFollowMode: (enabled: boolean) => Promise<void> | void;
  onCancelTurn: () => Promise<void> | void;
}) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<AgentImageAttachment[]>([]);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendLogoVisible, setSendLogoVisible] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sendInFlightRef = useRef(false);
  const sendLogoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showSendLogoBurst = () => {
    if (sendLogoTimerRef.current !== null) {
      clearTimeout(sendLogoTimerRef.current);
    }
    setSendLogoVisible(true);
    sendLogoTimerRef.current = setTimeout(() => {
      setSendLogoVisible(false);
      sendLogoTimerRef.current = null;
    }, SEND_LOGO_BURST_MS);
  };

  const submit = async () => {
    if (disabledReason !== undefined || sendInFlightRef.current) return;
    const trimmed = value.trim();
    if (trimmed.length === 0 && attachments.length === 0) return;
    sendInFlightRef.current = true;
    setSendBusy(true);
    showSendLogoBurst();
    try {
      await onSend(trimmed, attachments);
      setValue("");
      setAttachments([]);
      setAttachmentMenuOpen(false);
    } finally {
      sendInFlightRef.current = false;
      setSendBusy(false);
    }
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

  useEffect(() => () => {
    if (sendLogoTimerRef.current !== null) {
      clearTimeout(sendLogoTimerRef.current);
    }
  }, []);

  const canSend = disabledReason === undefined && !sendBusy && (value.trim().length > 0 || attachments.length > 0);
  const hasDraft = value.trim().length > 0 || attachments.length > 0;
  const showPauseButton = isTurnRunning && !hasDraft;
  const primaryActionMode = sendLogoVisible ? "sending" : showPauseButton ? "pause" : "send";
  const primaryActionLabel = primaryActionMode === "pause" ? t("lyra-agents-composer.pause") : t("lyra-agents-composer.send");
  const followLabel = browserFollowModeEnabled
    ? t("lyra-agents-composer.stopFollowingAgent")
    : t("lyra-agents-composer.followAgent");
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
  const permissionModeOptions = permissionModeControls === null || permissionModeControls === undefined
    ? []
    : [
        {
          value: "approval" as const,
          label: t("lyra-agents-composer.permissionModeApproval")
        },
        {
          value: "full_auto" as const,
          label: t("lyra-agents-composer.permissionModeFullAuto")
        },
        ...(permissionModeControls.currentMode === "custom"
          ? [{
              value: "custom" as const,
              label: t("lyra-agents-composer.permissionModeCustom"),
              disabled: true
            }]
          : [])
      ];
  const selectedPermissionModeOption = permissionModeOptions.find(
    (option) => option.value === permissionModeControls?.currentMode
  );
  const fastValue = modelControls?.serviceTier.current ?? "default";
  const modelParameterSubmenus: AppModelMenuSubmenu[] = modelControls === null || modelControls === undefined
    ? []
    : [
        ...(modelControls.reasoningEffort.supported
          ? [{
              id: "reasoning-effort",
              ariaLabel: t("lyra-agents-composer.reasoningEffort"),
              label: t("lyra-agents-composer.reasoningEffort"),
              value: modelControls.reasoningEffort.current ?? "none",
              options: modelControls.reasoningEffort.options.map((option) => ({
                label: option,
                value: option
              })),
              disabled: modelControls.isSwitching,
              onValueChange: (nextValue: string) => {
                void modelControls.updateReasoningEffort(nextValue);
              }
            }]
          : []),
        ...(modelControls.verbosity.supported
          ? [{
              id: "verbosity",
              ariaLabel: t("lyra-agents-composer.verbosity"),
              label: t("lyra-agents-composer.verbosity"),
              value: modelControls.verbosity.current ?? "medium",
              options: modelControls.verbosity.options.map((option) => ({
                label: option,
                value: option
              })),
              disabled: modelControls.isSwitching,
              onValueChange: (nextValue: string) => {
                void modelControls.updateVerbosity(nextValue);
              }
            }]
          : []),
        ...(modelControls.serviceTier.supported
          ? [{
              id: "service-tier",
              ariaLabel: t("lyra-agents-composer.fastMode"),
              label: t("lyra-agents-composer.fastMode"),
              value: fastValue,
              options: [
                { label: t("lyra-agents-composer.serviceTierStandard"), value: "default" },
                ...modelControls.serviceTier.options.map((option) => ({
                  label: option,
                  value: option
                }))
              ],
              disabled: modelControls.isSwitching,
              onValueChange: (nextValue: string) => {
                void modelControls.updateServiceTier(nextValue);
              }
            }]
          : [])
      ];

  return (
    <form className="lyra-agents-composer" onSubmit={handleSubmit}>
      <AppTextarea
        ref={textareaRef}
        className="lyra-agents-composer-input"
        placeholder={disabledReason ?? t("lyra-agents-composer.placeholder")}
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
        <div className="lyra-agents-composer-attachments">
          {attachments.map((attachment) => (
            <figure key={attachment.id} className="lyra-agents-composer-attachment">
              <img
                src={"data:" + attachment.mediaType + ";base64," + attachment.data}
                alt={attachment.label ?? t("lyra-agents-message.imageAttachment")}
              />
              <figcaption>{attachment.label ?? t("lyra-agents-message.imageAttachment")}</figcaption>
              <AppButton variant="ghost" size="sm"
                type="button"
                aria-label={t("lyra-agents-composer.removeAttachment")}
                onClick={() => setAttachments((items) => items.filter((item) => item.id !== attachment.id))}
              >
                <X size={12} strokeWidth={2} />
              </AppButton>
            </figure>
          ))}
        </div>
      ) : null}
      <AppInput
        ref={fileInputRef}
        className="lyra-agents-composer-file-input"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        tabIndex={-1}
        onChange={(event) => {
          void handleFileChange(event);
        }}
      />
      <div className="lyra-agents-composer-bottom">
        <AppMenu open={attachmentMenuOpen} onOpenChange={setAttachmentMenuOpen}>
          <div className="lyra-agents-composer-attach-menu-wrap">
            <AppMenuTrigger asChild>
              <AppIconButton
                className="lyra-agents-composer-action"
                type="button"
                aria-label={t("lyra-agents-composer.attach")}
                title={t("lyra-agents-composer.attach")}
                active={attachmentMenuOpen}
                disabled={disabledReason !== undefined || attachmentBusy}
                onClick={() => {
                  if (!attachmentMenuOpen) {
                    setAttachmentMenuOpen(true);
                  }
                }}
              >
                <Plus size={TOOLBAR_ICON_SIZE} strokeWidth={TOOLBAR_ICON_STROKE_WIDTH} />
              </AppIconButton>
            </AppMenuTrigger>
            <AppMenuContent
              className="lyra-agents-composer-attach-menu"
              side="top"
              align="start"
              sideOffset={8}
            >
              <AppMenuItem
                className="lyra-app-menu-item-with-icon lyra-agents-composer-attach-menu-item"
                onSelect={() => fileInputRef.current?.click()}
              >
                <ImageIcon size={TOOLBAR_ICON_SIZE} strokeWidth={TOOLBAR_ICON_STROKE_WIDTH} />
                <span className="lyra-app-menu-item-label">{t("lyra-agents-composer.attachImage")}</span>
              </AppMenuItem>
              <AppMenuItem
                className="lyra-app-menu-item-with-icon lyra-agents-composer-attach-menu-item"
                onSelect={() => {
                  void captureAttachment(onCaptureBrowserScreenshot);
                }}
              >
                <Camera size={TOOLBAR_ICON_SIZE} strokeWidth={TOOLBAR_ICON_STROKE_WIDTH} />
                <span className="lyra-app-menu-item-label">{t("lyra-agents-composer.attachBrowserScreenshot")}</span>
              </AppMenuItem>
              <AppMenuItem
                className="lyra-app-menu-item-with-icon lyra-agents-composer-attach-menu-item"
                onSelect={() => {
                  void captureAttachment(onCaptureWindowScreenshot);
                }}
              >
                <Monitor size={TOOLBAR_ICON_SIZE} strokeWidth={TOOLBAR_ICON_STROKE_WIDTH} />
                <span className="lyra-app-menu-item-label">{t("lyra-agents-composer.attachWindowScreenshot")}</span>
              </AppMenuItem>
            </AppMenuContent>
          </div>
        </AppMenu>
        {modelControls !== null && modelControls !== undefined ? (
          <div className="lyra-agents-composer-model-controls">
            {modelPickerOptions.length > 0 ? (
              <AppModelMenu
                className="lyra-agents-composer-model-picker"
                contentClassName="lyra-agents-composer-select-content"
                ariaLabel={t("lyra-agents-composer.modelControls")}
                value={selectedModelValue}
                placeholder={selectedModel?.label ?? modelPickerOptions[0]?.label ?? ""}
                options={modelPickerOptions}
                disabled={modelControls.isSwitching}
                submenus={modelParameterSubmenus}
                onModelChange={(nextModel) => {
                  void modelControls.switchModel(nextModel);
                }}
              />
            ) : (
              <AppButton variant="ghost" size="sm"
                type="button"
                className="lyra-agents-composer-model-settings-button"
                aria-label={t("lyra-agents-composer.configureModel")}
                title={t("lyra-agents-composer.configureModel")}
                onClick={() => {
                  void (modelControls.openModelSettings?.() ?? onOpenModelSettings?.());
                }}
              >
                <CircleAlert size={TOOLBAR_ICON_SIZE} strokeWidth={TOOLBAR_ICON_STROKE_WIDTH} />
                <span>{t("lyra-agents-composer.configureModel")}</span>
              </AppButton>
            )}
            {permissionModeControls !== null && permissionModeControls !== undefined ? (
              <AppSelect<PermissionPickerValue>
                className="lyra-agents-composer-permission-mode-picker"
                contentClassName="lyra-agents-composer-select-content"
                ariaLabel={t("lyra-agents-composer.permissionMode")}
                value={permissionModeControls.currentMode}
                placeholder={selectedPermissionModeOption?.label ?? t("lyra-agents-composer.permissionModeApproval")}
                options={permissionModeOptions}
                disabled={permissionModeControls.isSwitching}
                onValueChange={(nextMode) => {
                  if (nextMode === "approval" || nextMode === "full_auto") {
                    void permissionModeControls.switchMode(nextMode);
                  }
                }}
              />
            ) : null}
          </div>
        ) : null}
        <div className="lyra-agents-composer-primary-actions">
          <AppButton variant="ghost" size="sm"
            type="button"
            className="lyra-agents-composer-follow"
            aria-label={followLabel}
            aria-pressed={browserFollowModeEnabled}
            title={followLabel}
            data-active={browserFollowModeEnabled ? "true" : "false"}
            disabled={followBusy}
            onClick={() => {
              if (followBusy) return;
              setFollowBusy(true);
              void Promise.resolve(onToggleBrowserFollowMode(!browserFollowModeEnabled))
                .finally(() => setFollowBusy(false));
            }}
          >
            <Crosshair size={TOOLBAR_ICON_SIZE} strokeWidth={TOOLBAR_ICON_STROKE_WIDTH} />
          </AppButton>
          <AppButton variant="ghost" size="sm"
            type={primaryActionMode === "send" ? "submit" : "button"}
            className="lyra-agents-composer-send"
            data-mode={primaryActionMode}
            disabled={primaryActionMode === "pause" ? cancelBusy : primaryActionMode === "send" ? !canSend : false}
            aria-busy={primaryActionMode === "sending" ? "true" : undefined}
            aria-label={primaryActionLabel}
            title={primaryActionLabel}
            onClick={primaryActionMode === "pause"
              ? () => {
                  if (cancelBusy) return;
                  setCancelBusy(true);
                  void Promise.resolve(onCancelTurn()).finally(() => setCancelBusy(false));
                }
              : undefined}
          >
            {primaryActionMode === "sending" || primaryActionMode === "pause" ? (
              <span className="lyra-agents-composer-send-logo" style={SEND_LOGO_STYLE} aria-hidden="true" />
            ) : (
              <ArrowUp size={TOOLBAR_ICON_SIZE} strokeWidth={TOOLBAR_ICON_STROKE_WIDTH} />
            )}
          </AppButton>
        </div>
      </div>
    </form>
  );
}
