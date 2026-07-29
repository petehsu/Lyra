import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { DocsLayout } from "fumadocs-ui/layouts/docs";

import { normalizeDocsLocale } from "@/lib/i18n";
import { baseOptions } from "@/lib/layout.shared";
import { source } from "@/lib/source";

type DocsLayoutProps = {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly locale: string }>;
};

export default async function Layout({ children, params }: DocsLayoutProps) {
  const locale = normalizeDocsLocale((await params).locale);
  if (locale === null) notFound();

  return (
    <DocsLayout
      tree={source.getPageTree(locale)}
      themeSwitch={{
        enabled: false
      }}
      i18n={false}
      {...baseOptions(locale)}
    >
      {children}
    </DocsLayout>
  );
}
