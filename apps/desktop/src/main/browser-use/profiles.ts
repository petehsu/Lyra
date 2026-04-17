import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { BrowserUseBrowserProfileOption } from "../../shared/browser-use";

const AGENT_PLAN_QUESTION_REQUIRED = "AGENT_PLAN_QUESTION_REQUIRED";
const MAX_PROFILE_OPTIONS = 8;

type BrowserUserDataRoot = {
  readonly browserId: string;
  readonly browserName: string;
  readonly userDataDir: string;
};

const browserPriority = (browserId: string): number => {
  switch (browserId) {
    case "chrome":
      return 0;
    case "edge":
      return 1;
    case "brave":
      return 2;
    case "chromium":
      return 3;
    case "chrome-canary":
      return 4;
    default:
      return 99;
  }
};

const userDataRootsForPlatform = (): readonly BrowserUserDataRoot[] => {
  const home = os.homedir();
  switch (process.platform) {
    case "darwin":
      return [
        {
          browserId: "chrome",
          browserName: "Google Chrome",
          userDataDir: path.join(home, "Library", "Application Support", "Google", "Chrome"),
        },
        {
          browserId: "chrome-canary",
          browserName: "Google Chrome Canary",
          userDataDir: path.join(home, "Library", "Application Support", "Google", "Chrome Canary"),
        },
        {
          browserId: "chromium",
          browserName: "Chromium",
          userDataDir: path.join(home, "Library", "Application Support", "Chromium"),
        },
        {
          browserId: "brave",
          browserName: "Brave",
          userDataDir: path.join(home, "Library", "Application Support", "BraveSoftware", "Brave-Browser"),
        },
        {
          browserId: "edge",
          browserName: "Microsoft Edge",
          userDataDir: path.join(home, "Library", "Application Support", "Microsoft Edge"),
        },
      ];
    case "win32":
      return [
        {
          browserId: "chrome",
          browserName: "Google Chrome",
          userDataDir: path.join(home, "AppData", "Local", "Google", "Chrome", "User Data"),
        },
        {
          browserId: "chrome-canary",
          browserName: "Google Chrome Canary",
          userDataDir: path.join(home, "AppData", "Local", "Google", "Chrome SxS", "User Data"),
        },
        {
          browserId: "chromium",
          browserName: "Chromium",
          userDataDir: path.join(home, "AppData", "Local", "Chromium", "User Data"),
        },
        {
          browserId: "brave",
          browserName: "Brave",
          userDataDir: path.join(home, "AppData", "Local", "BraveSoftware", "Brave-Browser", "User Data"),
        },
        {
          browserId: "edge",
          browserName: "Microsoft Edge",
          userDataDir: path.join(home, "AppData", "Local", "Microsoft", "Edge", "User Data"),
        },
      ];
    default:
      return [
        {
          browserId: "chrome",
          browserName: "Google Chrome",
          userDataDir: path.join(home, ".config", "google-chrome"),
        },
        {
          browserId: "chrome-canary",
          browserName: "Google Chrome Canary",
          userDataDir: path.join(home, ".config", "google-chrome-canary"),
        },
        {
          browserId: "chromium",
          browserName: "Chromium",
          userDataDir: path.join(home, ".config", "chromium"),
        },
        {
          browserId: "brave",
          browserName: "Brave",
          userDataDir: path.join(home, ".config", "BraveSoftware", "Brave-Browser"),
        },
        {
          browserId: "edge",
          browserName: "Microsoft Edge",
          userDataDir: path.join(home, ".config", "microsoft-edge"),
        },
      ];
  }
};

const readJsonRecord = async (filePath: string): Promise<Record<string, unknown> | null> => {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
};

const listProfileDirectories = async (userDataDir: string): Promise<readonly string[]> => {
  try {
    const entries = await readdir(userDataDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => name === "Default" || /^Profile \d+$/u.test(name) || /^Guest Profile$/u.test(name));
  } catch {
    return [];
  }
};

