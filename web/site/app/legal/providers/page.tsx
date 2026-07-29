import type { Metadata } from "next";
import { ProvidersPage } from "./content";

export const metadata: Metadata = {
  title: "Provider Register",
  alternates: {
    canonical: "/legal/providers/en-US",
    languages: {
      en: "/legal/providers/en-US",
      "zh-CN": "/legal/providers/zh-CN"
    }
  }
};

export default function LegacyProvidersPage() {
  return <ProvidersPage locale="en-US" />;
}
