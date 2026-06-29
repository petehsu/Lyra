import {
  createPageTab,
  createPageTabWithId,
  createResultsTab,
  createResultsTabWithId,
  createSearchTab,
  createSearchTabWithId,
  createWebSearchTab,
  createWebSearchTabWithId
} from "./tab-factory";
import type {
  WorkspaceResolvedNavigation,
  WorkspaceTab,
  WorkspaceTabsConfig
} from "./types";

const URL_OR_DOMAIN_PATTERN = /^(https?:\/\/|file:\/\/|[\w.-]+\.[a-z]{2,}(\/|$))/i;

export const looksLikeUrl = (value: string): boolean => URL_OR_DOMAIN_PATTERN.test(value);

export const normalizeUrl = (value: string): string => {
  if (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("file://")
  ) {
    return value;
  }
  return `https://${value}`;
};

export const toSafeAddress = (value: string): string | null => {
  const normalized = normalizeUrl(value.trim());
  try {
    const parsed = new URL(normalized);
    if (
      parsed.protocol === "http:" ||
      parsed.protocol === "https:" ||
      parsed.protocol === "file:"
    ) {
      return parsed.toString();
    }
  } catch (_error) {
    return null;
  }
  return null;
};

const TRANSIENT_NAVIGATION_PARAM_NAMES = new Set([
  "__cf_chl_rt_tk",
  "__cf_chl_tk",
  "__cf_chl_jschl_tk__",
  "__cf_chl_captcha_tk__",
  "__cf_chl_managed_tk__",
  "__cf_chl_f_tk",
  "cf_chl_rt_tk",
  "cf_chl_tk"
]);

const isTransientNavigationParam = (name: string): boolean => {
  const normalized = name.trim();
  return (
    TRANSIENT_NAVIGATION_PARAM_NAMES.has(normalized)
    || normalized.startsWith("__cf_chl_")
    || normalized.startsWith("cf_chl_")
  );
};

const unwrapTranslationWrapperUrl = (parsed: URL): URL => {
  if (
    parsed.hostname === "translate.google.com"
    || parsed.hostname === "translate.google.cn"
    || parsed.hostname.endsWith(".translate.goog")
  ) {
    const embedded = parsed.searchParams.get("u");
    if (embedded !== null && embedded.trim().length > 0) {
      try {
        return new URL(decodeURIComponent(embedded.trim()));
      } catch (_error) {
        return parsed;
      }
    }
  }
  return parsed;
};

const normalizeNavigationComparisonAddress = (value: string): string => {
  const address = toSafeAddress(value);
  if (address === null || address === "about:blank") {
    return value;
  }
  try {
    let parsed = new URL(address);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return address;
    }
    parsed = unwrapTranslationWrapperUrl(parsed);
    if (parsed.hash.includes("googtrans")) {
      parsed.hash = "";
    }
    for (const name of [...parsed.searchParams.keys()]) {
      if (isTransientNavigationParam(name)) {
        parsed.searchParams.delete(name);
      }
    }
    return parsed.toString();
  } catch (_error) {
    return address;
  }
};

export const areNavigationAddressesEquivalent = (left: string, right: string): boolean => {
  const normalizedLeft = toSafeAddress(left);
  const normalizedRight = toSafeAddress(right);
  if (normalizedLeft === null || normalizedRight === null) {
    return false;
  }
  if (normalizedLeft === normalizedRight) {
    return true;
  }
  return (
    normalizeNavigationComparisonAddress(normalizedLeft)
    === normalizeNavigationComparisonAddress(normalizedRight)
  );
};

export const toNonEmptyTrimmed = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const resolveReplacementTab = (
  current: WorkspaceTab,
  request: WorkspaceResolvedNavigation,
  config: WorkspaceTabsConfig
): WorkspaceTab => {
  switch (request.kind) {
    case "home":
      return createSearchTabWithId(current.id, config);
    case "page":
      return createPageTabWithId(
        current.id,
        request.address,
        request.title,
        request.searchQuery === undefined || request.searchSource !== "web"
          ? undefined
          : {
              query: request.searchQuery,
              source: "web",
              ...(request.searchEngineId === undefined
                ? {}
                : { engineId: request.searchEngineId })
            }
      );
    case "search":
      return createResultsTabWithId(
        current.id,
        request.query,
        config
      );
    case "web-search":
      return createWebSearchTabWithId(
        current.id,
        request.query,
        request.address,
        config,
        request.engineId,
        request.title,
        request.selection
      );
  }
};

export const createNavigationTab = (
  serial: number,
  request: WorkspaceResolvedNavigation,
  config: WorkspaceTabsConfig
): WorkspaceTab => {
  switch (request.kind) {
    case "home":
      return createSearchTab(serial, config);
    case "page":
      return createPageTab(serial, request.address, request.title);
    case "search":
      return createResultsTab(
        serial,
        request.query,
        config
      );
    case "web-search":
      return createWebSearchTab(
        serial,
        request.query,
        request.address,
        config,
        request.engineId,
        request.title,
        request.selection
      );
  }
};
