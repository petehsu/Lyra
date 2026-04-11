import type { LyraDesktopApi } from "../../../shared/desktop-bridge";

const URL_OR_DOMAIN_PATTERN = /^(https?:\/\/|[\w.-]+\.[a-z]{2,}(\/|$))/i;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;
const UNC_PATH_PATTERN = /^\\\\[^\\]+\\[^\\]+/;
const POSIX_ABSOLUTE_PATH_PATTERN = /^\//;

export type WorkbenchNavigationResolution =
  | {
      readonly kind: "empty";
    }
  | {
      readonly kind: "url";
      readonly address: string;
    }
  | {
      readonly kind: "file";
      readonly path: string;
    }
  | {
      readonly kind: "directory";
      readonly path: string;
    }
  | {
      readonly kind: "search";
      readonly query: string;
      readonly mode: "standard";
    };

const looksLikeUrl = (value: string): boolean => URL_OR_DOMAIN_PATTERN.test(value);

const normalizeUrl = (value: string): string => {
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }
  return `https://${value}`;
};

const toSafeAddress = (value: string): string | null => {
  const normalized = normalizeUrl(value.trim());
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

const decodeUrlPath = (value: string): string | null => {
  try {
    return decodeURIComponent(value);
  } catch (_error) {
    return null;
  }
};

const fromFileUrl = (value: string): string | null => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "file:") {
      return null;
    }
    const decodedPath = decodeUrlPath(parsed.pathname);
    if (decodedPath === null) {
      return null;
    }
    if (parsed.host.length > 0) {
      return `\\\\${parsed.host}${decodedPath.replaceAll("/", "\\")}`;
    }
    if (/^\/[A-Za-z]:\//.test(decodedPath)) {
      return decodedPath.slice(1);
    }
    return decodedPath;
  } catch (_error) {
    return null;
  }
};

const looksLikeAbsolutePath = (value: string): boolean =>
  POSIX_ABSOLUTE_PATH_PATTERN.test(value) ||
  WINDOWS_ABSOLUTE_PATH_PATTERN.test(value) ||
  UNC_PATH_PATTERN.test(value);

const toSearchResolution = (value: string): WorkbenchNavigationResolution => ({
  kind: "search",
  query: value,
  mode: "standard"
});

const resolveLocalPath = async (
  path: string,
  desktopApi: Pick<LyraDesktopApi, "files"> | null
): Promise<WorkbenchNavigationResolution | null> => {
  if (desktopApi === null) {
    return null;
  }

  try {
    const stat = await desktopApi.files.statFile({ path });
    if (stat.exists === false) {
      return null;
    }
    return stat.isDirectory
      ? { kind: "directory", path }
      : { kind: "file", path };
  } catch (_error) {
    return null;
  }
};

export const resolveWorkbenchNavigationInput = async (
  rawValue: string,
  desktopApi: Pick<LyraDesktopApi, "files"> | null
): Promise<WorkbenchNavigationResolution> => {
  const value = rawValue.trim();
  if (value.length === 0) {
    return { kind: "empty" };
  }

  const fileUrlPath = fromFileUrl(value);
  if (fileUrlPath !== null) {
    return (await resolveLocalPath(fileUrlPath, desktopApi)) ?? toSearchResolution(value);
  }

  if (looksLikeUrl(value)) {
    const address = toSafeAddress(value);
    if (address !== null) {
      return { kind: "url", address };
    }
  }

  if (looksLikeAbsolutePath(value)) {
    return (await resolveLocalPath(value, desktopApi)) ?? toSearchResolution(value);
  }

  return toSearchResolution(value);
};
