import { ArrowRight, Check, ChevronRight, Plus, Square } from "lucide-react";

import { ModernCaretOverlay } from "../caret/modern-caret";
import type {
  AgentComposerModelState,
  AgentComposerSendVisualState
} from "./agent-composer-model";
import type { AgentPermissionMode } from "./agent-composer-types";
import type { AgentComposerRuntime } from "./use-agent-composer-runtime";

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
  readonly inputDisabled: boolean;
  readonly sendDisabled: boolean;
  readonly sending: boolean;
  readonly planModeEnabled?: boolean | undefined;
  readonly planModeLocked?: boolean | undefined;
  readonly onPlanModeToggle?: (() => void) | undefined;
  readonly permissionMode?: AgentPermissionMode | undefined;
  readonly permissionModeDisabled?: boolean | undefined;
  readonly onPermissionModeSelect?: ((mode: AgentPermissionMode) => void) | undefined;
  readonly onModelSelect?: ((modelName: string) => void) | undefined;
  readonly onSteer?: ((value: string) => void | Promise<void>) | undefined;
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
  inputDisabled,
  sendDisabled,
  sending,
  planModeEnabled = false,
  planModeLocked = false,
  onPlanModeToggle,
  permissionMode = "default",
  permissionModeDisabled = false,
  onPermissionModeSelect,
  onModelSelect,
  onSteer,
  steerDisabled = false,
  onStop,
  stopDisabled = false
}: AgentComposerViewProps) => (
  <div
    ref={runtime.containerRef}
    className={composerClassName}
  >
    <div className="lyra-ai-agent-composer-input-shell">
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
