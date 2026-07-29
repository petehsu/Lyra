import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { RootProvider } from "fumadocs-ui/provider/next";

import { RuntimeModeBridge } from "@/components/runtime-mode";
import { StaticSearchDialog } from "@/components/static-search-dialog";
import {
  docsI18n,
  docsUiI18n,
  normalizeDocsLocale
} from "@/lib/i18n";
import "../global.css";

type LocaleLayoutProps = {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly locale: string }>;
};

export const metadata: Metadata = {
  metadataBase: new URL("https://docs.lyra.ltd"),
  title: {
    default: "Lyra Docs",
    template: "%s — Lyra Docs"
  },
  description: "Official user and developer documentation for Lyra.",
  icons: {
    icon: "/lyra-mark.svg"
  }
};

export const dynamicParams = false;

export function generateStaticParams() {
  return docsI18n.languages.map((locale) => ({ locale }));
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const locale = normalizeDocsLocale((await params).locale);
  if (locale === null) notFound();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider
          i18n={docsUiI18n.provider(locale)}
          search={{ SearchDialog: StaticSearchDialog }}
          theme={{ storageKey: "lyra.docs.theme" }}
        >
          <RuntimeModeBridge routeLocale={locale} />
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
