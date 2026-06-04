export const BROWSER_IDENTITY_FEDCM_FEATURE = "FedCm";

type BrowserIdentityCompatApp = {
  readonly commandLine: {
    readonly appendSwitch: (name: string, value?: string) => void;
  };
  userAgentFallback: string;
};

export const sanitizeBrowserCompatibleUserAgent = (userAgent: string): string => {
  const trimmed = userAgent.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }
  const sanitized = trimmed
    .replace(/\sElectron\/[^\s]+/gu, "")
    .replace(/\sLyra(?:Desktop|Workbench)?\/[^\s]+/gu, "")
    .replace(/\s{2,}/gu, " ")
    .trim();
  return sanitized.length > 0 ? sanitized : trimmed;
};

export const configureBrowserIdentityCompatibility = (
  app: BrowserIdentityCompatApp
): void => {
  app.commandLine.appendSwitch("disable-features", BROWSER_IDENTITY_FEDCM_FEATURE);
  const sanitizedUserAgent = sanitizeBrowserCompatibleUserAgent(app.userAgentFallback);
  if (sanitizedUserAgent !== app.userAgentFallback && sanitizedUserAgent.length > 0) {
    app.userAgentFallback = sanitizedUserAgent;
  }
};
