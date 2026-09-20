import type {
  AuthMethod,
  AuthMethodKind,
  CredentialSession,
  CredentialsSnapshot,
  FactSource,
  StoredCredential
} from "./types";

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const AUTH_KINDS = new Set<AuthMethodKind>([
  "site_session",
  "password",
  "passkey",
  "oauth",
  "sso",
  "magic_link",
  "unknown"
]);

const FACT_SOURCES = new Set<FactSource>(["observed", "inferred", "manual", "unknown"]);

const parseAuthMethodKind = (value: unknown): AuthMethodKind => {
  const kind = stringValue(value);
  return kind !== undefined && AUTH_KINDS.has(kind as AuthMethodKind)
    ? kind as AuthMethodKind
    : "unknown";
};

const parseFactSource = (value: unknown): FactSource => {
  const source = stringValue(value);
  return source !== undefined && FACT_SOURCES.has(source as FactSource)
    ? source as FactSource
    : "unknown";
};

const parseAuthMethod = (value: unknown): AuthMethod => {
  const record = isRecord(value) ? value : {};
  const label = stringValue(record.label) ?? "Unknown";
  const providerDomain = stringValue(record.providerDomain);
  return {
    kind: parseAuthMethodKind(record.kind),
    label,
    source: parseFactSource(record.source),
    ...(providerDomain === undefined ? {} : { providerDomain })
  };
};

const parseSession = (value: unknown): CredentialSession | undefined => {
  if (!isRecord(value)) return undefined;
  const id = stringValue(value.id);
  const origin = stringValue(value.origin);
  const hostname = stringValue(value.hostname);
  if (id === undefined || origin === undefined || hostname === undefined) {
    return undefined;
  }
  const faviconUrl = stringValue(value.faviconUrl);
  const title = stringValue(value.title);
  const address = stringValue(value.address);
  const accountHint = stringValue(value.accountHint);
  const notes = stringValue(value.notes);
  const lastSeenAt = stringValue(value.lastSeenAt);
  return {
    id,
    origin,
    hostname,
    authMethod: parseAuthMethod(value.authMethod),
    authMethodSource: parseFactSource(value.authMethodSource),
    ...(faviconUrl === undefined ? {} : { faviconUrl }),
    ...(title === undefined ? {} : { title }),
    ...(address === undefined ? {} : { address }),
    ...(accountHint === undefined ? {} : { accountHint }),
    ...(notes === undefined ? {} : { notes }),
    ...(lastSeenAt === undefined ? {} : { lastSeenAt })
  };
};

const parseCredential = (value: unknown): StoredCredential | undefined => {
  if (!isRecord(value)) return undefined;
  const id = stringValue(value.id);
  const origin = stringValue(value.origin);
  const hostname = stringValue(value.hostname);
  const username = typeof value.username === "string" ? value.username : undefined;
  if (id === undefined || origin === undefined || hostname === undefined || username === undefined) {
    return undefined;
  }
  const faviconUrl = stringValue(value.faviconUrl);
  const usernameLabel = stringValue(value.usernameLabel);
  const updatedAt = stringValue(value.updatedAt);
  return {
    id,
    origin,
    hostname,
    username,
    authMethod: parseAuthMethod(value.authMethod),
    passwordAvailable: value.passwordAvailable === true,
    ...(faviconUrl === undefined ? {} : { faviconUrl }),
    ...(usernameLabel === undefined ? {} : { usernameLabel }),
    ...(updatedAt === undefined ? {} : { updatedAt })
  };
};

export const parseCredentialsSnapshot = (value: unknown): CredentialsSnapshot => {
  if (!isRecord(value) || !Array.isArray(value.sessions) || !Array.isArray(value.credentials)) {
    throw new Error("Core returned an invalid credential snapshot.");
  }
  return {
    sessions: value.sessions.flatMap((entry) => {
      const parsed = parseSession(entry);
      return parsed === undefined ? [] : [parsed];
    }),
    credentials: value.credentials.flatMap((entry) => {
      const parsed = parseCredential(entry);
      return parsed === undefined ? [] : [parsed];
    })
  };
};
