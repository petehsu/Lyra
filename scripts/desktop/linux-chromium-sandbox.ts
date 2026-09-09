import { statSync } from "node:fs";

const systemSandboxCandidates = [
  "/usr/lib/chromium/chrome-sandbox",
  "/usr/lib/chromium-browser/chrome-sandbox",
  "/opt/google/chrome/chrome-sandbox",
  "/opt/google/chrome-beta/chrome-sandbox"
] as const;

export const resolveLinuxSystemSandbox = (): string | null => {
  for (const candidate of systemSandboxCandidates) {
    try {
      const stats = statSync(candidate);
      const isRootOwned = stats.uid === 0;
      const isSetuid = (stats.mode & 0o4000) !== 0;
      if (stats.isFile() && isRootOwned && isSetuid) {
        return candidate;
      }
    } catch {
      // Continue to the next well-known system installation.
    }
  }
  return null;
};
