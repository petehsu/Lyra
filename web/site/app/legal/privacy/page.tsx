import type { Metadata } from "next";
import { PrivacyPage } from "./content";

export const metadata: Metadata = {
  title: "Privacy Policy",
  alternates: {
    canonical: "/legal/privacy/en-US",
    languages: {
      en: "/legal/privacy/en-US",
      "zh-CN": "/legal/privacy/zh-CN"
    }
  }
};

export default function LegacyPrivacyPage() {
  return <PrivacyPage locale="en-US" />;
}
