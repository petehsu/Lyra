# Operator Legal-Risk Review

Status: **signed conditionally — objective publication gates remain**
Operator: **徐远豪 (Pete Hsu)**
Product: **Lyra Desktop 0.1.0-preview.1**
Review date: **2026-08-02**

This is an operator publication record, not a legal opinion and not a claim
that a lawyer reviewed Lyra. Independent legal advice remains recommended when
available. The operator must complete this record using the exact release
artifacts, provider configuration, distribution markets, and product behavior.

## Evidence reviewed

- [ ] Final bilingual Terms and Privacy Policy version and hashes.
- [ ] Provider register, privacy data-flow audit, and rights-request runbook.
- [ ] Exact installer and application build used for publication.
- [ ] Consent and significant-notice screenshots for Persona, credential
  capture, UIUX trust, location, search suggestions, and agreement acceptance.
- [ ] Supabase project region, DPA/subprocessors, deletion test, and RLS audit.
  Region, DPA/subprocessors, and RLS were verified by 2026-08-02; the
  production end-to-end deletion test remains outstanding.
- [ ] GPL/LGPL corresponding-source and relinking package for each shipped
  target.

## Feature decisions

For each item, record `enabled`, `disabled`, or `changed`, the user control,
the disclosure location, test evidence, residual risk, and the operator's
decision.

### Persona identity inference

- Decision: **enabled only after an off-by-default user opt-in**
- Evidence and residual risk: schema-v1 consent defaults to disabled and records
  the grant time; Settings describes the OS, Git, SSH, npm/pip and editor
  signals, the inferred name/email/username/age, and transmission to the
  selected model. The control stops future collection when disabled. Residual
  risk remains that users may not anticipate every source clue, model-provider
  retention is provider-controlled, and cached or previously transmitted data
  is not erased merely by disabling future collection.
- Operator acceptance: **accepted 2026-08-02**

### Automatic credential capture

- Decision: **disabled by default; enabled only by an explicit Login Manager action**
- Evidence and residual risk: submitted credentials are ignored until capture
  is enabled; the Login Manager continuously displays capture status and its
  disclosure; captured passwords are stored as Electron `safeStorage`
  ciphertext and saving is disabled when encryption is unavailable. Residual
  risk remains that enabling capture covers subsequent supported form
  submissions until disabled, a compromised local OS account may defeat the OS
  key store, and website behavior can make form detection incomplete.
- Operator acceptance: **accepted 2026-08-02**

### Search suggestions while typing

- Decision: **remote suggestions disabled; local history only until submit**
- Evidence: titlebar navigation tests dated 2026-08-01.
- Residual risk: submitted searches still go to the user-selected destination.
- Operator acceptance: **accepted 2026-08-02**

### Precise location

- Decision: **public Nominatim disabled; coordinates local-only**
- Evidence: Desktop location service and Agent context tests dated 2026-08-01.
- Residual risk: operating-system location permission and local coordinate
  storage still require accurate disclosure and revocation behavior.
- Operator acceptance: **accepted 2026-08-02**

### Trusted UIUX code

- Decision: **external packs install untrusted and require explicit trusted-code acknowledgement before activation**
- Evidence and residual risk: the confirmation states that UIUX is not
  sandboxed and can use the full trusted Desktop UI API; the main process also
  rejects a trust request without that acknowledgement. Residual risk remains
  equivalent to running trusted application code: a malicious pack can access
  renderer-visible data and capabilities, and revocation cannot undo data
  already read or transmitted.
- Operator acceptance: **accepted 2026-08-02**

### Agreement acceptance

- Decision: **versioned startup click-through with local timestamp**
- Evidence: Desktop startup acceptance tests and legal version-match gate.
- Residual risk: the record is device-local rather than a server audit log;
  market-specific enforceability still depends on prominence and applicable law.
- Operator acceptance: **accepted 2026-08-02**

## Market and transfer review

- Intended release markets: **Preview release directed to the United States,
  Canada, Japan, Singapore, and other overseas markets outside the exclusions
  below.**
- Excluded markets: **No active distribution or marketing directed to mainland
  China, the EEA, or the United Kingdom for this Preview.**
- EEA representative conclusion and evidence: **No representative appointed
  for this Preview because Lyra will not actively offer or market it to people
  in the EEA. Reassess before any EEA-directed release, marketing, support, or
  behavior monitoring; this operational limitation is not a guarantee that EU
  law can never apply.**
- UK representative conclusion and evidence: **No representative appointed
  for this Preview on the same no-active-offering basis. Reassess before any
  UK-directed release, marketing, support, or behavior monitoring.**
- Cross-border transfer mechanisms and provider evidence: **Supabase DPA
  Version 1 incorporates the EU SCCs and UK Addendum where applicable. Other
  cloud models and user-configured endpoints remain provider- and
  configuration-specific and must be disclosed at selection/use; no universal
  transfer assurance is claimed. The factual launch-market and route matrix is
  maintained in `docs/operations/preview-market-transfer-review.md`; its
  remaining provider and production-test items keep the international gate
  pending.**
- Consumer-law limitations that remain mandatory: **The Terms preserve
  non-waivable rights and statutory venues in the consumer's residence. No
  liability exclusion or choice-of-law clause overrides mandatory consumer
  protection.**

## Final attestation

- Independent counsel obtained: **no**
- All unresolved risks accepted by operator: **yes, subject to completing the
  remaining objective publication gates before release**
- Terms/privacy version: **1.0.0 (fixed and represented as 1.0.0-draft only
  until the objective gates pass)**
- Effective date: **2026-08-02, conditional on publication on that date**
- Release build and commit: **pending final release artifact**
- Operator legal name: **徐远豪**
- Signature: **徐远豪**
- Date: **2026-08-02**

Do not change the legal content to `effective` until this attestation and every
objective item in `legal/RELEASE_COMPLIANCE.md` are complete.
