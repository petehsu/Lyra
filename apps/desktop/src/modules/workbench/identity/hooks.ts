import { useEffect, useMemo, useState } from "react";

import type {
  IdentityIconSnapshot,
  LyraDesktopApi,
  ProjectIdentitySnapshot
} from "../../../shared/desktop-bridge";

export type ResolvedIdentityIcon = {
  readonly url: string | null;
  readonly label?: string;
  readonly source: "project" | "user" | "fallback";
  readonly renderHint?: "lyra-logo";
};

export type TerminalIdentityRequest = {
  readonly terminalTabId: string;
  readonly currentCwd?: string | null;
  readonly sourceAgentWorkingDir?: string | null;
};

export type ProjectIdentityRequest = {
  readonly identityId: string;
  readonly projectPath?: string | null;
};

const emptyIdentity: ResolvedIdentityIcon = {
  url: null,
  source: "fallback"
};

const IDENTITY_PROJECTION_REVISION = "lyra-logo-render-hint-v2";

let userIconPromise: Promise<IdentityIconSnapshot | null> | null = null;
const projectIdentityPromises = new Map<string, Promise<ProjectIdentitySnapshot | null>>();

const normalizePath = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeIdentityPath = (value: string | undefined): string =>
  value?.trim().replace(/\\/g, "/").toLowerCase() ?? "";

const hasPathSegment = (value: string, segment: string): boolean =>
  value.split("/").some((entry) => entry === segment);

const isLyraRendererLogoPath = (logoPath: string): boolean =>
  logoPath.includes("/assets/brand/lyra-mark") ||
  logoPath.includes("/assets/brand/lyra-logo") ||
  logoPath.includes("/resources/icons/app/lyra-app-icon") ||
  logoPath.includes("/resources/icons/macos/lyra") ||
  logoPath.includes("/resources/icons/win/lyra") ||
  logoPath.endsWith("/src/renderer/assets/logo.svg") ||
  logoPath.endsWith("/src/renderer/assets/logo.png");

const isLyraProjectLogo = (project: ProjectIdentitySnapshot): boolean => {
  const projectName = project.name?.trim().toLowerCase() ?? "";
  const rootPath = normalizeIdentityPath(project.rootPath);
  const logoPath = normalizeIdentityPath(project.logo?.path);
  if (projectName === "lyra") {
    return true;
  }
  if (logoPath.includes("lyra-mark") || logoPath.includes("lyra-logo")) {
    return true;
  }
  return hasPathSegment(rootPath, "lyra") && isLyraRendererLogoPath(logoPath);
};

const readUserIcon = (
  desktopApi: LyraDesktopApi | null
): Promise<IdentityIconSnapshot | null> => {
  if (desktopApi?.identity === undefined) {
    return Promise.resolve(null);
  }
  userIconPromise ??= desktopApi.identity.readUserIcon().catch(() => null);
  return userIconPromise;
};

const resolveProjectIdentity = (
  desktopApi: LyraDesktopApi | null,
  targetPath: string | null
): Promise<ProjectIdentitySnapshot | null> => {
  if (desktopApi?.identity === undefined || targetPath === null) {
    return Promise.resolve(null);
  }
  const key = targetPath;
  let cached = projectIdentityPromises.get(key);
  if (cached === undefined) {
    cached = desktopApi.identity.resolveProjectIdentity({ path: targetPath }).catch(() => null);
    projectIdentityPromises.set(key, cached);
  }
  return cached;
};

export const iconFromProject = (
  project: ProjectIdentitySnapshot | null
): ResolvedIdentityIcon | null => {
  const logoUrl = project?.logo?.url?.trim();
  const label = project?.name;
  if (project !== null && isLyraProjectLogo(project)) {
    return {
      url: null,
      ...(label === undefined ? {} : { label }),
      source: "project",
      renderHint: "lyra-logo"
    };
  }
  if (logoUrl === undefined || logoUrl.length === 0) {
    return null;
  }
  return {
    url: logoUrl,
    ...(label === undefined ? {} : { label }),
    source: "project"
  };
};

