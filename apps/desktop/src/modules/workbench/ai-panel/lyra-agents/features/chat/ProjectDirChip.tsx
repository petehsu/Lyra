// ============================================================================
// ProjectDirChip — working-directory chip shown outside the composer input box
// ============================================================================
//
// Sits at the bottom-left of the composer stack (outside the textarea). Shows
// "Home" when the session is bound to the default home directory, otherwise the
// bound project's name. When the project is bound, clicking opens a dropdown
// menu with options to open the project in Lyra's file tree, the system file
// manager, or any detected external editor/IDE. When not bound, clicking
// triggers the project chooser flow.

import { ChevronDown, Folder } from "lucide-react";
import { useEffect, useState } from "react";
import { AppButton } from "@renderer/ui/components";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@renderer/ui/primitives/dropdown-menu";
import { LyraLogo } from "@renderer/ui/app";
import type { DetectedEditor, LyraDesktopApi } from "../../../../../../shared/desktop-bridge";
import { IdentityIconView, useSessionIdentityIcon } from "../../../../identity";
import { formatMessage, t } from "../../core/i18n";

const ICON_SIZE = 13;
const ICON_STROKE_WIDTH = 2;

export function ProjectDirChip({
  desktopApi,
  projectName,
  workingDir,
  isHome,
  canOpenProjectTree,
  onChooseProject,
  onOpenProjectTree,
  onOpenInFileManager,
}: {
  desktopApi?: LyraDesktopApi | null;
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
    if (workingDir) void desktopApi?.revealInFolder(workingDir).catch(() => undefined);
  };
  const openEditor = (editorId: string) => {
    if (workingDir) void desktopApi?.openInEditor({ editorId, path: workingDir }).catch(() => undefined);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
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
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={4}>
        <DropdownMenuItem onClick={() => { void onOpenProjectTree(); }}>
          {t("header.openProjectTree")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => { if (workingDir) void onOpenInFileManager(workingDir); }}>
          {t("header.openInFileManager")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={reveal}>
          {t("header.revealInFileManager")}
        </DropdownMenuItem>
        {editors.length > 0 ? <DropdownMenuSeparator /> : null}
        {editors.map((editor) => (
          <DropdownMenuItem key={editor.id} onClick={() => openEditor(editor.id)}>
            <span className="lyra-agents-editor-menu-row">
              {editor.icon ? <img src={editor.icon} alt="" className="lyra-agents-editor-menu-icon" /> : null}
              {formatMessage("header.openInEditor", { editor: editor.label })}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}