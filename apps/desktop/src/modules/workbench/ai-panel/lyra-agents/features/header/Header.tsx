// ============================================================================
// Header — frosted top bar with session title, total diff, project name
// ============================================================================

import {
  AppBadge,
  AppIconButton,
  AppMenu,
  AppMenuContent,
  AppMenuItem,
  AppMenuSeparator,
  AppMenuTrigger,
} from "@renderer/ui/components";
import {
  Archive,
  ArrowLeftToLine,
  ArrowRightToLine,
  CheckCircle,
  Hammer,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2
} from "lucide-react";
import { useState } from "react";
import { t } from "@workbench/i18n";
import type { AgentMode } from "../../../../../../shared/agent";
import { useData } from "../../data/DataProvider";
import type { AiPanelSide } from "../../../types";

export function Header() {
  const { session } = useData();
  return (
    <header className="lyra-agents-header">
      <div className="lyra-agents-header-title" title={session.title}>{session.title}</div>
      <HeaderControls />
    </header>
  );
}

export function HeaderControls({
  showNewSessionButton = true,
  forceShowNewSessionButton = false,
  aiPanelSide,
  onToggleAiPanelSide,
  movePanelToLeftLabel,
  movePanelToRightLabel
}: {
  readonly showNewSessionButton?: boolean;
  readonly forceShowNewSessionButton?: boolean;
  readonly aiPanelSide?: AiPanelSide;
  readonly onToggleAiPanelSide?: () => void;
  readonly movePanelToLeftLabel?: string;
  readonly movePanelToRightLabel?: string;
}) {
  const {
    session,
    messages,
    isTurnRunning,
    createSession,
    runImprove,
    runRefactor,
    runReview,
    runJudge,
    renameSession,
    archiveSession,
    deleteSession,
  } = useData();
  const [creating, setCreating] = useState(false);
  const [newSessionMenuOpen, setNewSessionMenuOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState<
    "improve" | "refactor" | "review" | "judge" | null
  >(null);
  const [sessionActionBusy, setSessionActionBusy] = useState(false);
  const shouldShowNewSessionButton =
    showNewSessionButton && (forceShowNewSessionButton || messages.length > 0);
  const showProjectActions =
    session.projectBound && !session.workingDirIsHome;
  const canManageSession =
    typeof session.id === "string" && session.id.trim().length > 0;
  const canMovePanel =
    onToggleAiPanelSide !== undefined
    && aiPanelSide !== undefined
    && (aiPanelSide === "left"
      ? movePanelToRightLabel !== undefined
      : movePanelToLeftLabel !== undefined);
  const hasMenuItems = showProjectActions || canManageSession || canMovePanel;

  const onCreateSession = async (mode: AgentMode) => {
    if (creating) return;
    setNewSessionMenuOpen(false);
    setCreating(true);
    try {
      await createSession(mode);
    } finally {
      setCreating(false);
    }
  };

  const runMenuAction = async (
    action: "improve" | "refactor" | "review" | "judge",
    handler: () => Promise<void>
  ) => {
    if (isTurnRunning || actionBusy !== null) return;
    setMenuOpen(false);
    setActionBusy(action);
    try {
      await handler();
    } finally {
      setActionBusy(null);
    }
  };

  const actionDisabled = isTurnRunning || actionBusy !== null;
  const sessionActionDisabled = sessionActionBusy || isTurnRunning;
  const menuItemClassName = "lyra-app-menu-item-with-icon lyra-agents-header-menu-item";
  const modeMenuItemClassName = "lyra-agents-header-menu-item lyra-agents-header-mode-item";

  return (
    <div className="lyra-agents-header-right">
      {shouldShowNewSessionButton ? (
        <AppMenu open={newSessionMenuOpen} onOpenChange={setNewSessionMenuOpen}>
          <AppMenuTrigger asChild>
            <AppIconButton
              className="lyra-agents-header-action app-header-new-session"
              type="button"
              aria-label={t("header.newSession")}
              title={t("header.newSession")}
              disabled={creating}
              active={newSessionMenuOpen}
            >
              <Plus aria-hidden="true" size={14} strokeWidth={1.8} />
            </AppIconButton>
          </AppMenuTrigger>
          <AppMenuContent className="lyra-agents-header-menu" align="end" sideOffset={6}>
            <AppMenuItem
              className={modeMenuItemClassName}
              disabled={creating}
              onSelect={() => void onCreateSession("solo")}
            >
              <span className="lyra-app-menu-item-label">{t("lyra-agents-oma.soloMode")}</span>
            </AppMenuItem>
            <AppMenuItem
              className={modeMenuItemClassName}
              disabled={creating}
              onSelect={() => void onCreateSession("oma")}
            >
              <span className="lyra-app-menu-item-label">{t("lyra-agents-oma.omaMode")}</span>
              <AppBadge tone="warning" className="lyra-agents-header-mode-beta">
                {t("lyra-agents-oma.beta")}
              </AppBadge>
            </AppMenuItem>
          </AppMenuContent>
        </AppMenu>
      ) : null}
      {hasMenuItems ? (
      <AppMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <div className="lyra-agents-header-more">
          <AppMenuTrigger asChild>
            <AppIconButton
              className="lyra-agents-header-action app-header-more-button"
              type="button"
              aria-label={t("header.more")}
              title={t("header.more")}
              active={menuOpen}
            >
              <MoreHorizontal aria-hidden="true" size={15} strokeWidth={1.8} />
            </AppIconButton>
          </AppMenuTrigger>
          <AppMenuContent className="lyra-agents-header-menu" align="end" sideOffset={6}>
            {showProjectActions ? (
              <>
                <AppMenuItem
                  className={menuItemClassName}
                  disabled={actionDisabled}
                  onSelect={() => void runMenuAction("improve", () => runImprove())}
                >
                  <Sparkles aria-hidden="true" size={14} strokeWidth={1.8} />
                  <span className="lyra-app-menu-item-label">{t("header.improve")}</span>
                </AppMenuItem>
                <AppMenuItem
                  className={menuItemClassName}
                  disabled={actionDisabled}
                  onSelect={() => void runMenuAction("refactor", () => runRefactor())}
                >
                  <Hammer aria-hidden="true" size={14} strokeWidth={1.8} />
                  <span className="lyra-app-menu-item-label">{t("header.refactor")}</span>
                </AppMenuItem>
                <AppMenuItem
                  className={menuItemClassName}
                  disabled={actionDisabled}
                  onSelect={() => void runMenuAction("review", runReview)}
                >
                  <Search aria-hidden="true" size={14} strokeWidth={1.8} />
                  <span className="lyra-app-menu-item-label">{t("header.review")}</span>
                </AppMenuItem>
                <AppMenuItem
                  className={menuItemClassName}
                  disabled={actionDisabled}
                  onSelect={() => void runMenuAction("judge", runJudge)}
                >
                  <CheckCircle aria-hidden="true" size={14} strokeWidth={1.8} />
                  <span className="lyra-app-menu-item-label">{t("header.judge")}</span>
                </AppMenuItem>
              </>
            ) : null}
            {showProjectActions && canManageSession ? <AppMenuSeparator /> : null}
            {canManageSession ? (
              <>
                <AppMenuItem
                  className={menuItemClassName}
                  disabled={sessionActionDisabled}
                  onSelect={() => {
                    setMenuOpen(false);
                    renameSession();
                  }}
                >
                  <Pencil aria-hidden="true" size={14} strokeWidth={1.8} />
                  <span className="lyra-app-menu-item-label">{t("header.rename")}</span>
                </AppMenuItem>
                <AppMenuItem
                  className={menuItemClassName}
                  disabled={sessionActionDisabled}
                  onSelect={() => {
                    if (sessionActionBusy) return;
                    setMenuOpen(false);
                    setSessionActionBusy(true);
                    void archiveSession().finally(() => {
                      setSessionActionBusy(false);
                    });
                  }}
                >
                  <Archive aria-hidden="true" size={14} strokeWidth={1.8} />
                  <span className="lyra-app-menu-item-label">{t("header.archive")}</span>
                </AppMenuItem>
                <AppMenuItem
                  className={menuItemClassName}
                  disabled={sessionActionDisabled}
                  onSelect={() => {
                    setMenuOpen(false);
                    deleteSession();
                  }}
                >
                  <Trash2 aria-hidden="true" size={14} strokeWidth={1.8} />
                  <span className="lyra-app-menu-item-label">{t("header.delete")}</span>
                </AppMenuItem>
              </>
            ) : null}
            {canMovePanel ? (
              <>
                {showProjectActions || canManageSession ? <AppMenuSeparator /> : null}
                <AppMenuItem
                  className={menuItemClassName}
                  onSelect={() => {
                    setMenuOpen(false);
                    onToggleAiPanelSide?.();
                  }}
                >
                  {aiPanelSide === "left" ? (
                    <ArrowRightToLine aria-hidden="true" size={14} strokeWidth={1.8} />
                  ) : (
                    <ArrowLeftToLine aria-hidden="true" size={14} strokeWidth={1.8} />
                  )}
                  <span className="lyra-app-menu-item-label">
                    {aiPanelSide === "left" ? movePanelToRightLabel : movePanelToLeftLabel}
                  </span>
                </AppMenuItem>
              </>
            ) : null}
          </AppMenuContent>
        </div>
      </AppMenu>
      ) : (
        <AppIconButton
          className="lyra-agents-header-action app-header-more-button"
          type="button"
          disabled
          aria-label={t("header.more")}
          title={t("header.moreDisabled")}
        >
          <MoreHorizontal aria-hidden="true" size={15} strokeWidth={1.8} />
        </AppIconButton>
      )}
    </div>
  );
}
