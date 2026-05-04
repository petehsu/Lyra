import {
  ArrowRight,
  Bot,
  Check,
  ChevronRight,
  ClipboardList,
  Crosshair,
  FilePlus2,
  FileText,
  Folder,
  Globe,
  House,
  Image as ImageIcon,
  MessagesSquare,
  Paperclip,
  PanelTop,
  Plus,
  Search,
  Settings2,
  Square,
  SquareTerminal,
  X
} from "lucide-react";
import { createPortal } from "react-dom";

import { renderFileManagerEntryIconByKind } from "../file-manager/icon-registry";
import { resolveFileManagerEntryIconKind } from "../file-manager/entry-icon-classifier";
import {
  renderWorkspaceAppIcon,
  type WorkbenchAppId,
  type WorkspaceAppIconKey
} from "../workspace-apps";
import type {
  AgentComposerModelState,
  AgentComposerSendVisualState
} from "./agent-composer-model";
import type {
  AgentComposerFileAttachment,
  AgentComposerModelControlOption,
  AgentComposerReasoningEffort,
  AgentComposerSubmitPayload,
  AgentComposerVerbosity
} from "./agent-composer-types";
import type {
  AgentComposerMentionPanelResult,
  AgentComposerRuntime
} from "./use-agent-composer-runtime";

const renderAttachmentIcon = (kind: AgentComposerFileAttachment["kind"]) => {
  if (kind === "directory") {
    return <Folder size={12} aria-hidden="true" />;
  }
  if (kind === "local_image" || kind === "image") {
    return <ImageIcon size={12} aria-hidden="true" />;
  }
  if (kind === "workbench_tab") {
    return <PanelTop size={12} aria-hidden="true" />;
  }
  if (kind === "ai_thread") {
    return <MessagesSquare size={12} aria-hidden="true" />;
  }
  return <Paperclip size={12} aria-hidden="true" />;
};

const mentionPanelSectionLabel = (section: string): string => {
  if (section === "tabs") {
    return "Tabs";
  }
  if (section === "recommended_files") {
    return "Recommended files";
  }
  if (section === "root") {
    return "Root";
  }
  return "Search results";
};

const extensionFromPath = (path: string): string | undefined => {
  const fileName = path.replace(/\\/gu, "/").split("/").filter(Boolean).pop() ?? path;
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex <= 0 || dotIndex === fileName.length - 1
    ? undefined
    : fileName.slice(dotIndex + 1);
};

const renderFileMentionIcon = (result: AgentComposerMentionPanelResult) => {
  const extension = extensionFromPath(result.path);
  const iconKind = resolveFileManagerEntryIconKind(
    result.kind === "directory"
      ? {
          id: result.id,
          name: result.name,
          path: result.path,
          kind: "directory" as const,
          isHidden: result.name.startsWith("."),
          folderState: "unknown" as const,
          ...(extension === undefined ? {} : { extension }),
        }
      : {
          id: result.id,
          name: result.name,
          path: result.path,
          kind: "file" as const,
          isHidden: result.name.startsWith("."),
          ...(extension === undefined ? {} : { extension }),
        }
  );
  return renderFileManagerEntryIconByKind(iconKind, {
    className: "lyra-ai-agent-composer-mention-file-icon",
    size: 13,
  });
};

const renderTabMentionIcon = (result: AgentComposerMentionPanelResult) => {
  if (result.faviconUrl !== undefined && result.faviconUrl.length > 0) {
    return (
      <img
        src={result.faviconUrl}
        alt=""
        className="lyra-ai-agent-composer-mention-favicon"
        loading="eager"
        decoding="async"
      />
    );
  }
  if (result.appId !== undefined && result.appIconKey !== undefined) {
    return renderWorkspaceAppIcon(
      result.appId as WorkbenchAppId,
      result.appIconKey as WorkspaceAppIconKey
    );
  }
  if (result.tabKind === "settings") {
    return <Settings2 size={13} aria-hidden="true" />;
  }
  if (result.tabKind === "results") {
    return <Search size={13} aria-hidden="true" />;
  }
  if (result.tabKind === "search") {
    return <House size={13} aria-hidden="true" />;
  }
  if (result.tabKind === "terminal") {
    return <SquareTerminal size={13} aria-hidden="true" />;
  }
  return <Globe size={13} aria-hidden="true" />;
};

