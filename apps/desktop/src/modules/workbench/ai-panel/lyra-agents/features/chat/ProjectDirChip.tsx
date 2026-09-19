import { ChevronDown, Folder } from "@lyra/icons";
import { useEffect, useState } from "react";
import {
  AppButton,
  AppMenu,
  AppMenuContent,
  AppMenuItem,
  AppMenuSeparator,
  AppMenuSub,
  AppMenuSubContent,
  AppMenuSubTrigger,
  AppMenuTrigger,
  reportWorkbenchError
} from "@renderer/ui/components";
import { LyraLogo } from "@renderer/ui/app";
import type { DetectedEditor, LyraDesktopApi } from "../../../../../../shared/desktop-bridge";
import { IdentityIconView, useSessionIdentityIcon } from "../../../../identity";
import { formatMessage, t } from "@workbench/i18n";

const ICON_SIZE = 13;
const ICON_STROKE_WIDTH = 2;

export type SessionProjectOption = {
  readonly path: string;
  readonly name: string;
};

const projectNameFromPath = (value: string): string => {
  const normalized = value.trim().replace(/[\\/]+$/u, "");
  if (normalized.length === 0) {
    return value;
  }
  const parts = normalized.split(/[\\/]+/u);
  return parts[parts.length - 1] ?? normalized;
};

const isLikelyHomeDir = (value: string): boolean => {
  const normalized = value.trim().replaceAll("\\", "/").replace(/\/+$/u, "");
  return normalized.length === 0
    || normalized === "/"
    || normalized === "~"
    || /^\/(?:Users|home)\/[^/]+$/u.test(normalized)
    || /^[A-Za-z]:\/Users\/[^/]+$/u.test(normalized);
};

export const collectSessionProjectOptions = (
  sessions: readonly { readonly workingDir?: string | null }[]
): readonly SessionProjectOption[] => {
  const seen = new Set<string>();
  const options: SessionProjectOption[] = [];
  for (const session of sessions) {
    const path = session.workingDir?.trim() ?? "";
    if (path.length === 0 || isLikelyHomeDir(path) || seen.has(path)) {
      continue;
    }
    seen.add(path);
    options.push({ path, name: projectNameFromPath(path) });
  }
  return options;
};

