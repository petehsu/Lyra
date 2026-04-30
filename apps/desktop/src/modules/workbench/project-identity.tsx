import { FolderOpen } from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactElement
} from "react";

import type { FilesApi } from "../../shared/desktop-bridge";
import type { FileManagerEntry } from "../../shared/file-manager";

const LYRA_LOGO_URL = new URL("../../renderer/assets/logo.svg", import.meta.url).toString();
const MAX_PROJECT_LOGO_SCAN_DIRS = 18;
const MAX_PROJECT_LOGO_SCAN_DEPTH = 2;

const PROJECT_LOGO_IMAGE_EXTENSIONS = new Set([
  "avif",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp"
]);

const PROJECT_LOGO_DIRECTORY_NAMES = new Set([
  ".lyra",
  "app",
  "assets",
  "brand",
  "icons",
  "images",
  "img",
  "public",
  "resources",
  "src",
  "static"
]);

type ProjectLogoScanResult = {
  readonly path: string;
  readonly score: number;
};

export const normalizeProjectRoot = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.replace(/\\/g, "/").replace(/\/+$/g, "");
};

const joinClassNames = (...values: Array<string | false | null | undefined>): string =>
  values.filter((value): value is string => typeof value === "string" && value.length > 0).join(" ");

const normalizeFileExtension = (value: string | undefined): string => {
  const raw = value?.trim().replace(/^\./u, "").toLowerCase();
  if (raw !== undefined && raw.length > 0) {
    return raw;
  }
  return "";
};

const extensionFromName = (name: string): string => {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === name.length - 1) {
    return "";
  }
  return name.slice(dotIndex + 1).toLowerCase();
};

const toFilePreviewUrl = (path: string): string =>
  `lyra-file://preview?path=${encodeURIComponent(path)}`;

const scoreProjectLogoEntry = (entry: FileManagerEntry, depth: number): number | null => {
  if (entry.kind !== "file") {
    return null;
  }
  const name = entry.name.trim().toLowerCase();
  const extension = normalizeFileExtension(entry.extension) || extensionFromName(name);
  if (PROJECT_LOGO_IMAGE_EXTENSIONS.has(extension) === false) {
    return null;
  }

  const baseName = name.replace(new RegExp(`\\.${extension}$`, "u"), "");
  const depthPenalty = depth * 40;
  if (baseName === "logo") {
    return 1000 - depthPenalty;
  }
  if (baseName === "icon" || baseName === "favicon") {
    return 820 - depthPenalty;
  }
  if (/^(app|brand|project)[-_.]?(logo|icon)$/u.test(baseName)) {
    return 760 - depthPenalty;
  }
  if (baseName.includes("logo")) {
    return 680 - depthPenalty;
  }
  if (baseName.includes("icon")) {
    return 520 - depthPenalty;
  }
  return null;
};

const shouldScanProjectLogoDirectory = (entry: FileManagerEntry, depth: number): boolean =>
  entry.kind === "directory"
  && depth < MAX_PROJECT_LOGO_SCAN_DEPTH
  && PROJECT_LOGO_DIRECTORY_NAMES.has(entry.name.trim().toLowerCase());

const readProjectLogoUrl = async (
  filesApi: Pick<FilesApi, "readDirectory">,
  projectRoot: string
): Promise<string | null> => {
  const queue: Array<{ readonly path: string; readonly depth: number }> = [
    { path: projectRoot, depth: 0 }
  ];
  const seenDirectories = new Set<string>();
  let best: ProjectLogoScanResult | null = null;

  while (queue.length > 0 && seenDirectories.size < MAX_PROJECT_LOGO_SCAN_DIRS) {
    const current = queue.shift();
    if (current === undefined || seenDirectories.has(current.path)) {
      continue;
    }
    seenDirectories.add(current.path);

    let entries: readonly FileManagerEntry[];
    try {
      entries = (await filesApi.readDirectory({ path: current.path })).entries;
    } catch (_error) {
      continue;
    }

    for (const entry of entries) {
      const score = scoreProjectLogoEntry(entry, current.depth);
      if (score !== null && (best === null || score > best.score)) {
        best = { path: entry.path, score };
      }
    }

    for (const entry of entries) {
      if (shouldScanProjectLogoDirectory(entry, current.depth)) {
        queue.push({ path: entry.path, depth: current.depth + 1 });
      }
    }
  }

  return best === null ? null : toFilePreviewUrl(best.path);
};