const renderMentionIcon = (result: AgentComposerMentionPanelResult) => {
  if (result.kind === "file" || result.kind === "directory") {
    return renderFileMentionIcon(result);
  }
  if (result.kind === "workbench_tab") {
    return renderTabMentionIcon(result);
  }
  return <MessagesSquare size={13} aria-hidden="true" />;
};

type AgentComposerViewProps = {
  readonly composerClassName: string;
  readonly composerMenuLabel: string;
  readonly sendVisualState: AgentComposerSendVisualState;
  readonly modelState: AgentComposerModelState;
  readonly runtime: AgentComposerRuntime;
  readonly ariaLabel: string;
  readonly placeholder: string;
  readonly sendLabel: string;
  readonly followLabel: string;
  readonly followEnabled: boolean;
  readonly addFileLabel: string;
  readonly removeAttachmentLabel: string;
  readonly fileMentionNoMatchesLabel: string;
  readonly inputDisabled: boolean;
  readonly sendDisabled: boolean;
  readonly sending: boolean;
  readonly modelSwitchDisabled: boolean;
  readonly planModeEnabled?: boolean | undefined;
  readonly planModeLocked?: boolean | undefined;
  readonly onPlanModeToggle?: (() => void) | undefined;
  readonly onModelSelect?: ((modelName: string) => void) | undefined;
  readonly reasoningEffortOptions: readonly AgentComposerModelControlOption<AgentComposerReasoningEffort>[];
  readonly selectedReasoningEffort: AgentComposerReasoningEffort | null;
  readonly reasoningEffortLabel: string;
  readonly onReasoningEffortSelect?: ((value: AgentComposerReasoningEffort | null) => void) | undefined;
  readonly verbosityOptions: readonly AgentComposerModelControlOption<AgentComposerVerbosity>[];
  readonly selectedVerbosity: AgentComposerVerbosity | null;
  readonly verbosityLabel: string;
  readonly onVerbositySelect?: ((value: AgentComposerVerbosity | null) => void) | undefined;
  readonly onFollowToggle?: (() => void) | undefined;
  readonly onRequestFileAttachments?: (() => Promise<readonly AgentComposerFileAttachment[]>) | undefined;
  readonly onSteer?: ((value: AgentComposerSubmitPayload) => void | Promise<void>) | undefined;
  readonly steerDisabled?: boolean | undefined;
  readonly onStop?: (() => void) | undefined;
  readonly stopDisabled?: boolean | undefined;
};

