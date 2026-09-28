import type { AgentPageCitation } from "../../../../../../shared/agent";

export const parseComposerHttpUrl = (raw: string): string | null => {
  const value = raw.trim();
  if (!/^https?:\/\//iu.test(value) || /\s/u.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
};

// Display only. Never use this value as the navigation or submission target.
export const websiteLinkLabel = (url: string): string =>
  url.replace(/^https?:\/\//iu, "").replace(/^www\./iu, "").replace(/\/$/u, "");

export const pageCitationWebUrl = (citation: AgentPageCitation): string | null => {
  if (citation.excerptKind === "selection") return null;
  return parseComposerHttpUrl(
    citation.excerptKind === "link"
      ? citation.linkUrl || citation.srcUrl || citation.pageUrl
      : citation.pageUrl
  );
};
