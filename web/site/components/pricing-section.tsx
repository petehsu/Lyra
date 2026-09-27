import type { SiteCopy } from "@/lib/i18n";

type PricingSectionProps = {
  readonly copy: SiteCopy["pricing"];
};

export function PricingSection({ copy }: PricingSectionProps) {
  return (
    <section id="pricing" className="pricing-section">
      <div className="pricing-inner">
        <div className="pricing-intro">
          <h2>{copy.title}</h2>
          <p>{copy.body}</p>
        </div>
        <div className="pricing-grid">
          {copy.plans.map((plan) => (
            <article className="pricing-plan" data-available={plan.available} key={plan.name}>
              <header><h3>{plan.name}</h3><span>{plan.status}</span></header>
              <p className="pricing-price">{plan.price}</p>
              <p className="pricing-description">{plan.description}</p>
              {plan.points.length > 0 ? (
                <ul>{plan.points.map((point) => <li key={point}>{point}</li>)}</ul>
              ) : null}
            </article>
          ))}
        </div>
        <p className="pricing-note">{copy.note}</p>
      </div>
    </section>
  );
}