const readInfoCache = async (
  userDataDir: string,
): Promise<Record<string, { readonly name?: string }> | null> => {
  const localState = await readJsonRecord(path.join(userDataDir, "Local State"));
  const profile = localState?.profile;
  if (profile === null || typeof profile !== "object" || Array.isArray(profile)) {
    return null;
  }
  const infoCache = (profile as Record<string, unknown>).info_cache;
  if (infoCache === null || typeof infoCache !== "object" || Array.isArray(infoCache)) {
    return null;
  }
  return infoCache as Record<string, { readonly name?: string }>;
};

const formatProfilePreview = (option: BrowserUseBrowserProfileOption): string =>
  JSON.stringify(
    {
      browserName: option.browserName,
      browserId: option.browserId,
      profileName: option.profileName,
      profileDirectory: option.profileDirectory,
      userDataDir: option.userDataDir,
    },
    null,
    2,
  );

const normalizeLookup = (value: string): string => value.trim().toLowerCase();

export const listBrowserUseRealProfiles = async (): Promise<readonly BrowserUseBrowserProfileOption[]> => {
  const results: BrowserUseBrowserProfileOption[] = [];
  for (const root of userDataRootsForPlatform()) {
    const infoCache = await readInfoCache(root.userDataDir);
    const directoryNames = new Set<string>(await listProfileDirectories(root.userDataDir));
    if (infoCache !== null) {
      for (const key of Object.keys(infoCache)) {
        if (key.trim().length > 0) {
          directoryNames.add(key);
        }
      }
    }
    for (const profileDirectory of directoryNames) {
      const cachedLabel = infoCache?.[profileDirectory];
      const profileName =
        typeof cachedLabel?.name === "string" && cachedLabel.name.trim().length > 0
          ? cachedLabel.name.trim()
          : profileDirectory;
      results.push({
        id: `${root.browserId}:${profileDirectory}`,
        browserId: root.browserId,
        browserName: root.browserName,
        profileName,
        profileDirectory,
        userDataDir: root.userDataDir,
        isDefault: profileDirectory === "Default",
      });
    }
  }

  return results
    .sort((left, right) => {
      const priorityDelta = browserPriority(left.browserId) - browserPriority(right.browserId);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      if (left.isDefault !== right.isDefault) {
        return left.isDefault ? -1 : 1;
      }
      const browserDelta = left.browserName.localeCompare(right.browserName);
      if (browserDelta !== 0) {
        return browserDelta;
      }
      return left.profileName.localeCompare(right.profileName);
    });
};

export const resolveBrowserUseProfileSelection = (
  profiles: readonly BrowserUseBrowserProfileOption[],
  requestedProfile: string,
): BrowserUseBrowserProfileOption | undefined => {
  const normalized = normalizeLookup(requestedProfile);
  return profiles.find((profile) => {
    const candidates = [
      profile.id,
      profile.profileDirectory,
      profile.profileName,
      `${profile.browserName} · ${profile.profileName}`,
    ].map(normalizeLookup);
    return candidates.includes(normalized);
  });
};

export const createRealProfileSelectionQuestionError = (
  profiles: readonly BrowserUseBrowserProfileOption[],
) => ({
  code: AGENT_PLAN_QUESTION_REQUIRED,
  message:
    "This browser_use task needs a real signed-in browser profile. Ask the user which browser profile Lyra should use, then retry browser_use.session.prepare with that profileName.",
  retryable: false,
  details: {
    questions: [
      {
        id: "profile_name",
        header: "Browser",
        question: "Which real browser profile should Lyra use for this task?",
        allowOther: true,
        options: profiles.slice(0, MAX_PROFILE_OPTIONS).map((profile) => ({
          label: `${profile.browserName} · ${profile.profileName}`,
          description: profile.isDefault
            ? `Default profile in ${profile.browserName}`
            : `${profile.browserName} profile directory ${profile.profileDirectory}`,
          preview: formatProfilePreview(profile),
        })),
      },
    ],
    allowNote: false,
    browserProfiles: profiles,
  },
});
