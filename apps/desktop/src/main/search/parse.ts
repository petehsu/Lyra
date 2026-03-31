const HTML_ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " "
};

const JS_ESCAPES: Record<string, string> = {
  "\\n": "\n",
  "\\r": "\r",
  "\\t": "\t",
  "\\f": "\f",
  "\\b": "\b",
  "\\/": "/",
  '\\"': '"',
  "\\'": "'",
  "\\\\": "\\"
};

const compactWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

export const decodeHtmlEntities = (input: string): string =>
  input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_match, entity: string) => {
    const normalized = String(entity).toLowerCase();
    if (normalized.startsWith("#x")) {
      const code = Number.parseInt(normalized.slice(2), 16);
      return Number.isNaN(code) ? "" : String.fromCodePoint(code);
    }

    if (normalized.startsWith("#")) {
      const code = Number.parseInt(normalized.slice(1), 10);
      return Number.isNaN(code) ? "" : String.fromCodePoint(code);
    }

    return HTML_ENTITY_MAP[normalized] ?? "";
  });

export const stripHtmlTags = (value: string): string =>
  compactWhitespace(
    decodeHtmlEntities(
      value
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
    )
  );

export const decodeJsLiteral = (value: string): string => {
  let output = value;

  output = output.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex: string) => {
    const code = Number.parseInt(hex, 16);
    return Number.isNaN(code) ? "" : String.fromCharCode(code);
  });

  output = output.replace(/\\x([0-9a-fA-F]{2})/g, (_match, hex: string) => {
    const code = Number.parseInt(hex, 16);
    return Number.isNaN(code) ? "" : String.fromCharCode(code);
  });

  output = output.replace(/\\[nrtfb/"'\\]/g, (escape) => JS_ESCAPES[escape] ?? escape);

  return stripHtmlTags(output);
};

const toSafeUrl = (candidate: string): string | null => {
  if (candidate.length === 0) {
    return null;
  }

  const normalized = candidate.startsWith("//") ? `https:${candidate}` : candidate;
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch (_error) {
    return null;
  }

  return null;
};

export const resolveDuckDuckGoRedirect = (rawUrl: string): string | null => {
  const directUrl = toSafeUrl(rawUrl);
  if (directUrl === null) {
    return null;
  }

  try {
    const parsed = new URL(directUrl);
    if (parsed.hostname.includes("duckduckgo.com")) {
      const redirected = parsed.searchParams.get("uddg");
      if (redirected !== null) {
        return toSafeUrl(redirected);
      }
    }
  } catch (_error) {
    return directUrl;
  }

  return directUrl;
};

export const toDisplayUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname === "/" ? "" : parsed.pathname;
    const query = parsed.search.length > 0 ? parsed.search : "";
    return `${parsed.hostname}${pathname}${query}`;
  } catch (_error) {
    return url;
  }
};

const normalizeHostname = (hostname: string): string => hostname.replace(/^www\./i, "").toLowerCase();

export const toResultMergeKey = (url: string): string => {
  try {
    const parsed = new URL(url);
    const normalizedPath = parsed.pathname.replace(/\/$/, "") || "/";
    return `${normalizeHostname(parsed.hostname)}${normalizedPath}`;
  } catch (_error) {
    return url;
  }
};

export const clip = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
};

export const containsBotChallenge = (html: string): boolean => /anomaly|captcha|challenge/i.test(html);

export const extractTagContent = (xml: string, tagName: string): string => {
  const match = xml.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, "i"));
  if (match === null || match[1] === undefined) {
    return "";
  }
  return stripHtmlTags(match[1]);
};

export const stableResultId = (engineId: string, rank: number, url: string): string =>
  `${engineId}-${rank}-${toResultMergeKey(url)}`;
