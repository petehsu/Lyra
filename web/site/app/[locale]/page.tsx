import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteHome } from "@/components/site-home";
import { getDictionary, isSiteLocale, SITE_LOCALES } from "@/lib/i18n";

type PageProps = {
  readonly params: Promise<{ readonly locale: string }>;
};

export const generateStaticParams = () =>
  SITE_LOCALES.map((locale) => ({ locale }));

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isSiteLocale(locale)) return {};
  const copy = getDictionary(locale);
  return {
    title: copy.metadata.title,
    description: copy.metadata.description,
    alternates: {
      canonical: `/${locale}`,
      languages: {
        "zh-CN": "/zh",
        en: "/en"
      }
    }
  };
}

export default async function LocalePage({ params }: PageProps) {
  const { locale } = await params;
  if (!isSiteLocale(locale)) notFound();
  return <SiteHome locale={locale} copy={getDictionary(locale)} />;
}
