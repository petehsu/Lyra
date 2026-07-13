import type {
  InstalledLanguagePack,
  LanguagePackCatalogResponse
} from "../../shared/language-packs";

export const BUILTIN_STARTUP_LOCALES = ["zh-CN", "en-US"] as const;

const canonicalize = (value: string): string | null => {
  try {
    return Intl.getCanonicalLocales(value.trim())[0] ?? null;
  } catch {
    return null;
  }
};

const matchesLocale = (requested: string, candidate: string, aliases: readonly string[] = []): boolean => {
  const request = requested.toLowerCase();
  const normalizedCandidate = candidate.toLowerCase();
  return request === normalizedCandidate
    || request.split("-")[0] === normalizedCandidate.split("-")[0]
    || aliases.some((alias) => alias.toLowerCase() === request);
};

export type StartupLocaleResolution = {
  readonly locale: string;
  readonly downloadedLocale?: string;
};

export const resolveStartupLocale = async (params: {
  readonly requestedLocale: string;
  readonly installed: readonly InstalledLanguagePack[];
  readonly catalog: LanguagePackCatalogResponse;
  readonly install: (locale: string) => Promise<unknown>;
}): Promise<StartupLocaleResolution> => {
  const requested = canonicalize(params.requestedLocale) ?? "en-US";
  const builtin = BUILTIN_STARTUP_LOCALES.find((locale) => matchesLocale(requested, locale));
  if (builtin !== undefined) {
    return { locale: builtin };
  }

  const installed = params.installed.find((pack) => matchesLocale(requested, pack.locale));
  if (installed !== undefined) {
    return { locale: installed.locale };
  }

  const catalogEntry = params.catalog.packs.find((pack) =>
    matchesLocale(requested, pack.locale, pack.aliases)
  );
  if (catalogEntry !== undefined) {
    try {
      await params.install(catalogEntry.locale);
      return {
        locale: catalogEntry.locale,
        downloadedLocale: catalogEntry.locale
      };
    } catch {
      // The signed pack service already rejects invalid or unavailable packs.
    }
  }

  return { locale: "en-US" };
};
