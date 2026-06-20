const BLOCKED_SCHEMES = ["javascript:", "vbscript:", "file:", "data:"] as const;

const ALLOWED_DATA_IMAGE_PREFIXES = [
  "data:image/gif;",
  "data:image/png;",
  "data:image/jpeg;",
  "data:image/webp;"
] as const;

const matchesBlockedScheme = (normalized: string): boolean =>
  BLOCKED_SCHEMES.some((scheme) => normalized.startsWith(scheme));

const matchesAllowedDataImage = (normalized: string): boolean =>
  ALLOWED_DATA_IMAGE_PREFIXES.some((prefix) => normalized.startsWith(prefix));

/**
 * Mirrors lyra-render-core `is_safe_link_url` / markdown-it validateLink.
 */
export const isSafeRenderUrl = (url: string): boolean => {
  const normalized = url.trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }
  if (matchesBlockedScheme(normalized)) {
    return matchesAllowedDataImage(normalized);
  }
  return true;
};

export const isSafeRenderImageSrc = (src: string): boolean => isSafeRenderUrl(src);