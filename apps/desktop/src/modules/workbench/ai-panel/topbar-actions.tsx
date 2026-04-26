import {
  ClipboardCheck,
  FolderOpen,
  MoreHorizontal,
  PanelLeftOpen,
  PanelRightOpen,
  ShieldCheck
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { renderAiPanelTopbarIcon } from "./icon-registry";
import type { AiPanelSide } from "./types";

type AiPanelTopbarActionsProps = {
  readonly onRequestProjectBind?: (() => void) | undefined;
  readonly activeBoundProjectName: string | null;
  readonly isBindingProject: boolean;
  readonly bindProjectLabel: string;
  readonly isAgentAvailable: boolean;
  readonly onOpenHistory?: (() => void) | undefined;
  readonly onOpenMcp?: (() => void) | undefined;
  readonly onOpenSkills?: (() => void) | undefined;
  readonly onOpenPermissions?: (() => void) | undefined;
  readonly openHistoryLabel?: string | undefined;
  readonly openMcpLabel?: string | undefined;
  readonly openSkillsLabel?: string | undefined;
  readonly openPermissionsLabel?: string | undefined;
  readonly onStartReview?: (() => void) | undefined;
  readonly reviewChangesLabel?: string | undefined;
  readonly aiPanelSide?: AiPanelSide | undefined;
  readonly onToggleAiPanelSide?: (() => void) | undefined;
  readonly movePanelToLeftLabel?: string | undefined;
  readonly movePanelToRightLabel?: string | undefined;
  readonly moreActionsLabel?: string | undefined;
};

export const AiPanelTopbarActions = ({
  onRequestProjectBind,
  activeBoundProjectName,
  isBindingProject,
  bindProjectLabel,
  isAgentAvailable,
  onOpenHistory,
  onOpenMcp,
  onOpenSkills,
  onOpenPermissions,
  openHistoryLabel,
  openMcpLabel,
  openSkillsLabel,
  openPermissionsLabel,
  onStartReview,
  reviewChangesLabel,
  aiPanelSide = "left",
  onToggleAiPanelSide,
  movePanelToLeftLabel = "Move panel to left",
  movePanelToRightLabel = "Move panel to right",
  moreActionsLabel = "More actions",
}: AiPanelTopbarActionsProps) => {
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const hasMoreActions =
    (onOpenMcp !== undefined && openMcpLabel !== undefined)
    || (onOpenSkills !== undefined && openSkillsLabel !== undefined)
    || (onOpenPermissions !== undefined && openPermissionsLabel !== undefined)
    || onToggleAiPanelSide !== undefined
    || onStartReview !== undefined;
  const movePanelLabel =
    aiPanelSide === "left" ? movePanelToRightLabel : movePanelToLeftLabel;
  const MovePanelIcon = aiPanelSide === "left" ? PanelRightOpen : PanelLeftOpen;

  useEffect(() => {
    if (!isMoreOpen) {
      return;
    }
    const closeOnPointerDown = (event: PointerEvent): void => {
      if (moreMenuRef.current?.contains(event.target as Node) === true) {
        return;
      }
      setIsMoreOpen(false);
    };
    window.addEventListener("pointerdown", closeOnPointerDown);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
    };
  }, [isMoreOpen]);

  return (
    <div className="lyra-ai-panel-topbar-actions">
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
      {hasMoreActions ? (
        <div className="lyra-ai-panel-topbar-more" ref={moreMenuRef}>
          <button
            type="button"
            className="lyra-ai-panel-topbar-action"
            onClick={() => {
              setIsMoreOpen((current) => !current);
            }}
            aria-label={moreActionsLabel}
            aria-haspopup="menu"
            aria-expanded={isMoreOpen}
            title={moreActionsLabel}
          >
            <MoreHorizontal size={15} aria-hidden="true" />
          </button>
          {isMoreOpen ? (
            <div className="lyra-ai-panel-topbar-more-menu" role="menu">
              {onOpenMcp === undefined || openMcpLabel === undefined ? null : (
                <button
                  type="button"
                  className="lyra-ai-panel-topbar-more-item"
                  role="menuitem"
                  onClick={() => {
                    setIsMoreOpen(false);
                    onOpenMcp();
                  }}
                >
                  {renderAiPanelTopbarIcon("mcp")}
                  <span>{openMcpLabel}</span>
                </button>
              )}
              {onOpenSkills === undefined || openSkillsLabel === undefined ? null : (
                <button
                  type="button"
                  className="lyra-ai-panel-topbar-more-item"
                  role="menuitem"
                  onClick={() => {
                    setIsMoreOpen(false);
                    onOpenSkills();
                  }}
                >
                  {renderAiPanelTopbarIcon("skills")}
                  <span>{openSkillsLabel}</span>
                </button>
              )}
              {onOpenPermissions === undefined || openPermissionsLabel === undefined ? null : (
                <button
                  type="button"
                  className="lyra-ai-panel-topbar-more-item"
                  role="menuitem"
                  onClick={() => {
                    setIsMoreOpen(false);
                    onOpenPermissions();
                  }}
                >
                  <ShieldCheck size={14} aria-hidden="true" />
                  <span>{openPermissionsLabel}</span>
                </button>
              )}
              {onToggleAiPanelSide === undefined ? null : (
                <button
                  type="button"
                  className="lyra-ai-panel-topbar-more-item"
                  role="menuitem"
                  onClick={() => {
                    setIsMoreOpen(false);
                    onToggleAiPanelSide();
                  }}
                >
                  <MovePanelIcon size={14} aria-hidden="true" />
                  <span>{movePanelLabel}</span>
                </button>
              )}
              {onStartReview === undefined ? null : (
                <button
                  type="button"
                  className="lyra-ai-panel-topbar-more-item"
                  role="menuitem"
                  disabled={!isAgentAvailable}
                  onClick={() => {
                    setIsMoreOpen(false);
                    onStartReview();
                  }}
                >
                  <ClipboardCheck size={14} aria-hidden="true" />
                  <span>{reviewChangesLabel ?? "Review changes"}</span>
                </button>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
