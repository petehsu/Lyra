import {
  Check,
  Copy,
  GitFork,
  Pencil,
  Quote,
  Undo2
} from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import { LyraBrandLogo } from "../brand";
import type { ContextMenuOpenRequest } from "../context-menu";
import type { FileEditorLabels, FileEditorModel } from "../file-editor";
import type { FileManagerModel, FileManagerSurfaceLabels } from "../file-manager";
import { renderFileManagerEntryIconByKind } from "../file-manager/icon-registry";
import type { SidebarComposerToken } from "../sidebar/types";
import type { TerminalDockLabels } from "../terminal-dock";
import type { TerminalThemePresetId } from "../terminal-theme";
import { resolveSidebarFileChipIconKind } from "../sidebar/file-chip-icon-kind";
import type { AiComputerLabels } from "./computer/types";
import { measureAiHotzone } from "./hotzone-profile";
import { aiTextLayoutService } from "./text-layout";
import type {
  AiPanelMessage,
  AiPanelMessageAssistantActionId,
  AiPanelMessageUserActionId
} from "./chat-types";
import { AiPanelRuntimeTimelineEntry } from "./runtime";
import type { AiPanelRuntimeItem, AiPanelRuntimeLabels } from "./runtime";
import { buildAiPanelThreadTimeline } from "./thread-timeline";
import type {
  AiComputerSessionState,
  LyraDesktopApi
} from "../../../shared/desktop-bridge";

const LYRA_ASSISTANT_LOGO_URL = new URL(
  "../../../renderer/assets/logo.svg",
  import.meta.url
).toString();
const COPIED_MARK_DURATION_MS = 1200;
const MESSAGE_CONTENT_FONT = "400 12px system-ui";
const MESSAGE_CONTENT_LINE_HEIGHT_PX = 18.6;
const MESSAGE_BUBBLE_SIDE_PADDING_PX = 20;
const MESSAGE_ROW_SIDE_PADDING_PX = 36;
const MESSAGE_BUBBLE_MIN_WIDTH_PX = 220;
const EMPTY_RUNTIME_ITEMS: readonly AiPanelRuntimeItem[] = [];

type AiPanelMessageActionLabels = {
  readonly copy: string;
  readonly fork: string;
  readonly undo: string;
  readonly edit: string;
  readonly quote: string;
  readonly ariaCopyUser: string;
  readonly ariaForkUser: string;
  readonly ariaUndoUser: string;
  readonly ariaEditUser: string;
  readonly ariaQuoteUser: string;
  readonly ariaCopyAssistant: string;
  readonly ariaQuoteAssistant: string;
};

type AiPanelTaskCardLabels = {
  readonly open: string;
  readonly copy: string;
  readonly copied: string;
  readonly accept: string;
  readonly reject: string;
  readonly undo: string;
};

type AiPanelMessageThreadProps = {
  readonly variant: "sidebar" | "workspace";
  readonly messages: readonly AiPanelMessage[];
  readonly runtimeItems?: readonly AiPanelRuntimeItem[];
  readonly runtimeLabels?: AiPanelRuntimeLabels;
  readonly computerLabels?: AiComputerLabels;
  readonly computerState?: AiComputerSessionState | null;
  readonly desktopApi?: LyraDesktopApi | null;
  readonly fileEditorModel?: FileEditorModel;
  readonly fileEditorLabels?: FileEditorLabels;
  readonly fileManagerModel?: FileManagerModel;
  readonly fileManagerLabels?: FileManagerSurfaceLabels;
  readonly terminalLabels?: TerminalDockLabels;
  readonly terminalThemeSignature?: string;
  readonly terminalThemePreset?: TerminalThemePresetId;
  readonly themeSignature?: string;
  readonly taskCardLabels: AiPanelTaskCardLabels;
  readonly onActivateRuntimeItem?: (itemId: string) => void;
  readonly onOpenRuntimeItemInWorkspaceTab?: (filePath: string) => void;
  readonly onAcceptRuntimeItem?: (itemId: string) => void;
  readonly onRejectRuntimeItem?: (itemId: string) => void;
  readonly onUndoRuntimeItem?: (itemId: string) => void;
  readonly onRequestContextMenu?: (request: ContextMenuOpenRequest) => void;
  readonly onUserAction?: (message: AiPanelMessage, actionId: AiPanelMessageUserActionId) => void;
  readonly onAssistantAction?: (
    message: AiPanelMessage,
    actionId: AiPanelMessageAssistantActionId
  ) => void;
  readonly actionLabels: AiPanelMessageActionLabels;
};

