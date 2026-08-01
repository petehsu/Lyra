# Privacy-rights request handling

Audience: Internal
Status: Active
Last verified: 2026-08-02

This runbook defines the minimum operational path for requests concerning
access, correction, deletion, objection, restriction, portability, or consent
withdrawal. It does not prove that the mailbox works, grant access to a
provider dashboard, or replace market-specific legal advice.

## Intake and fallback

The primary intake address is `x13102306563@gmail.com`. It is a personal
mailbox operated by 徐远豪 (Pete Hsu), not a staffed privacy desk. Give each
request a locally generated case ID, record the received time and requested
right, and acknowledge receipt without asking the sender to repeat unnecessary
sensitive information.

If the sender reports that email is unavailable, accept the initial notice
through any personal contact channel published in the official-site footer.
Move the case to email as soon as practical, explain that no single channel is
guaranteed to be continuously monitored, and never request passwords, API
keys, model-provider secrets, or full authentication tokens.

## Identity and scope

Use the least intrusive information that can reasonably match the record. For
a Supabase account, start with the account email and ask the user to confirm
control through the normal sign-in or provider recovery path. Do not accept a
password, OAuth token, local credential-vault contents, workspace files, or an
identity document unless the operator has documented a necessity under the
applicable law and a proportionate secure handling process.

Separate the request into these scopes:

- cloud account/profile and Supabase authentication records;
- records held by a model, search, location, MCP, Skills, update, or language
  provider, which may require the provider's own process;
- local Lyra data, for which the operator can give deletion/export directions
  but normally cannot remotely access the user's device; and
- public correspondence or issue content the requester chose to publish.

## Case handling

1. Record the request in a restricted case log with case ID, dates, scope,
   verification method, actions, provider references, and final disposition.
2. Preserve only the evidence needed to demonstrate handling; never copy the
   user's prompts, files, passwords, precise location, or local Persona cache
   into the case log unless strictly necessary and approved.
3. For cloud deletion, confirm the production Supabase project and delete or
   anonymize the profile, authentication identity, and other linked first-party
   records using an operator-only path. Client applications must never receive
   a Supabase service-role key.
4. Tell the requester which third-party records Lyra cannot directly delete
   and provide the applicable provider request path from the provider register.
5. Record completion evidence without storing secrets. Send a concise outcome,
   any lawful limitation, and the route for follow-up.
6. Close the case only after a second review confirms that every in-scope
   first-party record was handled and no unrelated account was affected.

The internal service targets are to acknowledge a request within seven
calendar days and to aim for a substantive result within 30 calendar days.
These are operational targets, not a statement of the deadline required in
every jurisdiction; the operator must replace them when the applicable law or
qualified advice establishes a different period.

## Release verification

The production Supabase project currently has `delete-account` version 1 in
`ACTIVE` state with JWT verification enabled. On 2026-08-02 an unauthenticated
negative smoke test returned HTTP 401 before the function body ran. This proves
the deployed endpoint rejects a missing session; it does not prove successful
deletion, so the destructive path must still be tested with a dedicated
disposable account rather than the operator's primary account.

Before changing the legal content to `effective`, run an end-to-end test with a
dedicated production-like test account:

- send a request to the published mailbox and confirm receipt;
- exercise one fallback footer channel;
- verify account ownership without collecting a password or token;
- delete the test account and profile using the production operator path;
- confirm the user can no longer authenticate and that own-row profile reads
  return no record;
- verify local device data was not falsely represented as remotely deleted;
- archive a redacted case-log entry and completion response; and
- record the reviewer, date, Supabase project region, DPA, subprocessors, and
  provider-register version used for the test.

If any step cannot be completed, keep the legal release status `pending`.
