import type { CSSProperties } from "react";

import type { WorkbenchBrowserPageRuntimeState } from "../../../shared/desktop-bridge";
import { AnimatedMagicBorder } from "./animated-magic-border";
import type { BrowserAgentVisualState } from "./use-workbench-browser-runtime";

const BIBATA_CURSOR_SHAPE_URL = new URL(
  "../../../renderer/assets/cursors/bibata/svg/modern/left_ptr.svg",
  import.meta.url
).toString();

type AgentBrowserActivityOverlayProps = {
  readonly state: BrowserAgentVisualState;
  readonly recoveryFailure?: WorkbenchBrowserPageRuntimeState["recoveryFailure"];
};

export const browserAgentVisualStateLabel = (
  state: Pick<BrowserAgentVisualState, "action" | "interaction"> &
    Partial<Pick<BrowserAgentVisualState, "sharedControlState">>
): string => {
  if (state.sharedControlState === "awaiting_user_decision") return "Paused";
  if (state.sharedControlState === "user_interrupted") return "Interrupted";
  if (state.sharedControlState === "locked_input") return "Agent input";
  if (state.sharedControlState === "resuming") return "Resuming";
  if (state.action === "act") {
    if (state.interaction === "hover") return "Hover";
    if (state.interaction === "doubleClick") return "Double click";
    if (state.interaction === "rightClick") return "Right click";
    return "Click";
  }
  if (state.action === "type") return "Typing";
  if (state.action === "focus") return "Focus";
  if (state.action === "wait") return "Wait";
  if (state.action === "press") return "Key";
  if (state.action === "navigate") return "Navigate";
  if (state.action === "capture") return "Capture";
  if (state.action === "read") return "Read";
  if (state.action === "observe") return "Observe";
  return "Agent";
};

export const browserRecoveryFailureLabel = (
  failure: NonNullable<WorkbenchBrowserPageRuntimeState["recoveryFailure"]>
): string => {
  if (failure.reason === "profile_missing") return "Profile unavailable";
  if (failure.reason === "storage_unavailable") return "Storage unavailable";
  if (failure.reason === "target_stale") return "Target changed";
  return "Restore issue";
};

export const AgentBrowserActivityOverlay = ({
  state,
  recoveryFailure
}: AgentBrowserActivityOverlayProps) => {
  const cursorStyle = state.cursor === null
    ? undefined
    : ({
        "--lyra-agent-browser-cursor-x": `${Math.round(state.cursor.x)}px`,
        "--lyra-agent-browser-cursor-y": `${Math.round(state.cursor.y)}px`,
        "--lyra-agent-browser-cursor-url": `url("${BIBATA_CURSOR_SHAPE_URL}")`
      } as CSSProperties);
  const stateLabel = browserAgentVisualStateLabel(state);

  return (
    <div
      className="lyra-agent-browser-activity-overlay"
      data-active={state.active ? "true" : "false"}
      data-input-active={state.inputActive ? "true" : "false"}
      data-cursor-visible={state.cursorVisible ? "true" : "false"}
      data-cursor-phase={state.cursorPhase}
      data-control-state={state.sharedControlState}
      data-target-mode={state.targetMode ?? "none"}
      data-action={state.action ?? "idle"}
      data-interaction={state.interaction ?? "none"}
      data-recovery-failure={recoveryFailure === undefined ? "false" : "true"}
      aria-hidden="true"
    >
      <AnimatedMagicBorder
        isOpen={state.active}
        className="lyra-agent-browser-workspace-border"
      />
      <span className="lyra-agent-browser-path-line" />
      {state.active ? (
        <span className="lyra-agent-browser-state-cue">
          <span className="lyra-agent-browser-state-dot" />
          <span className="lyra-agent-browser-state-label">{stateLabel}</span>
        </span>
      ) : null}
      {recoveryFailure === undefined ? null : (
        <span className="lyra-agent-browser-recovery-cue">
          <span className="lyra-agent-browser-recovery-dot" />
          <span className="lyra-agent-browser-recovery-label">
            {browserRecoveryFailureLabel(recoveryFailure)}
          </span>
        </span>
      )}
      {state.cursorVisible && state.cursor !== null ? (
        <span
          className="lyra-agent-browser-cursor"
          style={cursorStyle}
        >
          <span className="lyra-agent-browser-cursor-aura" />
          <span className="lyra-agent-browser-cursor-shape" />
        </span>
      ) : null}
    </div>
  );
};
