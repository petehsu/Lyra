import type { TerminalProfile, TerminalProfilePaneOptions } from "./types";

export const DEFAULT_TERMINAL_PROFILE_ID = "default" as const;

export const DEFAULT_TERMINAL_PROFILES: readonly TerminalProfile[] = [
  {
    id: DEFAULT_TERMINAL_PROFILE_ID,
    name: "Terminal"
  }
];

const normalizeString = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const resolveTerminalProfile = (
  profiles: readonly TerminalProfile[],
  profileId: string | undefined
): TerminalProfile => {
  const normalizedProfileId = normalizeString(profileId);
  return (
    profiles.find((profile) => profile.id === normalizedProfileId)
    ?? profiles.find((profile) => profile.id === DEFAULT_TERMINAL_PROFILE_ID)
    ?? DEFAULT_TERMINAL_PROFILES[0]!
  );
};

export const createTerminalProfilePaneOptions = (
  profile: TerminalProfile,
  index: number
): TerminalProfilePaneOptions => {
  const startupCommand = normalizeString(profile.startupCommand);
  const mode = startupCommand === undefined ? profile.mode : profile.mode ?? "command";
  return {
    title: profile.name.trim().length > 0 ? profile.name.trim() : `Terminal ${index}`,
    profileId: profile.id,
    ...(normalizeString(profile.shell) === undefined ? {} : { shell: normalizeString(profile.shell)! }),
    ...(normalizeString(profile.cwd) === undefined ? {} : { cwd: normalizeString(profile.cwd)! }),
    ...(profile.env === undefined || profile.env.length === 0 ? {} : { env: profile.env }),
    ...(startupCommand === undefined ? {} : { startupCommand, command: startupCommand }),
    ...(mode === undefined ? {} : { mode })
  };
};
