import {
  History,
  PanelLeftOpen,
  Plus
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent
} from "react";

import {
  hasFileManagerEntryDragPayload,
  readFileManagerEntryDragPayload,
  type FileManagerEntryDragPayload
} from "../file-manager/drag-transfer";
import { SidebarComposer, type SidebarComposerHandle } from "../sidebar";
import type { SidebarComposerMode, SidebarComposerSubmitPayload } from "../sidebar/types";
import { AiPanelComputerSurface } from "./computer";
import { AiComputerViewStateProvider } from "./computer/browser-view-state";
import { renderAiPanelTopbarIcon } from "./icon-registry";
import { AiPanelMessageThread } from "./message-thread";
import { AiTaskCardRegistryProvider } from "./task-card";
import type { AiPanelSurfaceProps } from "./types";

export const AiPanelSurface = ({
  variant,
  sessionId,
  sessionTitle: _sessionTitle,
  composerMode,
  messages,
  isReplying,
  quotedMessage,
  questionPanel,
  changeApprovalPanel,
  changeApprovalLabels,
  questionNavigateUpLabel,
  questionNavigateDownLabel,
  questionCloseLabel,
  questionCustomPlaceholder,
  questionSubmitCustomLabel,
  openHistoryLabel,
  openMcpLabel,
  openSkillsLabel,
  historyTitle,
  newConversationLabel,
  openConversationLabel,
  dropHintTitle,
  dropHintDescription,
  actionCopyLabel,
  actionForkLabel,
  actionUndoLabel,
  actionEditLabel,
  actionQuoteLabel,
  actionAriaCopyUser,
  actionAriaForkUser,
  actionAriaUndoUser,
  actionAriaEditUser,
  actionAriaQuoteUser,
  actionAriaCopyAssistant,
  actionAriaQuoteAssistant,
  historyWorkspaceBadgeLabel,
  taskCardOpenLabel,
  taskCardCopyLabel,
  taskCardCopiedLabel,
  taskCardAcceptLabel,
  taskCardRejectLabel,
  taskCardUndoLabel,
  runtimeItems,
  activeRuntimeItemId,
  runtimeLabels,
  computerLabels,
  computerState,
  computerHostStatus,
  desktopApi,
  fileEditorModel,
  fileEditorLabels,
  fileManagerModel,
  fileManagerLabels,
  terminalLabels,
  terminalThemeSignature,
  terminalThemePreset,
  themeSignature,
  historyRevealToken,
  onSendSessionPayload,
  onPauseSession,
  onCloseQuestionPanel,
  onQuestionNavigate,
  onQuestionSelectOption,
  onQuestionCustomDraftChange,
  onQuestionSubmitCustom,
  onChangeApprovalViewChange,
  onAcceptAllRuntimeFileChanges,
  onOpenChangedFile,
  onComposerModeChange,
  onSetQuotedMessage,
  onStartNewConversation,
  onOpenHistoryItem,
  onOpenSessionInWorkspace: _onOpenSessionInWorkspace,
  onOpenMcp,
  onOpenSkills,
  onActivateRuntimeItem,
  onOpenRuntimeItemInWorkspaceTab,
  onPowerOnComputer,
  onPowerOffComputer,
  onInstallOfficialSystem,
  onOpenComputerApp,
  onFocusComputerApp,
  onCloseComputerApp,
  onMoveComputerAppWindow,
  onResizeComputerAppWindow,
  onMinimizeComputerApp,
  onMaximizeComputerApp,
  onRestoreComputerApp,
  onAcceptRuntimeItem,
  onRejectRuntimeItem,
  onUndoRuntimeItem,
  topbarActionLabel,
  onTopbarAction,
  ariaLabel,
  placeholder,
  sendLabel,
  onSend,
  historyItems,
  onOpenMessageContextMenu
}: AiPanelSurfaceProps) => {
  const [isHistoryVisible, setIsHistoryVisible] = useState(false);
  const [isFileDropHover, setIsFileDropHover] = useState(false);
  const [pendingPanelDropEntry, setPendingPanelDropEntry] =
    useState<FileManagerEntryDragPayload | null>(null);
  const fileDragDepthRef = useRef(0);
  const composerRef = useRef<SidebarComposerHandle | null>(null);
  const historyPanelRef = useRef<HTMLElement | null>(null);
  const historyToggleRef = useRef<HTMLButtonElement | null>(null);

  const items = useMemo(
    () => historyItems ?? [],
    [historyItems]
  );

  const resetFileDropHover = useCallback((): void => {
    fileDragDepthRef.current = 0;
    setIsFileDropHover(false);
  }, []);

  useEffect(() => {
    const clearDropHover = (): void => {
      resetFileDropHover();
    };
    window.addEventListener("dragend", clearDropHover);
    window.addEventListener("drop", clearDropHover);
    return () => {
      window.removeEventListener("dragend", clearDropHover);
      window.removeEventListener("drop", clearDropHover);
    };
  }, [resetFileDropHover]);

  useEffect(() => {
    if (pendingPanelDropEntry === null) {
      return;
    }
    if (composerRef.current === null) {
      return;
    }

    composerRef.current.insertFileEntry(pendingPanelDropEntry);
    composerRef.current.focus();
    setPendingPanelDropEntry(null);
  }, [pendingPanelDropEntry]);

  useEffect(() => {
    if (isHistoryVisible === false) {
      return;
    }

    const closeOnOutsidePointer = (event: PointerEvent): void => {
      const target = event.target;
      if ((target instanceof Node) === false) {
        return;
      }

      if (historyPanelRef.current?.contains(target)) {
        return;
      }
      if (historyToggleRef.current?.contains(target)) {
        return;
      }

      setIsHistoryVisible(false);
    };

    window.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [isHistoryVisible]);

  useEffect(() => {
    if (historyRevealToken === undefined) {
      return;
    }
    setIsHistoryVisible(true);
  }, [historyRevealToken]);

  const onSurfaceDragEnter = useCallback((event: ReactDragEvent<HTMLElement>): void => {
    if (hasFileManagerEntryDragPayload(event.dataTransfer) === false) {
      return;
    }

    event.preventDefault();
    fileDragDepthRef.current += 1;
    setIsFileDropHover(true);
  }, []);

  const onSurfaceDragOver = useCallback((event: ReactDragEvent<HTMLElement>): void => {
    if (hasFileManagerEntryDragPayload(event.dataTransfer) === false) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsFileDropHover(true);
  }, []);

  const onSurfaceDragLeave = useCallback((event: ReactDragEvent<HTMLElement>): void => {
    if (hasFileManagerEntryDragPayload(event.dataTransfer) === false && isFileDropHover === false) {
      return;
    }

    event.preventDefault();
    const nextDepth = Math.max(0, fileDragDepthRef.current - 1);
    fileDragDepthRef.current = nextDepth;
    if (nextDepth === 0) {
      setIsFileDropHover(false);
    }
  }, [isFileDropHover]);

  const onSurfaceDrop = useCallback((event: ReactDragEvent<HTMLElement>): void => {
    const droppedEntry = readFileManagerEntryDragPayload(event.dataTransfer);
    if (droppedEntry === null) {
      resetFileDropHover();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (composerRef.current === null) {
      setPendingPanelDropEntry(droppedEntry);
      setIsHistoryVisible(false);
      resetFileDropHover();
      return;
    }

    composerRef.current.insertFileEntry(droppedEntry);
    composerRef.current.focus();
    resetFileDropHover();
  }, [resetFileDropHover]);

  const onComposerSend = useCallback(
    (payload: SidebarComposerSubmitPayload, mode: SidebarComposerMode): void => {
      onSendSessionPayload(sessionId, payload, mode);
      onSend?.(payload.text, mode);
    },
    [onSend, onSendSessionPayload, sessionId]
  );

  const renderHistoryList = () => (
    <section className="lyra-ai-panel-history-shell" aria-label="ai-panel-history">
      <header className="lyra-ai-panel-history-head">
        <span className="lyra-ai-panel-history-title">{historyTitle}</span>
        <button
          type="button"
          className="lyra-ai-panel-history-new"
          onClick={() => {
            onStartNewConversation?.();
            onSetQuotedMessage?.(sessionId, null);
            setIsHistoryVisible(false);
          }}
        >
          <Plus size={13} />
          <span>{newConversationLabel}</span>
        </button>
      </header>
      <div className="lyra-ai-panel-history-list">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="lyra-ai-panel-history-item"
            aria-label={`${openConversationLabel} ${item.title}`}
            onClick={() => {
              onOpenHistoryItem?.(item.id);
              setIsHistoryVisible(false);
            }}
          >
            <span className="lyra-ai-panel-history-item-row">
              <span className="lyra-ai-panel-history-item-title">{item.title}</span>
              <span className="lyra-ai-panel-history-item-time">{item.updatedAt}</span>
            </span>
            <span className="lyra-ai-panel-history-item-summary">{item.summary}</span>
            {item.isOpenInWorkspace && historyWorkspaceBadgeLabel !== undefined ? (
              <span className="lyra-ai-panel-history-item-badge">
                {historyWorkspaceBadgeLabel}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </section>
  );

  const renderChatSurface = () => (
    <div className="lyra-ai-panel-chat">
      <AiPanelMessageThread
        variant={variant}
        messages={messages}
        {...(runtimeItems === undefined ? {} : { runtimeItems })}
        {...(runtimeLabels === undefined ? {} : { runtimeLabels })}
        {...(computerLabels === undefined ? {} : { computerLabels })}
        {...(computerState === undefined ? {} : { computerState })}
        {...(desktopApi === undefined ? {} : { desktopApi })}
        {...(fileEditorModel === undefined ? {} : { fileEditorModel })}
        {...(fileEditorLabels === undefined ? {} : { fileEditorLabels })}
        {...(fileManagerModel === undefined ? {} : { fileManagerModel })}
        {...(fileManagerLabels === undefined ? {} : { fileManagerLabels })}
        {...(terminalLabels === undefined ? {} : { terminalLabels })}
        {...(terminalThemeSignature === undefined ? {} : { terminalThemeSignature })}
        {...(terminalThemePreset === undefined ? {} : { terminalThemePreset })}
        {...(themeSignature === undefined ? {} : { themeSignature })}
        actionLabels={{
          copy: actionCopyLabel,
          fork: actionForkLabel,
          undo: actionUndoLabel,
          edit: actionEditLabel,
          quote: actionQuoteLabel,
          ariaCopyUser: actionAriaCopyUser,
          ariaForkUser: actionAriaForkUser,
          ariaUndoUser: actionAriaUndoUser,
          ariaEditUser: actionAriaEditUser,
          ariaQuoteUser: actionAriaQuoteUser,
          ariaCopyAssistant: actionAriaCopyAssistant,
          ariaQuoteAssistant: actionAriaQuoteAssistant
        }}
        taskCardLabels={{
          open: taskCardOpenLabel,
          copy: taskCardCopyLabel,
          copied: taskCardCopiedLabel,
          accept: taskCardAcceptLabel,
          reject: taskCardRejectLabel,
          undo: taskCardUndoLabel
        }}
        {...(onActivateRuntimeItem === undefined
          ? {}
          : { onActivateRuntimeItem })}
        {...(onOpenRuntimeItemInWorkspaceTab === undefined
          ? {}
          : { onOpenRuntimeItemInWorkspaceTab })}
        {...(onAcceptRuntimeItem === undefined
          ? {}
          : { onAcceptRuntimeItem })}
        {...(onRejectRuntimeItem === undefined
          ? {}
          : { onRejectRuntimeItem })}
        {...(onUndoRuntimeItem === undefined
          ? {}
          : { onUndoRuntimeItem })}
        {...(onOpenMessageContextMenu === undefined
          ? {}
          : { onRequestContextMenu: onOpenMessageContextMenu })}
        onUserAction={(message, actionId) => {
          if (actionId === "quote") {
            onSetQuotedMessage?.(sessionId, message.content);
          }
        }}
        onAssistantAction={(message, actionId) => {
          if (actionId === "quote") {
            onSetQuotedMessage?.(sessionId, message.content);
          }
        }}
      />
      <SidebarComposer
        key={sessionId}
        ref={composerRef}
        ariaLabel={ariaLabel}
        placeholder={placeholder}
        sendLabel={sendLabel}
        defaultMode={composerMode}
        isResponding={isReplying}
        {...(questionPanel === null || questionPanel === undefined ? {} : { questionPanel })}
        {...(
          changeApprovalPanel === null || changeApprovalPanel === undefined
            ? {}
            : { changeApprovalPanel }
        )}
        {...(
          changeApprovalLabels === undefined
            ? {}
            : { changeApprovalLabels }
        )}
        {...(questionNavigateUpLabel === undefined ? {} : { questionNavigateUpLabel })}
        {...(questionNavigateDownLabel === undefined ? {} : { questionNavigateDownLabel })}
        {...(questionCloseLabel === undefined ? {} : { questionCloseLabel })}
        {...(questionCustomPlaceholder === undefined ? {} : { questionCustomPlaceholder })}
        {...(questionSubmitCustomLabel === undefined ? {} : { questionSubmitCustomLabel })}
        onModeChange={(mode) => {
          onComposerModeChange?.(sessionId, mode);
        }}
        onQuestionNavigateUp={() => {
          onQuestionNavigate?.(sessionId, "up");
        }}
        onQuestionNavigateDown={() => {
          onQuestionNavigate?.(sessionId, "down");
        }}
        onQuestionClose={() => {
          onCloseQuestionPanel?.(sessionId);
        }}
        onQuestionSelectOption={(questionId, optionId) => {
          onQuestionSelectOption?.(sessionId, questionId, optionId);
        }}
        onQuestionCustomDraftChange={(questionId, value) => {
          onQuestionCustomDraftChange?.(sessionId, questionId, value);
        }}
        onQuestionSubmitCustom={(questionId) => {
          onQuestionSubmitCustom?.(sessionId, questionId);
        }}
        onChangeApprovalViewChange={(view) => {
          onChangeApprovalViewChange?.(sessionId, view);
        }}
        onAcceptAllChanges={() => {
          onAcceptAllRuntimeFileChanges?.(sessionId);
        }}
        onOpenChangedFile={(filePath) => {
          if (onOpenChangedFile !== undefined) {
            onOpenChangedFile(sessionId, filePath);
            return;
          }
          onOpenRuntimeItemInWorkspaceTab?.(filePath);
        }}
        onRequestPause={() => {
          onPauseSession(sessionId);
        }}
        {...(quotedMessage === null ? {} : { quotedMessage })}
        onSendPayload={onComposerSend}
      />
    </div>
  );

  const renderHistoryFloatingPanel = () => (
    <aside
      ref={historyPanelRef}
      className={`lyra-ai-panel-history-floating lyra-ai-panel-history-floating-${variant}`}
      aria-label="ai-panel-history-floating"
    >
      {renderHistoryList()}
    </aside>
  );

  const isWorkspaceVariant = variant === "workspace";
  const canRenderRuntimeWorkspace =
    isWorkspaceVariant
    && runtimeItems !== undefined
    && runtimeLabels !== undefined
    && computerLabels !== undefined
    && fileManagerModel !== undefined
    && fileManagerLabels !== undefined
    && fileEditorModel !== undefined
    && fileEditorLabels !== undefined
    && terminalLabels !== undefined
    && terminalThemeSignature !== undefined
    && terminalThemePreset !== undefined
    && themeSignature !== undefined;

  const renderContent = () => {
    if (isWorkspaceVariant === false) {
      return renderChatSurface();
    }

    return (
      <div className="lyra-ai-panel-workspace-layout" aria-label="ai-panel-workspace-layout">
        <div className="lyra-ai-panel-workspace-chat-shell">
          {renderTopbar("lyra-ai-panel-topbar lyra-ai-panel-topbar-workspace-chat")}
          <div className="lyra-ai-panel-workspace-chat">{renderChatSurface()}</div>
        </div>
        <div className="lyra-ai-panel-workspace-runtime">
          {canRenderRuntimeWorkspace ? (
            <AiPanelComputerSurface
              sessionId={sessionId}
              labels={computerLabels}
              desktopApi={desktopApi ?? null}
              computerState={computerState ?? null}
              computerHostStatus={computerHostStatus ?? null}
              fileManagerModel={fileManagerModel}
              fileManagerLabels={fileManagerLabels}
              fileEditorModel={fileEditorModel}
              fileEditorLabels={fileEditorLabels}
              terminalLabels={terminalLabels}
              terminalThemeSignature={terminalThemeSignature}
              terminalThemePreset={terminalThemePreset}
              uiThemeId={themeSignature}
              onPowerOn={() => {
                onPowerOnComputer?.(sessionId);
              }}
              onPowerOff={() => {
                onPowerOffComputer?.(sessionId);
              }}
              onInstallOfficialSystem={() => {
                onInstallOfficialSystem?.(sessionId);
              }}
              onOpenApp={(request) => {
                onOpenComputerApp?.(sessionId, request);
              }}
              onFocusApp={(appInstanceId) => {
                onFocusComputerApp?.(sessionId, appInstanceId);
              }}
              onCloseApp={(appInstanceId) => {
                onCloseComputerApp?.(sessionId, appInstanceId);
              }}
              onMoveAppWindow={(appInstanceId, frame) => {
                onMoveComputerAppWindow?.(sessionId, appInstanceId, frame);
              }}
              onResizeAppWindow={(appInstanceId, frame) => {
                onResizeComputerAppWindow?.(sessionId, appInstanceId, frame);
              }}
              onMinimizeApp={(appInstanceId) => {
                onMinimizeComputerApp?.(sessionId, appInstanceId);
              }}
              onMaximizeApp={(appInstanceId) => {
                onMaximizeComputerApp?.(sessionId, appInstanceId);
              }}
              onRestoreApp={(appInstanceId) => {
                onRestoreComputerApp?.(sessionId, appInstanceId);
              }}
              onOpenFileInWorkspace={onOpenRuntimeItemInWorkspaceTab ?? (() => undefined)}
            />
          ) : null}
        </div>
      </div>
    );
  };

  const renderTopbar = (className?: string) => (
    <header className={className === undefined ? "lyra-ai-panel-topbar" : className}>
      <div className="lyra-ai-panel-topbar-start">
        <button
          ref={historyToggleRef}
          type="button"
          className={
            isHistoryVisible
              ? "lyra-ai-panel-topbar-nav lyra-ai-panel-topbar-nav-active"
              : "lyra-ai-panel-topbar-nav"
          }
          aria-label={openHistoryLabel}
          onClick={() => {
            setIsHistoryVisible((current) => !current);
          }}
        >
          <History size={14} />
        </button>
      </div>
      <div className="lyra-ai-panel-topbar-actions">
        <button
          type="button"
          className="lyra-ai-panel-topbar-action"
          aria-label={openMcpLabel}
          onClick={onOpenMcp}
        >
          {renderAiPanelTopbarIcon("mcp")}
        </button>
        <button
          type="button"
          className="lyra-ai-panel-topbar-action"
          aria-label={openSkillsLabel}
          onClick={onOpenSkills}
        >
          {renderAiPanelTopbarIcon("skills")}
        </button>
        {onTopbarAction !== undefined && topbarActionLabel !== undefined ? (
          <button
            type="button"
            className="lyra-ai-panel-topbar-action"
            aria-label={topbarActionLabel}
            onClick={onTopbarAction}
          >
            <PanelLeftOpen size={14} />
          </button>
        ) : null}
      </div>
    </header>
  );

  return (
    <AiTaskCardRegistryProvider scopeKey={sessionId}>
      <AiComputerViewStateProvider sessionId={sessionId}>
        <section
          className={
            isFileDropHover
              ? `lyra-ai-panel-surface lyra-ai-panel-surface-${variant} lyra-ai-panel-surface-drop-active`
              : isHistoryVisible
                ? `lyra-ai-panel-surface lyra-ai-panel-surface-${variant} lyra-ai-panel-surface-history-open`
                : `lyra-ai-panel-surface lyra-ai-panel-surface-${variant}`
          }
          aria-label="ai-panel-surface"
          onDragEnter={onSurfaceDragEnter}
          onDragOver={onSurfaceDragOver}
          onDragLeave={onSurfaceDragLeave}
          onDrop={onSurfaceDrop}
        >
          {isWorkspaceVariant ? null : renderTopbar()}

          <section
            className={
              isWorkspaceVariant
                ? "lyra-ai-panel-content lyra-ai-panel-content-workspace"
                : "lyra-ai-panel-content"
            }
          >
            {renderContent()}
          </section>

          {isHistoryVisible ? renderHistoryFloatingPanel() : null}

          {isFileDropHover ? (
            <div className="lyra-ai-panel-drop-overlay" aria-hidden="true">
              <div className="lyra-ai-panel-drop-overlay-card">
                <strong>{dropHintTitle}</strong>
                <span>{dropHintDescription}</span>
              </div>
            </div>
          ) : null}
        </section>
      </AiComputerViewStateProvider>
    </AiTaskCardRegistryProvider>
  );
};
