import { Copy, Undo2 } from "lucide-react";
import { useState } from "react";
import type { AgentRollbackPreviewResponse } from "../../../../../../shared/agent";
import type { ChatMessage } from "../../core/types";
import { useData } from "../../data/DataProvider";
import { ToolGroupBlock } from "../tools/ToolGroup";
import { BrailleSpinner } from "../../components/BrailleSpinner";
import { ClickableImage, imagePreviewSource } from "../rich-text/ActionTargets";
import { StreamingText } from "../rich-text/StreamingText";
import { formatMessage, t } from "../../core/i18n";

/** Check if any tool group in the message is still running. */
export function isAgentMessageWorking(message: ChatMessage): boolean {
  return message.blocks.some(
    (b) => b.type === "tools" && b.group.status === "running"
  );
}

export function isEmptyPendingAgentMessage(message: ChatMessage): boolean {
  return (
    message.author === "agent" &&
    message.blocks.length > 0 &&
    message.blocks.every((b) => b.type === "text" && b.body.trim().length === 0)
  );
}

export function shouldShowAgentActivityIndicator(message: ChatMessage): boolean {
  return (
    message.author === "agent" &&
    (isEmptyPendingAgentMessage(message) || isAgentMessageWorking(message))
  );
}

export function Message({
  message,
  showActivityIndicator = true
}: {
  message: ChatMessage;
  showActivityIndicator?: boolean;
}) {
  const { previewRollback, rollbackMessage, isTurnRunning } = useData();
  const [rollbackPreview, setRollbackPreview] = useState<AgentRollbackPreviewResponse | null>(null);
  const [rollbackBusy, setRollbackBusy] = useState(false);
  const [rollbackError, setRollbackError] = useState<string | null>(null);

  const handleCopy = () => {
    const text = message.blocks
      .filter((b) => b.type === "text")
      .map((b) => (b as { body: string }).body)
      .join("\n\n");
    navigator.clipboard.writeText(text);
  };

  const canRollback =
    message.rollback?.available === true &&
    message.author === "user" &&
    !isTurnRunning &&
    !rollbackBusy;

  const unavailableRollbackReason =
    isTurnRunning
      ? t("msg.rollbackCancelRunning")
      : message.rollback?.unavailableReason ?? t("msg.rollbackUnavailable");

  const openRollbackConfirm = async () => {
    if (!canRollback) {
      setRollbackError(unavailableRollbackReason);
      return;
    }
    setRollbackBusy(true);
    setRollbackError(null);
    try {
      const preview = await previewRollback(message.id);
      if (!preview.available) {
        setRollbackError(preview.unavailableReason ?? t("msg.rollbackUnavailable"));
        setRollbackPreview(null);
        return;
      }
      setRollbackPreview(preview);
    } catch (error) {
      setRollbackError(error instanceof Error ? error.message : String(error));
    } finally {
      setRollbackBusy(false);
    }
  };

  const confirmRollback = async () => {
    setRollbackBusy(true);
    setRollbackError(null);
    try {
      await rollbackMessage(message.id);
      setRollbackPreview(null);
    } catch (error) {
      setRollbackError(error instanceof Error ? error.message : String(error));
    } finally {
      setRollbackBusy(false);
    }
  };

  if (message.author === "user") {
    return (
      <div className="msg msg-user">
        <div className="msg-content-user">
          <div className="msg-bubble">
            {message.blocks.map((b) => {
              if (b.type === "text") {
                return (
                  <p key={b.id} className="msg-text">
                    {b.body}
                  </p>
                );
              }
              if (b.type === "image") {
                const src = imagePreviewSource(b.image);
                return (
                  <figure key={b.id} className="msg-image">
                    <ClickableImage
                      src={src}
                      image={b.image}
                      alt={b.image.label ?? t("msg.imageAttachment")}
                    />
                    {b.image.label !== undefined && b.image.label !== null ? (
                      <figcaption>{b.image.label}</figcaption>
                    ) : null}
                  </figure>
                );
              }
              return null;
            })}
          </div>
          {message.time && (
            <span className="msg-time msg-time-user">
              <span className="time-text">{message.time}</span>
              <span className="time-actions">
                <span className="time-copy" onClick={handleCopy} role="button" aria-label={t("msg.copy")}>
                  <Copy size={12} strokeWidth={2} />
                </span>
                {message.rollback?.available === true ? (
                  <span
                    className="time-copy"
                    onClick={openRollbackConfirm}
                    role="button"
                    aria-disabled={!canRollback}
                    aria-label={t("msg.undoMessage")}
                    title={canRollback ? t("msg.rollbackTitle") : unavailableRollbackReason}
                  >
                    <Undo2 size={12} strokeWidth={2} />
                  </span>
                ) : null}
              </span>
            </span>
          )}
          {(rollbackPreview !== null || rollbackError !== null) && (
            <div className="msg-rollback-popover" role="dialog" aria-label={t("msg.rollbackConfirm")}>
              {rollbackPreview !== null ? (
                <>
                  <div className="msg-rollback-title">{t("msg.rollbackTitle")}</div>
                  <div className="msg-rollback-body">
                    {formatMessage("msg.rollbackBody", {
                      messages: rollbackPreview.removedMessageCount,
                      files: rollbackPreview.changedFiles.length
                    })}
                  </div>
                  {rollbackPreview.changedFiles.length > 0 ? (
                    <div className="msg-rollback-files">
                      {rollbackPreview.changedFiles.slice(0, 4).map((file) => (
                        <span key={file.path}>{file.path}</span>
                      ))}
                      {rollbackPreview.changedFiles.length > 4 ? (
                        <span>
                          {formatMessage("msg.rollbackMoreFiles", {
                            count: rollbackPreview.changedFiles.length - 4
                          })}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="msg-rollback-actions">
                    <button type="button" onClick={() => setRollbackPreview(null)} disabled={rollbackBusy}>
                      {t("msg.rollbackCancel")}
                    </button>
                    <button type="button" onClick={confirmRollback} disabled={rollbackBusy}>
                      {rollbackBusy ? t("msg.rollbackBusy") : t("msg.rollbackAction")}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="msg-rollback-title">{t("msg.rollbackErrorTitle")}</div>
                  <div className="msg-rollback-body">{rollbackError}</div>
                  <div className="msg-rollback-actions">
                    <button type="button" onClick={() => setRollbackError(null)}>{t("msg.rollbackClose")}</button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  const working = isAgentMessageWorking(message);
  const textBlocks = message.blocks.filter((b) => b.type === "text");
  const lastTextId = textBlocks.at(-1)?.id ?? null;
  const isEmptyPendingAgent = isEmptyPendingAgentMessage(message);
  const hasTextBlocks = textBlocks.some((b) => b.body.trim().length > 0);
  const hasImages = message.blocks.some((b) => b.type === "image");

  if (isEmptyPendingAgent && !showActivityIndicator) {
    return null;
  }

  return (
    <div className="msg msg-agent">
      <div className="msg-body">
        {isEmptyPendingAgent ? (
          <div className="msg-loading" aria-label={t("msg.agentResponding")}>
            <BrailleSpinner />
          </div>
        ) : (
          message.blocks.map((b) => {
            if (b.type === "text") {
              // Stream the last text block if the message is still working
              const isLastText = b.id === lastTextId;
              const shouldStream = working && isLastText;
              return (
                <div key={b.id} className="msg-text-block">
                  <StreamingText content={b.body} streaming={shouldStream} />
                </div>
              );
            }
            if (b.type === "image") {
              const src = imagePreviewSource(b.image);
              return (
                <figure key={b.id} className="msg-image msg-image-agent">
                  <ClickableImage
                    src={src}
                    image={b.image}
                    alt={b.image.label ?? t("msg.imageAttachment")}
                  />
                  {b.image.label !== undefined && b.image.label !== null ? (
                    <figcaption>{b.image.label}</figcaption>
                  ) : null}
                </figure>
              );
            }
            return <ToolGroupBlock key={b.id} group={b.group} />;
          })
        )}
        {working && showActivityIndicator ? (
          <span className="msg-time msg-time-agent" aria-label={t("msg.agentResponding")}>
            <BrailleSpinner />
          </span>
        ) : (message.time && (hasTextBlocks || hasImages)) ? (
          <span className="msg-time msg-time-agent">
            <span className="time-text">{message.time}</span>
            <span className="time-copy" onClick={handleCopy} role="button" aria-label={t("msg.copy")}>
              <Copy size={12} strokeWidth={2} />
            </span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
