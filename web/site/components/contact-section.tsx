import {
  faGithub,
  faQq,
  faTelegram,
  faXTwitter
} from "@fortawesome/free-brands-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { ArrowUpRight } from "lucide-react";
import type { SiteCopy } from "@/lib/i18n";

type ContactSectionProps = {
  readonly copy: SiteCopy["contact"];
};

const contactLinks = [
  {
    icon: faXTwitter,
    href: "https://x.com/Qxuzhong"
  },
  {
    icon: faTelegram,
    href: "https://t.me/PeteHsu"
  },
  {
    icon: faQq,
    href: "https://qm.qq.com/q/zPnGMZAgAo"
  },
  {
    icon: faGithub,
    href: "https://github.com/petehsu"
  }
] as const;

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

            return (
              <a
                className="contact-link"
                href={link.href}
                target="_blank"
                rel="noreferrer"
                key={channel.label}
              >
                <span className="contact-link-heading">
                  <FontAwesomeIcon icon={link.icon} aria-hidden="true" />
                  <ArrowUpRight size={17} aria-hidden="true" />
                </span>
                <strong>{channel.label}</strong>
                <span>{channel.value}</span>
              </a>
            );
          })}
        </div>
      </div>
    </section>
  );
}
