export type LanguageSearchEntry = {
  readonly locale: string;
  readonly nativeName: string;
  readonly displayName: string;
  readonly englishName: string;
  readonly aliases: readonly string[];
};

export const normalizeLanguageSearchText = (value: string): string =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\p{White_Space}\p{Punctuation}\p{Symbol}_]+/gu, "");

const tokenized = (value: string): readonly string[] =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .split(/[\p{White_Space}\p{Punctuation}\p{Symbol}_]+/gu)
    .filter(Boolean);

const isSubsequence = (needle: string, haystack: string): boolean => {
  let cursor = 0;
  for (const character of haystack) {
    if (character === needle[cursor]) {
      cursor += 1;
    }
    if (cursor === needle.length) {
      return true;
    }
  }
  return needle.length === 0;
};

const scoreCandidate = (entry: LanguageSearchEntry, query: string): number | null => {
  const normalizedQuery = normalizeLanguageSearchText(query);
  if (normalizedQuery.length === 0) {
    return 0;
  }
  const fields = [
    entry.locale,
    entry.nativeName,
    entry.displayName,
    entry.englishName,
    ...entry.aliases
  ];
  let best: number | null = null;
  for (const field of fields) {
    const normalized = normalizeLanguageSearchText(field);
    if (normalized === normalizedQuery) {
      best = Math.max(best ?? -Infinity, 1_000);
      continue;
    }
    if (normalized.startsWith(normalizedQuery)) {
      best = Math.max(best ?? -Infinity, 800 - normalized.length);
      continue;
    }
    if (normalized.includes(normalizedQuery)) {
      best = Math.max(best ?? -Infinity, 600 - normalized.indexOf(normalizedQuery));
      continue;
    }
    if (isSubsequence(normalizedQuery, normalized)) {
      best = Math.max(best ?? -Infinity, 300 - normalized.length);
    }
  }
  const queryTokens = tokenized(query);
  if (
    queryTokens.length > 1
    && queryTokens.every((token) =>
      fields.some((field) => normalizeLanguageSearchText(field).includes(normalizeLanguageSearchText(token)))
    )
  ) {
    best = Math.max(best ?? -Infinity, 700 - queryTokens.length);
  }
  return best;
};

export const searchLanguages = <T extends LanguageSearchEntry>(
  entries: readonly T[],
  query: string
): readonly T[] =>
  entries
    .map((entry) => ({ entry, score: scoreCandidate(entry, query) }))
    .filter((candidate): candidate is { readonly entry: T; readonly score: number } =>
      candidate.score !== null
    )
    .sort((left, right) =>
      right.score - left.score
      || left.entry.nativeName.localeCompare(right.entry.nativeName)
      || left.entry.locale.localeCompare(right.entry.locale)
    )
    .map(({ entry }) => entry);