const writeClipboardText = async (text: string): Promise<boolean> => {
  if (
    typeof navigator !== "undefined"
    && typeof navigator.clipboard?.writeText === "function"
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back to execCommand below.
    }
  }

  if (typeof document === "undefined") {
    return false;
  }

  const probe = document.createElement("textarea");
  probe.value = text;
  probe.setAttribute("readonly", "true");
  probe.style.position = "fixed";
  probe.style.opacity = "0";
  probe.style.pointerEvents = "none";
  probe.style.left = "-10000px";
  probe.style.top = "-10000px";
  document.body.append(probe);
  probe.focus();
  probe.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(probe);
  }
};

const renderMessageToken = (
  messageId: string,
  token: SidebarComposerToken,
  tokenIndex: number
) => {
  if (token.kind === "text") {
    return <Fragment key={`${messageId}-token-text-${tokenIndex}`}>{token.value}</Fragment>;
  }

  const iconKind = resolveSidebarFileChipIconKind(token.entryKind, token.iconKind);
  return (
    <span
      key={`${messageId}-token-file-${tokenIndex}`}
      className={`lyra-sidebar-composer-file-chip lyra-sidebar-composer-file-chip-kind-${iconKind} lyra-ai-message-file-chip`}
      title={token.path ?? token.name}
      data-lyra-file-name={token.name}
      data-lyra-file-kind={token.entryKind}
      data-lyra-file-source={token.source}
      {...(token.iconKind === undefined ? {} : { "data-lyra-file-icon-kind": token.iconKind })}
      {...(token.path === undefined ? {} : { "data-lyra-file-path": token.path })}
    >
      <span className="lyra-sidebar-composer-file-chip-icon" aria-hidden="true">
        {renderFileManagerEntryIconByKind(iconKind, {
          className: "lyra-sidebar-composer-file-chip-icon-glyph",
          size: 13
        })}
      </span>
      <span className="lyra-sidebar-composer-file-chip-label">{token.name}</span>
    </span>
  );
};

const renderMessageContent = (message: AiPanelMessage) => {
  if (message.tokens === undefined || message.tokens.length === 0) {
    return message.content;
  }

  return message.tokens.map((token, index) =>
    renderMessageToken(message.id, token, index)
  );
};

const resolveRuntimeItemCopyValue = (item: AiPanelRuntimeItem): string => {
  if (item.filePath !== undefined) {
    const added = item.addedLines ?? 0;
    const removed = item.removedLines ?? 0;
    return `${item.filePath} +${added} -${removed}`;
  }
  return `${item.title} ${item.summary}`.trim();
};

