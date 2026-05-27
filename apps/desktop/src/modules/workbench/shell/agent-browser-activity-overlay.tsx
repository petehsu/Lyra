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

  return (
    <div
      className="lyra-agent-browser-activity-overlay"
      data-active={state.active ? "true" : "false"}
      data-input-active={state.inputActive ? "true" : "false"}
      data-target-mode={state.targetMode ?? "none"}
      data-action={state.action ?? "idle"}
      aria-hidden="true"
    >
      <AnimatedMagicBorder
        isOpen={state.active}
        className="lyra-agent-browser-workspace-border"
      />
      <span className="lyra-agent-browser-path-line" />
      {state.inputActive && state.cursor !== null ? (
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
