import type { CSSProperties } from "react";

import { AnimatedMagicBorder } from "./animated-magic-border";
import type { BrowserAgentVisualState } from "./use-workbench-browser-runtime";

const BIBATA_CURSOR_SHAPE_URL = new URL(
  "../../../renderer/assets/cursors/bibata/svg/modern/left_ptr.svg",
  import.meta.url
).toString();

type AgentBrowserActivityOverlayProps = {
  readonly state: BrowserAgentVisualState;
};

export const browserAgentVisualStateLabel = (
  state: Pick<BrowserAgentVisualState, "action" | "interaction">
): string => {
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

export const AgentBrowserActivityOverlay = ({
  state
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
      data-target-mode={state.targetMode ?? "none"}
      data-action={state.action ?? "idle"}
      data-interaction={state.interaction ?? "none"}
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
