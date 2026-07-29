import type { Metadata } from "next";
import { TermsPage } from "./content";

export const metadata: Metadata = {
  title: "Terms of Use",
  alternates: {
    canonical: "/legal/terms/en-US",
    languages: {
      en: "/legal/terms/en-US",
      "zh-CN": "/legal/terms/zh-CN"
    }
  }
};

export default function LegacyTermsPage() {
  return <TermsPage locale="en-US" />;
}
