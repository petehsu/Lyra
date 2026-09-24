import type { SiteCopy } from "@/lib/i18n";

type VideoSectionProps = {
  readonly copy: SiteCopy["video"];
};

const VIDEO_SRC =
  "https://jhpeihmmxfcwwodngybw.supabase.co/storage/v1/object/public/installer/promotional.mp4";

export function VideoSection({ copy }: VideoSectionProps) {
  return (
    <section id="video" className="video-section">
      <div className="video-inner">
        <div className="video-intro drop-reveal">
          <h2>{copy.title}</h2>
          <p>{copy.body}</p>
        </div>
        <figure className="video-frame drop-reveal">
          <video
            src={VIDEO_SRC}
            aria-label={copy.frameTitle}
            controls
            controlsList="nodownload"
            playsInline
            preload="metadata"
          >
            {copy.frameTitle}
          </video>
        </figure>
      </div>
    </section>
  );
}
