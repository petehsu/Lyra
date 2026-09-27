import type { SiteLocale } from "./i18n";

const toSiteLocale = (value: string): SiteLocale | null => {
  const language = value.toLowerCase().split(/[-_]/)[0];
  return language === "zh" || language === "en" ? language : null;
};

/** Startup snapshots must acknowledge the route before they can navigate it. */
export function createWorkbenchLocaleSync(routeLocale: SiteLocale) {
  let acknowledged = false;
  let previous = routeLocale;
  return (value: string): SiteLocale | null => {
    const next = toSiteLocale(value);
    if (next === null) return null;
    if (!acknowledged) {
      acknowledged = next === routeLocale;
      return null;
    }
    if (next === previous) return null;
    previous = next;
    return next;
  };
}