export const AgentComposerView = ({
  composerClassName,
  composerMenuLabel,
  sendVisualState,
  modelState,
  runtime,
  ariaLabel,
  placeholder,
  sendLabel,
  followLabel,
  followEnabled,
  addFileLabel,
  removeAttachmentLabel,
  fileMentionNoMatchesLabel,
  inputDisabled,
  sendDisabled,
  sending,
  modelSwitchDisabled,
  planModeEnabled = false,
  planModeLocked = false,
  onPlanModeToggle,
  onModelSelect,
  reasoningEffortOptions,
  selectedReasoningEffort,
  reasoningEffortLabel,
  onReasoningEffortSelect,
  verbosityOptions,
  selectedVerbosity,
  verbosityLabel,
  onVerbositySelect,
  onFollowToggle,
  onRequestFileAttachments,
  onSteer,
  steerDisabled = false,
  onStop,
  stopDisabled = false
}: AgentComposerViewProps) => {
  const menuLayer = runtime.toolsMenuOpen
    ? createPortal(
        <div
          ref={runtime.toolsMenuPortalRef}
          className="lyra-ai-agent-composer-menu-layer"
        >
          <div
            className="lyra-ai-agent-composer-menu"
            role="menu"
            style={runtime.toolsMenuStyle}
          >
            <button
              type="button"
              role="menuitem"
              className="lyra-ai-agent-composer-menu-item"
              disabled={inputDisabled || onRequestFileAttachments === undefined}
              onClick={() => {
                void runtime.requestFileAttachments(onRequestFileAttachments);
              }}
            >
              <FilePlus2 size={13} aria-hidden="true" />
              <span>{addFileLabel}</span>
            </button>
            {onPlanModeToggle === undefined ? null : (
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={planModeEnabled}
                className={
                  planModeEnabled
                    ? "lyra-ai-agent-composer-menu-item lyra-ai-agent-composer-menu-item-active"
                    : "lyra-ai-agent-composer-menu-item"
                }
                disabled={planModeLocked}
                onClick={() => {
                  onPlanModeToggle();
                }}
              >
                <ClipboardList size={13} aria-hidden="true" />
                <span>{modelState.resolvedPlanModeLabel}</span>
                {planModeEnabled ? <Check size={13} aria-hidden="true" /> : null}
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={runtime.modelSubmenuOpen}
              className="lyra-ai-agent-composer-menu-item lyra-ai-agent-composer-menu-item-nested"
              disabled={!modelState.canOpenModelMenu}
              onClick={runtime.toggleModelSubmenu}
            >
              <Bot size={13} aria-hidden="true" />
              <span>{modelState.resolvedModelAriaLabel}</span>
              <small>{modelState.selectedModelLabel}</small>
              <ChevronRight size={13} aria-hidden="true" />
            </button>
          </div>
          {runtime.modelSubmenuOpen && modelState.canOpenModelMenu ? (
            <div
              className="lyra-ai-agent-composer-submenu"
              role="menu"
              style={{
                ...modelState.modelMenuStyle,
                ...runtime.submenuStyle,
              }}
            >
              {modelState.resolvedModelOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={option.value === modelState.resolvedSelectedModelName}
                  className={
                    option.value === modelState.resolvedSelectedModelName
                      ? "lyra-ai-agent-composer-submenu-item lyra-ai-agent-composer-submenu-item-active"
                      : "lyra-ai-agent-composer-submenu-item"
                  }
                  onClick={() => {
                    runtime.selectModel(option.value, onModelSelect);
                  }}
                >
                  <span>{option.label}</span>
                  {option.value === modelState.resolvedSelectedModelName ? <Check size={13} aria-hidden="true" /> : null}
                </button>
              ))}
              {reasoningEffortOptions.length > 0 ? (
                <>
                  <div className="lyra-ai-agent-composer-submenu-section" aria-hidden="true">
                    {reasoningEffortLabel}
                  </div>
                  {reasoningEffortOptions.map((option) => (
                    <button
                      key={`reasoning-${option.value}`}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selectedReasoningEffort === option.value}
                      className={
                        selectedReasoningEffort === option.value
                          ? "lyra-ai-agent-composer-submenu-item lyra-ai-agent-composer-submenu-item-active"
                          : "lyra-ai-agent-composer-submenu-item"
                      }
                      disabled={option.disabled === true || onReasoningEffortSelect === undefined || modelSwitchDisabled}
                      title={option.disabledReason}
                      onClick={() => {
                        onReasoningEffortSelect?.(option.value);
                      }}
                    >
                      <span>{option.label}</span>
                      {selectedReasoningEffort === option.value ? <Check size={13} aria-hidden="true" /> : null}
                    </button>
                  ))}
                </>
              ) : null}
              {verbosityOptions.length > 0 ? (
                <>
                  <div className="lyra-ai-agent-composer-submenu-section" aria-hidden="true">
                    {verbosityLabel}
                  </div>
                  {verbosityOptions.map((option) => (
                    <button
                      key={`verbosity-${option.value}`}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selectedVerbosity === option.value}
                      className={
                        selectedVerbosity === option.value
                          ? "lyra-ai-agent-composer-submenu-item lyra-ai-agent-composer-submenu-item-active"
                          : "lyra-ai-agent-composer-submenu-item"
                      }
                      disabled={option.disabled === true || onVerbositySelect === undefined || modelSwitchDisabled}
                      title={option.disabledReason}
                      onClick={() => {
                        onVerbositySelect?.(option.value);
                      }}
                    >
                      <span>{option.label}</span>
                      {selectedVerbosity === option.value ? <Check size={13} aria-hidden="true" /> : null}
                    </button>
                  ))}
                </>
              ) : null}
            </div>
          ) : null}
        </div>,
        document.body
      )
    : null;
  const mentionPanelHost = runtime.inputRef.current?.ownerDocument.body ?? null;
  const mentionPanelLayer = runtime.mentionPanelOpen && mentionPanelHost !== null
    ? createPortal(
        <div
          className="lyra-ai-agent-composer-mention-popover"
          role="listbox"
          aria-label="Mentions"
          style={runtime.mentionPanelStyle}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
        >
          {runtime.mentionPanelResults.length === 0 ? (
            <div className="lyra-ai-agent-composer-mention-empty">
              <FileText size={12} aria-hidden="true" />
              <span>{fileMentionNoMatchesLabel}</span>
            </div>
          ) : (
            <div className="lyra-ai-agent-composer-mention-list">
              {runtime.mentionPanelResults.map((result, index, results) => {
                const previous = results[index - 1];
                const showSection = previous === undefined || previous.section !== result.section;
                return (
                  <div key={result.id} className="lyra-ai-agent-composer-mention-row">
                    {showSection ? (
                      <div className="lyra-ai-agent-composer-mention-section" aria-hidden="true">
                        {mentionPanelSectionLabel(result.section)}
                      </div>
                    ) : null}
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === runtime.mentionPanelSelectedIndex}
                      className={
                        index === runtime.mentionPanelSelectedIndex
                          ? "lyra-ai-agent-composer-mention-item lyra-ai-agent-composer-mention-item-active"
                          : "lyra-ai-agent-composer-mention-item"
                      }
                      title={result.path}
                      onClick={() => {
                        runtime.selectMentionPanelResult(result);
                      }}
                    >
                      {renderMentionIcon(result)}
                      <span>{result.name}</span>
                      <small>{result.description ?? result.path}</small>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>,
        mentionPanelHost
      )
    : null;

  const hasInlineAttachments = runtime.attachments.length > 0;

  return (
  <div
    ref={runtime.containerRef}
    className={composerClassName}
  >
    <div
      className={
        runtime.attachmentDragActive
          ? "lyra-ai-agent-composer-input-shell lyra-ai-agent-composer-input-shell-drag-active"
          : "lyra-ai-agent-composer-input-shell"
      }
      onDragEnter={runtime.onInputShellDragEnter}
      onDragOver={runtime.onInputShellDragOver}
      onDragLeave={runtime.onInputShellDragLeave}
      onDrop={runtime.onInputShellDrop}
    >
      <div
        className={
          hasInlineAttachments
            ? "lyra-ai-agent-composer-input-stack lyra-ai-agent-composer-input-stack-has-attachments"
            : "lyra-ai-agent-composer-input-stack"
        }
      >
        {hasInlineAttachments ? (
          <div
            className="lyra-ai-agent-composer-input-renderer"
            style={{
              transform: `translateY(-${String(runtime.inputScrollTop)}px)`
            }}
          >
            {runtime.draftParts.map((part, index) => (
              part.type === "text" ? (
                <span key={`text-${String(index)}`} aria-hidden="true">{part.text}</span>
              ) : (
                <span
                  key={`attachment-${part.attachment.id}-${String(index)}`}
                  className="lyra-ai-agent-composer-attachment-chip lyra-ai-agent-composer-attachment-chip-inline"
                  title={part.attachment.path}
                >
                  {renderAttachmentIcon(part.attachment.kind)}
                  <span>{part.attachment.name}</span>
                  <button
                    type="button"
                    className="lyra-ai-agent-composer-attachment-remove"
                    aria-label={`${removeAttachmentLabel} ${part.attachment.name}`}
                    title={`${removeAttachmentLabel} ${part.attachment.name}`}
                    onClick={() => {
                      runtime.removeAttachment(part.attachment.id);
                    }}
                  >
                    <X size={11} aria-hidden="true" />
                  </button>
                </span>
              )
            ))}
          </div>
        ) : null}
        <textarea
          ref={runtime.inputRef}
          className="lyra-ai-agent-composer-input"
          value={runtime.draftValue}
          aria-label={ariaLabel}
          disabled={inputDisabled}
          placeholder={placeholder}
          onCompositionStart={runtime.onTextareaCompositionStart}
          onCompositionEnd={runtime.onTextareaCompositionEnd}
          onFocus={runtime.onTextareaFocus}
          onBlur={runtime.onTextareaBlur}
          onScroll={runtime.onTextareaScroll}
          onInput={runtime.onTextareaInput}
          onPaste={runtime.onTextareaPaste}
          onChange={(event) => {
            runtime.setDraftValue(event.target.value);
          }}
          onKeyDown={runtime.onTextareaKeyDown}
          onKeyUp={runtime.onTextareaKeyUp}
        />
      </div>
    </div>
    <div className="lyra-ai-agent-composer-toolbar">
      <div className="lyra-ai-agent-composer-toolbar-leading">
        <div className="lyra-ai-agent-composer-tools" ref={runtime.toolsMenuRef}>
          <button
            type="button"
            className="lyra-ai-agent-composer-tools-trigger"
            aria-label={composerMenuLabel}
            title={composerMenuLabel}
            aria-haspopup="menu"
            aria-expanded={runtime.toolsMenuOpen}
            onClick={runtime.toggleToolsMenu}
          >
            <Plus size={15} aria-hidden="true" />
          </button>
        </div>
        {menuLayer}
      </div>
      <div className="lyra-ai-agent-composer-toolbar-trailing">
        {sending && runtime.hasContent && onSteer !== undefined ? (
          <button
            type="button"
            className="lyra-ai-agent-steer"
            disabled={steerDisabled}
            onClick={() => {
              if (!steerDisabled) {
                void runtime.submit("steer");
              }
            }}
          >
            {modelState.resolvedSteerLabel}
          </button>
        ) : null}
        {onFollowToggle === undefined ? null : (
          <button
            type="button"
            className={
              followEnabled
                ? "lyra-ai-agent-follow-toggle lyra-ai-agent-follow-toggle-active"
                : "lyra-ai-agent-follow-toggle"
            }
            aria-pressed={followEnabled}
            aria-label={followLabel}
            title={followLabel}
            onClick={() => {
              onFollowToggle();
            }}
          >
            <Crosshair size={14} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className={`lyra-ai-agent-send lyra-ai-agent-send-${sendVisualState}`}
          disabled={sending ? stopDisabled : (sendDisabled || !runtime.hasContent)}
          aria-label={sendLabel}
          title={sendLabel}
          onClick={() => {
            if (sending) {
              if (!stopDisabled) {
                onStop?.();
              }
              return;
            }
            if (sendDisabled || !runtime.hasContent) {
              return;
            }
            void runtime.submit("send");
          }}
        >
          {sending ? (
            <Square className="lyra-ai-agent-send-icon" size={12} />
          ) : (
            <ArrowRight className="lyra-ai-agent-send-icon" size={14} />
          )}
        </button>
      </div>
    </div>
    {mentionPanelLayer}
  </div>
);
};
