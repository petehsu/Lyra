import { DataPracticeTable } from "@/components/legal/data-practice-table";
import { LegalContactDetails } from "@/components/legal/legal-contact-details";
import { LegalDocumentView } from "@/components/legal/legal-document";
import { LegalShell } from "@/components/legal/legal-shell";
import { localized, PRIVACY_DOCUMENT, type LegalLocale } from "@/lib/legal";

export function PrivacyPage({ locale }: { readonly locale: LegalLocale }) {
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
