import {
  ArrowUpRight,
  GithubBrandLogo,
  QqBrandLogo,
  TelegramBrandLogo,
  XBrandLogo,
  type LyraIcon
} from "@lyra/icons";
import {
  OPERATOR_PERSONAL_EMAIL,
  PERSONAL_CONTACT_CHANNELS
} from "@/lib/contact";
import type { SiteCopy } from "@/lib/i18n";

type ContactSectionProps = {
  readonly copy: SiteCopy["contact"];
};

const contactLinks = [
  {
    icon: XBrandLogo,
    href: PERSONAL_CONTACT_CHANNELS.x.href
  },
  {
    icon: TelegramBrandLogo,
    href: PERSONAL_CONTACT_CHANNELS.telegram.href
  },
  {
    icon: QqBrandLogo,
    href: PERSONAL_CONTACT_CHANNELS.qq.href
  },
  {
    icon: GithubBrandLogo,
    href: PERSONAL_CONTACT_CHANNELS.github.href
  }
] as const satisfies ReadonlyArray<{ readonly icon: LyraIcon; readonly href: string }>;

export function ContactSection({ copy }: ContactSectionProps) {
  return (
    <section id="contact" className="contact-section drop-reveal">
      <div className="contact-inner">
        <header className="contact-intro">
          <p className="contact-kicker">{copy.kicker}</p>
          <h2>{copy.title}</h2>
          <p>{copy.body}</p>
        </header>

        <div className="contact-links">
          {copy.channels.map((channel, index) => {
            const link = contactLinks[index];
            const BrandIcon = link.icon;

            return (
              <a
                className="contact-link"
                href={link.href}
                target="_blank"
                rel="noreferrer"
                key={channel.label}
              >
                <span className="contact-link-heading">
                  <BrandIcon size={20} aria-hidden="true" />
                  <ArrowUpRight size={17} aria-hidden="true" />
                </span>
                <strong>{channel.label}</strong>
                <span>{channel.value}</span>
              </a>
            );
          })}
        </div>
        <aside className="contact-guidance" aria-label={copy.emailLabel}>
          <p className="contact-email">
            <span>{copy.emailLabel}</span>
            <a href={`mailto:${OPERATOR_PERSONAL_EMAIL}`}>
              {OPERATOR_PERSONAL_EMAIL}
            </a>
          </p>
          <p>{copy.personalNotice}</p>
        </aside>
      </div>
    </section>
  );
}
