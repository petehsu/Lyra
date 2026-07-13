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

## How the draft applies the research

- The privacy page identifies the operator/contact, categories of data, purposes, recipients, retention, rights, international processing, children, and policy changes.
- The draft does not claim that Lyra is compliant in every jurisdiction. It leaves the controller address, final jurisdiction, minimum age, provider regions, and deletion workflow for release confirmation.
- The draft avoids saying that Lyra trains on user content or stores prompts in Supabase because the current repository does not implement either behavior.
- The terms separate Lyra from user-selected AI providers and websites, and place human review around consequential agent actions.

## Release blockers

Do not treat the pages as final legal advice until the publication checklist in `README.md` is complete and a lawyer reviews the final operating entity, jurisdiction, age policy, provider list, and data-retention commitments.
