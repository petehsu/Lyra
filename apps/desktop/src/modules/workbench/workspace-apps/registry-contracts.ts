import type { LyraAppModule } from "@lyra/app-runtime";

const ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

export const normalizeWorkspaceIdentifier = (
  value: string,
  label: string
): string => {
  const normalized = value.trim();
  if (!ID_PATTERN.test(normalized)) {
    throw new Error(`${label} is invalid: ${value}`);
  }
  return normalized;
};

export const normalizeWorkspaceVersion = (value: string): string => {
  const normalized = value.trim();
  if (!SEMVER_PATTERN.test(normalized)) {
    throw new Error(`Workspace app version is invalid: ${value}`);
  }
  return normalized;
};

export const assertModuleContributionsOwned = (module: LyraAppModule): void => {
  const contributions = module.contributions;
  if (contributions === undefined) {
    return;
  }
  const groups = [
    contributions.commands ?? [],
    contributions.capabilities ?? [],
    contributions.settings ?? [],
    contributions.status ?? [],
    contributions.events ?? []
  ] as const;

  for (const group of groups) {
    for (const contribution of group) {
      if (
        contribution.id !== module.id
        && !contribution.id.startsWith(`${module.id}.`)
      ) {
        throw new Error(
          `${module.id} cannot declare another module's contribution: ${contribution.id}`
        );
      }
    }
  }
  for (const contribution of contributions.settings ?? []) {
    if (!contribution.route.startsWith("/") || contribution.route.startsWith("//")) {
      throw new Error(`Workspace app settings route must be absolute: ${contribution.route}`);
    }
  }
};
