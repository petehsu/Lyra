const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

const collapseUrlWhitespace = (value: string): string =>
  value
    .split("")
    .filter((char) => char !== " " && char !== "\t" && char !== "\n" && char !== "\r")
    .join("");

const tryParseHttpUrl = (raw: string): URL | null => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const collapsed = collapseUrlWhitespace(trimmed);
  const candidates = [
    trimmed,
    collapsed,
    trimmed.startsWith("//") ? `https:${trimmed}` : null,
    collapsed.startsWith("//") ? `https:${collapsed}` : null,
    !trimmed.includes("://") && trimmed.includes(".") ? `https://${collapsed}` : null
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate);
      if (HTTP_PROTOCOLS.has(parsed.protocol)) {
        return parsed;
      }
    } catch {
      continue;
    }
  }
  return null;
};

const extractEmbeddedHttpUrl = (parsed: URL): URL | null => {
  let decodedPath = parsed.pathname;
  try {
    decodedPath = decodeURIComponent(parsed.pathname);
  } catch {
    decodedPath = parsed.pathname;
  }
  const embedded = decodedPath.replace(/^\//, "");
  if (embedded.startsWith("http://") || embedded.startsWith("https://")) {
    return tryParseHttpUrl(embedded);
  }
  return null;
};

export type CanonicalBrowserCitationUrls = {
  readonly pageUrl: string;
  readonly frameUrl: string | null;
};

export const canonicalizeBrowserCitationUrls = (
  pageUrlInput: string,
  frameUrlInput?: string | null
): CanonicalBrowserCitationUrls | null => {
  const frameParsed =
    frameUrlInput === undefined || frameUrlInput === null
      ? null
      : tryParseHttpUrl(frameUrlInput);
  const pageParsed = tryParseHttpUrl(pageUrlInput);
  const pageEmbedded = pageParsed === null ? null : extractEmbeddedHttpUrl(pageParsed);

  const authoritative = frameParsed ?? pageEmbedded ?? pageParsed;
  if (authoritative === null) {
    return null;
  }

  const pageUrl = authoritative.href;
  const frameCandidate = frameParsed ?? pageEmbedded;
  const frameUrl =
    frameCandidate !== null && frameCandidate.href !== pageUrl ? frameCandidate.href : null;

  return { pageUrl, frameUrl };
};