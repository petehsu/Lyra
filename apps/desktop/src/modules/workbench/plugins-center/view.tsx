import type { PluginsCenterLabels, PluginsCenterModel } from "./types";

export type PluginsCenterSurfaceProps = {
  readonly model: PluginsCenterModel;
  readonly labels: PluginsCenterLabels;
};

export const PluginsCenterSurface = ({ model, labels }: PluginsCenterSurfaceProps) => {
  void model;

  return (
    <section
      className="lyra-plugins-center-surface lyra-mcp-center-surface"
      aria-label="ai-plugins-surface"
    >
      <div className="lyra-mcp-center-shell lyra-mcp-center-shell-no-sidebar lyra-plugins-center-shell">
        <section className="lyra-mcp-center-main lyra-plugins-center-main">
          <div className="lyra-mcp-center-empty-state">
            <strong>{labels.title}</strong>
            <span>Reserved for the next Agent runtime.</span>
          </div>
        </section>
      </div>
    </section>
  );
};
