import type { Metadata } from "next";
import LicensesPage from "./[locale]/page";

export const metadata: Metadata = {
  title: "Third-party Notices",
  alternates: {
    canonical: "/legal/licenses/en-US",
    languages: {
      en: "/legal/licenses/en-US",
      "zh-CN": "/legal/licenses/zh-CN"
    }
  }
};

export default function LegacyLicensesPage() {
  return (
    <LicensesPage params={Promise.resolve({ locale: "en-US" })} />
  );
}
