# Legal Release Readiness

Status: **pending**
Owner: **徐远豪 (Pete Hsu), an individual developer in mainland China operating
under the Lyra name**
Last reviewed: **2026-07-28**

This is the engineering source of truth for whether the draft legal content can
be published as effective. `pnpm legal:check` validates the documents while
they are drafts. `pnpm legal:release-check` must reject a release until every
item below is complete and the legal content is switched from `pending` to
`effective`.

Lyra's original code is proprietary. Third-party components keep their own
licenses and must be handled independently. This checklist is not a substitute
for advice from counsel familiar with every intended release market.

## Required publication metadata

- [ ] Verify that the published personal mailbox
  `x13102306563@gmail.com` can receive privacy requests, is monitored, and has
  a documented fallback process.
- [ ] Verify that the same personal mailbox can receive support requests and
  document when users should retry through the four personal channels listed
  in the official-site footer.
- [ ] Add a complete legal-service address for the operator.
- [ ] Set the final terms and privacy version.
- [ ] Set the effective date and publication date.
- [ ] Record the lawyer's name, review date, and written sign-off.
- [ ] Replace every pending-only notice in the current terms and privacy text;
  `legal:release-check` rejects unresolved draft or release-review wording after
  status changes to `effective`.
- [ ] Confirm that the English and Simplified Chinese versions have equal legal
  effect and exactly matching section IDs.

## Supabase and account rights

- [ ] Confirm the production project's region in the Supabase Dashboard. Do not
  infer it from a hostname, latency, or a local configuration file.
- [ ] Record the applicable Supabase DPA and current subprocessor list.
- [ ] Document the applicable international-transfer mechanism for every
  release market.
- [ ] Provide and verify a working channel for cloud account deletion, access,
  correction, objection, restriction, portability, and consent withdrawal.
- [ ] Test the rights-request workflow, identity verification, response
  tracking, and deletion completion.
- [ ] Reconfirm that profile access uses own-row RLS and that anonymous account
  enumeration remains removed.

## Counsel review required

- [ ] Review the current per-turn Persona behavior, including inferred name,
  email, usernames, and age entering the selected model's context.
- [ ] Review automatic login-form credential capture and local `safeStorage`
  encryption, including whether a separate save confirmation is required.
- [ ] Review search suggestions that send typed queries to Google and Wikipedia.
- [ ] Review sending precise coordinates to the public Nominatim service and
  its prohibition on submitting personal or confidential data.
- [ ] Review reliance on “use means acceptance,” including the evidence,
  prominence, accessibility, and enforceability of the notice in each market.
- [ ] Determine whether an EEA or UK representative is required.
- [ ] Determine the applicable cross-border transfer mechanisms and notices.
- [ ] Confirm the governing-law, consumer-rights, venue, liability-cap, age,
  acceptable-use, Agent automation, and third-party extension provisions.

## Third-party software and source obligations

- [ ] Make the exact corresponding source for every bundled `aria2` binary
  available through a GPL-compliant delivery method.
- [ ] For the macOS and Linux `aria2` bundles, collect and ship license,
  copyright, and source-offer material for every conda-forge package listed in
  each bundle's `manifest.json`.
- [ ] Confirm whether a generated Bibata cursor artifact ships. If it does,
  satisfy GPL-3.0 distribution obligations; if it does not, remove unused
  vendored source from the release input.
- [ ] Complete every other GPL, LGPL, relinking, written-offer, and corresponding
  source obligation identified for the exact release artifacts.
- [ ] Keep Apache-2.0 notices for CodeGraph, OpenAI Codex-derived code, and the
  separately published Lyra Agent UI component.
- [ ] Keep MIT notices for JCode-derived compatibility code and the Pretext
  text-layout engine.
- [ ] Run `pnpm legal:generate` for the exact release dependency graph.
- [ ] Run `pnpm legal:notices:check` and confirm that
  `legal/generated/THIRD-PARTY-NOTICES.md` and
  `legal/generated/third-party-notices.json`, and
  `legal/generated/third-party-license-index.json` are current.
- [ ] Confirm both localized `/legal/licenses/*` pages render the compact
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

Only after all boxes are complete may the legal content status change to
`effective` and `legal:release-check` be expected to pass.
