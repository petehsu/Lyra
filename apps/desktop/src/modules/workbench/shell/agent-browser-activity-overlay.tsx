import type { BrowserAgentVisualState } from "./use-workbench-browser-runtime";

type AgentBrowserActivityOverlayProps = {
  readonly state: BrowserAgentVisualState;
};

export const AgentBrowserActivityOverlay = ({
  state
}: AgentBrowserActivityOverlayProps) => {
  return (
    <div
      className="lyra-agent-browser-activity-overlay"
      data-active={state.active ? "true" : "false"}
      aria-hidden="true"
    >
      {state.active ? <span className="lyra-agent-browser-page-glow" /> : null}
    </div>
  );
};
