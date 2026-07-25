import type { WorkspaceTab } from "../../../../workspace-tabs/types";
import { readBrowserHistoryEntries } from "../../../../browser-history/service";
import { getDesktopApi } from "../../../../shell/service";
import type { ComposerLinkSegment } from "./message-citation";

const websiteFaviconRequests = new Map<string, Promise<string | null>>();
const resolvedWebsiteFavicons = new Map<string, string | null>();

export const parseComposerHttpUrl = (raw: string): string | null => {
  const value = raw.trim();
  if (!/^https?:\/\//iu.test(value) || /\s/u.test(value)) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
};

export const websiteLinkLabel = (url: string): string => {
  try {
    return new URL(url).host.replace(/^www\./iu, "") || url;
  } catch {
    return url;
  }
};

const existingFaviconUrl = (tab: WorkspaceTab): string | null => {
  const faviconUrl = tab.faviconUrl?.trim();
  return faviconUrl === undefined || faviconUrl.length === 0 ? null : faviconUrl;
};

export const knownFaviconUrlForUrl = (
  url: string,
  workspaceTabs: readonly WorkspaceTab[]
): string | null => {
  const exact = workspaceTabs.find(
    (tab) => tab.displayAddress.trim() === url && existingFaviconUrl(tab) !== null
  );
  if (exact !== undefined) {
    return existingFaviconUrl(exact);
  }

  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return null;
  }
  const sameOrigin = workspaceTabs.find((tab) => {
    if (existingFaviconUrl(tab) === null) {
      return false;
    }
    try {
      return new URL(tab.displayAddress).origin === origin;
    } catch {
      return false;
    }
  });
  const sameOriginFavicon = sameOrigin === undefined ? null : existingFaviconUrl(sameOrigin);
  if (sameOriginFavicon !== null) {
    return sameOriginFavicon;
  }

  const history = readBrowserHistoryEntries();
  const exactHistory = history.find(
    (entry) => entry.url === url && (entry.faviconUrl?.trim().length ?? 0) > 0
  );
  if (exactHistory?.faviconUrl !== undefined) {
    return exactHistory.faviconUrl.trim();
  }
  const sameOriginHistory = history.find((entry) => {
    if ((entry.faviconUrl?.trim().length ?? 0) === 0) {
      return false;
    }
    try {
      return new URL(entry.url).origin === origin;
    } catch {
      return false;
    }
  });
  return sameOriginHistory?.faviconUrl?.trim() || null;
};

const autoResolvableWebsiteOrigin = (rawUrl: string): string | null => {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    const hostname = url.hostname.toLowerCase();
    if (
      hostname.length === 0
      || !hostname.includes(".")
      || hostname.includes(":")
      || /^\d+(?:\.\d+){3}$/u.test(hostname)
      || hostname === "localhost"
      || hostname.endsWith(".localhost")
      || hostname.endsWith(".local")
      || hostname.endsWith(".internal")
      || hostname.endsWith(".home.arpa")
      || url.username.length > 0
      || url.password.length > 0
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
};

export const cachedWebsiteFaviconUrl = (url: string): string | null =>
  resolvedWebsiteFavicons.get(autoResolvableWebsiteOrigin(url) ?? "") ?? null;

export const resolveWebsiteFaviconUrl = async (url: string): Promise<string | null> => {
  const origin = autoResolvableWebsiteOrigin(url);
  if (origin === null) {
    return null;
  }
  if (resolvedWebsiteFavicons.has(origin)) {
    return resolvedWebsiteFavicons.get(origin) ?? null;
  }
  const existingRequest = websiteFaviconRequests.get(origin);
  if (existingRequest !== undefined) {
    return await existingRequest;
  }
  const agentApi = getDesktopApi()?.agent;
  if (agentApi === undefined) {
    return null;
  }
  const request = agentApi.resolveProviderIcon({ baseUrl: origin, publicOnly: true })
    .then(({ iconUrl }) => iconUrl?.trim() || null)
    .catch(() => null)
    .then((iconUrl) => {
      resolvedWebsiteFavicons.set(origin, iconUrl);
      return iconUrl;
    })
    .finally(() => {
      websiteFaviconRequests.delete(origin);
    });
  websiteFaviconRequests.set(origin, request);
  return await request;
};

export const createComposerLinkSegment = (
  text: string,
  workspaceTabs: readonly WorkspaceTab[]
): ComposerLinkSegment | null => {
  const url = parseComposerHttpUrl(text);
  if (url === null) {
    return null;
  }
  const faviconUrl = knownFaviconUrlForUrl(url, workspaceTabs);
  return {
    type: "link",
    url,
    label: websiteLinkLabel(url),
    ...(faviconUrl === null ? {} : { faviconUrl })
  };
};
