import type { Rectangle, WebFrameMain } from "electron";

import { sanitizeBrowserPageRestoreState } from "../../../shared/workbench-browser";
import type {
  WorkbenchBrowserLayoutSnapshot,
  WorkbenchBrowserPageLayout,
  WorkbenchBrowserPageRuntimeState,
  WorkbenchBrowserPageSpec,
  WorkbenchBrowserSearchInPageMatch,
  WorkbenchBrowserSearchInPageRequest,
  WorkbenchBrowserTopologySnapshot,
  WorkbenchLumenTargetKind
} from "../../../shared/desktop-bridge";
import type {
  WorkbenchBrowserAgentElement,
  WorkbenchBrowserAgentVerification,
  WorkbenchBrowserFrameGlobalBounds,
  WorkbenchBrowserNativeInputEvent,
  WorkbenchBrowserSemanticActionCapability
} from "../types";
import type { BrowserAgentFrameOwnerCandidate } from "./types";

const DEFAULT_PAGE_TITLE = "New Tab";
const HIDDEN_PAGE_TOMBSTONE_DELAY_MS = 45_000;
const MAX_BROWSER_AGENT_FOLLOW_ACTIONS = 240;
const MAX_BROWSER_AGENT_FOLLOW_FRAMES = 320;
const MAX_BROWSER_PAGE_DIAGNOSTICS = 180;
const BROWSER_SESSION_STATE_KEY = "browser-session" as const;
const BROWSER_SESSION_SNAPSHOT_WRITE_DELAY_MS = 120;

const hashStableString = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const browserAgentTargetFingerprint = (
  pageUrl: string,
  element: Pick<
    WorkbenchBrowserAgentElement,
    | "frameTreeNodeId"
    | "tagName"
    | "role"
    | "label"
    | "selectorPreview"
    | "bounds"
    | "href"
    | "inputType"
    | "frameUrl"
    | "discoveryScope"
    | "hostChainFingerprint"
  >
): string => [
  element.frameUrl ?? pageUrl,
  element.frameTreeNodeId,
  element.tagName,
  element.role,
  element.label,
  element.selectorPreview,
  element.href ?? "",
  element.inputType ?? "",
  element.discoveryScope ?? "document",
  element.hostChainFingerprint ?? "",
  Math.round(element.bounds.x / 8),
  Math.round(element.bounds.y / 8),
  Math.round(element.bounds.width / 8),
  Math.round(element.bounds.height / 8)
].join("|");

const createBrowserAgentTargetRef = (
  pageUrl: string,
  element: Pick<
    WorkbenchBrowserAgentElement,
    | "frameTreeNodeId"
    | "tagName"
    | "role"
    | "label"
    | "selectorPreview"
    | "bounds"
    | "href"
    | "inputType"
    | "frameUrl"
    | "discoveryScope"
    | "hostChainFingerprint"
  >
): { readonly stableId: string; readonly targetRef: string; readonly elementFingerprint: string } => {
  const elementFingerprint = browserAgentTargetFingerprint(pageUrl, element);
  const stableId = hashStableString(elementFingerprint);
  return {
    stableId,
    targetRef: `lumen:${stableId}`,
    elementFingerprint
  };
};

const createBrowserAgentFrameRef = (
  frameTreeNodeId: number,
  url: string,
  parentFrameTreeNodeId?: number
): string =>
  `lumen-frame:${hashStableString([
    parentFrameTreeNodeId ?? "root",
    frameTreeNodeId,
    url
  ].join("|"))}`;

const browserAgentTargetKind = (
  element: Pick<WorkbenchBrowserAgentElement, "tagName" | "role" | "editable" | "discoveryScope">
): WorkbenchLumenTargetKind => {
  if (element.discoveryScope === "visual") {
    return "visual";
  }
  const role = element.role.toLowerCase();
  const tagName = element.tagName.toLowerCase();
  if (element.editable || tagName === "input" || tagName === "textarea" || role === "textbox" || role === "searchbox") {
    return "input";
  }
  if (tagName === "button" || role === "button") {
    return "button";
  }
  if (tagName === "a" || role === "link") {
    return "link";
  }
  if (role === "frame") {
    return "frame";
  }
  return "element";
};

