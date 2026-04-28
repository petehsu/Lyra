import {
  ArrowRight,
  Check,
  ChevronRight,
  Crosshair,
  FilePlus2,
  FileText,
  Folder,
  Image as ImageIcon,
  Paperclip,
  Plus,
  Square,
  X
} from "lucide-react";

import { ModernCaretOverlay } from "../caret/modern-caret";
import type {
  AgentComposerModelState,
  AgentComposerSendVisualState
} from "./agent-composer-model";
import type {
  AgentComposerFileAttachment,
  AgentComposerModelControlOption,
  AgentComposerReasoningEffort,
  AgentComposerSubmitPayload,
  AgentComposerVerbosity,
  AgentPermissionMode
} from "./agent-composer-types";
import type { AgentComposerRuntime } from "./use-agent-composer-runtime";

const renderAttachmentIcon = (kind: AgentComposerFileAttachment["kind"]) => {
  if (kind === "directory") {
    return <Folder size={12} aria-hidden="true" />;
  }
  if (kind === "local_image" || kind === "image") {
    return <ImageIcon size={12} aria-hidden="true" />;
  }
  return <Paperclip size={12} aria-hidden="true" />;
};

type AgentComposerViewProps = {
  readonly composerClassName: string;
  readonly composerMenuLabel: string;
  readonly permissionModeLabel: string;
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
  readonly permissionMode?: AgentPermissionMode | undefined;
  readonly permissionModeDisabled?: boolean | undefined;
  readonly onPermissionModeSelect?: ((mode: AgentPermissionMode) => void) | undefined;
  readonly onModelSelect?: ((modelName: string) => void) | undefined;
  readonly reasoningEffortOptions: readonly AgentComposerModelControlOption<AgentComposerReasoningEffort>[];
  readonly selectedReasoningEffort: AgentComposerReasoningEffort | null;
  readonly reasoningEffortLabel: string;
  readonly modelControlAutoLabel: string;
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
  permissionModeLabel,
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
  permissionMode = "default",
  permissionModeDisabled = false,
  onPermissionModeSelect,
  onModelSelect,
  reasoningEffortOptions,
  selectedReasoningEffort,
  reasoningEffortLabel,
  modelControlAutoLabel,
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
}: AgentComposerViewProps) => (
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
      <div className="lyra-ai-agent-composer-input-stack">
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
        <div className="lyra-ai-agent-composer-text-fx-layer">
          {runtime.textEffects.map((effect) => (
            <span
              key={effect.id}
              aria-hidden="true"
              className={`lyra-ai-agent-text-fx lyra-ai-agent-text-fx-${effect.kind}`}
              style={{
                left: `${String(effect.left)}px`,
                top: `${String(effect.top)}px`
              }}
            >
              {effect.text === " " ? "\u00a0" : effect.text}
            </span>
          ))}
        </div>
        <div className="lyra-modern-caret-layer lyra-ai-agent-composer-caret-layer">
          <ModernCaretOverlay
            rect={runtime.caretRect}
            focused={runtime.inputFocused}
            blinking={runtime.isCaretIdle && !runtime.isCaretPressed}
            pressed={runtime.isCaretPressed}
            motionToken={runtime.caretMotionToken}
            motionTrail={runtime.caretMotionTrail}
            className="lyra-modern-caret-composer"
          />
        </div>
        {runtime.fileMentionMenuOpen ? (
          <div
            className="lyra-ai-agent-composer-mention-popover"
            role="listbox"
            aria-label="File mentions"
            onMouseDown={(event) => {
              event.preventDefault();
            }}
          >
            {runtime.fileMentionResults.length === 0 ? (
              <div className="lyra-ai-agent-composer-mention-empty">
                <FileText size={12} aria-hidden="true" />
                <span>{fileMentionNoMatchesLabel}</span>
              </div>
            ) : (
              runtime.fileMentionResults.slice(0, 8).map((result, index) => (
                <button
                  key={result.id}
                  type="button"
                  role="option"
                  aria-selected={index === runtime.fileMentionSelectedIndex}
                  className={
                    index === runtime.fileMentionSelectedIndex
                      ? "lyra-ai-agent-composer-mention-item lyra-ai-agent-composer-mention-item-active"
                      : "lyra-ai-agent-composer-mention-item"
                  }
                  title={result.path}
                  onClick={() => {
                    runtime.selectFileMentionResult(result);
                  }}
                >
                  {result.kind === "directory" ? (
                    <Folder size={12} aria-hidden="true" />
                  ) : (
                    <FileText size={12} aria-hidden="true" />
                  )}
                  <span>{result.name}</span>
                  <small>{result.path}</small>
                </button>
              ))
            )}
          </div>
        ) : null}
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
          {runtime.toolsMenuOpen ? (
            <div className="lyra-ai-agent-composer-menu" role="menu">
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
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={planModeEnabled}
                className={
                  planModeEnabled
                    ? "lyra-ai-agent-composer-menu-item lyra-ai-agent-composer-menu-item-active"
                    : "lyra-ai-agent-composer-menu-item"
                }
                disabled={onPlanModeToggle === undefined || planModeLocked}
                onClick={() => {
                  onPlanModeToggle?.();
                }}
              >
                <span>{modelState.resolvedPlanModeLabel}</span>
                {planModeEnabled ? <Check size={13} aria-hidden="true" /> : null}
              </button>
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={runtime.modelSubmenuOpen}
                className="lyra-ai-agent-composer-menu-item lyra-ai-agent-composer-menu-item-nested"
                disabled={!modelState.canOpenModelMenu}
                onClick={runtime.toggleModelSubmenu}
              >
                <span>{modelState.resolvedModelAriaLabel}</span>
                <small>{modelState.selectedModelLabel}</small>
                <ChevronRight size={13} aria-hidden="true" />
              </button>
              {runtime.modelSubmenuOpen && modelState.canOpenModelMenu ? (
                <div
                  className="lyra-ai-agent-composer-submenu"
                  role="menu"
                  style={modelState.modelMenuStyle}
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
                  <div className="lyra-ai-agent-composer-submenu-section" aria-hidden="true">
                    {reasoningEffortLabel}
                  </div>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={selectedReasoningEffort === null}
                    className={
                      selectedReasoningEffort === null
                        ? "lyra-ai-agent-composer-submenu-item lyra-ai-agent-composer-submenu-item-active"
                        : "lyra-ai-agent-composer-submenu-item"
                    }
                    disabled={onReasoningEffortSelect === undefined || modelSwitchDisabled}
                    onClick={() => {
                      onReasoningEffortSelect?.(null);
                    }}
                  >
                    <span>{modelControlAutoLabel}</span>
                    {selectedReasoningEffort === null ? <Check size={13} aria-hidden="true" /> : null}
                  </button>
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
                  <div className="lyra-ai-agent-composer-submenu-section" aria-hidden="true">
                    {verbosityLabel}
                  </div>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={selectedVerbosity === null}
                    className={
                      selectedVerbosity === null
                        ? "lyra-ai-agent-composer-submenu-item lyra-ai-agent-composer-submenu-item-active"
                        : "lyra-ai-agent-composer-submenu-item"
                    }
                    disabled={onVerbositySelect === undefined || modelSwitchDisabled}
                    onClick={() => {
                      onVerbositySelect?.(null);
                    }}
                  >
                    <span>{modelControlAutoLabel}</span>
                    {selectedVerbosity === null ? <Check size={13} aria-hidden="true" /> : null}
                  </button>
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
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="lyra-ai-agent-permission-modes" aria-label={permissionModeLabel}>
          {modelState.permissionModeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={
                permissionMode === option.value
                  ? "lyra-ai-agent-permission-mode lyra-ai-agent-permission-mode-active"
                  : "lyra-ai-agent-permission-mode"
              }
              disabled={permissionModeDisabled || onPermissionModeSelect === undefined}
              onClick={() => {
                onPermissionModeSelect?.(option.value as AgentPermissionMode);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
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
          disabled={onFollowToggle === undefined}
          onClick={() => {
            onFollowToggle?.();
          }}
        >
          <Crosshair size={14} aria-hidden="true" />
        </button>
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
  </div>
);