export const useProjectLogoMap = (
  filesApi: Pick<FilesApi, "readDirectory"> | undefined,
  projectRoots: readonly string[]
): ReadonlyMap<string, string | null> => {
  const roots = useMemo(
    () => {
      const normalized = projectRoots
        .map(normalizeProjectRoot)
        .filter((root): root is string => root !== null);
      return [...new Set(normalized)].sort();
    },
    [projectRoots]
  );
  const rootsKey = roots.join("\n");
  const [logoByRoot, setLogoByRoot] = useState<ReadonlyMap<string, string | null>>(
    () => new Map()
  );

  useEffect(() => {
    const nextRoots = new Set(roots);
    setLogoByRoot((current) => {
      const next = new Map<string, string | null>();
      for (const root of roots) {
        if (current.has(root)) {
          next.set(root, current.get(root) ?? null);
        }
      }
      return next;
    });

    if (filesApi === undefined || roots.length === 0) {
      return undefined;
    }

    let cancelled = false;
    for (const root of roots) {
      void readProjectLogoUrl(filesApi, root).then((logoUrl) => {
        if (cancelled || nextRoots.has(root) === false) {
          return;
        }
        setLogoByRoot((current) => {
          const next = new Map(current);
          next.set(root, logoUrl);
          return next;
        });
      });
    }

    return () => {
      cancelled = true;
    };
  }, [filesApi, roots, rootsKey]);

  return logoByRoot;
};

export const projectLogoUrlForRoot = (
  projectLogoByRoot: ReadonlyMap<string, string | null>,
  projectRoot: string | null | undefined
): string | null => {
  const normalizedRoot = normalizeProjectRoot(projectRoot);
  return normalizedRoot === null ? null : (projectLogoByRoot.get(normalizedRoot) ?? null);
};

export const ProjectIdentityIcon = ({
  projectRoot,
  projectLogoUrl,
  className,
  title
}: {
  readonly projectRoot?: string | null | undefined;
  readonly projectLogoUrl?: string | null | undefined;
  readonly className?: string | undefined;
  readonly title?: string | undefined;
}): ReactElement => {
  const normalizedRoot = normalizeProjectRoot(projectRoot);
  const projectLogoSrc =
    projectLogoUrl !== null && projectLogoUrl !== undefined && projectLogoUrl.length > 0
      ? projectLogoUrl
      : null;
  const kind =
    projectLogoSrc !== null
      ? "project-logo"
      : normalizedRoot === null
        ? "lyra"
        : "bound-project";
  const style =
    kind === "lyra"
      ? ({
          "--lyra-project-identity-lyra-logo-url": `url("${LYRA_LOGO_URL}")`
        } as CSSProperties)
      : undefined;

  return (
    <span
      className={joinClassNames(
        "lyra-project-identity-icon",
        `lyra-project-identity-icon-${kind}`,
        className
      )}
      data-project-icon-kind={kind}
      title={title ?? normalizedRoot ?? undefined}
      aria-hidden="true"
      style={style}
    >
      {projectLogoSrc !== null ? (
        <img
          className="lyra-project-identity-icon-image"
          src={projectLogoSrc}
          alt=""
          draggable={false}
        />
      ) : normalizedRoot !== null ? (
        <FolderOpen size={14} aria-hidden="true" />
      ) : (
        <span className="lyra-project-identity-lyra-logo" />
      )}
    </span>
  );
};
