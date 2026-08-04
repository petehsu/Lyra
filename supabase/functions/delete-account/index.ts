import { createClient } from "npm:@supabase/supabase-js@2";

type DeleteRequest = {
  readonly confirmUserId?: unknown;
};

const json = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store"
    }
  });

const readDefaultKey = (modernName: string, legacyName: string): string | null => {
  const modern = Deno.env.get(modernName);
  if (modern !== undefined) {
    try {
      const parsed = JSON.parse(modern) as Record<string, unknown>;
      const value = parsed.default;
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    } catch {
      return null;
    }
  }
  const legacy = Deno.env.get(legacyName);
  return legacy === undefined || legacy.length === 0 ? null : legacy;
};

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== "POST") {
    return json(405, { error: "Method not allowed." });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const publishableKey = readDefaultKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
  const secretKey = readDefaultKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/iu)?.[1];
  if (url === undefined || publishableKey === null || secretKey === null) {
    return json(503, { error: "Account deletion is not configured." });
  }
  if (token === undefined) {
    return json(401, { error: "A signed-in session is required." });
  }

  let payload: DeleteRequest;
  try {
    payload = await request.json() as DeleteRequest;
  } catch {
    return json(400, { error: "Invalid request body." });
  }

  const userClient = createClient(url, publishableKey, {
    global: { headers: { authorization: `Bearer ${token}` } },
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError !== null || userData.user === null) {
    return json(401, { error: "The signed-in session could not be verified." });
  }
  if (payload.confirmUserId !== userData.user.id) {
    return json(400, { error: "Account deletion confirmation did not match the signed-in user." });
  }

  const adminClient = createClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  });
  const { error: deleteError } = await adminClient.auth.admin.deleteUser(
    userData.user.id,
    false
  );
  if (deleteError !== null) {
    return json(409, {
      error: "The account could not be deleted. Remove any owned Supabase Storage objects or contact Lyra privacy support."
    });
  }

  return json(200, { deleted: true });
});
