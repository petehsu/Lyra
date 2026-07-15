# Legal Research Notes

This is an implementation note for the Lyra release process, not user-facing copy.

## Sources reviewed

- EU General Data Protection Regulation, especially Articles 13-14 (information notices), 15-21 (data-subject rights), and 22 (automated decision-making):
  https://eur-lex.europa.eu/eli/reg/2016/679/oj
- California Attorney General, California Consumer Privacy Act overview and consumer rights:
  https://oag.ca.gov/privacy/ccpa
- California Privacy Protection Agency, CCPA regulations and updates:
  https://cppa.ca.gov/regulations/
- Federal Trade Commission, privacy and security business guidance:
  https://www.ftc.gov/business-guidance/privacy-security
- Apache License 2.0:
  https://www.apache.org/licenses/LICENSE-2.0
- GNU GPL version 2 and the GNU GPL FAQ:
  https://www.gnu.org/licenses/old-licenses/gpl-2.0.html
  https://www.gnu.org/licenses/gpl-faq.html
- Cargo manifest license and license-file fields:
  https://doc.rust-lang.org/cargo/reference/manifest.html#the-license-and-license-file-fields
- GitHub guidance on repositories without a license:
  https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository

## How the draft applies the research

- The privacy page identifies the operator/contact, categories of data, purposes, recipients, retention, rights, international processing, children, and policy changes.
- The terms identify Lyra as proprietary commercial software and grant only a limited object-code license while preserving third-party open-source rights.
- The Git identity disclosure matches the current startup lookup: the local Git email is sent before sign-in and a successful match may return a display name and avatar URL.
- The draft does not claim that Lyra is compliant in every jurisdiction. It leaves the controller address, final jurisdiction, minimum age, provider regions, and deletion workflow for release confirmation.
- The draft avoids saying that Lyra trains on user content or stores prompts in Supabase because the current repository does not implement either behavior.
- The terms separate Lyra from user-selected AI providers and websites, and place human review around consequential agent actions.

## Release blockers

Do not treat the pages as final legal advice until the publication checklist in `README.md` is complete and a lawyer reviews the final operating entity, jurisdiction, age policy, provider list, data-retention commitments, commercial terms, and third-party source-code obligations.