export const AiPanelMessageThread = ({
  variant,
  messages,
  runtimeItems,
  runtimeLabels,
  computerLabels,
  computerState,
  desktopApi,
  fileEditorModel,
  fileEditorLabels,
  fileManagerModel,
  fileManagerLabels,
  terminalLabels,
  terminalThemeSignature,
  terminalThemePreset,
  themeSignature,
  taskCardLabels,
  onActivateRuntimeItem,
  onOpenRuntimeItemInWorkspaceTab,
  onAcceptRuntimeItem,
  onRejectRuntimeItem,
  onUndoRuntimeItem,
  onRequestContextMenu,
  onUserAction,
  onAssistantAction,
  actionLabels
}: AiPanelMessageThreadProps) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const copiedResetTimerRef = useRef<number | null>(null);
  const messageHeightCacheRef = useRef<Map<string, {
    readonly signature: string;
    readonly minHeightPx: number;
  }>>(new Map());
  const [copiedTargetKey, setCopiedTargetKey] = useState<string | null>(null);
  const [threadWidthPx, setThreadWidthPx] = useState(0);

  const clearCopiedResetTimer = useCallback((): void => {
    if (copiedResetTimerRef.current !== null) {
      window.clearTimeout(copiedResetTimerRef.current);
      copiedResetTimerRef.current = null;
    }
  }, []);

  const markCopied = useCallback((targetKey: string): void => {
    setCopiedTargetKey(targetKey);
    clearCopiedResetTimer();
    copiedResetTimerRef.current = window.setTimeout(() => {
      setCopiedTargetKey((currentId) => (currentId === targetKey ? null : currentId));
      copiedResetTimerRef.current = null;
    }, COPIED_MARK_DURATION_MS);
  }, [clearCopiedResetTimer]);

  const copyMessage = useCallback(async (
    message: AiPanelMessage,
    copiedTarget: string
  ): Promise<boolean> => {
    const copied = await writeClipboardText(message.content);
    if (copied) {
      markCopied(copiedTarget);
    }
    return copied;
  }, [markCopied]);

  const copyRuntimeItem = useCallback(async (
    item: AiPanelRuntimeItem,
    copiedTarget: string
  ): Promise<boolean> => {
    const copied = await writeClipboardText(resolveRuntimeItemCopyValue(item));
    if (copied) {
      markCopied(copiedTarget);
    }
    return copied;
  }, [markCopied]);

  const triggerUserAction = useCallback((message: AiPanelMessage, actionId: AiPanelMessageUserActionId): void => {
    if (actionId === "copy") {
      void copyMessage(message, `message:${message.id}`);
    }
    onUserAction?.(message, actionId);
  }, [copyMessage, onUserAction]);

  const triggerAssistantAction = useCallback((
    message: AiPanelMessage,
    actionId: AiPanelMessageAssistantActionId
  ): void => {
    if (actionId === "copy") {
      void copyMessage(message, `message:${message.id}`);
    }
    onAssistantAction?.(message, actionId);
  }, [copyMessage, onAssistantAction]);

  const openMessageContextMenu = useCallback(
    (message: AiPanelMessage, anchorX: number, anchorY: number): void => {
      if (onRequestContextMenu === undefined) {
        return;
      }

      const isUser = message.role === "user";
      const isPendingAssistant = message.role === "assistant" && message.isPending;
      if (isPendingAssistant) {
        return;
      }

      const items = isUser
        ? [
            {
              id: `ai-user-copy-${message.id}`,
              label: actionLabels.copy,
              icon: <Copy size={14} />,
              onSelect: () => {
                triggerUserAction(message, "copy");
              }
            },
            {
              id: `ai-user-fork-${message.id}`,
              label: actionLabels.fork,
              icon: <GitFork size={14} />,
              onSelect: () => {
                triggerUserAction(message, "fork");
              }
            },
            {
              id: `ai-user-undo-${message.id}`,
              label: actionLabels.undo,
              icon: <Undo2 size={14} />,
              onSelect: () => {
                triggerUserAction(message, "undo");
              }
            },
            {
              id: `ai-user-edit-${message.id}`,
              label: actionLabels.edit,
              icon: <Pencil size={14} />,
              onSelect: () => {
                triggerUserAction(message, "edit");
              }
            },
            {
              id: `ai-user-quote-${message.id}`,
              label: actionLabels.quote,
              icon: <Quote size={14} />,
              onSelect: () => {
                triggerUserAction(message, "quote");
              }
            }
          ]
        : [
            {
              id: `ai-assistant-copy-${message.id}`,
              label: actionLabels.copy,
              icon: <Copy size={14} />,
              onSelect: () => {
                triggerAssistantAction(message, "copy");
              }
            },
            {
              id: `ai-assistant-quote-${message.id}`,
              label: actionLabels.quote,
              icon: <Quote size={14} />,
              onSelect: () => {
                triggerAssistantAction(message, "quote");
              }
            }
          ];

      onRequestContextMenu({
        anchorX,
        anchorY,
        items
      });
    },
    [actionLabels, onRequestContextMenu, triggerAssistantAction, triggerUserAction]
  );

  const timeline = useMemo(
    () =>
      measureAiHotzone("message-thread", () =>
        buildAiPanelThreadTimeline(
          messages,
          runtimeItems ?? EMPTY_RUNTIME_ITEMS,
          variant
        )
      ),
    [messages, runtimeItems, variant]
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) {
      return;
    }
    const frameId = window.requestAnimationFrame(() => {
      viewport.scrollTop = viewport.scrollHeight;
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [timeline]);

  useEffect(
    () => () => {
      clearCopiedResetTimer();
    },
    [clearCopiedResetTimer]
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) {
      return;
    }

    let frameId: number | null = null;
    const syncWidth = (): void => {
      if (frameId !== null) {
        return;
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        const nextWidth = viewport.clientWidth;
        setThreadWidthPx((current) => (current === nextWidth ? current : nextWidth));
      });
    };

    syncWidth();
    const observer = new ResizeObserver(syncWidth);
    observer.observe(viewport);
    window.addEventListener("resize", syncWidth);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncWidth);
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, []);

  const messageMinHeightById = useMemo(() => {
    return measureAiHotzone("message-thread", () => {
      const measuredHeightById = new Map<string, number>();
      const cache = messageHeightCacheRef.current;
      if (threadWidthPx <= 0) {
        return measuredHeightById;
      }

      const maxBubbleWidthPx = Math.max(
        MESSAGE_BUBBLE_MIN_WIDTH_PX,
        Math.floor(threadWidthPx - MESSAGE_ROW_SIDE_PADDING_PX)
      );
      const maxContentWidthPx = Math.max(1, maxBubbleWidthPx - MESSAGE_BUBBLE_SIDE_PADDING_PX);
      const activeMessageIds = new Set<string>();

      for (const message of messages) {
        if (message.role === "assistant" && message.isPending && message.content.length === 0) {
          continue;
        }
        activeMessageIds.add(message.id);
        const signature = `${maxContentWidthPx}\u0000${message.content}`;
        const cached = cache.get(message.id);
        if (cached !== undefined && cached.signature === signature) {
          measuredHeightById.set(message.id, cached.minHeightPx);
          continue;
        }
        const measured = aiTextLayoutService.measureParagraph({
          text: message.content,
          font: MESSAGE_CONTENT_FONT,
          lineHeightPx: MESSAGE_CONTENT_LINE_HEIGHT_PX,
          maxWidthPx: maxContentWidthPx,
          whiteSpace: "pre-wrap"
        });
        if (measured.heightPx <= 0) {
          cache.delete(message.id);
          continue;
        }
        const minHeightPx = Math.ceil(measured.heightPx);
        cache.set(message.id, { signature, minHeightPx });
        measuredHeightById.set(message.id, minHeightPx);
      }

      for (const messageId of Array.from(cache.keys())) {
        if (activeMessageIds.has(messageId)) {
          continue;
        }
        cache.delete(messageId);
      }

      return measuredHeightById;
    });
  }, [messages, threadWidthPx]);

  const resolvedRuntimeLabels: AiPanelRuntimeLabels = runtimeLabels ?? {
    workspaceTitle: "Runtime Workspace",
    emptyState: "No runtime task.",
    openInWorkspaceTab: "Open in workspace tab",
    kindFile: "File",
    kindWeb: "Web",
    kindApp: "App",
    statusQueued: "Queued",
    statusRunning: "Running",
    statusCompleted: "Completed",
    statusError: "Error"
  };

  return (
    <section
      className="lyra-ai-panel-thread"
      aria-label="ai-message-thread"
      ref={viewportRef}
    >
      {timeline.map((entry) => {
        if (entry.kind === "runtime") {
          const item = entry.item;
          const runtimeCopiedTargetKey = `runtime:${item.id}`;
          const isCopied = copiedTargetKey === runtimeCopiedTargetKey;
          return (
            <AiPanelRuntimeTimelineEntry
              key={`runtime-item-${item.id}`}
              item={item}
              presentation={entry.presentation}
              labels={resolvedRuntimeLabels}
              {...(computerLabels === undefined ? {} : { computerLabels })}
              {...(computerState === undefined ? {} : { computerState })}
              {...(desktopApi === undefined ? {} : { desktopApi })}
              copyLabel={taskCardLabels.copy}
              copiedLabel={taskCardLabels.copied}
              acceptLabel={taskCardLabels.accept}
              rejectLabel={taskCardLabels.reject}
              undoLabel={taskCardLabels.undo}
              openLabel={taskCardLabels.open}
              openInWorkspaceLabel={resolvedRuntimeLabels.openInWorkspaceTab}
              isCopied={isCopied}
              onCopy={(targetItem) => {
                void copyRuntimeItem(targetItem, runtimeCopiedTargetKey);
              }}
              onActivate={(itemId) => {
                onActivateRuntimeItem?.(itemId);
              }}
              {...(item.filePath === undefined || onOpenRuntimeItemInWorkspaceTab === undefined
                ? {}
                : {
                    onOpenInWorkspaceTab: (filePath: string) => {
                      onOpenRuntimeItemInWorkspaceTab(filePath);
                    }
                  })}
              {...(onAcceptRuntimeItem === undefined
                ? {}
                : { onAccept: onAcceptRuntimeItem })}
              {...(onRejectRuntimeItem === undefined
                ? {}
                : { onReject: onRejectRuntimeItem })}
              {...(onUndoRuntimeItem === undefined
                ? {}
                : { onUndo: onUndoRuntimeItem })}
              {...(fileEditorModel === undefined
                ? {}
                : { fileEditorModel })}
              {...(fileEditorLabels === undefined
                ? {}
                : { fileEditorLabels })}
              {...(fileManagerModel === undefined
                ? {}
                : { fileManagerModel })}
              {...(fileManagerLabels === undefined
                ? {}
                : { fileManagerLabels })}
              {...(terminalLabels === undefined
                ? {}
                : { terminalLabels })}
              {...(terminalThemeSignature === undefined
                ? {}
                : { terminalThemeSignature })}
              {...(terminalThemePreset === undefined
                ? {}
                : { terminalThemePreset })}
              {...(themeSignature === undefined
                ? {}
                : { uiThemeId: themeSignature })}
            />
          );
        }

        const message = entry.message;
        const isUser = message.role === "user";
        const isPendingAssistant = !isUser && message.isPending;
        const isPendingAssistantEmpty = isPendingAssistant && message.content.length === 0;
        const minContentHeightPx = messageMinHeightById.get(message.id);
        const contentStyle = minContentHeightPx === undefined
          ? undefined
          : { minHeight: `${minContentHeightPx}px` };
        return (
          <article
            key={message.id}
            className={
              isUser
                ? "lyra-ai-message-row lyra-ai-message-row-user"
                : "lyra-ai-message-row lyra-ai-message-row-assistant"
            }
          >
            <div
              className="lyra-ai-message-bubble-shell"
              onContextMenu={(event) => {
                if (onRequestContextMenu === undefined) {
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                openMessageContextMenu(message, event.clientX, event.clientY);
              }}
            >
              {isUser ? null : (
                <div className="lyra-ai-message-assistant-head">
                  <span className="lyra-ai-message-assistant-avatar" aria-hidden="true">
                    <LyraBrandLogo
                      logoUrl={LYRA_ASSISTANT_LOGO_URL}
                      className="lyra-ai-message-assistant-avatar-logo"
                    />
                  </span>
                  <span className="lyra-ai-message-assistant-name">Lyra</span>
                </div>
              )}
              <div
                className={
                  isUser
                    ? "lyra-ai-message-bubble lyra-ai-message-bubble-user"
                    : isPendingAssistantEmpty
                      ? "lyra-ai-message-bubble lyra-ai-message-bubble-assistant lyra-ai-message-bubble-typing"
                      : "lyra-ai-message-bubble lyra-ai-message-bubble-assistant"
                }
              >
                {isPendingAssistantEmpty ? (
                  <>
                    <span className="lyra-ai-message-typing-dot" />
                    <span className="lyra-ai-message-typing-dot" />
                    <span className="lyra-ai-message-typing-dot" />
                  </>
                ) : isPendingAssistant ? (
                  <p
                    className="lyra-ai-message-content lyra-ai-message-content-stream"
                    aria-live="polite"
                    aria-atomic="false"
                    style={contentStyle}
                  >
                    {Array.from(message.content).map((token, index) => {
                      if (token === "\n") {
                        return <br key={`${message.id}-stream-break-${index}`} />;
                      }
                      return (
                        <span
                          key={`${message.id}-stream-token-${index}`}
                          className="lyra-ai-message-stream-token"
                        >
                          {token === " " ? "\u00A0" : token}
                        </span>
                      );
                    })}
                  </p>
                ) : (
                  <p className="lyra-ai-message-content" style={contentStyle}>
                    {renderMessageContent(message)}
                  </p>
                )}
              </div>

              {isUser ? (
                <div className="lyra-ai-message-actions lyra-ai-message-actions-user">
                  <button
                    type="button"
                    className={
                      copiedTargetKey === `message:${message.id}`
                        ? "lyra-ai-message-action lyra-ai-message-action-copied"
                        : "lyra-ai-message-action"
                    }
                    aria-label={actionLabels.ariaCopyUser}
                    onClick={() => {
                      triggerUserAction(message, "copy");
                    }}
                  >
                    {copiedTargetKey === `message:${message.id}` ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                  <button
                    type="button"
                    className="lyra-ai-message-action"
                    aria-label={actionLabels.ariaForkUser}
                    onClick={() => {
                      triggerUserAction(message, "fork");
                    }}
                  >
                    <GitFork size={12} />
                  </button>
                  <button
                    type="button"
                    className="lyra-ai-message-action"
                    aria-label={actionLabels.ariaUndoUser}
                    onClick={() => {
                      triggerUserAction(message, "undo");
                    }}
                  >
                    <Undo2 size={12} />
                  </button>
                  <button
                    type="button"
                    className="lyra-ai-message-action"
                    aria-label={actionLabels.ariaEditUser}
                    onClick={() => {
                      triggerUserAction(message, "edit");
                    }}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    className="lyra-ai-message-action"
                    aria-label={actionLabels.ariaQuoteUser}
                    onClick={() => {
                      triggerUserAction(message, "quote");
                    }}
                  >
                    <Quote size={12} />
                  </button>
                </div>
              ) : !isPendingAssistant ? (
                <div className="lyra-ai-message-actions lyra-ai-message-actions-assistant">
                  <button
                    type="button"
                    className={
                      copiedTargetKey === `message:${message.id}`
                        ? "lyra-ai-message-action lyra-ai-message-action-copied"
                        : "lyra-ai-message-action"
                    }
                    aria-label={actionLabels.ariaCopyAssistant}
                    onClick={() => {
                      triggerAssistantAction(message, "copy");
                    }}
                  >
                    {copiedTargetKey === `message:${message.id}` ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                  <button
                    type="button"
                    className="lyra-ai-message-action"
                    aria-label={actionLabels.ariaQuoteAssistant}
                    onClick={() => {
                      triggerAssistantAction(message, "quote");
                    }}
                  >
                    <Quote size={12} />
                  </button>
                </div>
              ) : null}
            </div>
          </article>
        );
      })}
    </section>
  );
};
