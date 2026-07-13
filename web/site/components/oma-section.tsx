import type { SiteCopy } from "@/lib/i18n";

type OmaSectionProps = {
  readonly copy: SiteCopy["oma"];
  readonly sectionId?: string;
};

export function OmaSection({ copy, sectionId }: OmaSectionProps) {
  return (
    <section id={sectionId} className="oma-section">
      <div className="oma-portal">
        <div className="oma-portal-stage">
          <p className="oma-phrase" aria-label="Oh My Agents">
            <span className="oma-token" aria-hidden="true">
              <span>O</span>
              <span className="oma-tail oma-tail-short">h</span>
            </span>
            <span className="oma-token" aria-hidden="true">
              <span>M</span>
              <span className="oma-tail oma-tail-short">y</span>
            </span>
            <span className="oma-token" aria-hidden="true">
              <span>A</span>
              <span className="oma-tail oma-tail-long">gents</span>
            </span>
          </p>
        </div>
      </div>

      <div className="oma-content">
        <div className="oma-intro drop-reveal">
          <p className="oma-label">{copy.label}</p>
          <h2>{copy.title}</h2>
          <p>{copy.body}</p>
        </div>

        <div className="oma-organization drop-reveal" aria-label={copy.label}>
          <div className="oma-lead">
            <strong>{copy.agents[0].name}</strong>
            <span>{copy.agents[0].role}</span>
          </div>
          <div className="oma-specialists">
            {copy.agents.slice(1).map((agent) => (
              <div key={agent.name}>
                <strong>{agent.name}</strong>
                <span>{agent.role}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="oma-details">
          {copy.items.map((item) => (
            <article className="oma-detail drop-reveal" key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