const normalizeUnitCoverage = (value: number): number =>
  Math.max(0, Math.min(1, Number.isFinite(value) ? Number(value.toFixed(3)) : 0));

const coerceFrameBounds = (value: unknown): WorkbenchBrowserFrameGlobalBounds | null => {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const x = Number(record.x);
  const y = Number(record.y);
  const width = Number(record.width);
  const height = Number(record.height);
  if (
    Number.isFinite(x) === false
    || Number.isFinite(y) === false
    || Number.isFinite(width) === false
    || Number.isFinite(height) === false
    || width <= 0
    || height <= 0
  ) {
    return null;
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  };
};

const coerceElementVisibility = (
  value: unknown
): WorkbenchBrowserAgentElement["visibility"] | undefined => {
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return {
    visible: record.visible !== false,
    offscreen: record.offscreen === true,
    covered: record.covered === true,
    ariaHidden: record.ariaHidden === true
  };
};

const boundsCenter = (
  bounds: WorkbenchBrowserFrameGlobalBounds
): { readonly x: number; readonly y: number } => ({
  x: bounds.x + Math.round(bounds.width / 2),
  y: bounds.y + Math.round(bounds.height / 2)
});

const semanticNodeKeyForTarget = (
  targetRef: string,
  source: string,
  frameRef: string
): string => `semantic:${hashStableString([targetRef, source, frameRef].join("|"))}`;

const actionCapabilitiesForElement = (
  element: Pick<WorkbenchBrowserAgentElement, "role" | "tagName" | "editable" | "actionHint" | "stateHint" | "disabled">
): readonly WorkbenchBrowserSemanticActionCapability[] => {
  if (element.disabled) {
    return [];
  }
  const role = element.role.toLowerCase();
  const tagName = element.tagName.toLowerCase();
  const capabilities = new Set<WorkbenchBrowserSemanticActionCapability>();
  if (element.editable || role === "textbox" || role === "searchbox" || tagName === "input" || tagName === "textarea") {
    capabilities.add("type");
  }
  if (tagName === "select" || role === "combobox" || element.actionHint === "select") {
    capabilities.add("select");
  }
  if (role === "checkbox" || role === "switch" || tagName === "input" && element.actionHint === "check") {
    capabilities.add("check");
  }
  if (role === "button" || role === "link" || tagName === "button" || tagName === "a") {
    capabilities.add(role === "link" || tagName === "a" ? "open" : "click");
  }
  if (role === "menuitem") {
    capabilities.add("menuitem");
    capabilities.add("click");
  }
  if (element.actionHint?.startsWith("open") === true) {
    capabilities.add("open");
  }
  if (element.stateHint === "collapsed" || element.stateHint === "expanded" || element.actionHint === "expand") {
    capabilities.add("expand");
  }
  if (element.actionHint === "click" && capabilities.size === 0) {
    capabilities.add("click");
  }
  if (capabilities.size === 0) {
    capabilities.add("click");
  }
  return [...capabilities];
};

