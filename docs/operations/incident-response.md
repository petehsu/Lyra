# Security and privacy incident response

Audience: Internal
Status: Active
Last verified: 2026-07-28

An incident includes suspected disclosure, alteration, loss, unauthorized
access, malicious extension/provider behavior, credential exposure, unsafe
automation, compromised update artifacts, or a legal rights request missed by
normal handling.

## 1. Receive and preserve

- Open a restricted incident record with reporter, time, affected version,
  account/provider, device/platform, and initial evidence.
- Preserve relevant logs and artifacts without collecting unrelated workspace
  content or plaintext secrets.
- Record all handling and evidence hashes. Do not paste sensitive material into
  ordinary issue trackers or model prompts.

## 2. Triage

Classify:

- confidentiality, integrity, availability, safety, or legal/privacy;
- local-only, cloud/provider, update/distribution, extension, or mixed;
- data classes, people/organizations, regions, duration, and active exposure;
- credential/token/key rotation needs;
- whether automated Agent actions are still running.

Assign an incident lead and legal/privacy contact. If no verified external
contact channel exists, that is itself a release-blocking operational gap.

## 3. Contain

Use the narrowest reversible containment:

- revoke tokens/keys and terminate affected sessions;
- disable a compromised provider/source/update artifact through an approved
  release/configuration change;
- stop affected processes or automation;
- quarantine malicious packages/artifacts;
- preserve user work and avoid broad deletion.

Never silently alter user workspaces to contain a service-side incident.

## 4. Investigate and remediate

Reproduce from the frozen affected version. Identify the collection/entry
point, privilege boundary, persistence, onward recipients, and control failure.
Patch the root cause, add regression tests, update the data-flow/provider/license
records, and review similar paths.

## 5. Notify and recover

The operator must determine notification duties, recipients, timing,
authorities, and content under the applicable law, obtaining qualified advice
when available. Communications state verified facts, affected versions/data,
containment, user actions, and support/rights channels without speculation.
Publish corrected artifacts through the normal signed release path.

## 6. Close

Document timeline, root cause, impact, decisions, tests, residual risk, and
follow-up owners/dates. Update ADRs/runbooks when the failure exposed an
architectural or operational gap. Retain incident records according to the
approved legal schedule.
