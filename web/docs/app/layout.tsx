import type { ReactNode } from "react";
import { RootProvider } from "fumadocs-ui/provider/next";

import { RuntimeModeBridge } from "@/components/runtime-mode";
import { docsUiI18n } from "@/lib/i18n";
import { resolveServerLocale } from "@/lib/runtime-context";
import "./global.css";

type RootLayoutProps = {
  readonly children: ReactNode;
};

export default async function Layout({ children }: RootLayoutProps) {
  const locale = await resolveServerLocale();
  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider i18n={docsUiI18n.provider(locale)}>
          <RuntimeModeBridge />
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
