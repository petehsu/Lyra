import type { Metadata } from "next";
import { SiteHome } from "@/components/site-home";
import { getDictionary } from "@/lib/i18n";

export const metadata: Metadata = {
  alternates: {
    canonical: "/en",
    languages: {
      "zh-CN": "/zh",
      en: "/en"
    }
  }
};

export default function RootPage() {
  return <SiteHome locale="en" copy={getDictionary("en")} />;
}
