import { LegalContactDetails } from "@/components/legal/legal-contact-details";
import { LegalDocumentView } from "@/components/legal/legal-document";
import { LegalShell } from "@/components/legal/legal-shell";
import { localized, TERMS_DOCUMENT, type LegalLocale } from "@/lib/legal";

export function TermsPage({ locale }: { readonly locale: LegalLocale }) {
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