const iconFromUser = (icon: IdentityIconSnapshot | null): ResolvedIdentityIcon | null => {
  const iconUrl = icon?.url?.trim();
  if (iconUrl === undefined || iconUrl.length === 0) {
    return null;
  }
  return {
    url: iconUrl,
    ...(icon?.label === undefined ? {} : { label: icon.label }),
    source: "user"
  };
};

export const useSessionIdentityIcon = (
  desktopApi: LyraDesktopApi | null,
  workingDir: string | null | undefined
): ResolvedIdentityIcon => {
  const normalizedWorkingDir = normalizePath(workingDir);
  const [icon, setIcon] = useState<ResolvedIdentityIcon>(emptyIdentity);

  useEffect(() => {
    let disposed = false;
    const run = async (): Promise<void> => {
      const project = iconFromProject(
        await resolveProjectIdentity(desktopApi, normalizedWorkingDir)
      );
      if (project !== null) {
        if (!disposed) setIcon(project);
        return;
      }
      const user = iconFromUser(await readUserIcon(desktopApi));
      if (!disposed) setIcon(user ?? emptyIdentity);
    };
    void run();
    return () => {
      disposed = true;
    };
  }, [desktopApi, normalizedWorkingDir, IDENTITY_PROJECTION_REVISION]);

  return icon;
};

export const useTerminalIdentityMap = (
  desktopApi: LyraDesktopApi | null,
  requests: readonly TerminalIdentityRequest[]
): Readonly<Record<string, ResolvedIdentityIcon>> => {
  const signature = useMemo(
    () => requests
      .map((request) => [
        IDENTITY_PROJECTION_REVISION,
        request.terminalTabId,
        normalizePath(request.currentCwd) ?? "",
        normalizePath(request.sourceAgentWorkingDir) ?? ""
      ].join("\u001f"))
      .join("\u001e"),
    [requests]
  );
  const [icons, setIcons] = useState<Readonly<Record<string, ResolvedIdentityIcon>>>({});

  useEffect(() => {
    let disposed = false;
    const run = async (): Promise<void> => {
      const entries = await Promise.all(requests.map(async (request) => {
        const currentCwd = normalizePath(request.currentCwd);
        const cwdProject = iconFromProject(
          await resolveProjectIdentity(desktopApi, currentCwd)
        );
        if (cwdProject !== null) {
          return [request.terminalTabId, cwdProject] as const;
        }

        const sourceWorkingDir = normalizePath(request.sourceAgentWorkingDir);
        if (sourceWorkingDir !== null) {
          const sourceProject = iconFromProject(
            await resolveProjectIdentity(desktopApi, sourceWorkingDir)
          );
          if (sourceProject !== null) {
            return [request.terminalTabId, sourceProject] as const;
          }
          const user = iconFromUser(await readUserIcon(desktopApi));
          if (user !== null) {
            return [request.terminalTabId, user] as const;
          }
        }

        return [request.terminalTabId, emptyIdentity] as const;
      }));
      if (!disposed) {
        setIcons(Object.fromEntries(entries));
      }
    };
    void run();
    return () => {
      disposed = true;
    };
  }, [desktopApi, requests, signature]);

  return icons;
};

export const useProjectIdentityMap = (
  desktopApi: LyraDesktopApi | null,
  requests: readonly ProjectIdentityRequest[]
): Readonly<Record<string, ResolvedIdentityIcon>> => {
  const signature = useMemo(
    () => requests
      .map((request) => [
        IDENTITY_PROJECTION_REVISION,
        request.identityId,
        normalizePath(request.projectPath) ?? ""
      ].join("\u001f"))
      .join("\u001e"),
    [requests]
  );
  const [icons, setIcons] = useState<Readonly<Record<string, ResolvedIdentityIcon>>>({});

  useEffect(() => {
    let disposed = false;
    const run = async (): Promise<void> => {
      const entries = await Promise.all(requests.map(async (request) => {
        const projectPath = normalizePath(request.projectPath);
        const project = iconFromProject(
          await resolveProjectIdentity(desktopApi, projectPath)
        );
        return [request.identityId, project ?? emptyIdentity] as const;
      }));
      if (!disposed) {
        setIcons(Object.fromEntries(entries));
      }
    };
    void run();
    return () => {
      disposed = true;
    };
  }, [desktopApi, requests, signature]);

  return icons;
};
