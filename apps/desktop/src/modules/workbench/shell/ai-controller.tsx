import { useCallback, useMemo, useState } from "react";

import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import {
  createAiMcpAppRequest,
  createAiPanelAppRequest,
  createAiSkillsAppRequest
} from "../ai-panel";
import type { AiPanelSurfaceProps } from "../ai-panel/types";
import type { AiComputerModel } from "../ai-panel/computer";
import type { AiPanelSessionStoreModel } from "../ai-panel/session-store";
import type { ContextMenuOpenRequest } from "../context-menu";
import type {
  FileEditorChangeReviewItem,
  FileEditorLabels,
  FileEditorModel
} from "../file-editor";
import type { FileManagerModel, FileManagerSurfaceLabels } from "../file-manager";
import type { I18nKey } from "../i18n";
import type { TerminalDockLabels } from "../terminal-dock";
import type { TerminalThemePresetId } from "../terminal-theme";
import type { WorkspaceTabsModel } from "../workspace-tabs/types";

type Translator = (key: I18nKey) => string;

export type UseWorkbenchAiControllerOptions = {
  readonly t: Translator;
  readonly desktopApi: LyraDesktopApi | null;
  readonly tabsModel: WorkspaceTabsModel;
  readonly aiSessionModel: AiPanelSessionStoreModel;
  readonly aiComputerModel: AiComputerModel;
  readonly fileEditorModel: FileEditorModel;
  readonly fileEditorLabels: FileEditorLabels;
  readonly fileManagerModel: FileManagerModel;
  readonly fileManagerLabels: FileManagerSurfaceLabels;
  readonly terminalLabels: TerminalDockLabels;
  readonly terminalThemeSignature: string;
  readonly terminalThemePreset: TerminalThemePresetId;
  readonly resolvedThemeId: string;
  readonly onOpenFileFromManager: (filePath: string) => void;
  readonly onOpenMessageContextMenu: (request: ContextMenuOpenRequest) => void;
};

export type WorkbenchAiController = {
  readonly sidebarAiSurfaceProps: Omit<AiPanelSurfaceProps, "variant"> | null;
  readonly resolveWorkspaceAiSurfaceProps: (
    sessionId: string
  ) => Omit<AiPanelSurfaceProps, "variant"> | null;
  readonly aiFileChangeReviewItems: readonly FileEditorChangeReviewItem[];
  readonly onAcceptAiFileChangeReviewItem: (item: FileEditorChangeReviewItem) => void;
  readonly onRejectAiFileChangeReviewItem: (item: FileEditorChangeReviewItem) => void;
  readonly onUndoAiFileChangeReviewItem: (item: FileEditorChangeReviewItem) => void;
};

