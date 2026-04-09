import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

const OPENAI_AUTH_ISSUER = "https://auth.openai.com";
const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_OAUTH_PORT = 1455;
const OPENAI_OAUTH_TIMEOUT_MS = 5 * 60 * 1000;
const OPENAI_OAUTH_POLLING_SAFETY_MARGIN_MS = 3000;

type OpenAiTokenResponse = {
  readonly id_token?: string;
  readonly access_token: string;
  readonly refresh_token?: string;
  readonly expires_in?: number;
};

type OpenAiDeviceCodeResponse = {
  readonly device_auth_id: string;
  readonly user_code: string;
  readonly interval: string;
};

type OpenAiDeviceTokenPollResponse = {
  readonly authorization_code: string;
  readonly code_verifier: string;
};

export type OpenAiBrowserAuthResult = {
  readonly refreshToken: string;
  readonly accessToken: string;
  readonly expiresAt: number;
  readonly accountId?: string;
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

const base64UrlEncode = (input: Buffer): string =>
  input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

const generatePkce = (): { verifier: string; challenge: string } => {
  const verifier = base64UrlEncode(randomBytes(64)).slice(0, 86);
  const challenge = base64UrlEncode(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
};

const generateState = (): string => base64UrlEncode(randomBytes(32));

const decodeJwtPayload = (token: string): Record<string, unknown> | null => {
  const segments = token.split(".");
  if (segments.length !== 3) {
    return null;
  }
  try {
    const payload = Buffer.from(segments[1] ?? "", "base64url").toString("utf8");
    const parsed = JSON.parse(payload);
    return parsed !== null && typeof parsed === "object"
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
};

const extractAccountId = (tokens: OpenAiTokenResponse): string | undefined => {
  const candidates = [tokens.id_token, tokens.access_token].filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );
  for (const token of candidates) {
    const claims = decodeJwtPayload(token);
    if (claims === null) {
      continue;
    }

    const direct = claims.chatgpt_account_id;
    if (typeof direct === "string" && direct.length > 0) {
      return direct;
    }

    const namespaced = claims["https://api.openai.com/auth"];
    if (
      namespaced !== null
      && typeof namespaced === "object"
      && "chatgpt_account_id" in namespaced
      && typeof (namespaced as Record<string, unknown>).chatgpt_account_id === "string"
    ) {
      const value = (namespaced as Record<string, unknown>).chatgpt_account_id as string;
      if (value.length > 0) {
        return value;
      }
    }

    const organizations = claims.organizations;
    if (Array.isArray(organizations) && organizations.length > 0) {
      const first = organizations[0];
      if (first !== null && typeof first === "object" && typeof (first as Record<string, unknown>).id === "string") {
        const value = (first as Record<string, unknown>).id as string;
        if (value.length > 0) {
          return value;
        }
      }
    }
  }
  return undefined;
};

const toOAuthResult = (
  tokens: OpenAiTokenResponse,
  sourceLabel: "browser" | "device_code"
): OpenAiBrowserAuthResult => {
  if (typeof tokens.access_token !== "string" || tokens.access_token.length === 0) {
    throw new Error(`OpenAI ${sourceLabel} OAuth did not return access_token`);
  }
  if (typeof tokens.refresh_token !== "string" || tokens.refresh_token.length === 0) {
    throw new Error(
      `OpenAI ${sourceLabel} OAuth did not return refresh_token. Please retry or use Device Code authorization.`
    );
  }
  const accountId = extractAccountId(tokens);
  return {
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    ...(accountId === undefined ? {} : { accountId })
  };
};

const exchangeCodeForTokens = async (
  code: string,
  redirectUri: string,
  verifier: string
): Promise<OpenAiTokenResponse> => {
  const response = await fetch(`${OPENAI_AUTH_ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: OPENAI_CLIENT_ID,
      code_verifier: verifier
    }).toString()
  });
  if (response.ok === false) {
    const body = await response.text();
    throw new Error(`OpenAI token exchange failed (${response.status}): ${body}`);
  }
  return await response.json() as OpenAiTokenResponse;
};

export const authorizeOpenAiChatGptInBrowser = async (
  openExternal: (url: string) => Promise<boolean>
): Promise<OpenAiBrowserAuthResult> => {
  const { verifier, challenge } = generatePkce();
  const state = generateState();
  const redirectUri = `http://localhost:${OPENAI_OAUTH_PORT}/auth/callback`;

  const authUrl = new URL(`${OPENAI_AUTH_ISSUER}/oauth/authorize`);
  authUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: OPENAI_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "openid profile email offline_access",
    code_challenge: challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state,
    originator: "opencode"
  }).toString();

  const tokens = await new Promise<OpenAiTokenResponse>(
    (resolve, reject) => {
      let settled = false;
      const finish = (handler: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        handler();
      };

      const server = createServer((request, response) => {
        const url = new URL(request.url ?? "/", redirectUri);
        if (url.pathname !== "/auth/callback") {
          response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          response.end("Not Found");
          return;
        }
        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");
        const error = url.searchParams.get("error");
        const errorDescription = url.searchParams.get("error_description");
        if (typeof error === "string" && error.length > 0) {
          response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          response.end("<h1>Authorization failed</h1><p>Please close this window.</p>");
          finish(() => {
            server.close();
            reject(new Error(`OpenAI authorization failed: ${errorDescription ?? error}`));
          });
          return;
        }
        if (typeof code !== "string" || code.length === 0 || typeof returnedState !== "string") {
          response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          response.end("<h1>Invalid callback</h1><p>Please close this window.</p>");
          finish(() => {
            server.close();
            reject(new Error("OpenAI authorization callback missing code or state"));
          });
          return;
        }
        if (returnedState !== state) {
          response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          response.end("<h1>Invalid state</h1><p>Please close this window and retry.</p>");
          finish(() => {
            server.close();
            reject(new Error("OpenAI authorization state mismatch"));
          });
          return;
        }

        void exchangeCodeForTokens(code, redirectUri, verifier)
          .then((result) => {
            response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            response.end("<h1>Authorization successful</h1><p>You can close this window and return to Lyra.</p>");
            finish(() => {
              server.close();
              resolve(result);
            });
          })
          .catch((error) => {
            response.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
            response.end("<h1>Authorization failed</h1><p>Please close this window and retry in Lyra.</p>");
            finish(() => {
              server.close();
              reject(error instanceof Error ? error : new Error(String(error)));
            });
          });
      });

      server.once("error", (error) => {
        finish(() => {
          reject(new Error(`failed to start OAuth callback server: ${String(error)}`));
        });
      });

      server.listen(OPENAI_OAUTH_PORT, "127.0.0.1", async () => {
        const opened = await openExternal(authUrl.toString());
        if (opened === false) {
          finish(() => {
            server.close();
            reject(new Error("failed to open browser for OpenAI authorization"));
          });
          return;
        }

        setTimeout(() => {
          finish(() => {
            server.close();
            reject(new Error("OpenAI authorization timed out"));
          });
        }, OPENAI_OAUTH_TIMEOUT_MS);
      });
    }
  );

  return toOAuthResult(tokens, "browser");
};

export const authorizeOpenAiChatGptViaDeviceCode = async (
  openExternal: (url: string) => Promise<boolean>
): Promise<OpenAiBrowserAuthResult> => {
  const startResponse = await fetch(`${OPENAI_AUTH_ISSUER}/api/accounts/deviceauth/usercode`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "lyra"
    },
    body: JSON.stringify({ client_id: OPENAI_CLIENT_ID })
  });
  if (startResponse.ok === false) {
    throw new Error(`failed to start OpenAI device authorization: ${startResponse.status}`);
  }
  const device = await startResponse.json() as OpenAiDeviceCodeResponse;
  const pollingIntervalMs = Math.max(Number.parseInt(device.interval, 10) || 5, 1) * 1000;

  const opened = await openExternal(`${OPENAI_AUTH_ISSUER}/codex/device`);
  if (opened === false) {
    throw new Error("failed to open browser for OpenAI device authorization");
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < OPENAI_OAUTH_TIMEOUT_MS) {
    const pollResponse = await fetch(`${OPENAI_AUTH_ISSUER}/api/accounts/deviceauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "lyra"
      },
      body: JSON.stringify({
        device_auth_id: device.device_auth_id,
        user_code: device.user_code
      })
    });

    if (pollResponse.ok) {
      const deviceToken = await pollResponse.json() as OpenAiDeviceTokenPollResponse;
      const tokenResponse = await fetch(`${OPENAI_AUTH_ISSUER}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: deviceToken.authorization_code,
          redirect_uri: `${OPENAI_AUTH_ISSUER}/deviceauth/callback`,
          client_id: OPENAI_CLIENT_ID,
          code_verifier: deviceToken.code_verifier
        }).toString()
      });
      if (tokenResponse.ok === false) {
        const body = await tokenResponse.text();
        throw new Error(`OpenAI token exchange failed (${tokenResponse.status}): ${body}`);
      }
      const tokens = await tokenResponse.json() as OpenAiTokenResponse;
      return toOAuthResult(tokens, "device_code");
    }

    if (pollResponse.status !== 403 && pollResponse.status !== 404) {
      const body = await pollResponse.text();
      throw new Error(`device authorization failed (${pollResponse.status}): ${body}`);
    }

    await sleep(pollingIntervalMs + OPENAI_OAUTH_POLLING_SAFETY_MARGIN_MS);
  }

  throw new Error("OpenAI device authorization timed out");
};
