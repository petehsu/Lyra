import { Check } from "lucide-react";
import type { SiteCopy } from "@/lib/i18n";

type LocalSectionProps = {
  readonly copy: SiteCopy["local"];
  readonly sectionId?: string;
};

export function LocalSection({ copy, sectionId }: LocalSectionProps) {
  return (
    <section id={sectionId} className="local-section">
      <div className="local-copy drop-reveal">
        <h2>{copy.title}</h2>
        <p>{copy.body}</p>
      </div>
      <ul className="local-points drop-reveal">
        {copy.points.map((point) => (
          <li key={point}>
            <Check size={15} aria-hidden="true" />
            <span>{point}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