const buildBrowserAgentFrameOwnerProbeScript = (): string => `
  (() => {
    const normalizeText = (value, maxLength = 160) => {
      if (typeof value !== "string") return "";
      const normalized = value.replace(/\\s+/g, " ").trim();
      return normalized.length <= maxLength ? normalized : normalized.slice(0, maxLength - 3) + "...";
    };
    const selectorPreview = (element) => {
      const tagName = String(element.tagName || "iframe").toLowerCase();
      const parts = [tagName];
      const id = normalizeText(element.id || "", 40);
      if (id) parts.push("#" + id);
      const name = normalizeText(element.getAttribute?.("name") || "", 40);
      if (name) parts.push("[name=\\"" + name + "\\"]");
      const title = normalizeText(element.getAttribute?.("title") || "", 40);
      if (title) parts.push("[title=\\"" + title + "\\"]");
      return parts.join("").slice(0, 140);
    };
    const isVisible = (element) => {
      if (!(element instanceof Element) || !element.isConnected) return false;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = window.getComputedStyle(element);
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number.parseFloat(style.opacity || "1") > 0;
    };
    const absoluteUrl = (value) => {
      const text = normalizeText(value || "", 800);
      if (!text) return "";
      try {
        return new URL(text, String(window.location.href || "about:blank")).href;
      } catch (_error) {
        return text;
      }
    };
    const candidates = [];
    const crawl = (root, hostChain = []) => {
      for (const element of Array.from(root.querySelectorAll("iframe, frame"))) {
        const rect = element.getBoundingClientRect();
        candidates.push({
          index: candidates.length,
          sourceKind: String(element.tagName || "").toLowerCase() === "frame" ? "frame" : "iframe",
          name: normalizeText(element.getAttribute?.("name") || element.name || "", 120),
          src: absoluteUrl(element.getAttribute?.("src") || ""),
          title: normalizeText(element.getAttribute?.("title") || "", 120),
          selectorPreview: selectorPreview(element),
          bounds: {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          },
          visible: isVisible(element),
          hostChain
        });
      }
      for (const element of Array.from(root.querySelectorAll("*"))) {
        if (element.shadowRoot) {
          crawl(element.shadowRoot, [...hostChain, selectorPreview(element)]);
        }
      }
    };
    crawl(document);
    return {
      title: normalizeText(document.title || "", 200),
      url: normalizeText(String(window.location.href || ""), 800),
      viewport: {
        x: 0,
        y: 0,
        width: Math.max(1, Math.round(window.innerWidth || document.documentElement?.clientWidth || 1)),
        height: Math.max(1, Math.round(window.innerHeight || document.documentElement?.clientHeight || 1))
      },
      candidates
    };
  })()
`;

const coerceFrameOwnerCandidates = (value: unknown): {
  readonly viewport: WorkbenchBrowserFrameGlobalBounds | null;
  readonly candidates: readonly BrowserAgentFrameOwnerCandidate[];
} => {
  const record = value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
  const candidates = Array.isArray(record.candidates)
    ? record.candidates
        .map((entry): BrowserAgentFrameOwnerCandidate | null => {
          if (entry === null || typeof entry !== "object") {
            return null;
          }
          const candidate = entry as Record<string, unknown>;
          const bounds = coerceFrameBounds(candidate.bounds);
          if (bounds === null) {
            return null;
          }
          return {
            index: Number.isFinite(Number(candidate.index)) ? Math.round(Number(candidate.index)) : 0,
            sourceKind: candidate.sourceKind === "frame" ? "frame" : "iframe",
            name: typeof candidate.name === "string" ? candidate.name : "",
            src: typeof candidate.src === "string" ? candidate.src : "",
            title: typeof candidate.title === "string" ? candidate.title : "",
            selectorPreview: typeof candidate.selectorPreview === "string" ? candidate.selectorPreview : "iframe",
            bounds,
            visible: candidate.visible === true,
            hostChain: Array.isArray(candidate.hostChain)
              ? candidate.hostChain.filter((item): item is string => typeof item === "string" && item.length > 0)
              : []
          };
        })
        .filter((entry): entry is BrowserAgentFrameOwnerCandidate => entry !== null)
    : [];
  return {
    viewport: coerceFrameBounds(record.viewport),
    candidates
  };
};

const scoreFrameOwnerCandidate = (
  frame: WebFrameMain,
  candidate: BrowserAgentFrameOwnerCandidate,
  siblingOrdinal: number
): number => {
  let score = 0;
  const frameUrl = frame.url.trim();
  if (frameUrl.length > 0 && candidate.src.length > 0 && frameUrl === candidate.src) {
    score += 80;
  }
  if (frame.name.length > 0 && frame.name === candidate.name) {
    score += 60;
  }
  if (candidate.visible) {
    score += 20;
  }
  if (candidate.index === siblingOrdinal) {
    score += 18;
  }
  if (frameUrl.length > 0 && candidate.src.length > 0) {
    try {
      const frameOrigin = new URL(frameUrl).origin;
      const candidateOrigin = new URL(candidate.src).origin;
      if (frameOrigin === candidateOrigin) {
        score += 10;
      }
    } catch {
      // ignore non-standard frame URLs
    }
  }
  return score;
};

