import type { Metadata } from "next";
import { HistoryPage } from "./content";

export const metadata: Metadata = {
  title: "Legal History",
  alternates: {
    canonical: "/legal/history/en-US",
    languages: {
      en: "/legal/history/en-US",
      "zh-CN": "/legal/history/zh-CN"
    }
  }
};

export default function LegacyHistoryPage() {
  return <HistoryPage locale="en-US" />;
}
