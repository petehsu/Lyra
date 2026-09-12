const TASK_OWNED_BROWSER_SURFACE_MS = 15 * 60_000;

type OriginGrant = {
  readonly origin: string;
  readonly expiresAt: number;
};

type TabGrant = {
  readonly tabId: string;
  readonly expiresAt: number;
};

let ownedOrigins: OriginGrant[] = [];
let ownedTabs: TabGrant[] = [];

const isHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const pruneExpired = (now: number): void => {
  ownedOrigins = ownedOrigins.filter((grant) => grant.expiresAt > now);
  ownedTabs = ownedTabs.filter((grant) => grant.expiresAt > now);
};

// ponytail: origin-wide 15 min after a task-owned open (CLI helper, agent navigate,
// MCP, popup from an owned tab). Tab id covers same-tab redirects and iframes
// without path/host regex. Upgrade: request-open-tab returns tabId to the opener.
export const grantBrowserAuthorizeAct = (url: string, tabId?: string): void => {
  const now = Date.now();
  const expiresAt = now + TASK_OWNED_BROWSER_SURFACE_MS;
  pruneExpired(now);
  if (isHttpUrl(url)) {
    try {
      const origin = new URL(url).origin;
      ownedOrigins = ownedOrigins.filter((grant) => grant.origin !== origin);
      ownedOrigins.push({ origin, expiresAt });
    } catch {
      // Invalid URLs never receive an origin grant.
    }
  }
  if (tabId !== undefined && tabId.length > 0) {
    ownedTabs = ownedTabs.filter((grant) => grant.tabId !== tabId);
    ownedTabs.push({ tabId, expiresAt });
  }
};

export const hasBrowserAuthorizeActGrant = (url?: string, tabId?: string): boolean => {
  const now = Date.now();
  pruneExpired(now);
  if (tabId !== undefined && tabId.length > 0) {
    if (ownedTabs.some((grant) => grant.tabId === tabId)) {
      return true;
    }
  }
  if (url === undefined || url.length === 0) {
    return false;
  }
  try {
    const origin = new URL(url).origin;
    return ownedOrigins.some((grant) => grant.origin === origin);
  } catch {
    return false;
  }
};