const matchFrameOwnerCandidates = (
  parentFrame: WebFrameMain,
  candidates: readonly BrowserAgentFrameOwnerCandidate[]
): ReadonlyMap<number, BrowserAgentFrameOwnerCandidate> => {
  const matches = new Map<number, BrowserAgentFrameOwnerCandidate>();
  const usedCandidateIndexes = new Set<number>();
  parentFrame.frames
    .filter((frame) => frame.isDestroyed() === false)
    .forEach((frame, siblingOrdinal) => {
      const ranked = candidates
        .filter((candidate) => usedCandidateIndexes.has(candidate.index) === false)
        .map((candidate) => ({
          candidate,
          score: scoreFrameOwnerCandidate(frame, candidate, siblingOrdinal)
        }))
        .sort((left, right) => right.score - left.score || left.candidate.index - right.candidate.index);
      const selected = ranked[0]?.candidate;
      if (selected !== undefined) {
        usedCandidateIndexes.add(selected.index);
        matches.set(frame.frameTreeNodeId, selected);
      }
    });
  return matches;
};

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeSearchText = (value: string, caseSensitive: boolean): string =>
  caseSensitive ? value : value.toLocaleLowerCase();

const buildSearchSnippet = (
  text: string,
  startChar: number,
  endChar: number
): string => {
  const snippetStart = Math.max(0, startChar - 90);
  const snippetEnd = Math.min(text.length, endChar + 90);
  const prefix = snippetStart > 0 ? "..." : "";
  const suffix = snippetEnd < text.length ? "..." : "";
  return `${prefix}${text.slice(snippetStart, snippetEnd)}${suffix}`
    .replace(/\s+/gu, " ")
    .trim();
};

const findSearchInPageMatches = (
  text: string,
  query: string,
  request: Pick<WorkbenchBrowserSearchInPageRequest, "caseSensitive" | "maxMatches">
): {
  readonly matches: readonly WorkbenchBrowserSearchInPageMatch[];
  readonly totalMatches: number;
  readonly truncated: boolean;
} => {
  const caseSensitive = request.caseSensitive === true;
  const maxMatches = Math.max(1, Math.min(100, Math.round(request.maxMatches ?? 20)));
  const haystack = normalizeSearchText(text, caseSensitive);
  const needle = normalizeSearchText(query, caseSensitive);
  const matches: WorkbenchBrowserSearchInPageMatch[] = [];
  let totalMatches = 0;
  let cursor = 0;
  while (needle.length > 0 && cursor <= haystack.length) {
    const index = haystack.indexOf(needle, cursor);
    if (index < 0) break;
    totalMatches += 1;
    const endChar = index + query.length;
    if (matches.length < maxMatches) {
      matches.push({
        id: `find-${hashStableString(`${query}|${totalMatches}|${index}|${endChar}`)}`,
        index: totalMatches,
        startChar: index,
        endChar,
        snippet: buildSearchSnippet(text, index, endChar)
      });
    }
    cursor = Math.max(index + needle.length, index + 1);
  }
  return {
    matches,
    totalMatches,
    truncated: totalMatches > matches.length
  };
};

type BrowserSemanticLocateCandidate = {
  readonly anchorQuery: string;
  readonly score: number;
  readonly reason: string;
};

const semanticLocateTokens = (value: string): readonly string[] => {
  const normalized = value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, " ")
    .trim();
  if (normalized.length === 0) {
    return [];
  }
  const words = normalized
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  const cjk = [...normalized.matchAll(/[\u4e00-\u9fff]{2,}/gu)]
    .flatMap((match) => {
      const text = match[0];
      const grams: string[] = [];
      for (let index = 0; index < text.length - 1; index += 1) {
        grams.push(text.slice(index, index + 2));
      }
      return grams;
    });
  return [...new Set([...words, ...cjk])].slice(0, 80);
};

const semanticLocateChunks = (text: string): readonly string[] => {
  const lines = text
    .split(/\n+/u)
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter((line) => line.length > 0);
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    const next = current.length === 0 ? line : `${current}\n${line}`;
    if (next.length > 800 && current.length >= 260) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks.length > 0 ? chunks : [text.replace(/\s+/gu, " ").trim()].filter(Boolean);
};

const fuzzySubsequence = (needle: string, haystack: string): boolean => {
  if (needle.length === 0) {
    return false;
  }
  let cursor = 0;
  for (const char of haystack) {
    if (char === needle[cursor]) {
      cursor += 1;
      if (cursor >= needle.length) {
        return true;
      }
    }
  }
  return false;
};

