# Provider register procedure

Audience: Internal
Status: Active
Last verified: 2026-07-28

Maintain the public provider register as structured legal content. This
runbook defines how to verify a record; it does not authorize guessing unknown
fields.

## Record fields

For each service or configurable provider class record:

- legal provider/operator name;
- product and purpose;
- data categories and source;
- endpoint or host pattern;
- processing/storage region, with evidence date;
- onward subprocessors;
- privacy policy and terms links;
- training/default retention policy;
- user configuration or opt-out controls;
- DPA/SCC/other transfer mechanism status where applicable;
- deletion/rights request path;
- Lyra owner, review date, and evidence link;
- status: verified, user-configured, pending, or removed.

The register covers Supabase, Google OAuth, each bundled AI route and custom
endpoint class, search/suggestion services, Nominatim, MCP, Skill catalogs and
sources, GitHub-hosted updates, and language packs.

## Verification

1. Start from runtime source to prove the endpoint and data sent.
2. Use the provider's official current documentation/dashboard.
3. Capture the date, account/project, and exact setting; do not rely on a
   marketing region list.
4. Have privacy/legal reviewers classify role, transfer, retention, training,
   and DPA status.
5. Update both locale renderings from one structured record.
6. Re-run legal structural and release checks.

## Supabase

The project region, DPA, and subprocessor configuration must be read from the
actual Supabase dashboard or an authenticated official API/CLI. The public
regions list proves available choices, not the project's selected region. Until
verified, keep the record and legal release status pending.

Auth/profile changes also require RLS verification: exposed tables enable RLS,
authenticated users access only their own row unless an explicitly reviewed
service role is used, and anonymous/public clients cannot enumerate profiles.

## User-configured endpoints

Do not pretend Lyra controls a custom AI or MCP endpoint's region, retention, or
training policy. Label it user-configured, explain the categories Lyra sends,
and require the user/organization to evaluate that operator.

## Change triggers

Update the register when code adds a host, a provider changes policy, a new data
category is sent, a region/account setting changes, or an endpoint is removed.
An endpoint found in production code but absent from the register blocks legal
release.

