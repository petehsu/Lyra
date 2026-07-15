# Lyra Legal Pages

This directory is a dependency-free static site for the public Lyra terms and privacy pages.

## Routes

- `/legal/terms`
- `/legal/privacy`
- `/legal/licenses`
- `/legal/` as the small index page when the directory is deployed directly

The pages use the browser language (`zh-CN` or `en-US`) by default and support `?lang=zh-CN` or `?lang=en-US`. A visitor can also switch language and theme without a framework runtime.

## Publication checklist

Before linking these pages from a public release:

1. Create and monitor `privacy@lyra.ltd` and `support@lyra.ltd`.
2. Confirm the developer/controller legal name and the governing-law jurisdiction.
3. Confirm the minimum age and whether the product will be offered to children.
4. Confirm the Supabase region, Google OAuth configuration, and the AI providers shown in the privacy notice.
5. Add a deletion path in the account settings or document the support-request process.
6. Confirm the governing law, dispute forum, consumer cancellation rules, and the legal terms for any paid plan, renewal, tax, or refund flow.
7. Complete the third-party release audit, including corresponding-source delivery for bundled GPL/LGPL components.
8. Review the final text with a lawyer familiar with the countries where Lyra will be offered.
9. Replace the version date if the actual public launch date changes.

The current text is intentionally specific to the repository implementation as of July 14, 2026. It is not a legal opinion and should not be presented as a guarantee of compliance in every jurisdiction.
