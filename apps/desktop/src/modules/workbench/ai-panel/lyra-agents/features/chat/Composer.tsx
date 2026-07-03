import {
  useState,
  useRef,
  useEffect,
  type CSSProperties,
  type FormEvent
} from "react";
import type {
  AgentPageCitation,
  AgentTranscriptCitation
} from "../../../../../../shared/agent";
import {
  ArrowUp,
  Camera,
  CircleAlert,
  Crosshair,
  File as FileIcon,
  LayoutGrid,
  Monitor,
  Plus,
  Terminal
} from "lucide-react";
import {
  AppButton,
  AppIconButton,
  AppMenu,
  AppMenuContent,
  AppMenuItem,
  AppMenuSub,
  AppMenuSubContent,
  AppMenuSubTrigger,
  AppMenuTrigger,
  AppModelMenu,
  AppSelect,
  type AppModelMenuGroup,
  type AppModelMenuSubmenu
} from "@renderer/ui/components";
import {
  CitationComposerInput,
  type CitationComposerInputHandle
} from "./CitationComposerInput";
import {
  hasComposerContent,
  segmentsToCitations,
  segmentsToPlainText,
  type ComposerInsertableCitation,
  type ComposerSegment
} from "./message-citation";
import { segmentsToImages } from "./composer-image";
import { segmentsToFileAttachments } from "./composer-file";
import { segmentsToPageCitations } from "./page-citation";
import {
  ComposerAttachMenuLeadingIcon,
  TerminalTabAttachMenuIcon,
  WorkspaceTabAttachMenuIcon
} from "./composer-attach-menu-icons";
import { buildTerminalTabPageCitation } from "./terminal-tab-citation";
import { buildWorkspaceTabPageCitation } from "./workspace-tab-citation";
import { t } from "@workbench/i18n";
import type { TerminalDockTab } from "../../../../terminal-dock/types";
import type { WorkspaceTab } from "../../../../workspace-tabs/types";
import type {
  AgentImageAttachment,
  ComposerModelControls,
  ComposerPermissionModeControls
} from "../../core/types";
import type { AgentFileAttachment } from "./composer-file";
import { AgentProviderBrandIcon } from "../../../../agent-provider-brand-icon";
import { getDesktopApi } from "../../../../shell/service";


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

