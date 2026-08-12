# Preview market and transfer review

Audience: Internal
Status: Active
Last verified: 2026-08-06
Release: Lyra Desktop `0.1.0-preview.8`

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
| Google OAuth | User-initiated Google sign-in plus Supabase authentication; Google controls global processing | Authenticated review on 2026-08-06 confirmed External/In production, 1/100 users, public home/privacy/terms URLs, `lyra.ltd` and the two current Supabase authorized domains, and no sensitive or restricted scopes | Data route review complete; Google branding re-verification and account deletion remain separate approval/rights items |
| Cloudflare website/docs | Global edge delivery and redirect Worker; no Desktop model or workspace payload is proxied through it | Authenticated Free-plan account review, DPA Version 6.4, subprocessors, and Worker observability/log-retention configuration | Provider review complete |
| GitHub releases and language packs | Public component/application assets and signed language-pack assets | Fixed public repositories and embedded verification keys | Provider route verified; first production download remains a release smoke test |
| Skills catalogs | Fixed `claude-plugins.dev`, `skills.sh`, `clawhub.ai`/`api.clawhub.ai` discovery endpoints plus user-selected repositories/archives | Code audit confirms calls occur only after a submitted Skills search or installation choice; the public register warns against personal/confidential queries and makes no DPA, region, or catalog-wide privacy promise | Reviewed and accepted for Preview with explicit limitations; installed Skill behavior remains source-specific |

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
  target states, thresholds, and opt-out duties. The current free Preview must
  honor its published privacy promises and maintain reasonable security; see
  the US Federal Trade Commission's
  [privacy and security guidance](https://www.ftc.gov/business-guidance/privacy-security).

## Release decision by market

| Market | Lyra-controlled route decision | User-selected route decision | Required operating limitation |
|---|---|---|---|
| United States | Supabase `us-west-2`, Cloudflare and Google routes are disclosed; no sale, sharing, ads or first-party behavioral analytics is represented | Provider/account terms and settings govern AI, MCP and custom endpoints | Reassess state thresholds before monetization, advertising, sale/sharing or material analytics |
| Canada | Foreign processing is disclosed; the operator remains accountable and relies on provider contracts/published safeguards plus security controls | The user chooses the provider and receives category/recipient warnings before use | Keep foreign-processing notice accurate and honor access/correction/deletion requests through the published channel |
| Japan | Google login is affirmative; optional providers/endpoints require a user choice; Supabase/provider safeguards and foreign locations are disclosed | Do not send data when the user has not selected the foreign destination or where required information/consent is unavailable | Reassess any background or newly Lyra-controlled foreign recipient before enabling it |
| Singapore | Supabase/Cloudflare contractual safeguards and published controls are recorded; optional routes are user-triggered and disclosed | The user or organization must review the chosen account/endpoint's comparable protection and transfer settings | Do not claim comparable protection for an unreviewed custom endpoint or catalog |

## Gate decision

The EEA/UK representative decision is recorded as not currently required for
the stated no-directed-launch plan and must be reassessed if that plan changes.
The four-market route review is complete as a factual operator record, not a
legal opinion or universal-compliance claim. Google branding approval and the
production privacy-rights test remain separate release items and do not change
the recorded location or transfer character of the reviewed routes.
