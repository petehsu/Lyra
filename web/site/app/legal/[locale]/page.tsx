import type { Metadata } from "next";
import { LegalOverviewPage } from "../content";
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
    title: locale === "zh-CN" ? "法律与信任中心" : "Legal and trust center",
    alternates: {
      canonical: `/legal/${locale}`,
      languages: {
        en: "/legal/en-US",
        "zh-CN": "/legal/zh-CN"
      }
    }
  };
}

export default async function LocalizedLegalOverviewPage(
  props: LegalLocalePageProps
) {
  const locale = await localeFromRouteProps(props);
  return <LegalOverviewPage locale={locale} />;
}