const semanticLocateAnchorFromChunk = (
  chunk: string,
  queryTokens: readonly string[]
): string => {
  const sentences = chunk
    .split(/(?<=[。！？.!?])\s+|\n+/u)
    .map((sentence) => sentence.replace(/\s+/gu, " ").trim())
    .filter((sentence) => sentence.length > 0);
  const candidates = sentences.length > 0 ? sentences : [chunk.replace(/\s+/gu, " ").trim()];
  const scored = candidates
    .map((candidate) => {
      const tokens = semanticLocateTokens(candidate);
      const overlap = queryTokens.filter((token) => tokens.includes(token)).length;
      return { candidate, overlap };
    })
    .sort((left, right) => right.overlap - left.overlap || left.candidate.length - right.candidate.length);
  const anchor = scored[0]?.candidate ?? chunk;
  return anchor.length <= 96 ? anchor : anchor.slice(0, 96).trim();
};

const selectSemanticLocateCandidate = (
  text: string,
  query: string
): BrowserSemanticLocateCandidate | null => {
  const queryTokens = semanticLocateTokens(query);
  if (queryTokens.length === 0) {
    return null;
  }
  const normalizedQuery = query.toLocaleLowerCase().trim();
  const scored = semanticLocateChunks(text)
    .map((chunk) => {
      const normalizedChunk = chunk.toLocaleLowerCase();
      const chunkTokens = semanticLocateTokens(chunk);
      const overlapCount = queryTokens.filter((token) => chunkTokens.includes(token)).length;
      const overlapScore = overlapCount / Math.max(1, queryTokens.length);
      const phraseBonus = normalizedChunk.includes(normalizedQuery) ? 0.45 : 0;
      const fuzzyBonus = queryTokens.some((token) => fuzzySubsequence(token, normalizedChunk)) ? 0.12 : 0;
      const shortBonus = chunk.length <= 420 ? 0.08 : 0;
      const score = overlapScore + phraseBonus + fuzzyBonus + shortBonus;
      return {
        chunk,
        score,
        reason:
          phraseBonus > 0
            ? "phrase-match"
            : overlapCount > 0 ? `token-overlap:${overlapCount}/${queryTokens.length}` : "fuzzy-overlap"
      };
    })
    .sort((left, right) => right.score - left.score);
  const best = scored[0];
  if (best === undefined || best.score < 0.34) {
    return null;
  }
  return {
    anchorQuery: semanticLocateAnchorFromChunk(best.chunk, queryTokens),
    score: Number(best.score.toFixed(3)),
    reason: best.reason
  };
};

const normalizeNumber = (value: unknown, fallback = 0): number => {
  if (typeof value !== "number" || Number.isFinite(value) === false) {
    return fallback;
  }
  return Math.round(value);
};

