import type { Metadata } from "next";
import { LegalContactDetails } from "@/components/legal/legal-contact-details";
import { LegalDocumentView } from "@/components/legal/legal-document";
import { LegalShell } from "@/components/legal/legal-shell";
import { localized, TERMS_DOCUMENT } from "@/lib/legal";
import {
  localeFromPageProps,
  type LegalPageProps
} from "@/lib/legal/page";

export const metadata: Metadata = {
  title: "Terms of Use",
  alternates: {
    canonical: "/legal/terms",
    languages: {
      en: "/legal/terms?lang=en-US",
      "zh-CN": "/legal/terms?lang=zh-CN"
    }
  }
};

export default async function TermsPage(props: LegalPageProps) {
  const locale = await localeFromPageProps(props);
  return (
    <LegalShell
      locale={locale}
      currentPath="/legal/terms"
      title={localized(TERMS_DOCUMENT.title, locale)}
      description={localized(TERMS_DOCUMENT.description, locale)}
    >
      <LegalDocumentView
        document={TERMS_DOCUMENT}
        locale={locale}
        insertAfterSections={[
          {
            id: "agreement-changes-and-contact",
            content: (
              <LegalContactDetails
                locale={locale}
                variant="terms"
              />
            )
          }
        ]}
      />
    </LegalShell>
  );
}
