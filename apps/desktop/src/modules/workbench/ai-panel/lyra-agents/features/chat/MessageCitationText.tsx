import { Fragment, useMemo } from "react";
import type { AgentPageCitation, AgentTranscriptCitation } from "../../../../../../shared/agent";
import type { AgentImageAttachment } from "../../core/types";
import type { AgentFileAttachment } from "./composer-file";
import { CitationChipView } from "./CitationChipView";
import { FileAttachmentChipView } from "./FileAttachmentChipView";
import { ImageAttachmentChipView } from "./ImageAttachmentChipView";
import { parseRenderedCitationSegments } from "./message-citation";
import { PageCitationChipView } from "./PageCitationChipView";

type MessageCitationTextProps = {
  text: string;
  transcriptCitations: readonly AgentTranscriptCitation[];
  pageCitations: readonly AgentPageCitation[];
  inlineImages?: readonly AgentImageAttachment[];
  fileAttachments?: readonly AgentFileAttachment[];
  onTranscriptCitationClick?: (citation: AgentTranscriptCitation) => void;
  onPageCitationClick?: (citation: AgentPageCitation) => void;
  onImageAttachmentClick?: (image: AgentImageAttachment) => void;
  onFileAttachmentClick?: (file: AgentFileAttachment) => void;
};

export const MessageCitationText = ({
  text,
  transcriptCitations,
  pageCitations,
  inlineImages = [],
  fileAttachments = [],
  onTranscriptCitationClick,
  onPageCitationClick,
  onImageAttachmentClick,
  onFileAttachmentClick
}: MessageCitationTextProps) => {
  const segments = useMemo(
    () => parseRenderedCitationSegments(text, transcriptCitations, pageCitations, inlineImages, fileAttachments),
    [fileAttachments, inlineImages, pageCitations, text, transcriptCitations]
  );
  const hasRenderedCitations = segments.some(
    (segment) =>
      segment.type === "transcript"
      || segment.type === "page"
      || segment.type === "image"
      || segment.type === "file"
  );

  if (!hasRenderedCitations) {
    return <>{text}</>;
  }

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.type === "text") {
          return <Fragment key={`text-${index}`}>{segment.value}</Fragment>;
        }
        if (segment.type === "page") {
          const handleClick = onPageCitationClick === undefined
            ? undefined
            : () => onPageCitationClick(segment.citation);
          return (
            <PageCitationChipView
              key={`page-${segment.citation.id}-${index}`}
              citation={segment.citation}
              {...(handleClick === undefined ? {} : { onClick: handleClick })}
            />
          );
        }
        if (segment.type === "image") {
          const handleClick = onImageAttachmentClick === undefined
            ? undefined
            : () => onImageAttachmentClick(segment.image);
          return (
            <ImageAttachmentChipView
              key={`image-${segment.image.id}-${index}`}
              image={segment.image}
              {...(handleClick === undefined ? {} : { onClick: handleClick })}
            />
          );
        }
        if (segment.type === "file") {
          const handleClick = onFileAttachmentClick === undefined
            ? undefined
            : () => onFileAttachmentClick(segment.file);
          return (
            <FileAttachmentChipView
              key={`file-${segment.file.id}-${index}`}
              file={segment.file}
              {...(handleClick === undefined ? {} : { onClick: handleClick })}
            />
          );
        }
        const handleClick = onTranscriptCitationClick === undefined
          ? undefined
          : () => onTranscriptCitationClick(segment.citation);
        return (
          <CitationChipView
            key={`transcript-${segment.citation.id}-${index}`}
            citation={segment.citation}
            {...(handleClick === undefined ? {} : { onClick: handleClick })}
          />
        );
      })}
    </>
  );
};