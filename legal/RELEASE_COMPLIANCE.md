# Legal Release Readiness

Status: **effective legal version prepared; binary publication blocked by the
remaining rights-flow gate**
Owner: **徐远豪 (Pete Hsu), an individual developer in mainland China operating
under the Lyra name**
Last reviewed: **2026-08-06**

This is the engineering source of truth for whether the effective legal content
can accompany a binary publication. `pnpm legal:check` validates document
structure. `pnpm legal:release-check` must reject a binary release until every
release gate is complete.

Lyra's original code is proprietary. Third-party components keep their own
licenses and must be handled independently. This checklist is not a substitute
for advice from counsel familiar with every intended release market.

## Required publication metadata

- [x] Verify that the published personal mailbox
  `x13102306563@gmail.com` can receive privacy requests, is monitored, and has
  a documented fallback process.
- [x] Verify that the same personal mailbox can receive support requests and
  document when users should retry through the four personal channels listed
  in the official-site footer.
- [x] Record the complete legal-service address supplied by the operator. On
  2026-08-02 the operator confirmed that “Xinhua Village” is the complete name
  of the residential community, not an administrative village, and that this
  is the address used for parcel delivery.
- [x] Promote the reserved final terms and privacy version `1.0.0` for Lyra
  Desktop `0.1.0-preview.2`.
- [x] Set the effective date and publication date to 2026-08-06 at the
  operator's direction.
- [x] Complete and sign `legal/OPERATOR_LEGAL_RISK_REVIEW.md`, including a
  truthful record of whether independent counsel was obtained.
- [x] Replace every pending-only notice in the current terms and privacy text;
  `legal:release-check` rejects unresolved draft or release-review wording after
  status changes to `effective`.
- [x] Confirm that the English and Simplified Chinese versions have equal legal
  effect and exactly matching section IDs.

## Supabase and account rights

- [x] Record the named directed Preview markets as the United States, Canada,
  Japan, and Singapore; record that mainland China, the EEA, and the United
  Kingdom are not actively targeted. Treat any additional directed country as
  a new review item; see `docs/operations/preview-market-transfer-review.md`.

- [x] Confirm the production project's region through the authenticated
  Supabase Management API: project `jhpeihmmxfcwwodngybw`, region `us-west-2`,
  verified 2026-08-01.
- [x] Record Supabase DPA Version 1 dated 2026-08-01, which the authenticated
  organization dashboard confirms is automatically incorporated into the
  Terms for all organizations without a separate signature, and record the
  official subprocessor list dated 2026-06-01 (verified 2026-08-02).
- [x] Document the applicable international-transfer mechanism or explicit
  route limitation for every
  release market.
- [ ] Verify end to end the deployed signed-in cloud account deletion flow,
  and provide working channels for access,
  correction, objection, restriction, portability, and consent withdrawal.
- [x] Document the operator workflow for privacy-rights requests in
  `docs/operations/privacy-rights-requests.md`.
- [ ] Test the rights-request workflow, identity verification, response
  tracking, and deletion completion.
- [x] Reconfirm that profile access uses own-row RLS and that anonymous account
  enumeration remains removed (authenticated CLI/database audit, 2026-08-01).

## Operator legal-risk review required

Independent counsel is strongly recommended when affordable, especially before
wide international distribution. It is not a truthful release requirement to
claim that counsel reviewed Lyra when no such review occurred. The individual
operator must instead complete the written review template, resolve or accept
each residual risk, and keep the legal pages in `pending` until all objective
publication gates are complete.

- [x] Review the current per-turn Persona behavior, including inferred name,
  email, usernames, and age entering the selected model's context.
- [x] Review automatic login-form credential capture and local `safeStorage`
  encryption, including whether a separate save confirmation is required.
- [x] Review trusted UIUX packs as explicitly trusted Desktop code rather than
  a sandbox, including the activation acknowledgement and residual risk.
- [x] Resolve typed-query suggestion risk by disabling remote suggestion calls;
  only local history is searched until the user submits a search (2026-08-01).
- [x] Resolve public Nominatim risk by disabling the network integration and
  excluding coordinate labels from Agent model context (2026-08-01).
- [x] Replace passive use-only acceptance with a versioned startup click-through
  and local acceptance timestamp; version changes require confirmation again.
  Market-specific enforceability remains part of the operator review.
- [x] Determine whether an EEA or UK representative is required for the stated
  Preview launch plan. The operator will not actively direct distribution,
  marketing, local-language campaigns, support, or behavior monitoring to the
  EEA or UK, and must reassess before that changes.
- [x] Determine and record the applicable cross-border transfer mechanisms,
  notices, user-selected route limitations, and reassessment triggers for the
  four named Preview markets (2026-08-06).
- [x] Confirm the governing-law, consumer-rights, venue, liability-cap, age,
  acceptable-use, Agent automation, and third-party extension provisions.

## Third-party software and source obligations

Follow `docs/operations/copyleft-release.md` for the exact per-target archive,
relinking, publication, checksum, and verification procedure.

- [x] Make the exact corresponding source for the bundled darwin-x64 `aria2` binary
  available through a GPL-compliant delivery method.
- [x] For the currently shipped macOS darwin-x64 `aria2` bundle, collect and ship license,
  copyright, and source-offer material for every conda-forge package listed in
  each bundle's `manifest.json`.
- [x] Confirm no generated Bibata cursor artifact is present in the current
  Desktop build/release output. The vendored authoring source is not a staged
  component input; release checks must continue to reject accidental inclusion.
- [x] Complete GPL, LGPL, dynamic-library replacement, source-access, and
  corresponding-source material identified for the exact darwin-x64 release
  artifacts. Other targets remain blocked until their own assets exist.
- [ ] Keep Apache-2.0 notices for OpenAI Codex-derived code and the
  separately published Lyra Agent UI component.
- [ ] Keep MIT notices for JCode-derived compatibility code and the Pretext
  text-layout engine.
- [x] Run `pnpm legal:generate` for the exact release dependency graph.
- [x] Run `pnpm legal:notices:check` and confirm that
  `legal/generated/THIRD-PARTY-NOTICES.md` and
  `legal/generated/third-party-notices.json`, and
  `legal/generated/third-party-license-index.json` are current.
- [x] Confirm both localized `/legal/licenses/*` pages render the compact
  generated index, link the complete canonical notice asset, and have no
  hand-maintained web copy.

## Publication evidence

- [ ] Capture the release build identifier and hashes of the published terms,
  privacy policy, provider register, history, and notices.
- [ ] Capture evidence that the legal documents were available before use,
  readable without JavaScript, linked prominently, and printable.
- [ ] Capture the exact “use means acceptance” presentation used by the release.
- [ ] Verify mobile layout, keyboard navigation, language switching, headings,
  landmarks, and print output.
- [ ] Archive the provider register and each external provider policy reviewed
  for this release.
- [ ] Preserve the prior published legal version and its effective period in
  `/legal/history`.

The legal content has the operator-selected version and effective date. Binary
publication remains blocked until all release gates are complete; the status
alone does not make `legal:release-check` pass.