const normalizeAddress = (value: unknown): string | null => {
  let next = normalizeString(value);
  if (next === null) {
    return null;
  }
  if (next === "about:blank") {
    return "about:blank";
  }
  // Automatically prepend "http://" if a protocol/scheme is missing
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(next)) {
    next = "http://" + next;
  }
  try {
    const parsed = new URL(next);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:" && parsed.protocol !== "file:") {
      return null;
    }
    return parsed.toString();
  } catch (_error) {
    return null;
  }
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
  const translationHosts = new Set(["translate.google.com", "translate.google.cn"]);
  if (
    translationHosts.has(parsed.hostname)
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

const normalizeNavigationComparisonAddress = (value: unknown): string | null => {
  const address = normalizeAddress(value);
  if (address === null || address === "about:blank") {
    return address;
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

const areNavigationAddressesEquivalent = (left: unknown, right: unknown): boolean => {
  const normalizedLeft = normalizeAddress(left);
  const normalizedRight = normalizeAddress(right);
  if (normalizedLeft === null || normalizedRight === null) {
    return false;
  }
  if (normalizedLeft === normalizedRight) {
    return true;
  }
  return normalizeNavigationComparisonAddress(normalizedLeft) === normalizeNavigationComparisonAddress(normalizedRight);
};

const normalizeWebOrigin = (value: unknown): string | null => {
  const address = normalizeAddress(value);
  if (address === null) {
    return null;
  }
  try {
    const parsed = new URL(address);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.origin;
  } catch (_error) {
    return null;
  }
};

const normalizePageSpec = (value: unknown): WorkbenchBrowserPageSpec | null => {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const tabId = normalizeString(record.tabId);
  const address = normalizeAddress(record.address);
  if (tabId === null || address === null) {
    return null;
  }
  const restoreState = sanitizeBrowserPageRestoreState(record.restoreState);
  return {
    tabId,
    address,
    ...(normalizeString(record.titleHint) === null
      ? {}
      : { titleHint: normalizeString(record.titleHint)! }),
    ...(restoreState === undefined ? {} : { restoreState }),
    isActive: record.isActive === true
  };
};

const normalizeTopology = (value: unknown): WorkbenchBrowserTopologySnapshot => {
  if (value === null || typeof value !== "object") {
    return {
      activeTabId: null,
      pages: []
    };
  }
  const record = value as Record<string, unknown>;
  const pages = Array.isArray(record.pages)
    ? record.pages
        .map(normalizePageSpec)
        .filter((entry): entry is WorkbenchBrowserPageSpec => entry !== null)
    : [];
  const explicitActiveTabId = normalizeString(record.activeTabId);
  const activeTabId =
    explicitActiveTabId !== null && pages.some((page) => page.tabId === explicitActiveTabId)
      ? explicitActiveTabId
      : pages.find((page) => page.isActive)?.tabId ?? null;
  return {
    activeTabId,
    pages
  };
};

const normalizePageLayout = (value: unknown): WorkbenchBrowserPageLayout | null => {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const tabId = normalizeString(record.tabId);
  if (tabId === null) {
    return null;
  }
  const width = Math.max(0, normalizeNumber(record.width));
  const height = Math.max(0, normalizeNumber(record.height));
  return {
    tabId,
    x: normalizeNumber(record.x),
    y: normalizeNumber(record.y),
    width,
    height,
    visible: record.visible === true && width > 0 && height > 0,
    zIndex: normalizeNumber(record.zIndex),
    isFocusedPane: record.isFocusedPane === true
  };
};

const normalizeLayout = (value: unknown): WorkbenchBrowserLayoutSnapshot => {
  if (value === null || typeof value !== "object") {
    return {
      windowWidth: 0,
      windowHeight: 0,
      layouts: []
    };
  }
  const record = value as Record<string, unknown>;
  const layouts = Array.isArray(record.layouts)
    ? record.layouts
        .map(normalizePageLayout)
        .filter((entry): entry is WorkbenchBrowserPageLayout => entry !== null)
    : [];
  return {
    windowWidth: Math.max(0, normalizeNumber(record.windowWidth)),
    windowHeight: Math.max(0, normalizeNumber(record.windowHeight)),
    layouts
  };
};

const resolveBrowserCoreKey = (address: string): string => {
  try {
    const parsed = new URL(address);
    return `${parsed.protocol}//${parsed.host}`;
  } catch (_error) {
    return address;
  }
};

const toInitialRuntimeState = (spec: WorkbenchBrowserPageSpec): WorkbenchBrowserPageRuntimeState => ({
  tabId: spec.tabId,
  address: spec.address,
  title: spec.titleHint ?? DEFAULT_PAGE_TITLE,
  lifecycleState: spec.isActive ? "foreground" : "hot-hidden",
  coreKey: resolveBrowserCoreKey(spec.address),
  stateKey: `web-state:${spec.tabId}`,
  isTombstoned: false,
  isActive: spec.isActive,
  isVisible: false,
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  isHtmlFullscreen: false,
  ...(spec.restoreState === undefined ? {} : { restoreState: spec.restoreState }),
  updatedAt: Date.now()
});

const runtimeStateEquals = (
  left: WorkbenchBrowserPageRuntimeState,
  right: WorkbenchBrowserPageRuntimeState
): boolean =>
  left.tabId === right.tabId
  && left.address === right.address
  && left.title === right.title
  && left.faviconUrl === right.faviconUrl
  && left.lifecycleState === right.lifecycleState
  && left.coreKey === right.coreKey
  && left.stateKey === right.stateKey
  && left.isTombstoned === right.isTombstoned
  && left.restoreReason === right.restoreReason
  && left.isActive === right.isActive
  && left.isVisible === right.isVisible
  && left.isLoading === right.isLoading
  && left.canGoBack === right.canGoBack
  && left.canGoForward === right.canGoForward
  && left.isHtmlFullscreen === right.isHtmlFullscreen
  && JSON.stringify(left.restoreState ?? null) === JSON.stringify(right.restoreState ?? null)
  && JSON.stringify(left.recoveryFailure ?? null) === JSON.stringify(right.recoveryFailure ?? null);

const isSupportedWebUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (_error) {
    return false;
  }
};

const toBounds = (layout: WorkbenchBrowserPageLayout): Rectangle => ({
  x: layout.x,
  y: layout.y,
  width: Math.max(1, layout.width),
  height: Math.max(1, layout.height)
});

const delay = async (ms: number): Promise<void> => {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const normalizeExecuteScriptTimeoutMs = (value: unknown, fallback = 8_000): number => {
  if (typeof value !== "number" || Number.isFinite(value) === false) {
    return fallback;
  }
  return Math.max(250, Math.min(30_000, Math.round(value)));
};

const normalizeAgentVerification = (
  value: WorkbenchBrowserAgentVerification | undefined
): WorkbenchBrowserAgentVerification => {
  if (value === "full" || value === "fast") {
    return value;
  }
  return "none";
};

const runFrameScriptWithTimeout = async <T>(
  execute: () => Promise<T>,
  timeoutMs: number
): Promise<T> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      const error = new Error(`frame script timed out after ${timeoutMs}ms`) as Error & {
        readonly code?: string;
      };
      (error as { code: string }).code = "script_execution_timeout";
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([execute(), timeoutPromise]);
  } finally {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }
  }
};