export const useWorkbenchAiController = ({
  t,
  desktopApi,
  tabsModel,
  aiSessionModel,
  aiComputerModel,
  fileEditorModel,
  fileEditorLabels,
  fileManagerModel,
  fileManagerLabels,
  terminalLabels,
  terminalThemeSignature,
  terminalThemePreset,
  resolvedThemeId,
  onOpenFileFromManager,
  onOpenMessageContextMenu
}: UseWorkbenchAiControllerOptions): WorkbenchAiController => {
  const [sidebarHistoryRevealToken, setSidebarHistoryRevealToken] = useState(0);

  const openAiSessionInWorkspace = useCallback((sessionId: string): void => {
    const session = aiSessionModel.getSession(sessionId);
    const title = session?.title ?? t("ai.tabTitle");
    aiSessionModel.ensureSession(sessionId, {
      title,
      placement: "workspace-tab"
    });
    tabsModel.openAppTab(createAiPanelAppRequest(title, sessionId));
  }, [aiSessionModel, t, tabsModel]);

  const moveSidebarSessionIntoWorkspace = useCallback((): string => {
    const currentSessionId = aiSessionModel.sidebarSessionId;
    if (aiSessionModel.isSessionOpenInWorkspace(currentSessionId)) {
      openAiSessionInWorkspace(currentSessionId);
      return currentSessionId;
    }
    const movedSessionId = aiSessionModel.moveSidebarSessionToWorkspace();
    openAiSessionInWorkspace(movedSessionId);
    setSidebarHistoryRevealToken((current) => current + 1);
    return movedSessionId;
  }, [aiSessionModel, openAiSessionInWorkspace]);

  const onOpenAiRuntimeItemInWorkspaceTab = useCallback((filePath: string): void => {
    onOpenFileFromManager(filePath);
  }, [onOpenFileFromManager]);

  const resolveRuntimeSessionId = useCallback((runtimeItemId: string): string | null => {
    const owner = aiSessionModel.sessions.find((session) =>
      session.runtimeItems.some((item) => item.id === runtimeItemId)
    );
    return owner?.id ?? null;
  }, [aiSessionModel.sessions]);

  const onAcceptAiFileChangeReviewItem = useCallback((item: FileEditorChangeReviewItem): void => {
    const sessionId = resolveRuntimeSessionId(item.id);
    if (sessionId === null) {
      return;
    }
    aiSessionModel.acceptRuntimeItem(sessionId, item.id);
  }, [aiSessionModel, resolveRuntimeSessionId]);

  const onRejectAiFileChangeReviewItem = useCallback((item: FileEditorChangeReviewItem): void => {
    const sessionId = resolveRuntimeSessionId(item.id);
    if (sessionId === null) {
      return;
    }
    aiSessionModel.rejectRuntimeItem(sessionId, item.id);
  }, [aiSessionModel, resolveRuntimeSessionId]);

  const onUndoAiFileChangeReviewItem = useCallback((item: FileEditorChangeReviewItem): void => {
    const sessionId = resolveRuntimeSessionId(item.id);
    if (sessionId === null) {
      return;
    }
    aiSessionModel.undoRuntimeItemDecision(sessionId, item.id);
  }, [aiSessionModel, resolveRuntimeSessionId]);

  const aiFileChangeReviewItems = aiSessionModel.fileChangeReviewItems;

  const onOpenAiPanelInWorkspace = useCallback((): void => {
    void moveSidebarSessionIntoWorkspace();
  }, [moveSidebarSessionIntoWorkspace]);

  const onCreateWorkspaceAiConversation = useCallback((): void => {
    const request = createAiPanelAppRequest(t("ai.tabTitle"));
    aiSessionModel.ensureSession(request.appInstanceId, {
      title: request.title,
      placement: "workspace-tab"
    });
    tabsModel.openAppTab(request);
  }, [aiSessionModel, t, tabsModel]);

  const onOpenAiMcpInWorkspace = useCallback((): void => {
    tabsModel.openAppTab(createAiMcpAppRequest(t("ai.mcpTabTitle")));
  }, [t, tabsModel]);

  const onOpenAiSkillsInWorkspace = useCallback((): void => {
    tabsModel.openAppTab(createAiSkillsAppRequest(t("ai.skillsTabTitle")));
  }, [t, tabsModel]);

  const aiRuntimeLabels = useMemo(
    () => ({
      workspaceTitle: t("ai.runtimeWorkspaceTitle"),
      emptyState: t("ai.runtimeEmptyState"),
      openInWorkspaceTab: t("ai.runtimeOpenInWorkspaceTab"),
      kindFile: t("ai.runtimeKindFile"),
      kindWeb: t("ai.runtimeKindWeb"),
      kindApp: t("ai.runtimeKindApp"),
      statusQueued: t("ai.runtimeStatusQueued"),
      statusRunning: t("ai.runtimeStatusRunning"),
      statusCompleted: t("ai.runtimeStatusCompleted"),
      statusError: t("ai.runtimeStatusError")
    }),
    [t]
  );

  const aiComputerLabels = useMemo(
    () => ({
      menuTitle: t("ai.computerMenuTitle"),
      menuHost: t("ai.computerMenuHost"),
      menuState: t("ai.computerMenuState"),
      menuLyra: t("ai.computerMenuLyra"),
      menuFile: t("ai.computerMenuFile"),
      menuEdit: t("ai.computerMenuEdit"),
      menuView: t("ai.computerMenuView"),
      menuWindow: t("ai.computerMenuWindow"),
      menuHelp: t("ai.computerMenuHelp"),
      stateOff: t("ai.computerStateOff"),
      stateBooting: t("ai.computerStateBooting"),
      stateOn: t("ai.computerStateOn"),
      stateShuttingDown: t("ai.computerStateShuttingDown"),
      idleTitle: t("ai.computerIdleTitle"),
      idleDescription: t("ai.computerIdleDescription"),
      missingSystemTitle: t("ai.computerMissingSystemTitle"),
      missingSystemDescription: t("ai.computerMissingSystemDescription"),
      installOfficialSystem: t("ai.computerInstallOfficialSystem"),
      powerOn: t("ai.computerPowerOn"),
      desktopHint: t("ai.computerDesktopHint"),
      desktopFiles: t("ai.computerDesktopFiles"),
      desktopBrowser: t("ai.computerDesktopBrowser"),
      desktopTerminal: t("ai.computerDesktopTerminal"),
      desktopEditor: t("ai.computerDesktopEditor"),
      desktopStandby: t("ai.computerDesktopStandby"),
      desktopStatusReady: t("ai.computerDesktopStatusReady"),
      launcher: t("ai.computerLauncher"),
      search: t("ai.computerSearch"),
      taskbarTray: t("ai.computerTaskbarTray"),
      dockNewWindow: t("ai.computerDockNewWindow"),
      dockUnpin: t("ai.computerDockUnpin"),
      dockCloseAllWindows: t("ai.computerDockCloseAllWindows"),
      openInWorkspace: t("ai.computerOpenInWorkspace"),
      browserPlaceholder: t("ai.computerBrowserPlaceholder"),
      browserSearchAction: t("ai.computerBrowserSearchAction"),
      browserSearchPlaceholder: t("ai.computerBrowserSearchPlaceholder"),
      terminalPlaceholder: t("ai.computerTerminalPlaceholder"),
      fileManagerTitle: t("ai.computerDesktopFiles"),
      fileEditorTitle: t("ai.computerDesktopEditor"),
      minimizeWindow: t("ai.computerMinimizeWindow"),
      maximizeWindow: t("ai.computerMaximizeWindow"),
      restoreWindow: t("ai.computerRestoreWindow"),
      closeWindow: t("ai.computerCloseWindow")
    }),
    [t]
  );

  const onPowerOnAiComputer = useCallback((sessionId: string): void => {
    void aiComputerModel.powerOn(sessionId, "user");
  }, [aiComputerModel]);

  const onPowerOffAiComputer = useCallback((sessionId: string): void => {
    void aiComputerModel.powerOff(sessionId);
  }, [aiComputerModel]);

  const onInstallOfficialAiSystem = useCallback((sessionId: string): void => {
    void aiComputerModel.ensureOfficialSystemInstalled(sessionId);
  }, [aiComputerModel]);

  const onOpenAiComputerApp = useCallback((
    sessionId: string,
    request: {
      readonly kind: "file-manager" | "file-editor" | "terminal" | "browser";
      readonly title?: string;
      readonly appInstanceId?: string;
      readonly filePath?: string;
      readonly directoryPath?: string;
      readonly address?: string;
    }
  ): void => {
    void aiComputerModel
      .ensurePoweredOn(sessionId, "user")
      .then(() => aiComputerModel.openApp(sessionId, request));
  }, [aiComputerModel]);

  const onFocusAiComputerApp = useCallback((sessionId: string, appInstanceId: string): void => {
    void aiComputerModel.focusApp(sessionId, appInstanceId);
  }, [aiComputerModel]);

  const onCloseAiComputerApp = useCallback((sessionId: string, appInstanceId: string): void => {
    void aiComputerModel.closeApp(sessionId, appInstanceId);
  }, [aiComputerModel]);

  const onMoveAiComputerAppWindow = useCallback((
    sessionId: string,
    appInstanceId: string,
    frame: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    }
  ): void => {
    void aiComputerModel.moveAppWindow(sessionId, appInstanceId, frame);
  }, [aiComputerModel]);

  const onResizeAiComputerAppWindow = useCallback((
    sessionId: string,
    appInstanceId: string,
    frame: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    }
  ): void => {
    void aiComputerModel.resizeAppWindow(sessionId, appInstanceId, frame);
  }, [aiComputerModel]);

  const onMinimizeAiComputerApp = useCallback((sessionId: string, appInstanceId: string): void => {
    void aiComputerModel.minimizeApp(sessionId, appInstanceId);
  }, [aiComputerModel]);

  const onMaximizeAiComputerApp = useCallback((sessionId: string, appInstanceId: string): void => {
    void aiComputerModel.maximizeApp(sessionId, appInstanceId);
  }, [aiComputerModel]);

  const onRestoreAiComputerApp = useCallback((sessionId: string, appInstanceId: string): void => {
    void aiComputerModel.restoreApp(sessionId, appInstanceId);
  }, [aiComputerModel]);

  const focusRuntimeComputerSurface = useCallback((sessionId: string, itemId: string): void => {
    const session = aiSessionModel.getSession(sessionId);
    const item = session?.runtimeItems.find((entry) => entry.id === itemId) ?? null;
    if (item === null) {
      return;
    }

    if (item.computerAppInstanceId !== undefined) {
      void aiComputerModel.focusApp(sessionId, item.computerAppInstanceId);
      return;
    }

    if (item.kind === "file" && item.filePath !== undefined) {
      const filePath = item.filePath;
      void aiComputerModel
        .ensurePoweredOn(sessionId, "ai")
        .then(() =>
          aiComputerModel.openApp(sessionId, {
            kind: "file-editor",
            title: item.title,
            filePath
          })
        );
      return;
    }

    if (item.kind === "web") {
      void aiComputerModel
        .ensurePoweredOn(sessionId, "ai")
        .then(() =>
          aiComputerModel.openApp(sessionId, {
            kind: "browser",
            title: item.title
          })
        );
      return;
    }

    if (item.kind === "app") {
      void aiComputerModel
        .ensurePoweredOn(sessionId, "ai")
        .then(() =>
          aiComputerModel.openApp(sessionId, {
            kind: "terminal",
            title: item.title
          })
        );
    }
  }, [aiComputerModel, aiSessionModel]);

  const onOpenAiHistoryItem = useCallback((sessionId: string): void => {
    if (aiSessionModel.isSessionOpenInWorkspace(sessionId)) {
      openAiSessionInWorkspace(sessionId);
      return;
    }
    aiSessionModel.openSessionInSidebar(sessionId);
  }, [aiSessionModel, openAiSessionInWorkspace]);

  const buildAiSurfaceProps = useCallback((
    sessionId: string,
    variant: "sidebar" | "workspace"
  ): Omit<AiPanelSurfaceProps, "variant"> | null => {
    const sessionView = aiSessionModel.getSessionView(sessionId);
    if (sessionView === null) {
      return null;
    }

    const openSessionForItem = (itemId: string): void => {
      aiSessionModel.activateRuntimeItem(sessionId, itemId);
      if (variant === "workspace") {
        focusRuntimeComputerSurface(sessionId, itemId);
        return;
      }

      if (aiSessionModel.isSessionOpenInWorkspace(sessionId)) {
        openAiSessionInWorkspace(sessionId);
        focusRuntimeComputerSurface(sessionId, itemId);
        return;
      }

      const movedSessionId = moveSidebarSessionIntoWorkspace();
      aiSessionModel.activateRuntimeItem(movedSessionId, itemId);
      focusRuntimeComputerSurface(movedSessionId, itemId);
    };

    return {
      sessionId,
      sessionTitle: sessionView.title,
      composerMode: sessionView.mode,
      modeOptions: [
        { id: "chat", label: "Chat" },
        { id: "agent", label: "Agent", disabled: true },
        { id: "oma", label: "Oma", disabled: true }
      ],
      messages: sessionView.messages,
      isReplying: sessionView.isReplying,
      quotedMessage: sessionView.quotedMessage,
      questionPanel: sessionView.questionPanel,
      changeApprovalPanel: sessionView.changeApprovalPanel,
      changeApprovalLabels: {
        tabQuestion: t("ai.upperPanelTabQuestion"),
        tabChange: t("ai.upperPanelTabChange"),
        viewPending: t("ai.changeApprovalViewPending"),
        viewAll: t("ai.changeApprovalViewAll"),
        filesUnit: t("ai.changeApprovalFilesUnit"),
        acceptAll: t("ai.changeApprovalAcceptAll"),
        openFile: t("ai.changeApprovalOpenFile"),
        emptyPending: t("ai.changeApprovalEmptyPending"),
        emptyAll: t("ai.changeApprovalEmptyAll")
      },
      questionNavigateUpLabel: t("ai.questionNavigateUp"),
      questionNavigateDownLabel: t("ai.questionNavigateDown"),
      questionCloseLabel: t("ai.questionClose"),
      questionCustomPlaceholder: t("ai.questionCustomPlaceholder"),
      questionSubmitCustomLabel: t("ai.questionSubmitCustom"),
      openHistoryLabel: t("ai.openHistory"),
      openMcpLabel: t("ai.openMcp"),
      openSkillsLabel: t("ai.openSkills"),
      historyTitle: t("ai.historyTitle"),
      newConversationLabel: t("ai.newConversation"),
      openConversationLabel: t("ai.openConversation"),
      dropHintTitle: t("ai.dropHintTitle"),
      dropHintDescription: t("ai.dropHintDescription"),
      actionCopyLabel: t("ai.actionCopy"),
      actionForkLabel: t("ai.actionFork"),
      actionUndoLabel: t("ai.actionUndo"),
      actionEditLabel: t("ai.actionEdit"),
      actionQuoteLabel: t("ai.actionQuote"),
      actionAriaCopyUser: t("ai.ariaCopyUserMessage"),
      actionAriaForkUser: t("ai.ariaForkUserMessage"),
      actionAriaUndoUser: t("ai.ariaUndoUserMessage"),
      actionAriaEditUser: t("ai.ariaEditUserMessage"),
      actionAriaQuoteUser: t("ai.ariaQuoteUserMessage"),
      actionAriaCopyAssistant: t("ai.ariaCopyAssistantMessage"),
      actionAriaQuoteAssistant: t("ai.ariaQuoteAssistantMessage"),
      historyWorkspaceBadgeLabel: t("ai.historyWorkspaceBadge"),
      taskCardOpenLabel: t("ai.editorWorkOpen"),
      taskCardCopyLabel: t("ai.editorWorkCopy"),
      taskCardCopiedLabel: t("ai.editorWorkCopied"),
      taskCardAcceptLabel: t("ai.editorWorkAccept"),
      taskCardRejectLabel: t("ai.editorWorkReject"),
      taskCardUndoLabel: t("ai.editorWorkUndo"),
      runtimeItems: sessionView.runtimeItems,
      activeRuntimeItemId: sessionView.activeRuntimeItemId,
      runtimeLabels: aiRuntimeLabels,
      computerLabels: aiComputerLabels,
      computerState: aiComputerModel.getSessionState(sessionId),
      computerHostStatus: aiComputerModel.hostStatus,
      desktopApi,
      fileEditorModel,
      fileEditorLabels,
      fileManagerModel,
      fileManagerLabels,
      terminalLabels,
      terminalThemeSignature,
      terminalThemePreset,
      themeSignature: resolvedThemeId,
      ...(variant === "sidebar" ? { historyRevealToken: sidebarHistoryRevealToken } : {}),
      onSendSessionPayload: aiSessionModel.sendMessage,
      onPauseSession: aiSessionModel.pauseReplying,
      onCloseQuestionPanel: aiSessionModel.closeQuestionPanel,
      onQuestionNavigate: aiSessionModel.navigateQuestion,
      onQuestionSelectOption: aiSessionModel.selectQuestionOption,
      onQuestionCustomDraftChange: aiSessionModel.updateQuestionCustomDraft,
      onQuestionSubmitCustom: aiSessionModel.submitQuestionCustomAnswer,
      onChangeApprovalViewChange: aiSessionModel.setChangeApprovalView,
      onAcceptAllRuntimeFileChanges: aiSessionModel.acceptAllRuntimeFileChanges,
      onOpenChangedFile: (_targetSessionId, filePath) => {
        onOpenAiRuntimeItemInWorkspaceTab(filePath);
      },
      onComposerModeChange: aiSessionModel.setComposerMode,
      onSetQuotedMessage: aiSessionModel.setQuotedMessage,
      onStartNewConversation:
        variant === "sidebar"
          ? aiSessionModel.startNewSidebarConversation
          : onCreateWorkspaceAiConversation,
      onOpenHistoryItem: onOpenAiHistoryItem,
      onActivateRuntimeItem: (itemId) => {
        openSessionForItem(itemId);
      },
      onOpenRuntimeItemInWorkspaceTab: onOpenAiRuntimeItemInWorkspaceTab,
      onPowerOnComputer: onPowerOnAiComputer,
      onPowerOffComputer: onPowerOffAiComputer,
      onInstallOfficialSystem: onInstallOfficialAiSystem,
      onOpenComputerApp: onOpenAiComputerApp,
      onFocusComputerApp: onFocusAiComputerApp,
      onCloseComputerApp: onCloseAiComputerApp,
      onMoveComputerAppWindow: onMoveAiComputerAppWindow,
      onResizeComputerAppWindow: onResizeAiComputerAppWindow,
      onMinimizeComputerApp: onMinimizeAiComputerApp,
      onMaximizeComputerApp: onMaximizeAiComputerApp,
      onRestoreComputerApp: onRestoreAiComputerApp,
      onAcceptRuntimeItem: (itemId) => {
        aiSessionModel.acceptRuntimeItem(sessionId, itemId);
      },
      onRejectRuntimeItem: (itemId) => {
        aiSessionModel.rejectRuntimeItem(sessionId, itemId);
      },
      onUndoRuntimeItem: (itemId) => {
        aiSessionModel.undoRuntimeItemDecision(sessionId, itemId);
      },
      onOpenMcp: onOpenAiMcpInWorkspace,
      onOpenSkills: onOpenAiSkillsInWorkspace,
      ...(variant === "sidebar"
        ? {
            topbarActionLabel: t("ai.openInWorkspace"),
            onTopbarAction: onOpenAiPanelInWorkspace
          }
        : {}),
      ariaLabel: t("sidebar.composeAriaLabel"),
      placeholder: t("sidebar.composePlaceholder"),
      sendLabel: t("sidebar.composeSend"),
      historyItems: sessionView.historyItems,
      onOpenMessageContextMenu
    };
  }, [
    aiComputerLabels,
    aiComputerModel,
    aiRuntimeLabels,
    aiSessionModel,
    desktopApi,
    fileEditorLabels,
    fileEditorModel,
    fileManagerLabels,
    fileManagerModel,
    focusRuntimeComputerSurface,
    moveSidebarSessionIntoWorkspace,
    onCloseAiComputerApp,
    onCreateWorkspaceAiConversation,
    onFocusAiComputerApp,
    onInstallOfficialAiSystem,
    onMaximizeAiComputerApp,
    onMinimizeAiComputerApp,
    onMoveAiComputerAppWindow,
    onOpenAiHistoryItem,
    onOpenAiMcpInWorkspace,
    onOpenAiPanelInWorkspace,
    onOpenAiRuntimeItemInWorkspaceTab,
    onOpenAiSkillsInWorkspace,
    onOpenAiComputerApp,
    onOpenMessageContextMenu,
    onPowerOffAiComputer,
    onPowerOnAiComputer,
    onResizeAiComputerAppWindow,
    onRestoreAiComputerApp,
    openAiSessionInWorkspace,
    resolvedThemeId,
    sidebarHistoryRevealToken,
    t,
    terminalLabels,
    terminalThemePreset,
    terminalThemeSignature
  ]);

  const sidebarAiSurfaceProps = buildAiSurfaceProps(aiSessionModel.sidebarSessionId, "sidebar");

  return {
    sidebarAiSurfaceProps,
    resolveWorkspaceAiSurfaceProps: (sessionId) => buildAiSurfaceProps(sessionId, "workspace"),
    aiFileChangeReviewItems,
    onAcceptAiFileChangeReviewItem,
    onRejectAiFileChangeReviewItem,
    onUndoAiFileChangeReviewItem
  };
};
