# Provider register procedure

Audience: Internal
Status: Active
Last verified: 2026-08-06

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

The project region was verified as `us-west-2` through the authenticated
Supabase Management API on 2026-08-01. The authenticated organization
dashboard was reviewed on 2026-08-02 and states that the current DPA is
automatically incorporated into the Supabase Terms for every organization and
requires no separate signature. Record the current legal sources, not an old
download URL:

- DPA Version 1, dated 2026-08-01:
  <https://supabase.com/legal/customer-resources/data-processing-addendum>
- subprocessor register and update-subscription form:
  <https://supabase.com/legal/customer-resources/subprocessor-list>
- subprocessor list recorded for this review, dated 2026-06-01:
  <https://supabase.com/legal/subprocessor-list/June-1-2026.pdf>

The public regions list proves available choices, not the project's selected
region. Recheck the dashboard and legal pages for each release because the DPA
and subprocessor list can change.

Auth/profile changes also require RLS verification: exposed tables enable RLS,
authenticated users access only their own row unless an explicitly reviewed
service role is used, and anonymous/public clients cannot enumerate profiles.

## Cloudflare

The authenticated Cloudflare API was reviewed on 2026-08-02. The `lyra.ltd`
zone is active on the Free plan. `lyra-site` has persistent invocation logs at
10% head sampling, no traces, no Logpush, and no tail consumer; `lyra-docs` has
no observability configuration and no Logpush. Cloudflare's current Workers
documentation records three-day Workers Logs retention for the Free plan.

- Customer DPA Version 6.4, effective 2026-04-03:
  <https://www.cloudflare.com/cloudflare-customer-dpa/>
- current subprocessors:
  <https://www.cloudflare.com/gdpr/subprocessors/>
- Workers Logs retention and limits:
  <https://developers.cloudflare.com/workers/observability/logs/workers-logs/>

The DPA states that it forms part of the Self-Serve Subscription Agreement or
other Main Agreement. This account review does not create a custom region or
data-residency promise; recheck plan, settings, retention, DPA version, and
subprocessors for every release.

## Google OAuth

The authenticated Google Auth Platform project was reviewed again on 2026-08-06:

- project ID: `project-85aa0e03-d802-4ab5-8fd`;
- user type: External;
- publishing status: In production, with 1 user against the 100-user cap;
- one enabled web client, created 2026-07-11;
- authorized redirect URI:
  `https://jhpeihmmxfcwwodngybw.supabase.co/auth/v1/callback`;
- no separately configured sensitive or restricted scopes;
- application home, privacy-policy and terms links point to the public
  `lyra.ltd` pages;
- authorized domains contain `lyra.ltd` and the two current Supabase domains;
- Data Access shows no configured sensitive or restricted scopes.

Google still reports that the branding is not shown because the previous
verification attempt found stale home-page purpose/app-name issues. The live
home page now names Lyra and explains its purpose, so re-verification can be
requested; this provider approval is not represented as already granted.
Token revocation and account deletion remain rights-flow tests. Do not remove
the legacy Supabase authorized domain until its use has been separately
disproved.

## Skills discovery endpoints

The runtime source was audited on 2026-08-06 and fixes discovery/search calls
to `claude-plugins.dev`, `skills.sh`, `clawhub.ai`, and `api.clawhub.ai`.
Requests are made only after the user submits a Skills search or chooses an
installation; there is no background catalog query. No Lyra-specific DPA,
fixed processing region, or complete catalog-wide privacy policy is claimed.
The public register therefore tells users not to include personal or
confidential text in catalog searches and to review the selected source and
installed code. This is an accepted and disclosed Preview limitation, not a
provider certification.

## User-configured endpoints

Do not pretend Lyra controls a custom AI or MCP endpoint's region, retention, or
training policy. Label it user-configured, explain the categories Lyra sends,
and require the user/organization to evaluate that operator.

## Change triggers

Update the register when code adds a host, a provider changes policy, a new data
category is sent, a region/account setting changes, or an endpoint is removed.
An endpoint found in production code but absent from the register blocks legal
release.
