import type { Metadata } from "next";
import { HistoryPage } from "../content";
import {
  LEGAL_STATIC_PARAMS,
  localeFromRouteProps,
  type LegalLocalePageProps
} from "@/lib/legal/page";

export const dynamicParams = false;

export function generateStaticParams() {
  return [...LEGAL_STATIC_PARAMS];
}

export async function generateMetadata(
  props: LegalLocalePageProps
): Promise<Metadata> {
  const locale = await localeFromRouteProps(props);
  return {
    title: locale === "zh-CN" ? "法律版本历史" : "Legal History",
    alternates: {
      canonical: `/legal/history/${locale}`,
      languages: {
        en: "/legal/history/en-US",
        "zh-CN": "/legal/history/zh-CN"
      }
    }
  };
}

export default async function LocalizedHistoryPage(
  props: LegalLocalePageProps
) {
  const locale = await localeFromRouteProps(props);
  return <HistoryPage locale={locale} />;
}
