import type {
  AgentSessionDetail,
} from "./agent-ui-types";

const internalReflectionHeadingPattern = /(?:^|\n)\s{0,3}(?:#{1,6}\s*)?(?:reflection|反思)[\s\S]*$/i;

export const sanitizeAssistantDisplayContent = (content: string): string => {
  if (content.length === 0) {
    return content;
  }
  const normalized = content.replace(/\r\n/g, "\n");
  const withoutTaggedThinking = normalized
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/gi, "");
  const withoutTaggedReflection = withoutTaggedThinking
    .replace(/<reflection>[\s\S]*?<\/reflection>/gi, "")
    .replace(/<reflection>[\s\S]*$/gi, "");
  const headingMatch = internalReflectionHeadingPattern.exec(withoutTaggedReflection);
  if (headingMatch === null) {
    return withoutTaggedReflection;
  }
  const cutIndex = headingMatch.index + (headingMatch[0].startsWith("\n") ? 1 : 0);
  return withoutTaggedReflection.slice(0, cutIndex).trimEnd();
};

export const resolveAssistantDisplayContent = (
  message: Pick<AgentSessionDetail["messages"][number], "content"> & { readonly displayContent?: string }
): string => {
  if (typeof message.displayContent === "string" && message.displayContent.trim().length > 0) {
    return message.displayContent;
  }
  return sanitizeAssistantDisplayContent(message.content);
};
