export type AuthLocalePreference =
  | { readonly mode: "system" }
  | { readonly mode: "explicit"; readonly locale: string };

export type AuthUser = {
  readonly id: string;
  readonly email?: string;
  readonly displayName?: string;
  readonly avatarUrl?: string;
};

export type AuthProfile = {
  readonly id: string;
  readonly displayName?: string;
  readonly avatarUrl?: string;
  readonly localePreference: AuthLocalePreference;
  readonly themePreference: string;
  readonly onboardingCompleted: boolean;
  readonly onboardingVersion: number;
};

export type AuthSnapshot = {
  readonly configured: boolean;
  readonly user: AuthUser | null;
  readonly profile: AuthProfile | null;
  readonly error?: string;
};

export type AuthProfileUpdate = {
  readonly displayName?: string;
  readonly avatarUrl?: string;
  readonly localePreference?: AuthLocalePreference;
  readonly themePreference?: string;
  readonly onboardingCompleted?: boolean;
  readonly onboardingVersion?: number;
};

export type AuthLocalIdentity = {
  readonly displayName: string;
  readonly gitEmail?: string;
  readonly registered: boolean;
  readonly registeredDisplayName?: string;
  readonly registeredAvatarUrl?: string;
};

export type AuthApi = {
  readonly getSession: () => Promise<AuthSnapshot>;
  readonly getLocalIdentity: () => Promise<AuthLocalIdentity>;
  readonly startGoogleLogin: () => Promise<{
    readonly started: boolean;
    readonly authorizationUrl: string;
  }>;
  readonly updateProfile: (update: AuthProfileUpdate) => Promise<AuthProfile>;
  readonly deleteAccount: (confirmation: string) => Promise<void>;
  readonly logout: () => Promise<void>;
  readonly onChanged: (listener: (snapshot: AuthSnapshot) => void) => () => void;
};
