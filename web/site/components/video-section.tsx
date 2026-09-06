import type { SiteCopy } from "@/lib/i18n";

type VideoSectionProps = {
  readonly copy: SiteCopy["video"];
};

const VIDEO_EMBED_SRC =
  "https://www.youtube.com/embed/X0kaEvCIFCw?si=B8LjXjE0C0j55jHY&controls=0";

export function VideoSection({ copy }: VideoSectionProps) {
  return (
    <section id="video" className="video-section">
      <div className="video-inner">
        <div className="video-intro drop-reveal">
          <h2>{copy.title}</h2>
          <p>{copy.body}</p>
        </div>
        <div className="video-frame drop-reveal">
          <iframe
            src={VIDEO_EMBED_SRC}
            title={copy.frameTitle}
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
      </div>
    </section>
  );
}
