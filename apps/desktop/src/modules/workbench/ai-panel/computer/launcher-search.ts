import { pinyin } from "pinyin-pro";

import type {
  AiComputerAppKind,
  AiComputerAppInstance
} from "../../../../shared/desktop-bridge";

type LauncherAppKind = Exclude<AiComputerAppKind, "desktop">;

export type LauncherSearchItem = {
  readonly kind: LauncherAppKind;
  readonly label: string;
  readonly targetApp: AiComputerAppInstance | null;
  readonly keywords?: readonly string[];
};

const CJK_PATTERN = /[\u3400-\u9fff]/;
const SEARCH_TEXT_CACHE = new Map<string, readonly string[]>();

export const normalizeLauncherSearchText = (value: string): string =>
  value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s`~!@#$%^&*()\-_=+[{\]}\\|;:'",<.>/?]+/g, "");

const buildPinyinTokens = (value: string): readonly string[] => {
  if (!CJK_PATTERN.test(value)) {
    return [];
  }

  const plain = pinyin(value, {
    toneType: "none"
  });
  const normalizedPlain = normalizeLauncherSearchText(plain);
  const syllables = plain
    .toLocaleLowerCase()
    .split(/[\s-]+/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const initials = normalizeLauncherSearchText(
    syllables.map((entry) => entry[0] ?? "").join("")
  );

  const tokens = new Set<string>();
  if (normalizedPlain.length > 0) {
    tokens.add(normalizedPlain);
  }
  if (initials.length > 1) {
    tokens.add(initials);
  }
  return [...tokens];
};

const resolveSearchTokensForText = (value: string): readonly string[] => {
  const cached = SEARCH_TEXT_CACHE.get(value);
  if (cached !== undefined) {
    return cached;
  }

  const normalizedValue = normalizeLauncherSearchText(value);
  const tokens = new Set<string>();
  if (normalizedValue.length > 0) {
    tokens.add(normalizedValue);
  }
  for (const token of buildPinyinTokens(value)) {
    tokens.add(token);
  }

  const next = [...tokens];
  SEARCH_TEXT_CACHE.set(value, next);
  return next;
};

const computeFuzzySubsequenceScore = (query: string, candidate: string): number | null => {
  if (query.length === 0 || candidate.length === 0) {
    return null;
  }

  const directIndex = candidate.indexOf(query);
  if (directIndex >= 0) {
    return 2_000 - directIndex * 8 - (candidate.length - query.length);
  }

  let queryIndex = 0;
  let firstMatchIndex = -1;
  let lastMatchIndex = -1;

  for (let candidateIndex = 0; candidateIndex < candidate.length; candidateIndex += 1) {
    if (candidate[candidateIndex] !== query[queryIndex]) {
      continue;
    }
    if (firstMatchIndex < 0) {
      firstMatchIndex = candidateIndex;
    }
    lastMatchIndex = candidateIndex;
    queryIndex += 1;
    if (queryIndex === query.length) {
      break;
    }
  }

  if (queryIndex < query.length || firstMatchIndex < 0 || lastMatchIndex < 0) {
    return null;
  }

  const span = lastMatchIndex - firstMatchIndex + 1;
  const gaps = span - query.length;
  const prefixBonus = firstMatchIndex === 0 ? 220 : 0;
  return 1_200 + prefixBonus - gaps * 10 - firstMatchIndex * 3;
};

const resolveLauncherSearchScore = (
  query: string,
  searchTokens: readonly string[]
): number | null => {
  let maxScore: number | null = null;
  for (const token of searchTokens) {
    const score = computeFuzzySubsequenceScore(query, token);
    if (score === null) {
      continue;
    }
    if (maxScore === null || score > maxScore) {
      maxScore = score;
    }
  }
  return maxScore;
};

const buildItemSearchTokens = (item: LauncherSearchItem): readonly string[] => {
  const sourceValues = [
    item.label,
    item.kind,
    ...(item.keywords ?? [])
  ];
  const tokens = new Set<string>();
  for (const value of sourceValues) {
    for (const token of resolveSearchTokensForText(value)) {
      tokens.add(token);
    }
  }
  return [...tokens];
};

export const filterLauncherSearchItems = (
  query: string,
  items: readonly LauncherSearchItem[]
): LauncherSearchItem[] => {
  const normalizedQuery = normalizeLauncherSearchText(query.trim());
  const indexedItems = items.map((item) => ({
    item,
    searchTokens: buildItemSearchTokens(item)
  }));

  if (normalizedQuery.length === 0) {
    return indexedItems.map(({ item }) => item);
  }

  return indexedItems
    .map(({ item, searchTokens }) => ({
      item,
      score: resolveLauncherSearchScore(normalizedQuery, searchTokens)
    }))
    .filter((entry) => entry.score !== null)
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
    .map(({ item }) => item);
};

