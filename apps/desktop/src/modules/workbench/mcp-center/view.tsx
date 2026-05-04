import type { McpCenterLabels, McpCenterModel } from "./types";

export type McpCenterSurfaceProps = {
  readonly model: McpCenterModel;
  readonly labels: McpCenterLabels;
};

export const McpCenterSurface = ({ model, labels }: McpCenterSurfaceProps) => {
  void model;

  return (
    <section className="lyra-mcp-center-surface" aria-label="ai-mcp-surface">
      <div className="lyra-mcp-center-shell lyra-mcp-center-shell-no-sidebar">
        <section className="lyra-mcp-center-main">
          <div className="lyra-mcp-center-empty-state">
            <strong>{labels.title}</strong>
            <span>Reserved for the next Agent runtime.</span>
          </div>
        </section>
      </div>
    </section>
  );
};
