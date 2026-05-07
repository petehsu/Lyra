import type { AgentComposerSubmitPayload } from "./agent-composer";

const runtimeAttachmentFromComposer = (
  attachment: AgentComposerSubmitPayload["attachments"][number]
) => ({
  name: attachment.name,
  path: attachment.path,
  kind: attachment.kind,
  ...(attachment.contextText === undefined ? {} : { contextText: attachment.contextText }),
});

export const runtimeInputFromComposerReferenceParts = (
  payload: AgentComposerSubmitPayload
) => ({
  text: payload.text.trim(),
  attachments: payload.attachments.map(runtimeAttachmentFromComposer),
  parts: payload.parts.map((part) => part.type === "text"
    ? { type: "text" as const, text: part.text }
    : {
        type: "attachment" as const,
        attachment: runtimeAttachmentFromComposer(part.attachment),
      }),
});
