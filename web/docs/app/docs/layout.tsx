import type { ReactNode } from "react";
import { DocsLayout } from "fumadocs-ui/layouts/docs";

import { baseOptions } from "@/lib/layout.shared";
import { resolveServerLocale } from "@/lib/runtime-context";
import { source } from "@/lib/source";

type DocsLayoutProps = {
  readonly children: ReactNode;
};

export default async function Layout({ children }: DocsLayoutProps) {
  const locale = await resolveServerLocale();
  return (
    <DocsLayout
      tree={source.getPageTree(locale)}
      themeSwitch={{
        enabled: false
      }}
      i18n={false}
      {...baseOptions()}
    >
      {children}
    </DocsLayout>
  );
}
