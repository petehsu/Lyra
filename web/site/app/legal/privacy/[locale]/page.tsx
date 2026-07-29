import type { Metadata } from "next";
import { PrivacyPage } from "../content";
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
    title: locale === "zh-CN" ? "隐私政策" : "Privacy Policy",
    alternates: {
      canonical: `/legal/privacy/${locale}`,
      languages: {
        en: "/legal/privacy/en-US",
        "zh-CN": "/legal/privacy/zh-CN"
      }
    }
  };
}

export default async function LocalizedPrivacyPage(
  props: LegalLocalePageProps
) {
  const locale = await localeFromRouteProps(props);
  return <PrivacyPage locale={locale} />;
}
