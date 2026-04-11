import type { WorkbenchBrowserIpcBridge } from "../workbench-browser/service";
import type { CachedDocumentBytes } from "./types";

const SUPPORTED_PROTOCOLS = new Set(["https:", "http:", "file:"]);

export const normalizeDocumentUrl = (rawUrl: string, baseUrl?: string): string | null => {
  try {
    const parsed = baseUrl === undefined ? new URL(rawUrl) : new URL(rawUrl, baseUrl);
    if (!SUPPORTED_PROTOCOLS.has(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
};

export const fetchDocumentBytes = async ({
  browserBridge,
  tabId,
  url,
  referrer
}: {
  readonly browserBridge: WorkbenchBrowserIpcBridge;
  readonly tabId: string;
  readonly url: string;
  readonly referrer?: string;
}): Promise<CachedDocumentBytes> => {
  const normalized = normalizeDocumentUrl(url);
  if (normalized === null) {
    throw Object.assign(new Error(`Unsupported document URL: ${url}`), {
      code: "document_unsupported_scheme"
    });
  }

  const response = await browserBridge.fetchWithTabSession(tabId, {
    url: normalized,
    ...(typeof referrer === "string" && referrer.length > 0 ? { referrer } : {}),
    timeoutMs: 10_000,
    maxBytes: 64 * 1024 * 1024
  });

  if (response.status >= 400) {
    throw Object.assign(new Error(`Document fetch failed with status ${response.status}`), {
      code: "document_fetch_failed"
    });
  }

  return {
    finalUrl: response.finalUrl,
    ...(response.mimeType === undefined ? {} : { mimeType: response.mimeType }),
    body: response.body
  };
};
