import type { Metadata } from "next";
import { DataPracticeTable } from "@/components/legal/data-practice-table";
import { LegalContactDetails } from "@/components/legal/legal-contact-details";
import { LegalDocumentView } from "@/components/legal/legal-document";
import { LegalShell } from "@/components/legal/legal-shell";
import { localized, PRIVACY_DOCUMENT } from "@/lib/legal";
import {
  localeFromPageProps,
  type LegalPageProps
} from "@/lib/legal/page";

export const metadata: Metadata = {
  title: "Privacy Policy",
  alternates: {
    canonical: "/legal/privacy",
    languages: {
      en: "/legal/privacy?lang=en-US",
      "zh-CN": "/legal/privacy?lang=zh-CN"
    }
  }
};

export default async function PrivacyPage(props: LegalPageProps) {
  const locale = await localeFromPageProps(props);
  return (
    <LegalShell
      locale={locale}
      currentPath="/legal/privacy"
      title={localized(PRIVACY_DOCUMENT.title, locale)}
      description={localized(PRIVACY_DOCUMENT.description, locale)}
    >
      <LegalDocumentView
        document={PRIVACY_DOCUMENT}
        locale={locale}
        insertAfterSections={[
          {
            id: "data-inventory",
            content: <DataPracticeTable locale={locale} />
          },
          {
            id: "rights-and-choices",
            content: (
              <LegalContactDetails
                locale={locale}
                variant="privacy"
              />
            )
          }
        ]}
      />
    </LegalShell>
  );
}
