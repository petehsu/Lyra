import { Folder, Image as ImageIcon, Paperclip } from "lucide-react";

import type { AgentMessageContentPart } from "../../../shared/desktop-bridge";

type InlineMessageContentProps = {
  readonly content: string;
  readonly parts?: readonly AgentMessageContentPart[] | undefined;
};

const renderInlineAttachmentIcon = (
  kind: Extract<AgentMessageContentPart, { readonly type: "attachment" }>["kind"]
) => {
  if (kind === "directory") {
    return <Folder size={12} aria-hidden="true" />;
  }
  if (kind === "local_image" || kind === "image") {
    return <ImageIcon size={12} aria-hidden="true" />;
  }
  return <Paperclip size={12} aria-hidden="true" />;
};

export const InlineMessageContent = ({
  content,
  parts,
}: InlineMessageContentProps) => {
  if (parts === undefined || parts.length === 0) {
    return <>{content}</>;
  }

  return (
    <span className="lyra-ai-agent-inline-content">
      {parts.map((part, index) => (
        part.type === "text" ? (
          <span key={`text-${String(index)}`}>{part.text}</span>
        ) : (
          <span
            key={`attachment-${part.path}-${String(index)}`}
            className="lyra-ai-agent-inline-attachment"
            title={part.path}
          >
            {renderInlineAttachmentIcon(part.kind)}
            <span>{part.name}</span>
          </span>
        )
      ))}
    </span>
  );
};
