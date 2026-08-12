# Authentication architecture

Audience: Internal
Status: Active
Last verified: 2026-07-28

Lyra account sign-in uses Google OAuth through Supabase Auth. Local mode does
not require a cloud account. Authentication is distinct from model-provider
credentials and from browser login-manager credentials.

## Cloud path

1. Desktop requests a Google OAuth URL from Supabase.
2. The system browser completes the provider flow.
3. The operating system sends the authorization result back to the registered
   `lyra://auth/callback` protocol handler.
4. Desktop exchanges it for a Supabase session.
5. Profile fields are read from the authenticated user's `profiles` row.

The profile includes display/avatar metadata, locale preference, theme
preference, onboarding state, and account identifiers. Database access must
remain protected by RLS policies scoped to `auth.uid()`.

## Local storage

- `~/.lyra/auth/session.json` contains a `safeStorage`-encrypted Supabase
  session envelope.
- `~/.lyra/auth/local-identity.json` contains an encrypted cache of the most
  recently matched account identity.
- Logging out removes the stored session. It does not currently erase every
  cloud profile row or the local identity cache.

Local identity matching compares the current Git email to the encrypted cached
account email. It does not enumerate anonymous Supabase accounts. The security
migration under `supabase/migrations` is the database source of truth for the
current profile boundary.

## Operational rules

- Never log OAuth codes, access tokens, refresh tokens, anon keys beyond their
  intended public role, or full auth callback URLs.
- Do not infer the Supabase project region. Record it only after dashboard
  verification using the [provider procedure](../operations/provider-register.md).
- A release cannot claim self-service cloud deletion until that workflow and
  rights-request channel exist.
- Auth changes require a current Supabase security review, RLS tests, and
  updates to the privacy data-flow audit.
