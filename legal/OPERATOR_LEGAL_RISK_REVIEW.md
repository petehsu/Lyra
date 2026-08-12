# Operator Legal-Risk Review

Status: **signed conditionally — objective publication gates remain**
Operator: **徐远豪 (Pete Hsu)**
Product: **Lyra Desktop 0.1.0-preview.8**
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
- Cross-border transfer mechanisms and provider evidence: **Reviewed
  2026-08-06 for the United States, Canada, Japan, and Singapore. Supabase
  `us-west-2` and its DPA, Cloudflare's DPA/global edge route, Google OAuth's
  user-initiated global route, GitHub distribution, fixed user-triggered Skills
  endpoints, and user-selected AI/MCP/custom destinations are recorded in
  `docs/operations/preview-market-transfer-review.md`. Canada accountability
  and transparency, Japan consent/continuing-safeguard routes, Singapore
  comparable protection, and United States privacy/security limitations are
  recorded without claiming universal adequacy, one mechanism for every
  provider, or data residency.**
- Consumer-law limitations that remain mandatory: **The Terms preserve
  non-waivable rights and statutory venues in the consumer's residence. No
  liability exclusion or choice-of-law clause overrides mandatory consumer
  protection.**

## Final attestation

- Independent counsel obtained: **no**
- All disclosed residual risks accepted by operator: **yes. The operator also
  directed on 2026-08-06 that the Preview use version 1.0.0 with that day's
  effective date. The production cloud-deletion and rights-request workflow
  remains explicitly recorded as not end-to-end tested and is not represented
  as complete.**
- Terms/privacy version: **1.0.0**
- Effective date: **2026-08-06**
- Release build and commit: **The final workflow must emit and attach the
  build commit, legal-content hashes, asset hashes, and release identifiers;
  the current darwin-x64 Draft contains the signed candidate assets and
  copyleft evidence, but will be rebuilt after the installer visibility fix.**
- Operator legal name: **徐远豪**
- Signature: **徐远豪**
- Final publication instruction recorded: **2026-08-06**

The legal content metadata records the operator's requested effective version
and date. Artifact publication remains subject to the automated release gates;
an incomplete gate must not be relabeled as complete or removed to obtain a
passing result.
