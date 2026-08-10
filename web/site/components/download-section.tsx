import {
  faApple,
  faLinux,
  faWindows
} from "@fortawesome/free-brands-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Clock3, Command, Cpu, Download, Smartphone } from "lucide-react";
import type { SiteCopy } from "@/lib/i18n";

type DownloadSectionProps = {
  readonly copy: SiteCopy["download"];
};

const desktopPlatforms = [
  {
    icon: faApple
  },
  {
    icon: faApple
  },
  {
    icon: faWindows
  },
  {
    icon: faLinux
  }
] as const;

const upcomingPlatforms = [Cpu, Smartphone, Command] as const;

export function DownloadSection({ copy }: DownloadSectionProps) {
  return (
    <section id="download" className="download-section drop-reveal">
      <div className="download-inner">
        <header className="download-intro">
          <p className="download-kicker">{copy.kicker}</p>
          <h2>{copy.title}</h2>
          <p>{copy.body}</p>
        </header>

        <div className="download-platforms">
          {copy.platforms.map((platform, index) => {
            const meta = desktopPlatforms[index];

            return (
              <article className="download-platform" key={platform.name}>
                <header>
                  <span>0{index + 1}</span>
                  <FontAwesomeIcon icon={meta.icon} aria-hidden="true" />
                </header>
                <h3>{platform.name}</h3>
                <p>{platform.detail}</p>
                {platform.available ? (
                  <a
                    className="download-action download-action--available"
                    href={platform.href}
                    rel="noopener noreferrer"
                  >
                    <span>{copy.action}</span>
                    <Download size={17} aria-hidden="true" />
                  </a>
                ) : (
                  <a
                    className="download-action download-action--upcoming"
                    href={platform.href}
                    rel="noopener noreferrer"
                    aria-disabled="true"
                  >
                    <span>{copy.waiting}</span>
                    <Clock3 size={17} aria-hidden="true" />
                  </a>
                )}
              </article>
            );
          })}
        </div>

        <div className="download-upcoming">
          <h3>{copy.upcomingTitle}</h3>
          <ul>
            {copy.upcoming.map((platform, index) => {
              const Icon = upcomingPlatforms[index];

              return (
                <li key={platform}>
                  <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
                  <span>{platform}</span>
                  <small>{copy.waiting}</small>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
