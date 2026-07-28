import type { AuthLocalIdentity } from "../../shared/auth";

export type CachedLocalIdentity = {
  readonly email: string;
  readonly displayName?: string;
  readonly avatarUrl?: string;
};

export const resolveLocalIdentity = ({
  displayName,
  gitEmail,
  cached
}: {
  readonly displayName: string;
  readonly gitEmail?: string;
  readonly cached: CachedLocalIdentity | null;
}): AuthLocalIdentity => {
  const email = gitEmail?.trim() || undefined;
  const matchesCachedAccount =
    email !== undefined
    && cached !== null
    && cached.email.trim().toLowerCase() === email.toLowerCase();

  if (!matchesCachedAccount) {
    return {
      displayName,
      ...(email === undefined ? {} : { gitEmail: email }),
      registered: false
    };
  }

  const registeredDisplayName = cached.displayName?.trim() || displayName;
  const registeredAvatarUrl = cached.avatarUrl?.trim();
  return {
    displayName,
    gitEmail: email,
    registered: true,
    registeredDisplayName,
    ...(registeredAvatarUrl === undefined ? {} : { registeredAvatarUrl })
  };
};
