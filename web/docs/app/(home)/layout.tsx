import type { ReactNode } from "react";
import { HomeLayout } from "fumadocs-ui/layouts/home";

import { baseOptions } from "@/lib/layout.shared";

type HomeLayoutProps = {
  readonly children: ReactNode;
};

export default function Layout({ children }: HomeLayoutProps) {
  return (
    <HomeLayout
      {...baseOptions()}
      themeSwitch={{
        enabled: false
      }}
      i18n={false}
    >
      {children}
    </HomeLayout>
  );
}
