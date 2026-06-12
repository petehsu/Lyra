// ============================================================================
// Header — frosted top bar with session title, total diff, project name
// ============================================================================

import {
  AppButton,
  AppIconButton,
  AppInput,
  AppMenu,
  AppMenuContent,
  AppMenuItem,
  AppMenuTrigger,
  AppSwitch,
  AppTextarea
} from "@renderer/ui/components";
import {
  ArrowRightLeft,
  Bot,
  CheckCircle,
  CopyPlus,
  FlaskConical,
  Folder,
  Hammer,
  MessageSquare,
  Moon,
  MoreHorizontal,
  PackageOpen,
  Search,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
  Target
} from "lucide-react";
import { useEffect, useState } from "react";
import { t } from "../../core/i18n";
import type { AgentGoalItem } from "../../core/types";
import { useData } from "../../data/DataProvider";

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
  showNewSessionButton = true
}: {
  readonly showNewSessionButton?: boolean;
}) {
  const {
    session,
    messages,
    isTurnRunning,
    createSession,
    bindProject,
    openProjectTree,
    openSelfDevLab,
    openOvernightLab,
    runImprove,
    runRefactor,
    runReview,
    runJudge,
    runSubagent,
    askSideQuestion,
    splitSession,
    transferSession,
    compactContext,
    openGoals,
    listGoals,
    showGoal,
    resumeGoal,
    updateAutomation
  } = useData();
  const [creating, setCreating] = useState(false);
  const [bindingProject, setBindingProject] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<"subagent" | "btw" | "goals" | "automation" | null>(null);
  const [actionBusy, setActionBusy] = useState<
    | "improve"
    | "refactor"
    | "review"
    | "judge"
    | "subagent"
    | "btw"
    | "split"
    | "transfer"
    | "compact"
    | "goals"
    | "resumeGoal"
    | "automation"
    | "selfdev"
    | "overnight"
    | null
  >(null);
  const [subagentPrompt, setSubagentPrompt] = useState("");
  const [subagentType, setSubagentType] = useState("general");
  const [subagentModel, setSubagentModel] = useState("");
  const [subagentContinue, setSubagentContinue] = useState("");
  const [btwQuestion, setBtwQuestion] = useState("");
  const [goalItems, setGoalItems] = useState<readonly AgentGoalItem[]>([]);
  const [goalsLoading, setGoalsLoading] = useState(false);
  const [automationModel, setAutomationModel] = useState("");
  const [automationReview, setAutomationReview] = useState(false);
  const [automationJudge, setAutomationJudge] = useState(false);
  const projectName = session.project.trim();
  const projectTitle = session.projectBound && session.workingDir !== null
    ? session.workingDir
    : t("header.bindProject");
  const hasBoundProject =
    session.projectBound && session.workingDir !== null && projectName.length > 0;
  const shouldShowNewSessionButton = showNewSessionButton && messages.length > 0;

  useEffect(() => {
    if (dialog !== "automation") return;
    setAutomationModel(session.automation?.subagentModel ?? "");
    setAutomationReview(session.automation?.autoreviewEnabled ?? false);
    setAutomationJudge(session.automation?.autojudgeEnabled ?? false);
  }, [
    dialog,
    session.automation?.autojudgeEnabled,
    session.automation?.autoreviewEnabled,
    session.automation?.subagentModel
  ]);

  const onCreateSession = async () => {
    if (creating) return;
    setCreating(true);
    try {
      await createSession();
    } finally {
      setCreating(false);
    }
  };

  const runMenuAction = async (
    action: "review" | "judge",
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

  const runImmediateAction = async (
    action: Exclude<typeof actionBusy, null | "review" | "judge" | "subagent" | "btw" | "automation">,
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

  const openDialog = (target: "subagent" | "btw" | "automation") => {
    if (isTurnRunning || actionBusy !== null) return;
    setMenuOpen(false);
    setDialog(target);
  };

  const refreshGoals = async () => {
    if (goalsLoading) return;
    setGoalsLoading(true);
    try {
      setGoalItems(await listGoals());
    } finally {
      setGoalsLoading(false);
    }
  };

  const openGoalsDialog = () => {
    if (actionBusy !== null) return;
    setMenuOpen(false);
    setDialog("goals");
    void refreshGoals();
  };

  const openGoalOverview = async () => {
    if (actionBusy !== null) return;
    setActionBusy("goals");
    try {
      await openGoals();
    } finally {
      setActionBusy(null);
    }
  };

  const selectGoal = async (goalId: string) => {
    if (actionBusy !== null) return;
    setActionBusy("goals");
    try {
      await showGoal(goalId);
      setDialog(null);
    } finally {
      setActionBusy(null);
    }
  };

  const submitSubagent = async () => {
    const prompt = subagentPrompt.trim();
    if (prompt.length === 0 || actionBusy !== null) return;
    setActionBusy("subagent");
    try {
      await runSubagent({
        prompt,
        subagentType: subagentType.trim() || "general",
        model: subagentModel.trim() || null,
        continueSessionId: subagentContinue.trim() || null
      });
      setDialog(null);
      setSubagentPrompt("");
      setSubagentModel("");
      setSubagentContinue("");
    } finally {
      setActionBusy(null);
    }
  };

  const submitBtw = async () => {
    const question = btwQuestion.trim();
    if (question.length === 0 || actionBusy !== null) return;
    setActionBusy("btw");
    try {
      await askSideQuestion(question);
      setDialog(null);
      setBtwQuestion("");
    } finally {
      setActionBusy(null);
    }
  };

  const submitAutomation = async () => {
    if (actionBusy !== null) return;
    setActionBusy("automation");
    try {
      await updateAutomation({
        subagentModel: automationModel.trim() || null,
        autoreviewEnabled: automationReview,
        autojudgeEnabled: automationJudge
      });
      setDialog(null);
    } finally {
      setActionBusy(null);
    }
  };

  const onProjectAction = async () => {
    if (bindingProject) return;
    setBindingProject(true);
    try {
      if (hasBoundProject) {
        await openProjectTree();
      } else if (!isTurnRunning) {
        await bindProject();
      }
    } finally {
      setBindingProject(false);
    }
  };

  const onChangeProject = async () => {
    if (bindingProject || isTurnRunning) return;
    setBindingProject(true);
    try {
      await bindProject();
    } finally {
      setBindingProject(false);
    }
  };

  const actionDisabled = isTurnRunning || actionBusy !== null;
  const menuItemClassName = "lyra-app-menu-item-with-icon lyra-agents-header-menu-item";

  return (
    <>
      <div className="lyra-agents-header-right">
        <div className="lyra-agents-header-project-controls">
          <AppButton
            className="lyra-agents-header-action lyra-agents-header-project-bind"
            type="button"
            variant="ghost"
            size="sm"
            aria-label={hasBoundProject ? t("header.openProjectTree") : t("header.bindProject")}
            title={projectTitle}
            disabled={bindingProject || (!hasBoundProject && isTurnRunning)}
            onClick={() => void onProjectAction()}
          >
            <Folder aria-hidden="true" size={14} strokeWidth={1.8} />
            {hasBoundProject ? (
              <span className="lyra-agents-header-project-name">{projectName}</span>
            ) : null}
          </AppButton>
          {hasBoundProject ? (
            <AppIconButton
              className="lyra-agents-header-action app-header-project-change"
              type="button"
              aria-label={t("header.changeProjectBinding")}
              title={t("header.changeProjectBinding")}
              disabled={bindingProject || isTurnRunning}
              onClick={() => void onChangeProject()}
            >
              <ArrowRightLeft aria-hidden="true" size={13} strokeWidth={1.8} />
            </AppIconButton>
          ) : null}
        </div>
        {shouldShowNewSessionButton ? (
          <AppIconButton
            className="lyra-agents-header-action app-header-new-session"
            type="button"
            aria-label={t("header.newSession")}
            title={t("header.newSession")}
            disabled={creating}
            onClick={() => void onCreateSession()}
          >
            <SquarePen aria-hidden="true" size={14} strokeWidth={1.8} />
          </AppIconButton>
        ) : null}
        <AppMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <div className="lyra-agents-header-more">
            <AppMenuTrigger asChild>
              <AppIconButton
                className="lyra-agents-header-action app-header-more-button"
                type="button"
                aria-label={t("header.more")}
                title={t("header.more")}
                active={menuOpen}
                onClick={() => {
                  if (!menuOpen) {
                    setMenuOpen(true);
                  }
                }}
              >
                <MoreHorizontal aria-hidden="true" size={15} strokeWidth={1.8} />
              </AppIconButton>
            </AppMenuTrigger>
            <AppMenuContent className="lyra-agents-header-menu" align="end" sideOffset={6}>
              <AppMenuItem
                className={menuItemClassName}
                disabled={actionDisabled}
                onSelect={() => void runImmediateAction("improve", () => runImprove())}
              >
                <Sparkles aria-hidden="true" size={14} strokeWidth={1.8} />
                <span className="lyra-app-menu-item-label">{t("header.improve")}</span>
              </AppMenuItem>
              <AppMenuItem
                className={menuItemClassName}
                disabled={actionDisabled}
                onSelect={() => void runImmediateAction("refactor", () => runRefactor())}
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
              <AppMenuItem
                className={menuItemClassName}
                disabled={actionDisabled}
                onSelect={() => openDialog("subagent")}
              >
                <Bot aria-hidden="true" size={14} strokeWidth={1.8} />
                <span className="lyra-app-menu-item-label">{t("header.subagent")}</span>
              </AppMenuItem>
              <AppMenuItem
                className={menuItemClassName}
                disabled={actionDisabled}
                onSelect={() => openDialog("btw")}
              >
                <MessageSquare aria-hidden="true" size={14} strokeWidth={1.8} />
                <span className="lyra-app-menu-item-label">{t("header.btw")}</span>
              </AppMenuItem>
              <AppMenuItem
                className={menuItemClassName}
                disabled={actionDisabled}
                onSelect={() => void runImmediateAction("split", splitSession)}
              >
                <CopyPlus aria-hidden="true" size={14} strokeWidth={1.8} />
                <span className="lyra-app-menu-item-label">{t("header.split")}</span>
              </AppMenuItem>
              <AppMenuItem
                className={menuItemClassName}
                disabled={actionDisabled}
                onSelect={() => void runImmediateAction("transfer", transferSession)}
              >
                <ArrowRightLeft aria-hidden="true" size={14} strokeWidth={1.8} />
                <span className="lyra-app-menu-item-label">{t("header.transfer")}</span>
              </AppMenuItem>
              <AppMenuItem
                className={menuItemClassName}
                disabled={actionDisabled}
                onSelect={() => void runImmediateAction("compact", compactContext)}
              >
                <PackageOpen aria-hidden="true" size={14} strokeWidth={1.8} />
                <span className="lyra-app-menu-item-label">{t("header.compact")}</span>
              </AppMenuItem>
              <AppMenuItem
                className={menuItemClassName}
                disabled={actionBusy !== null}
                onSelect={openGoalsDialog}
              >
                <Target aria-hidden="true" size={14} strokeWidth={1.8} />
                <span className="lyra-app-menu-item-label">{t("header.goals")}</span>
              </AppMenuItem>
              <AppMenuItem
                className={menuItemClassName}
                disabled={actionBusy !== null}
                onSelect={() => void runImmediateAction("resumeGoal", resumeGoal)}
              >
                <Target aria-hidden="true" size={14} strokeWidth={1.8} />
                <span className="lyra-app-menu-item-label">{t("header.resumeGoal")}</span>
              </AppMenuItem>
              <AppMenuItem
                className={menuItemClassName}
                disabled={actionDisabled}
                onSelect={() => void runImmediateAction("selfdev", openSelfDevLab)}
              >
                <FlaskConical aria-hidden="true" size={14} strokeWidth={1.8} />
                <span className="lyra-app-menu-item-label">{t("header.selfdev")}</span>
              </AppMenuItem>
              <AppMenuItem
                className={menuItemClassName}
                disabled={actionBusy !== null}
                onSelect={() => {
                  if (actionBusy !== null) return;
                  setMenuOpen(false);
                  void openOvernightLab();
                }}
              >
                <Moon aria-hidden="true" size={14} strokeWidth={1.8} />
                <span className="lyra-app-menu-item-label">{t("header.overnight")}</span>
              </AppMenuItem>
              <AppMenuItem
                className={menuItemClassName}
                disabled={actionDisabled}
                onSelect={() => openDialog("automation")}
              >
                <SlidersHorizontal aria-hidden="true" size={14} strokeWidth={1.8} />
                <span className="lyra-app-menu-item-label">{t("header.automation")}</span>
              </AppMenuItem>
            </AppMenuContent>
          </div>
        </AppMenu>
      </div>
      {dialog !== null ? (
        <div className="lyra-agents-header-dialog" role="dialog" aria-modal="true">
          {dialog === "subagent" ? (
            <form
              className="lyra-agents-header-dialog-card"
              onSubmit={(event) => {
                event.preventDefault();
                void submitSubagent();
              }}
            >
              <div className="lyra-agents-header-dialog-title">{t("header.subagent")}</div>
              <label className="lyra-agents-header-dialog-field">
                <span>{t("header.subagentType")}</span>
                <AppInput
                  value={subagentType}
                  onChange={(event) => setSubagentType(event.target.value)}
                />
              </label>
              <label className="lyra-agents-header-dialog-field">
                <span>{t("header.subagentModel")}</span>
                <AppInput
                  value={subagentModel}
                  onChange={(event) => setSubagentModel(event.target.value)}
                />
              </label>
              <label className="lyra-agents-header-dialog-field">
                <span>{t("header.subagentContinue")}</span>
                <AppInput
                  value={subagentContinue}
                  onChange={(event) => setSubagentContinue(event.target.value)}
                />
              </label>
              <label className="lyra-agents-header-dialog-field">
                <span>{t("header.prompt")}</span>
                <AppTextarea
                  value={subagentPrompt}
                  onChange={(event) => setSubagentPrompt(event.target.value)}
                  rows={4}
                />
              </label>
              <div className="lyra-agents-header-dialog-actions">
                <AppButton type="button" variant="secondary" size="sm" onClick={() => setDialog(null)} disabled={actionBusy !== null}>
                  {t("header.cancel")}
                </AppButton>
                <AppButton type="submit" size="sm" disabled={actionBusy !== null || subagentPrompt.trim().length === 0}>
                  {t("header.run")}
                </AppButton>
              </div>
            </form>
          ) : null}
          {dialog === "btw" ? (
            <form
              className="lyra-agents-header-dialog-card"
              onSubmit={(event) => {
                event.preventDefault();
                void submitBtw();
              }}
            >
              <div className="lyra-agents-header-dialog-title">{t("header.btw")}</div>
              <label className="lyra-agents-header-dialog-field">
                <span>{t("header.question")}</span>
                <AppTextarea
                  value={btwQuestion}
                  onChange={(event) => setBtwQuestion(event.target.value)}
                  rows={4}
                />
              </label>
              <div className="lyra-agents-header-dialog-actions">
                <AppButton type="button" variant="secondary" size="sm" onClick={() => setDialog(null)} disabled={actionBusy !== null}>
                  {t("header.cancel")}
                </AppButton>
                <AppButton type="submit" size="sm" disabled={actionBusy !== null || btwQuestion.trim().length === 0}>
                  {t("header.ask")}
                </AppButton>
              </div>
            </form>
          ) : null}
          {dialog === "goals" ? (
            <div className="lyra-agents-header-dialog-card">
              <div className="lyra-agents-header-dialog-title">{t("header.goals")}</div>
              <div className="lyra-agents-header-goals-list">
                {goalsLoading ? (
                  <span className="lyra-agents-header-goals-empty">{t("working")}</span>
                ) : goalItems.length === 0 ? (
                  <span className="lyra-agents-header-goals-empty">{t("header.noGoals")}</span>
                ) : (
                  goalItems.map((goal) => (
                    <AppButton
                      key={goal.id}
                      type="button"
                      className="lyra-agents-header-goal-item"
                      variant="ghost"
                      size="sm"
                      disabled={actionBusy !== null}
                      onClick={() => {
                        void selectGoal(goal.id);
                      }}
                    >
                      <span>{goal.title}</span>
                      {goal.status !== undefined && goal.status !== null ? (
                        <small>{goal.status}</small>
                      ) : null}
                    </AppButton>
                  ))
                )}
              </div>
              <div className="lyra-agents-header-dialog-actions">
                <AppButton type="button" variant="secondary" size="sm" onClick={() => setDialog(null)} disabled={actionBusy !== null}>
                  {t("header.cancel")}
                </AppButton>
                <AppButton type="button" variant="secondary" size="sm" onClick={() => void refreshGoals()} disabled={actionBusy !== null || goalsLoading}>
                  {t("header.refreshGoals")}
                </AppButton>
                <AppButton type="button" size="sm" onClick={() => void openGoalOverview()} disabled={actionBusy !== null}>
                  {t("header.openGoalsOverview")}
                </AppButton>
              </div>
            </div>
          ) : null}
          {dialog === "automation" ? (
            <form
              className="lyra-agents-header-dialog-card"
              onSubmit={(event) => {
                event.preventDefault();
                void submitAutomation();
              }}
            >
              <div className="lyra-agents-header-dialog-title">{t("header.automation")}</div>
              <label className="lyra-agents-header-dialog-field">
                <span>{t("header.subagentModel")}</span>
                <AppInput
                  value={automationModel}
                  onChange={(event) => setAutomationModel(event.target.value)}
                />
              </label>
              <label className="lyra-agents-header-toggle-row">
                <AppSwitch
                  aria-label={t("header.autoreview")}
                  checked={automationReview}
                  onCheckedChange={setAutomationReview}
                />
                <span>{t("header.autoreview")}</span>
              </label>
              <label className="lyra-agents-header-toggle-row">
                <AppSwitch
                  aria-label={t("header.autojudge")}
                  checked={automationJudge}
                  onCheckedChange={setAutomationJudge}
                />
                <span>{t("header.autojudge")}</span>
              </label>
              <div className="lyra-agents-header-dialog-actions">
                <AppButton type="button" variant="secondary" size="sm" onClick={() => setDialog(null)} disabled={actionBusy !== null}>
                  {t("header.cancel")}
                </AppButton>
                <AppButton type="submit" size="sm" disabled={actionBusy !== null}>
                  {t("header.save")}
                </AppButton>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
