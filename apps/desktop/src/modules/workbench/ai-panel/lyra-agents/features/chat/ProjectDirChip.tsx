// ============================================================================
// ProjectDirChip — working-directory chip shown outside the composer input box
// ============================================================================
//
// Sits at the bottom-left of the composer stack (outside the textarea). Shows
// "Home" when the session is bound to the default home directory, otherwise the
// bound project's name. Clicking it binds Home/draft sessions, then opens the
// project file tree once the session is bound to a real project.

import { Folder } from "lucide-react";
import { AppButton } from "@renderer/ui/components";
import { t } from "../../core/i18n";

const ICON_SIZE = 13;
const ICON_STROKE_WIDTH = 2;

export function ProjectDirChip({
  projectName,
  isHome,
  canOpenProjectTree,
  onChooseProject,
  onOpenProjectTree,
}: {
  /** Bound project's display name; ignored when isHome is true. */
  projectName: string | null;
  /** True when the session is bound to the default home directory. */
  isHome: boolean;
  /** True when the session is bound to a real project. */
  canOpenProjectTree: boolean;
  onChooseProject: () => Promise<void> | void;
  onOpenProjectTree: () => Promise<void> | void;
}) {
  const label = isHome || projectName === null || projectName.trim().length === 0
    ? t("lyra-agents-composer.workingDirHome")
    : projectName.trim();
  const title = canOpenProjectTree ? t("header.openProjectTree") : label;
  return (
    <AppButton
      variant="ghost"
      size="sm"
      type="button"
      className="lyra-agents-project-dir-chip"
      aria-label={label}
      title={title}
      onClick={() => {
        void (canOpenProjectTree ? onOpenProjectTree() : onChooseProject());
      }}
    >
      <Folder size={ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
      <span className="lyra-agents-project-dir-chip-label">{label}</span>
    </AppButton>
  );
}
