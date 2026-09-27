import { FilmWebsitePreview } from "@/components/film-website-preview";
import { getDictionary } from "@/lib/i18n";

export const metadata = { robots: { index: false, follow: false } };
export default async function FilmPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const locale = params.locale === "zh" ? "zh" : "en";
  return <FilmWebsitePreview locale={locale} theme={params.theme === "dark" ? "dark" : "light"} copy={getDictionary(locale)} />;
}
