import {
  createPageTab,
  createPageTabWithId,
  createResultsTab,
  createResultsTabWithId,
  createSearchTab,
  createSearchTabWithId
} from "./tab-factory";
import type {
  WorkspaceResolvedNavigation,
  WorkspaceTab,
  WorkspaceTabsConfig
} from "./types";

const URL_OR_DOMAIN_PATTERN = /^(https?:\/\/|[\w.-]+\.[a-z]{2,}(\/|$))/i;

export const looksLikeUrl = (value: string): boolean => URL_OR_DOMAIN_PATTERN.test(value);

export const normalizeUrl = (value: string): string => {
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }
  return `https://${value}`;
};

export const toSafeAddress = (value: string): string | null => {
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
      return createPageTabWithId(current.id, request.address);
    case "search":
      return createResultsTabWithId(current.id, request.query, config, request.mode);
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
      return createPageTab(serial, request.address);
    case "search":
      return createResultsTab(serial, request.query, config, request.mode);
  }
};
