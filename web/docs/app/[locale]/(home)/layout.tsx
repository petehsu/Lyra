import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { HomeLayout } from "fumadocs-ui/layouts/home";

import { normalizeDocsLocale } from "@/lib/i18n";
import { baseOptions } from "@/lib/layout.shared";

type HomeLayoutProps = {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly locale: string }>;
};

export default async function Layout({ children, params }: HomeLayoutProps) {
  const locale = normalizeDocsLocale((await params).locale);
  if (locale === null) notFound();

  return (
    <HomeLayout
      {...baseOptions(locale)}
      themeSwitch={{
        enabled: false
      }}
      i18n={false}
    >
      {children}
    </HomeLayout>
  );
}
