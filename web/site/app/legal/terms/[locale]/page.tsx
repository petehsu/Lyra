import type { Metadata } from "next";
import { TermsPage } from "../content";
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
    title: locale === "zh-CN" ? "用户协议" : "Terms of Use",
    alternates: {
      canonical: `/legal/terms/${locale}`,
      languages: {
        en: "/legal/terms/en-US",
        "zh-CN": "/legal/terms/zh-CN"
      }
    }
  };
}

export default async function LocalizedTermsPage(
  props: LegalLocalePageProps
) {
  const locale = await localeFromRouteProps(props);
  return <TermsPage locale={locale} />;
}
