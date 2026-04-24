import { FolderOpen, Plus } from "lucide-react";

import { renderAiPanelTopbarIcon } from "./icon-registry";

type AiPanelTopbarActionsProps = {
  readonly onCreateThread?: (() => void) | undefined;
  readonly createThreadLabel?: string | undefined;
  readonly onRequestProjectBind?: (() => void) | undefined;
  readonly activeBoundProjectName: string | null;
  readonly isBindingProject: boolean;
  readonly bindProjectLabel: string;
  readonly isAgentAvailable: boolean;
  readonly onOpenHistory?: (() => void) | undefined;
  readonly onOpenMcp?: (() => void) | undefined;
  readonly onOpenSkills?: (() => void) | undefined;
  readonly openHistoryLabel?: string | undefined;
  readonly openMcpLabel?: string | undefined;
  readonly openSkillsLabel?: string | undefined;
};

export const AiPanelTopbarActions = ({
  onCreateThread,
  createThreadLabel,
  onRequestProjectBind,
  activeBoundProjectName,
  isBindingProject,
  bindProjectLabel,
  isAgentAvailable,
  onOpenHistory,
  onOpenMcp,
  onOpenSkills,
  openHistoryLabel,
  openMcpLabel,
  openSkillsLabel,
}: AiPanelTopbarActionsProps) => (
  <div className="lyra-ai-panel-topbar-actions">
    {onCreateThread === undefined || createThreadLabel === undefined ? null : (
      <button
        type="button"
        className="lyra-ai-panel-topbar-action"
        disabled={!isAgentAvailable}
        onClick={onCreateThread}
        aria-label={createThreadLabel}
        title={createThreadLabel}
      >
        <Plus size={14} aria-hidden="true" />
      </button>
    )}
    {onRequestProjectBind === undefined ? null : (
      <button
        type="button"
        className={
          activeBoundProjectName === null
            ? (
                isBindingProject
                  ? "lyra-ai-panel-topbar-action lyra-ai-panel-topbar-action-pending"
                  : "lyra-ai-panel-topbar-action"
              )
            : (
                isBindingProject
                  ? "lyra-ai-panel-topbar-action lyra-ai-panel-topbar-action-active lyra-ai-panel-topbar-action-pending"
                  : "lyra-ai-panel-topbar-action lyra-ai-panel-topbar-action-active"
              )
        }
        disabled={isBindingProject || !isAgentAvailable}
        aria-label={bindProjectLabel}
        title={activeBoundProjectName === null
          ? bindProjectLabel
          : `${bindProjectLabel}: ${activeBoundProjectName}`}
        onClick={onRequestProjectBind}
      >
        <FolderOpen size={14} aria-hidden="true" />
      </button>
    )}
    {onOpenHistory === undefined || openHistoryLabel === undefined ? null : (
      <button
        type="button"
        className="lyra-ai-panel-topbar-action"
        onClick={onOpenHistory}
        aria-label={openHistoryLabel}
        title={openHistoryLabel}
      >
        {renderAiPanelTopbarIcon("history")}
      </button>
    )}
    {onOpenMcp === undefined || openMcpLabel === undefined ? null : (
      <button
        type="button"
        className="lyra-ai-panel-topbar-action"
        onClick={onOpenMcp}
        aria-label={openMcpLabel}
        title={openMcpLabel}
      >
        {renderAiPanelTopbarIcon("mcp")}
      </button>
    )}
    {onOpenSkills === undefined || openSkillsLabel === undefined ? null : (
      <button
        type="button"
        className="lyra-ai-panel-topbar-action"
        onClick={onOpenSkills}
        aria-label={openSkillsLabel}
        title={openSkillsLabel}
      >
        {renderAiPanelTopbarIcon("skills")}
      </button>
    )}
  </div>
);
