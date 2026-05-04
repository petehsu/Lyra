import type {
  DownloadManagerChecksum,
  DownloadManagerEnqueueRequest
} from "../../shared/download-manager";

export type DownloadImportItem = {
  readonly url: string;
  readonly mirrors?: readonly string[] | undefined;
  readonly checksum?: DownloadManagerChecksum | undefined;
};

const SUPPORTED_PROTOCOLS = new Set([
  "http:",
  "https:",
  "magnet:",
  "ftp:",
  "ftps:",
  "sftp:",
  "webdav:",
  "webdavs:"
]);

const normalizeUrl = (value: string): string | null => {
  try {
    const parsed = new URL(value.trim());
    if (SUPPORTED_PROTOCOLS.has(parsed.protocol) === false) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
};

const dedupe = (values: readonly string[]): readonly string[] => {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    next.push(value);
  }
  return next;
};

const extractTextUrls = (text: string): readonly string[] => {
  const matches = text.match(/\b(?:(?:https?|ftps?|sftp|webdavs?):\/\/[^\s"'<>]+|magnet:\?[^\s"'<>]+)/giu) ?? [];
  return dedupe(matches.map((value) => normalizeUrl(value)).filter((value): value is string => value !== null));
};

const decodeXmlText = (value: string): string =>
  value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'");

const normalizeChecksumAlgorithm = (
  value: string
): DownloadManagerChecksum["algorithm"] | null => {
  const normalized = value.toLowerCase().replace(/[-_]/gu, "");
  if (normalized === "md5") {
    return "md5";
  }
  if (normalized === "sha1") {
    return "sha1";
  }
  if (normalized === "sha256") {
    return "sha256";
  }
  return null;
};

const parseMetalinkChecksum = (block: string): DownloadManagerChecksum | undefined => {
  const hashMatch = /<hash\b([^>]*)>([\s\S]*?)<\/hash>/iu.exec(block);
  if (hashMatch === null) {
    return undefined;
  }
  const attributes = hashMatch[1] ?? "";
  const typeMatch = /\btype=["']([^"']+)["']/iu.exec(attributes);
  if (typeMatch === null) {
    return undefined;
  }
  const algorithm = normalizeChecksumAlgorithm(typeMatch[1] ?? "");
  const expected = decodeXmlText(hashMatch[2] ?? "").trim();
  if (algorithm === null || expected.length === 0) {
    return undefined;
  }
  return {
    algorithm,
    expected
  };
};

const parseMetalinkBlock = (block: string): DownloadImportItem | null => {
  const urls = dedupe(
    [...block.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/giu)]
      .map((match) => normalizeUrl(decodeXmlText(match[1] ?? "").trim()))
      .filter((value): value is string => value !== null)
  );
  const [url, ...mirrors] = urls;
  if (url === undefined) {
    return null;
  }
  return {
    url,
    ...(mirrors.length === 0 ? {} : { mirrors }),
    ...(parseMetalinkChecksum(block) === undefined
      ? {}
      : { checksum: parseMetalinkChecksum(block) })
  };
};

const parseMetalinkItems = (text: string): readonly DownloadImportItem[] => {
  if (/<metalink\b/iu.test(text) === false && /<url\b/iu.test(text) === false) {
    return [];
  }
  const fileBlocks = [...text.matchAll(/<file\b[^>]*>([\s\S]*?)<\/file>/giu)]
    .map((match) => match[1] ?? "");
  const blocks = fileBlocks.length > 0 ? fileBlocks : [text];
  return blocks
    .map(parseMetalinkBlock)
    .filter((item): item is DownloadImportItem => item !== null);
};

export const parseDownloadUrls = (request: DownloadManagerEnqueueRequest): readonly string[] => {
  const values = [
    ...(request.urls ?? []),
    ...extractTextUrls(request.text ?? "")
  ];
  return dedupe(values.map((value) => normalizeUrl(value)).filter((value): value is string => value !== null));
};

export const parseDownloadImportItems = (
  request: DownloadManagerEnqueueRequest
): readonly DownloadImportItem[] => {
  const metalinkItems = parseMetalinkItems(request.text ?? "");
  if (metalinkItems.length > 0) {
    return metalinkItems;
  }
  return parseDownloadUrls(request).map((url) => ({
    url,
    ...(request.mirrors === undefined ? {} : { mirrors: parseDownloadUrls({ urls: request.mirrors }) }),
    ...(request.checksum === undefined ? {} : { checksum: request.checksum })
  }));
};