export function ProjectDirChip({
  desktopApi,
  sessionId,
  projectName,
  workingDir,
  isHome,
  canOpenProjectTree,
  onChooseProject,
  onSelectProject,
  onOpenProjectTree,
  onOpenInFileManager,
}: {
  desktopApi?: LyraDesktopApi | null;
  sessionId?: string | null | undefined;
  projectName: string | null;
  workingDir: string | null;
  isHome: boolean;
  canOpenProjectTree: boolean;
  onChooseProject: () => Promise<void> | void;
  onSelectProject?: (path: string) => Promise<void> | void;
  onOpenProjectTree: () => Promise<void> | void;
  onOpenInFileManager: (path: string) => Promise<void> | void;
}) {
  const icon = useSessionIdentityIcon(desktopApi ?? null, workingDir);
  const label = isHome || projectName === null || projectName.trim().length === 0
    ? t("lyra-agents-composer.workingDirHome")
    : projectName.trim();
  const [editors, setEditors] = useState<DetectedEditor[]>([]);
  const [knownProjects, setKnownProjects] = useState<readonly SessionProjectOption[]>([]);
  const [chooseOpen, setChooseOpen] = useState(false);

  useEffect(() => {
    if (!canOpenProjectTree || !desktopApi?.detectEditors) return;
    void desktopApi.detectEditors().then(setEditors).catch(() => undefined);
  }, [canOpenProjectTree, desktopApi]);

  useEffect(() => {
    if (canOpenProjectTree) {
      setKnownProjects([]);
      return undefined;
    }
    const listSessions = desktopApi?.agent?.listSessions;
    if (listSessions === undefined) {
      setKnownProjects([]);
      return undefined;
    }
    let cancelled = false;
    void listSessions({ limit: 500 })
      .then((response) => {
        if (!cancelled) {
          setKnownProjects(collectSessionProjectOptions(response.sessions));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setKnownProjects([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canOpenProjectTree, desktopApi, sessionId]);

  const chipContent = (
    <>
      <IdentityIconView
        className="lyra-agents-project-dir-chip-icon"
        imageClassName="lyra-agents-project-dir-chip-image"
        iconUrl={icon.url}
        label={icon.label}
        fallback={
          icon.renderHint === "lyra-logo"
            ? <LyraLogo className="lyra-agents-project-dir-chip-lyra-logo" alt="" />
            : <Folder size={ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
        }
      />
      <span className="lyra-agents-project-dir-chip-label">{label}</span>
      <ChevronDown size={12} strokeWidth={1.8} className="lyra-agents-project-dir-chip-chevron" aria-hidden="true" />
    </>
  );

  const chipTrigger = (
    <AppButton
      variant="ghost"
      size="sm"
      type="button"
      className="lyra-agents-project-dir-chip"
      aria-label={label}
      title={
        canOpenProjectTree
          ? t("header.openProjectTree")
          : knownProjects.length > 0
            ? t("lyra-agents-composer.chooseProject")
            : t("lyra-agents-composer.newProject")
      }
    >
      {chipContent}
    </AppButton>
  );

  if (!canOpenProjectTree) {
    return (
      <AppMenu
        onOpenChange={(open) => {
          if (!open) {
            setChooseOpen(false);
          }
        }}
      >
        <AppMenuTrigger asChild>
          {chipTrigger}
        </AppMenuTrigger>
        <AppMenuContent align="start" sideOffset={4}>
          {knownProjects.length > 0 ? (
            <AppMenuSub
              open={chooseOpen}
              onOpenChange={setChooseOpen}
            >
              <AppMenuSubTrigger
                onFocus={() => setChooseOpen(true)}
                onMouseEnter={() => setChooseOpen(true)}
                onPointerMove={() => setChooseOpen(true)}
              >
                {t("lyra-agents-composer.chooseProject")}
              </AppMenuSubTrigger>
              <AppMenuSubContent sideOffset={4} alignOffset={-4}>
                {knownProjects.map((project) => (
                  <AppMenuItem
                    key={project.path}
                    onClick={() => {
                      void onSelectProject?.(project.path);
                    }}
                  >
                    {project.name}
                  </AppMenuItem>
                ))}
              </AppMenuSubContent>
            </AppMenuSub>
          ) : null}
          <AppMenuItem onClick={() => { void onChooseProject(); }}>
            {t("lyra-agents-composer.newProject")}
          </AppMenuItem>
        </AppMenuContent>
      </AppMenu>
    );
  }

  const reveal = () => {
    if (workingDir) {
      void desktopApi?.revealInFolder(workingDir).catch((error: unknown) => {
        reportWorkbenchError(error, t("appStatus.revealPathFailed"));
      });
    }
  };
  const openEditor = (editorId: string) => {
    if (workingDir) {
      void desktopApi?.openInEditor({ editorId, path: workingDir }).catch((error: unknown) => {
        reportWorkbenchError(error, t("appStatus.openEditorFailed"));
      });
    }
  };

  return (
    <AppMenu>
      <AppMenuTrigger asChild>
        {chipTrigger}
      </AppMenuTrigger>
      <AppMenuContent align="start" sideOffset={4}>
        <AppMenuItem onClick={() => { void onOpenProjectTree(); }}>
          {t("header.openProjectTree")}
        </AppMenuItem>
        <AppMenuItem onClick={() => { if (workingDir) void onOpenInFileManager(workingDir); }}>
          {t("header.openInFileManager")}
        </AppMenuItem>
        <AppMenuItem onClick={reveal}>
          {t("header.revealInFileManager")}
        </AppMenuItem>
        {editors.length > 0 ? <AppMenuSeparator /> : null}
        {editors.map((editor) => (
          <AppMenuItem key={editor.id} onClick={() => openEditor(editor.id)}>
            <span className="lyra-agents-editor-menu-row">
              {editor.icon ? <img src={editor.icon} alt="" className="lyra-agents-editor-menu-icon" /> : null}
              {formatMessage("header.openInEditor", { editor: editor.label })}
            </span>
          </AppMenuItem>
        ))}
      </AppMenuContent>
    </AppMenu>
  );
}
