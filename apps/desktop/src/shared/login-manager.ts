import type { LyraSensitiveValueRef } from "./sensitive-value";

export type LoginManagerAuthMethodKind =
  | "site_session"
  | "password"
  | "passkey"
  | "oauth"
  | "sso"
  | "magic_link"
  | "unknown";

export type LoginManagerFactSource =
  | "observed"
  | "inferred"
  | "manual"
  | "unknown";

export type LoginManagerAuthMethod = {
  readonly kind: LoginManagerAuthMethodKind;
  readonly label: string;
  readonly source: LoginManagerFactSource;
  readonly confidence: number;
  readonly providerDomain?: string;
};

export type LoginManagerSessionStatus =
  | "observed"
  | "possible";

export type LoginManagerSessionSignals = {
  readonly cookieCount: number;
  readonly storageObserved: boolean;
  readonly formSubmitted: boolean;
  readonly oauthHint?: string;
};

export type LoginManagerSession = {
  readonly id: string;
  readonly origin: string;
  readonly hostname: string;
  readonly faviconUrl?: string;
  readonly title?: string;
  readonly address?: string;
  readonly status: LoginManagerSessionStatus;
  readonly accountHint?: string;
  readonly notes?: string;
  readonly authMethod: LoginManagerAuthMethod;
  readonly authMethodSource: LoginManagerFactSource;
  readonly signals: LoginManagerSessionSignals;
  readonly credentialIds: readonly string[];
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly updatedAt: string;
};

export type LoginManagerCredential = {
  readonly id: string;
  readonly origin: string;
  readonly hostname: string;
  readonly faviconUrl?: string;
  readonly username: string;
  readonly usernameLabel?: string;
  readonly authMethod: LoginManagerAuthMethod;
  readonly hasPassword: boolean;
  readonly passwordAvailable: boolean;
  readonly passwordRef?: LyraSensitiveValueRef;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastUsedAt?: string;
};

export type LoginManagerSnapshot = {
  readonly version: 1;
  readonly generatedAt: string;
  readonly storageRoot: string;
  readonly credentialCaptureEnabled: boolean;
  readonly passwordsAvailable: boolean;
  readonly passwordStorageReason?: string;
  readonly sessions: readonly LoginManagerSession[];
  readonly credentials: readonly LoginManagerCredential[];
};

export type LoginManagerUpdateSessionRequest = {
  readonly sessionId?: string;
  readonly origin?: string;
  readonly authMethod?: Partial<LoginManagerAuthMethod>;
  readonly accountHint?: string | null;
  readonly notes?: string | null;
};

export type LoginManagerDeleteCredentialRequest = {
  readonly credentialId: string;
};

export type LoginManagerRevealCredentialRequest = {
  readonly credentialId: string;
  readonly reason?: string;
};

export type LoginManagerRevealCredentialResponse = {
  readonly credentialId: string;
  readonly username: string;
  readonly password: string;
};

export type LoginManagerFillCredentialRequest = {
  readonly credentialId?: string;
  readonly origin?: string;
  readonly tabId?: string;
  readonly reason?: string;
};

export type LoginManagerFillCredentialResponse = {
  readonly filled: boolean;
  readonly tabId?: string;
  readonly origin?: string;
  readonly username?: string;
  readonly message?: string;
};

export type LoginManagerClearSiteRequest = {
  readonly origin?: string;
  readonly sessionId?: string;
  readonly hostname?: string;
};

export type LoginManagerClearSiteResponse = {
  readonly cleared: boolean;
  readonly origin: string;
  readonly hostname: string;
  readonly cookiesRemoved: number;
  readonly storageCleared: boolean;
};

export type LoginManagerEvent = {
  readonly kind: "snapshot";
  readonly snapshot: LoginManagerSnapshot;
};

export type LoginManagerApi = {
  readonly list: () => Promise<LoginManagerSnapshot>;
  readonly setCredentialCaptureEnabled: (
    enabled: boolean
  ) => Promise<LoginManagerSnapshot>;
  readonly updateSession: (
    request: LoginManagerUpdateSessionRequest
  ) => Promise<LoginManagerSnapshot>;
  readonly deleteCredential: (
    request: LoginManagerDeleteCredentialRequest
  ) => Promise<LoginManagerSnapshot>;
  readonly revealCredential: (
    request: LoginManagerRevealCredentialRequest
  ) => Promise<LoginManagerRevealCredentialResponse>;
  readonly fillCredential: (
    request: LoginManagerFillCredentialRequest
  ) => Promise<LoginManagerFillCredentialResponse>;
  readonly clearSite: (
    request: LoginManagerClearSiteRequest
  ) => Promise<LoginManagerClearSiteResponse>;
  readonly onEvent: (listener: (event: LoginManagerEvent) => void) => () => void;
};
