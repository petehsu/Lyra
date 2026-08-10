import { ChevronDown, Folder } from "lucide-react";
import { useEffect, useState } from "react";
import {
  AppButton,
  AppMenu,
  AppMenuContent,
  AppMenuItem,
  AppMenuSeparator,
  AppMenuTrigger,
  reportWorkbenchError
} from "@renderer/ui/components";
import { LyraLogo } from "@renderer/ui/app";
import type { DetectedEditor, LyraDesktopApi } from "../../../../../../shared/desktop-bridge";
import { IdentityIconView, useSessionIdentityIcon } from "../../../../identity";
import { formatMessage, t } from "@workbench/i18n";

const ICON_SIZE = 13;
const ICON_STROKE_WIDTH = 2;

export function ProjectDirChip({
  desktopApi,
  sessionId,
  projectName,
  workingDir,
  isHome,
  canOpenProjectTree,
  onChooseProject,
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
  onOpenProjectTree: () => Promise<void> | void;
  onOpenInFileManager: (path: string) => Promise<void> | void;
}) {
  const icon = useSessionIdentityIcon(desktopApi ?? null, workingDir);
  const label = isHome || projectName === null || projectName.trim().length === 0
    ? t("lyra-agents-composer.workingDirHome")
    : projectName.trim();
  const [editors, setEditors] = useState<DetectedEditor[]>([]);

  useEffect(() => {
    if (!canOpenProjectTree || !desktopApi?.detectEditors) return;
    void desktopApi.detectEditors().then(setEditors).catch(() => undefined);
  }, [canOpenProjectTree, desktopApi]);

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
      {canOpenProjectTree ? (
        <ChevronDown size={12} strokeWidth={1.8} className="lyra-agents-project-dir-chip-chevron" aria-hidden="true" />
      ) : null}
    </>
  );

  if (!canOpenProjectTree) {
    return (
      <AppButton
        variant="ghost"
        size="sm"
        type="button"
        className="lyra-agents-project-dir-chip"
        aria-label={label}
        title={label}
        onClick={() => { void onChooseProject(); }}
      >
        {chipContent}
      </AppButton>
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
        <AppButton
          variant="ghost"
          size="sm"
          type="button"
          className="lyra-agents-project-dir-chip"
          aria-label={label}
          title={t("header.openProjectTree")}
        >
          {chipContent}
        </AppButton>
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
