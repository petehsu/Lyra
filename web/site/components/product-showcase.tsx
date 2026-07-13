import type { SiteCopy } from "@/lib/i18n";

type ProductShowcaseProps = {
  readonly copy: SiteCopy["product"];
  readonly sectionId?: string;
};

export function ProductShowcase({ copy, sectionId }: ProductShowcaseProps) {
  return (
    <section id={sectionId} className="product-section">
      <div className="product-intro drop-reveal">
        <h2>{copy.title}</h2>
        <p>{copy.body}</p>
      </div>

      <div className="product-details">
        {copy.items.map((item) => (
          <article className="product-detail drop-reveal" key={item.title}>
            <div className="detail-copy">
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
