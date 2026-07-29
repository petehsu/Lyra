import type { Metadata } from "next";
import { ProvidersPage } from "../content";
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
    title: locale === "zh-CN" ? "服务商登记表" : "Provider Register",
    alternates: {
      canonical: `/legal/providers/${locale}`,
      languages: {
        en: "/legal/providers/en-US",
        "zh-CN": "/legal/providers/zh-CN"
      }
    }
  };
}

export default async function LocalizedProvidersPage(
  props: LegalLocalePageProps
) {
  const locale = await localeFromRouteProps(props);
  return <ProvidersPage locale={locale} />;
}
