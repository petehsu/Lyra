# Preview market and transfer review

Audience: Internal
Status: Active
Last verified: 2026-08-02
Release: Lyra Desktop `0.1.0-preview.1`

This record captures operator facts and current data routes. It is not a legal
opinion. A country is not approved for directed launch merely because the
website or a public GitHub asset can be reached there.

## Directed launch scope

- Named launch markets: United States, Canada, Japan, and Singapore.
- No active launch, advertising, local-market campaign, or behavior monitoring
  directed to mainland China, the EEA, or the United Kingdom for this Preview.
- “Other overseas markets” is a product intention, not a sufficiently precise
  compliance scope. Add each additional directed market to this review before
  targeting it.
- Lyra is a free Preview. The release has no first-party advertising, sale of
  personal data, data-broker activity, or first-party behavioral analytics.
- The Terms preserve non-waivable consumer rights and statutory venues.

## Current transfer routes

| Route | Lyra role and destination | Current release evidence | Publication status |
|---|---|---|---|
| Supabase authentication/profile | Lyra-selected project in `us-west-2`; the operator can access the project from China | Authenticated Management API region check; Supabase DPA Version 1 and current subprocessor register recorded | Provider review complete; production deletion test remains in the rights gate |
| Cloud AI/BYOK and custom endpoints | Requests leave the user's device directly for the provider or endpoint selected by the user; Lyra does not operate a model proxy or unified billing backend | Runtime adapters and provider register; provider account, region, training and retention remain user/provider controlled | User-configured; disclose before sending |
| Google OAuth | Google sign-in plus Supabase authentication | Authenticated review confirmed External/Testing, one enabled web client, the current Supabase callback, and no separately configured sensitive or restricted scopes; public branding URLs, `lyra.ltd`, Production publication, revocation and deletion testing remain | Pending |
| Cloudflare website/docs | Global edge delivery and redirect Worker; no Desktop model or workspace payload is proxied through it | Authenticated Free-plan account review, DPA Version 6.4, subprocessors, and Worker observability/log-retention configuration | Provider review complete |
| GitHub releases and language packs | Public component/application assets and signed language-pack assets | Fixed public repositories and embedded verification keys | Provider route verified; first production download remains a release smoke test |
| Skills catalogs | Fixed catalogs plus user-selected repositories/archives; installed code can reach destinations allowed by its actual execution path | Source inventory is not yet split into independently reviewed fixed catalogs | Pending |

## Market notes and official sources

- Canada: document accountability for processing outside Canada, contractual or
  other safeguards, and transparent notice of foreign processing. See the
  Office of the Privacy Commissioner of Canada's
  [cross-border processing guidance](https://www.priv.gc.ca/en/privacy-topics/airports-and-borders/gl_dab_090127/).
- Japan: reassess consent, information, and equivalent-protection requirements
  before a transfer to a foreign third party that is controlled by Lyra rather
  than selected directly by the user. See Japan's Personal Information
  Protection Commission
  [offshore transfer guidance](https://www.ppc.go.jp/personalinfo/legal/guidelines_offshore/).
- Singapore: maintain comparable protection for any Lyra-controlled overseas
  transfer. See the Personal Data Protection Commission's
  [Transfer Limitation Obligation](https://www.pdpc.gov.sg/data-protection-obligations).
- United States: no blanket conclusion is recorded for all states. Before paid
  release, advertising, sale/sharing, or material analytics, review the actual
  target states, thresholds, and opt-out duties.

## Gate decision

The EEA/UK representative decision is recorded as not currently required for
the stated no-directed-launch plan and must be reassessed if that plan changes.
The overall international-mechanisms gate remains pending until Google OAuth
and fixed Skills destinations are verified, the four named launch
markets have a final release-artifact review, and the privacy-rights workflow
has passed its production test.
