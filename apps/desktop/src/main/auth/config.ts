/**
 * Public Supabase client configuration.
 *
 * The anon (publishable) key is public by design — it is the same class of
 * credential as a Stripe publishable key or a Firebase web API key.  Security
 * is enforced by Row Level Security policies on the database, not by keeping
 * this key secret.  The service-role key must never appear in client code.
 *
 * Values are resolved in priority order:
 *   1. Runtime environment variable (allows overrides in dev/CI)
 *   2. Vite build-time variable (injected from .env during bundling)
 *   3. Hard-coded public default (the value already published in .env.example
 *      and in the Supabase dashboard — safe for client distribution)
 */
export const SUPABASE_URL =
  process.env.LYRA_SUPABASE_URL?.trim()
  || import.meta.env?.VITE_LYRA_SUPABASE_URL?.trim()
  || "https://jhpeihmmxfcwwodngybw.supabase.co";

export const SUPABASE_ANON_KEY =
  process.env.LYRA_SUPABASE_ANON_KEY?.trim()
  || process.env.SUPABASE_ANON_KEY?.trim()
  || import.meta.env?.VITE_LYRA_SUPABASE_ANON_KEY?.trim()
  || "sb_publishable_k9TdrnHlE8b9cRCd2VWvWA_uSvMxbal";

export const LYRA_AUTH_REDIRECT_URI = "lyra://auth/callback";
export const TERMS_URL = "https://lyra.ltd/legal/terms";
export const PRIVACY_URL = "https://lyra.ltd/legal/privacy";
