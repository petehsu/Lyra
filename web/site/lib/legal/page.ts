import { notFound } from "next/navigation";
import type { LegalLocale } from "./types";

export type LegalLocalePageProps = {
  readonly params: Promise<{
    readonly locale: string;
  }>;
};

export const LEGAL_STATIC_PARAMS = [
  { locale: "en-US" },
  { locale: "zh-CN" }
] as const;

export async function localeFromRouteProps(
  props: LegalLocalePageProps
): Promise<LegalLocale> {
  const { locale } = await props.params;
  if (locale !== "en-US" && locale !== "zh-CN") {
    notFound();
  }
  return locale;
}
