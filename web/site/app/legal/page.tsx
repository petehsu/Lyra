import type { Metadata } from "next";
import { LegalOverviewPage } from "./content";

export const metadata: Metadata = {
  title: "Legal overview",
  alternates: {
    canonical: "/legal/en-US",
    languages: {
      en: "/legal/en-US",
      "zh-CN": "/legal/zh-CN"
    }
  }
};

export default function LegacyLegalOverviewPage() {
  return <LegalOverviewPage locale="en-US" />;
}