const isScriptExecutionTimeout = (error: unknown): boolean =>
  error !== null
  && typeof error === "object"
  && (error as { readonly code?: unknown }).code === "script_execution_timeout";

const toNativeInputEvent = (event: WorkbenchBrowserNativeInputEvent):
  | Electron.MouseInputEvent
  | Electron.MouseWheelInputEvent
  | Electron.KeyboardInputEvent => {
  switch (event.type) {
    case "mouseMove":
    case "mouseDown":
    case "mouseUp":
      return {
        type: event.type,
        x: Math.round(event.x),
        y: Math.round(event.y),
        button: event.button ?? "left",
        clickCount: Math.max(1, Math.round(event.clickCount ?? 1))
      };
    case "keyDown":
    case "keyUp":
    case "char":
      return {
        type: event.type,
        keyCode: event.keyCode,
        modifiers: event.modifiers === undefined ? [] : [...event.modifiers]
      };
  }
};


export {
  BROWSER_SESSION_SNAPSHOT_WRITE_DELAY_MS,
  BROWSER_SESSION_STATE_KEY,
  DEFAULT_PAGE_TITLE,
  HIDDEN_PAGE_TOMBSTONE_DELAY_MS,
  MAX_BROWSER_AGENT_FOLLOW_ACTIONS,
  MAX_BROWSER_AGENT_FOLLOW_FRAMES,
  MAX_BROWSER_PAGE_DIAGNOSTICS,
  actionCapabilitiesForElement,
  areNavigationAddressesEquivalent,
  boundsCenter,
  browserAgentTargetFingerprint,
  browserAgentTargetKind,
  buildBrowserAgentFrameOwnerProbeScript,
  coerceElementVisibility,
  coerceFrameBounds,
  coerceFrameOwnerCandidates,
  createBrowserAgentFrameRef,
  createBrowserAgentTargetRef,
  delay,
  findSearchInPageMatches,
  hashStableString,
  isScriptExecutionTimeout,
  isSupportedWebUrl,
  matchFrameOwnerCandidates,
  normalizeAddress,
  normalizeAgentVerification,
  normalizeExecuteScriptTimeoutMs,
  normalizeLayout,
  normalizeNumber,
  normalizeSearchText,
  normalizeString,
  normalizeTopology,
  normalizeUnitCoverage,
  normalizeWebOrigin,
  resolveBrowserCoreKey,
  runFrameScriptWithTimeout,
  runtimeStateEquals,
  scoreFrameOwnerCandidate,
  selectSemanticLocateCandidate,
  semanticNodeKeyForTarget,
  toBounds,
  toInitialRuntimeState,
  toNativeInputEvent
};
export type { BrowserSemanticLocateCandidate };
