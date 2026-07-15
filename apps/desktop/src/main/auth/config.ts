export const SUPABASE_URL =
  process.env.LYRA_SUPABASE_URL?.trim()
  || import.meta.env?.VITE_LYRA_SUPABASE_URL?.trim()
  || "https://jhpeihmmxfcwwodngybw.supabase.co";

export const SUPABASE_ANON_KEY =
  process.env.LYRA_SUPABASE_ANON_KEY?.trim()
  || process.env.SUPABASE_ANON_KEY?.trim()
  || import.meta.env?.VITE_LYRA_SUPABASE_ANON_KEY?.trim()
  || "";

export const LYRA_AUTH_REDIRECT_URI = "lyra://auth/callback";
export const TERMS_URL = "https://lyra.ltd/legal/terms";
export const PRIVACY_URL = "https://lyra.ltd/legal/privacy";
