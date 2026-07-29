import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import type { DocsLocale } from "./i18n";
import { appName } from "./shared";

export function baseOptions(locale: DocsLocale): BaseLayoutProps {
  return {
    nav: {
      title: appName,
      url: `/${locale}`
    }
  };
}