export function Composer({
  onSend,
  onCaptureWorkspaceScreenshot,
  onCaptureWindowScreenshot,
  onPickFileFromFileManager,
  onImageAttachmentClick,
  workspaceTabs = [],
  terminalTabs = [],
  modelControls,
  permissionModeControls,
  onOpenModelSettings,
  disabledReason,
  isTurnRunning,
  browserFollowModeEnabled,
  onToggleBrowserFollowMode,
  onCancelTurn,
  onTranscriptCitationClick,
  onPageCitationClick,
  pendingCitation = null,
  pendingCitationNonce = 0,
  pendingImages = [],
  pendingImagesNonce = 0,
  pendingFiles = [],
  pendingFilesNonce = 0,
}: {
  onSend: (
    text: string,
    images?: readonly AgentImageAttachment[],
    citations?: readonly AgentTranscriptCitation[],
    pageCitations?: readonly AgentPageCitation[],
    fileCitations?: readonly AgentFileAttachment[],
    segments?: readonly ComposerSegment[]
  ) => Promise<void> | void;
  onTranscriptCitationClick?: (citation: AgentTranscriptCitation) => void;
  onPageCitationClick?: (citation: AgentPageCitation) => void;
  pendingCitation?: ComposerInsertableCitation | null;
  pendingCitationNonce?: number;
  pendingImages?: readonly AgentImageAttachment[];
  pendingImagesNonce?: number;
  pendingFiles?: readonly AgentFileAttachment[];
  pendingFilesNonce?: number;
  onCaptureWorkspaceScreenshot?: () => Promise<AgentImageAttachment | null>;
  onCaptureWindowScreenshot?: () => Promise<AgentImageAttachment | null>;
  onPickFileFromFileManager?: () => Promise<
    | { readonly kind: "image"; readonly attachment: AgentImageAttachment }
    | { readonly kind: "file"; readonly attachment: AgentFileAttachment }
    | null
  >;
  onImageAttachmentClick?: (image: AgentImageAttachment) => void;
  workspaceTabs?: readonly WorkspaceTab[];
  terminalTabs?: readonly TerminalDockTab[];
  modelControls?: ComposerModelControls | null;
  permissionModeControls?: ComposerPermissionModeControls | null;
  onOpenModelSettings?: () => Promise<void>;
  disabledReason?: string | undefined;
  isTurnRunning: boolean;
  browserFollowModeEnabled: boolean;
  onToggleBrowserFollowMode: (enabled: boolean) => Promise<void> | void;
  onCancelTurn: () => Promise<void> | void;
}) {
  const [segments, setSegments] = useState<ComposerSegment[]>([]);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [attachmentSubmenuId, setAttachmentSubmenuId] = useState<string | null>(null);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendLogoVisible, setSendLogoVisible] = useState(false);
  const composerRootRef = useRef<HTMLFormElement>(null);
  const composerInputRef = useRef<CitationComposerInputHandle>(null);
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
    const committedSegments = composerInputRef.current?.readSegments() ?? segments;
    if (!hasComposerContent(committedSegments)) return;
    const text = segmentsToPlainText(committedSegments).trim();
    const citations = segmentsToCitations(committedSegments);
    const pageCitations = segmentsToPageCitations(committedSegments);
    const fileCitations = segmentsToFileAttachments(committedSegments);
    const images = segmentsToImages(committedSegments);
    sendInFlightRef.current = true;
    setSendBusy(true);
    setSendError(null);
    showSendLogoBurst();
    try {
      await onSend(
        text,
        images,
        citations.length > 0 ? citations : undefined,
        pageCitations.length > 0 ? pageCitations : undefined,
        fileCitations.length > 0 ? fileCitations : undefined,
        committedSegments
      );
      setSegments([]);
      composerInputRef.current?.clear();
      setAttachmentMenuOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to send message.";
      setSendError(message);
    } finally {
      sendInFlightRef.current = false;
      setSendBusy(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit();
  };

  const pickFileAttachment = async () => {
    if (onPickFileFromFileManager === undefined) return;
    setAttachmentBusy(true);
    try {
      const result = await onPickFileFromFileManager();
      if (result !== null) {
        if (result.kind === "image") {
          composerInputRef.current?.insertImage(result.attachment);
        } else {
          composerInputRef.current?.insertFile(result.attachment);
        }
        composerInputRef.current?.focus();
      }
      setAttachmentMenuOpen(false);
      setAttachmentSubmenuId(null);
    } finally {
      setAttachmentBusy(false);
    }
  };

  const insertWorkspaceTabCitation = (tab: WorkspaceTab) => {
    composerInputRef.current?.insertCitation({
      kind: "page",
      citation: buildWorkspaceTabPageCitation(tab)
    });
    composerInputRef.current?.focus();
    setAttachmentMenuOpen(false);
    setAttachmentSubmenuId(null);
  };

  const insertTerminalTabCitation = (tab: TerminalDockTab) => {
    composerInputRef.current?.insertCitation({
      kind: "page",
      citation: buildTerminalTabPageCitation(tab, workspaceTabs)
    });
    composerInputRef.current?.focus();
    setAttachmentMenuOpen(false);
    setAttachmentSubmenuId(null);
  };

  const captureAttachment = async (
    capture: (() => Promise<AgentImageAttachment | null>) | undefined
  ) => {
    if (capture === undefined) return;
    setAttachmentBusy(true);
    try {
      const attachment = await capture();
      if (attachment !== null) {
        composerInputRef.current?.insertImage(attachment);
        composerInputRef.current?.focus();
      }
      setAttachmentMenuOpen(false);
    } finally {
      setAttachmentBusy(false);
    }
  };

  const handleImageAttachmentsAccepted = (attachments: readonly AgentImageAttachment[]) => {
    for (const attachment of attachments) {
      composerInputRef.current?.insertImage(attachment);
    }
    if (attachments.length > 0) {
      composerInputRef.current?.focus();
      void getDesktopApi()?.screenshotPreview.dismiss().catch(() => undefined);
    }
  };

  useEffect(() => {
    if (pendingCitation === null || pendingCitationNonce === 0) return;
    composerInputRef.current?.insertCitation(pendingCitation);
    composerInputRef.current?.focus();
  }, [pendingCitation, pendingCitationNonce]);

  useEffect(() => {
    if (pendingImages.length === 0 || pendingImagesNonce === 0) return;
    for (const attachment of pendingImages) {
      composerInputRef.current?.insertImage(attachment);
    }
    composerInputRef.current?.focus();
    void getDesktopApi()?.screenshotPreview.dismiss().catch(() => undefined);
  }, [pendingImages, pendingImagesNonce]);

  useEffect(() => {
    if (pendingFiles.length === 0 || pendingFilesNonce === 0) return;
    for (const file of pendingFiles) {
      composerInputRef.current?.insertFile(file);
    }
    composerInputRef.current?.focus();
  }, [pendingFiles, pendingFilesNonce]);

  useEffect(() => () => {
    if (sendLogoTimerRef.current !== null) {
      clearTimeout(sendLogoTimerRef.current);
    }
  }, []);

  const canSend = disabledReason === undefined && !sendBusy && hasComposerContent(segments);
  const hasDraft = hasComposerContent(segments);
  const showPauseButton = isTurnRunning && !hasDraft;
  const primaryActionMode = sendLogoVisible ? "sending" : showPauseButton ? "pause" : "send";
  const primaryActionLabel = primaryActionMode === "pause" ? t("lyra-agents-composer.pause") : t("lyra-agents-composer.send");
  const followLabel = browserFollowModeEnabled
    ? t("lyra-agents-composer.stopFollowingAgent")
    : t("lyra-agents-composer.followAgent");
  const configuredModels = (modelControls?.models ?? []).filter((model) => model.available && model.enabled);
  const selectedModel =
    configuredModels.find((model) => model.id === modelControls?.currentModel)
    ?? configuredModels.find((model) => model.model === modelControls?.currentModel)
    ?? null;
  const modelPickerOptions = configuredModels.map((model) => ({
    value: model.id,
    label: model.label,
    icon: (
      <AgentProviderBrandIcon
        label={model.provider ?? model.label}
        modelId={model.model}
        provider={model.provider}
        providerId={model.providerId}
        routeId={model.providerKey}
      />
    )
  }));
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

  // ponytail: O(n) grouping via Map — models are <50 so even O(n²) would be fine
  const modelPickerGroups: readonly AppModelMenuGroup[] = (() => {
    const map = new Map<string, AppModelMenuGroup>();
    configuredModels.forEach((model, i) => {
      const key = model.providerKey ?? model.providerId ?? model.provider ?? model.id;
      const existing = map.get(key);
      const option = modelPickerOptions[i];
      if (existing) {
        map.set(key, { ...existing, options: [...existing.options, option] });
      } else {
        map.set(key, { label: model.provider ?? model.providerId ?? key, options: [option] });
      }
    });
    return [...map.values()];
  })();

  return (
    <form ref={composerRootRef} className="lyra-agents-composer" onSubmit={handleSubmit}>
      {sendError !== null && (
        <div className="lyra-agents-composer-send-error" role="alert">
          <CircleAlert size={TOOLBAR_ICON_SIZE} strokeWidth={TOOLBAR_ICON_STROKE_WIDTH} aria-hidden="true" />
          <span>{sendError}</span>
        </div>
      )}
      <CitationComposerInput
        ref={composerInputRef}
        segments={segments}
        disabled={disabledReason !== undefined}
        placeholder={disabledReason ?? t("lyra-agents-composer.placeholder")}
        onSegmentsChange={setSegments}
        onSubmit={() => {
          void submit();
        }}
        {...(onTranscriptCitationClick === undefined ? {} : { onTranscriptCitationClick })}
        {...(onPageCitationClick === undefined ? {} : { onPageCitationClick })}
        {...(onImageAttachmentClick === undefined ? {} : { onImageAttachmentClick })}
        onImageAttachmentsAccepted={handleImageAttachmentsAccepted}
      />
      <div className="lyra-agents-composer-bottom">
        <AppMenu
          open={attachmentMenuOpen}
          onOpenChange={(nextOpen) => {
            setAttachmentMenuOpen(nextOpen);
            if (!nextOpen) {
              setAttachmentSubmenuId(null);
            }
          }}
        >
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
                className="lyra-agents-composer-attach-menu-item lyra-agents-composer-attach-menu-entry"
                onSelect={() => {
                  void pickFileAttachment();
                }}
              >
                <ComposerAttachMenuLeadingIcon>
                  <FileIcon size={TOOLBAR_ICON_SIZE} strokeWidth={TOOLBAR_ICON_STROKE_WIDTH} />
                </ComposerAttachMenuLeadingIcon>
                <span className="lyra-app-menu-item-label">{t("lyra-agents-composer.attachFile")}</span>
              </AppMenuItem>
              {workspaceTabs.length > 0 ? (
                <AppMenuSub
                  open={attachmentSubmenuId === "workspace-tabs"}
                  onOpenChange={(nextOpen) => {
                    setAttachmentSubmenuId(nextOpen ? "workspace-tabs" : null);
                  }}
                >
                  <AppMenuSubTrigger
                    className="lyra-agents-composer-attach-menu-item lyra-agents-composer-attach-submenu-trigger"
                    onFocus={() => setAttachmentSubmenuId("workspace-tabs")}
                    onMouseEnter={() => setAttachmentSubmenuId("workspace-tabs")}
                    onPointerMove={() => setAttachmentSubmenuId("workspace-tabs")}
                  >
                    <ComposerAttachMenuLeadingIcon>
                      <LayoutGrid size={TOOLBAR_ICON_SIZE} strokeWidth={TOOLBAR_ICON_STROKE_WIDTH} />
                    </ComposerAttachMenuLeadingIcon>
                    <span className="lyra-app-menu-item-label">{t("lyra-agents-composer.attachWorkspaceTab")}</span>
                  </AppMenuSubTrigger>
                  <AppMenuSubContent
                    className="lyra-agents-composer-attach-submenu"
                    sideOffset={4}
                    alignOffset={-4}
                  >
                    {workspaceTabs.map((tab) => (
                      <AppMenuItem
                        key={tab.id}
                        className="lyra-agents-composer-attach-menu-item lyra-agents-composer-attach-menu-entry"
                        onSelect={() => {
                          insertWorkspaceTabCitation(tab);
                        }}
                      >
                        <WorkspaceTabAttachMenuIcon tab={tab} />
                        <span className="lyra-app-menu-item-label">{tab.title.trim() || tab.displayAddress || tab.id}</span>
                      </AppMenuItem>
                    ))}
                  </AppMenuSubContent>
                </AppMenuSub>
              ) : null}
              {terminalTabs.length > 0 ? (
                <AppMenuSub
                  open={attachmentSubmenuId === "terminal-tabs"}
                  onOpenChange={(nextOpen) => {
                    setAttachmentSubmenuId(nextOpen ? "terminal-tabs" : null);
                  }}
                >
                  <AppMenuSubTrigger
                    className="lyra-agents-composer-attach-menu-item lyra-agents-composer-attach-submenu-trigger"
                    onFocus={() => setAttachmentSubmenuId("terminal-tabs")}
                    onMouseEnter={() => setAttachmentSubmenuId("terminal-tabs")}
                    onPointerMove={() => setAttachmentSubmenuId("terminal-tabs")}
                  >
                    <ComposerAttachMenuLeadingIcon>
                      <Terminal size={TOOLBAR_ICON_SIZE} strokeWidth={TOOLBAR_ICON_STROKE_WIDTH} />
                    </ComposerAttachMenuLeadingIcon>
                    <span className="lyra-app-menu-item-label">{t("lyra-agents-composer.attachTerminalTab")}</span>
                  </AppMenuSubTrigger>
                  <AppMenuSubContent
                    className="lyra-agents-composer-attach-submenu"
                    sideOffset={4}
                    alignOffset={-4}
                  >
                    {terminalTabs.map((tab) => (
                      <AppMenuItem
                        key={tab.id}
                        className="lyra-agents-composer-attach-menu-item lyra-agents-composer-attach-menu-entry"
                        onSelect={() => {
                          insertTerminalTabCitation(tab);
                        }}
                      >
                        <TerminalTabAttachMenuIcon />
                        <span className="lyra-app-menu-item-label">{tab.title.trim() || tab.id}</span>
                      </AppMenuItem>
                    ))}
                  </AppMenuSubContent>
                </AppMenuSub>
              ) : null}
              <AppMenuItem
                className="lyra-agents-composer-attach-menu-item lyra-agents-composer-attach-menu-entry"
                onSelect={() => {
                  void captureAttachment(onCaptureWorkspaceScreenshot);
                }}
              >
                <ComposerAttachMenuLeadingIcon>
                  <Camera size={TOOLBAR_ICON_SIZE} strokeWidth={TOOLBAR_ICON_STROKE_WIDTH} />
                </ComposerAttachMenuLeadingIcon>
                <span className="lyra-app-menu-item-label">{t("lyra-agents-composer.attachWorkspaceScreenshot")}</span>
              </AppMenuItem>
              <AppMenuItem
                className="lyra-agents-composer-attach-menu-item lyra-agents-composer-attach-menu-entry"
                onSelect={() => {
                  void captureAttachment(onCaptureWindowScreenshot);
                }}
              >
                <ComposerAttachMenuLeadingIcon>
                  <Monitor size={TOOLBAR_ICON_SIZE} strokeWidth={TOOLBAR_ICON_STROKE_WIDTH} />
                </ComposerAttachMenuLeadingIcon>
                <span className="lyra-app-menu-item-label">{t("lyra-agents-composer.attachWindowScreenshot")}</span>
              </AppMenuItem>
            </AppMenuContent>
          </div>
        </AppMenu>
        {modelControls !== null && modelControls !== undefined ? (
          <div className="lyra-agents-composer-model-controls">
            {modelPickerOptions.length > 0 ? (
              <AppModelMenu
                ariaLabel={t("lyra-agents-composer.modelControls")}
                className="lyra-agents-composer-model-picker"
                contentClassName="lyra-agents-composer-select-content"
                options={modelPickerOptions}
                groups={modelPickerGroups}
                value={selectedModel?.id ?? ""}
                onModelChange={(modelId) => {
                  void modelControls.switchModel(modelId);
                }}
                submenus={modelParameterSubmenus}
                disabled={modelControls.isSwitching}
              />
            ) : null}
            {modelPickerOptions.length === 0 ? (
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
            ) : null}
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
