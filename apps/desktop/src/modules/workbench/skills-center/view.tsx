import type { SkillsCenterLabels, SkillsCenterModel } from "./types";

export type SkillsCenterSurfaceProps = {
  readonly model: SkillsCenterModel;
  readonly labels: SkillsCenterLabels;
};

export const SkillsCenterSurface = ({ model, labels }: SkillsCenterSurfaceProps) => {
  void model;

  return (
    <section
      className="lyra-skills-center-surface lyra-mcp-center-surface"
      aria-label="ai-skills-surface"
    >
      <div className="lyra-mcp-center-shell lyra-mcp-center-shell-no-sidebar lyra-skills-center-shell">
        <section className="lyra-mcp-center-main lyra-skills-center-main">
          <div className="lyra-mcp-center-empty-state">
            <strong>{labels.title}</strong>
            <span>Reserved for the next Agent runtime.</span>
          </div>
        </section>
      </div>
    </section>
  );
};
