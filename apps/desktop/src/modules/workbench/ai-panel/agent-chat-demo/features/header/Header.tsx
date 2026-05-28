// ============================================================================
// Header — frosted top bar with session title, total diff, project name
// ============================================================================

import { useData } from "../../data/DataProvider";
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
import { useEffect, useRef, useState } from "react";
import { t } from "../../core/i18n";
import type { AgentGoalItem } from "../../core/types";

export function Header() {
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
  const menuRef = useRef<HTMLDivElement | null>(null);
  const projectName = session.project.trim();
  const projectTitle = session.projectBound && session.workingDir !== null
    ? session.workingDir
    : t("header.bindProject");
  const hasBoundProject =
    session.projectBound && session.workingDir !== null && projectName.length > 0;
  const showNewSessionButton = messages.length > 0;

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

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

  const actionDisabled = isTurnRunning || actionBusy !== null;

  return (
    <header className="app-header">
      <div className="app-header-title">{session.title}</div>
      <div className="app-header-right">
        <div className="app-header-project-controls">
          <button
            className="app-header-action app-header-project-bind"
            type="button"
            aria-label={hasBoundProject ? t("header.openProjectTree") : t("header.bindProject")}
            title={projectTitle}
            disabled={bindingProject || (!hasBoundProject && isTurnRunning)}
            onClick={() => void onProjectAction()}
          >
            <Folder aria-hidden="true" size={14} strokeWidth={1.8} />
            {hasBoundProject ? (
              <span className="app-header-project-name">{projectName}</span>
            ) : null}
          </button>
        </div>
        {showNewSessionButton ? (
          <button
            className="app-header-action app-header-new-session"
            type="button"
            aria-label={t("header.newSession")}
            title={t("header.newSession")}
            disabled={creating}
            onClick={() => void onCreateSession()}
          >
            <SquarePen aria-hidden="true" size={14} strokeWidth={1.8} />
          </button>
        ) : null}
        <div className="app-header-more" ref={menuRef}>
          <button
            className="app-header-action app-header-more-button"
            type="button"
            aria-label={t("header.more")}
            title={t("header.more")}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <MoreHorizontal aria-hidden="true" size={15} strokeWidth={1.8} />
          </button>
          {menuOpen ? (
            <div className="app-header-menu" role="menu" aria-label={t("header.more")}>
              <button
                className="app-header-menu-item"
                type="button"
                role="menuitem"
                disabled={actionDisabled}
                onClick={() => void runImmediateAction("improve", () => runImprove())}
              >
                <Sparkles aria-hidden="true" size={14} strokeWidth={1.8} />
                <span>{t("header.improve")}</span>
              </button>
              <button
                className="app-header-menu-item"
                type="button"
                role="menuitem"
                disabled={actionDisabled}
                onClick={() => void runImmediateAction("refactor", () => runRefactor())}
              >
                <Hammer aria-hidden="true" size={14} strokeWidth={1.8} />
                <span>{t("header.refactor")}</span>
              </button>
              <button
                className="app-header-menu-item"
                type="button"
                role="menuitem"
                disabled={actionDisabled}
                onClick={() => void runMenuAction("review", runReview)}
              >
                <Search aria-hidden="true" size={14} strokeWidth={1.8} />
                <span>{t("header.review")}</span>
              </button>
              <button
                className="app-header-menu-item"
                type="button"
                role="menuitem"
                disabled={actionDisabled}
                onClick={() => void runMenuAction("judge", runJudge)}
              >
                <CheckCircle aria-hidden="true" size={14} strokeWidth={1.8} />
                <span>{t("header.judge")}</span>
              </button>
              <button
                className="app-header-menu-item"
                type="button"
                role="menuitem"
                disabled={actionDisabled}
                onClick={() => openDialog("subagent")}
              >
                <Bot aria-hidden="true" size={14} strokeWidth={1.8} />
                <span>{t("header.subagent")}</span>
              </button>
              <button
                className="app-header-menu-item"
                type="button"
                role="menuitem"
                disabled={actionDisabled}
                onClick={() => openDialog("btw")}
              >
                <MessageSquare aria-hidden="true" size={14} strokeWidth={1.8} />
                <span>{t("header.btw")}</span>
              </button>
              <button
                className="app-header-menu-item"
                type="button"
                role="menuitem"
                disabled={actionDisabled}
                onClick={() => void runImmediateAction("split", splitSession)}
              >
                <CopyPlus aria-hidden="true" size={14} strokeWidth={1.8} />
                <span>{t("header.split")}</span>
              </button>
              <button
                className="app-header-menu-item"
                type="button"
                role="menuitem"
                disabled={actionDisabled}
                onClick={() => void runImmediateAction("transfer", transferSession)}
              >
                <ArrowRightLeft aria-hidden="true" size={14} strokeWidth={1.8} />
                <span>{t("header.transfer")}</span>
              </button>
              <button
                className="app-header-menu-item"
                type="button"
                role="menuitem"
                disabled={actionDisabled}
                onClick={() => void runImmediateAction("compact", compactContext)}
              >
                <PackageOpen aria-hidden="true" size={14} strokeWidth={1.8} />
                <span>{t("header.compact")}</span>
              </button>
              <button
                className="app-header-menu-item"
                type="button"
                role="menuitem"
                disabled={actionBusy !== null}
                onClick={openGoalsDialog}
              >
                <Target aria-hidden="true" size={14} strokeWidth={1.8} />
                <span>{t("header.goals")}</span>
              </button>
              <button
                className="app-header-menu-item"
                type="button"
                role="menuitem"
                disabled={actionBusy !== null}
                onClick={() => void runImmediateAction("resumeGoal", resumeGoal)}
              >
                <Target aria-hidden="true" size={14} strokeWidth={1.8} />
                <span>{t("header.resumeGoal")}</span>
              </button>
              <button
                className="app-header-menu-item"
                type="button"
                role="menuitem"
                disabled={actionDisabled}
                onClick={() => void runImmediateAction("selfdev", openSelfDevLab)}
              >
                <FlaskConical aria-hidden="true" size={14} strokeWidth={1.8} />
                <span>{t("header.selfdev")}</span>
              </button>
              <button
                className="app-header-menu-item"
                type="button"
                role="menuitem"
                disabled={actionBusy !== null}
                onClick={() => {
                  if (actionBusy !== null) return;
                  setMenuOpen(false);
                  void openOvernightLab();
                }}
              >
                <Moon aria-hidden="true" size={14} strokeWidth={1.8} />
                <span>{t("header.overnight")}</span>
              </button>
              <button
                className="app-header-menu-item"
                type="button"
                role="menuitem"
                disabled={actionDisabled}
                onClick={() => openDialog("automation")}
              >
                <SlidersHorizontal aria-hidden="true" size={14} strokeWidth={1.8} />
                <span>{t("header.automation")}</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
      {dialog !== null ? (
        <div className="app-header-dialog" role="dialog" aria-modal="true">
          {dialog === "subagent" ? (
            <form
              className="app-header-dialog-card"
              onSubmit={(event) => {
                event.preventDefault();
                void submitSubagent();
              }}
            >
              <div className="app-header-dialog-title">{t("header.subagent")}</div>
              <label className="app-header-dialog-field">
                <span>{t("header.subagentType")}</span>
                <input
                  value={subagentType}
                  onChange={(event) => setSubagentType(event.target.value)}
                />
              </label>
              <label className="app-header-dialog-field">
                <span>{t("header.subagentModel")}</span>
                <input
                  value={subagentModel}
                  onChange={(event) => setSubagentModel(event.target.value)}
                />
              </label>
              <label className="app-header-dialog-field">
                <span>{t("header.subagentContinue")}</span>
                <input
                  value={subagentContinue}
                  onChange={(event) => setSubagentContinue(event.target.value)}
                />
              </label>
              <label className="app-header-dialog-field">
                <span>{t("header.prompt")}</span>
                <textarea
                  value={subagentPrompt}
                  onChange={(event) => setSubagentPrompt(event.target.value)}
                  rows={4}
                />
              </label>
              <div className="app-header-dialog-actions">
                <button type="button" onClick={() => setDialog(null)} disabled={actionBusy !== null}>
                  {t("header.cancel")}
                </button>
                <button type="submit" disabled={actionBusy !== null || subagentPrompt.trim().length === 0}>
                  {t("header.run")}
                </button>
              </div>
            </form>
          ) : null}
          {dialog === "btw" ? (
            <form
              className="app-header-dialog-card"
              onSubmit={(event) => {
                event.preventDefault();
                void submitBtw();
              }}
            >
              <div className="app-header-dialog-title">{t("header.btw")}</div>
              <label className="app-header-dialog-field">
                <span>{t("header.question")}</span>
                <textarea
                  value={btwQuestion}
                  onChange={(event) => setBtwQuestion(event.target.value)}
                  rows={4}
                />
              </label>
              <div className="app-header-dialog-actions">
                <button type="button" onClick={() => setDialog(null)} disabled={actionBusy !== null}>
                  {t("header.cancel")}
                </button>
                <button type="submit" disabled={actionBusy !== null || btwQuestion.trim().length === 0}>
                  {t("header.ask")}
                </button>
              </div>
            </form>
          ) : null}
          {dialog === "goals" ? (
            <div className="app-header-dialog-card">
              <div className="app-header-dialog-title">{t("header.goals")}</div>
              <div className="app-header-goals-list">
                {goalsLoading ? (
                  <span className="app-header-goals-empty">{t("working")}</span>
                ) : goalItems.length === 0 ? (
                  <span className="app-header-goals-empty">{t("header.noGoals")}</span>
                ) : (
                  goalItems.map((goal) => (
                    <button
                      key={goal.id}
                      type="button"
                      className="app-header-goal-item"
                      disabled={actionBusy !== null}
                      onClick={() => {
                        void selectGoal(goal.id);
                      }}
                    >
                      <span>{goal.title}</span>
                      {goal.status !== undefined && goal.status !== null ? (
                        <small>{goal.status}</small>
                      ) : null}
                    </button>
                  ))
                )}
              </div>
              <div className="app-header-dialog-actions">
                <button type="button" onClick={() => setDialog(null)} disabled={actionBusy !== null}>
                  {t("header.cancel")}
                </button>
                <button type="button" onClick={() => void refreshGoals()} disabled={actionBusy !== null || goalsLoading}>
                  {t("header.refreshGoals")}
                </button>
                <button type="button" onClick={() => void openGoalOverview()} disabled={actionBusy !== null}>
                  {t("header.openGoalsOverview")}
                </button>
              </div>
            </div>
          ) : null}
          {dialog === "automation" ? (
            <form
              className="app-header-dialog-card"
              onSubmit={(event) => {
                event.preventDefault();
                void submitAutomation();
              }}
            >
              <div className="app-header-dialog-title">{t("header.automation")}</div>
              <label className="app-header-dialog-field">
                <span>{t("header.subagentModel")}</span>
                <input
                  value={automationModel}
                  onChange={(event) => setAutomationModel(event.target.value)}
                />
              </label>
              <label className="app-header-toggle-row">
                <input
                  type="checkbox"
                  checked={automationReview}
                  onChange={(event) => setAutomationReview(event.target.checked)}
                />
                <span>{t("header.autoreview")}</span>
              </label>
              <label className="app-header-toggle-row">
                <input
                  type="checkbox"
                  checked={automationJudge}
                  onChange={(event) => setAutomationJudge(event.target.checked)}
                />
                <span>{t("header.autojudge")}</span>
              </label>
              <div className="app-header-dialog-actions">
                <button type="button" onClick={() => setDialog(null)} disabled={actionBusy !== null}>
                  {t("header.cancel")}
                </button>
                <button type="submit" disabled={actionBusy !== null}>
                  {t("header.save")}
                </button>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
