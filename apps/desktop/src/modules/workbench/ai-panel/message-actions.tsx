import React from "react";
import { Check, Copy, GitFork, RefreshCcw, Undo2 } from "lucide-react";
import { useMessageCopy } from "./use-message-copy";

export interface MessageActionsProps {
  content: string;
  messageType: "user" | "assistant";
  className?: string;
  copyLabel?: string;
  copiedLabel?: string;
  forkLabel?: string;
  onFork?: () => void;
  regenerateLabel?: string;
  onRegenerate?: () => void;
  editLabel?: string;
  onEdit?: () => void;
}

export const MessageActions: React.FC<MessageActionsProps> = ({
  content,
  messageType,
  className = "",
  copyLabel = "Copy",
  copiedLabel = "Copied",
  forkLabel,
  onFork,
  regenerateLabel,
  onRegenerate,
  editLabel,
  onEdit,
}) => {
  const { isCopied, copyMessage } = useMessageCopy();

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await copyMessage(content);
  };

  return (
    <div
      className={`lyra-ai-message-actions ${messageType === "user" ? "lyra-ai-message-actions-user" : "lyra-ai-message-actions-assistant"} ${className}`}
    >
      <button
        type="button"
        className={isCopied ? "lyra-ai-message-copy-button lyra-ai-message-copy-button-copied" : "lyra-ai-message-copy-button"}
        onClick={handleCopy}
        aria-label={isCopied ? copiedLabel : copyLabel}
      >
        {isCopied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      {onFork === undefined ? null : (
        <button
          type="button"
          className="lyra-ai-message-copy-button lyra-ai-message-fork-button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onFork();
          }}
          aria-label={forkLabel ?? "Fork from this response"}
        >
          <GitFork size={14} />
        </button>
      )}
      {onRegenerate === undefined ? null : (
        <button
          type="button"
          className="lyra-ai-message-copy-button lyra-ai-message-regenerate-button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRegenerate();
          }}
          aria-label={regenerateLabel ?? "Regenerate response"}
        >
          <RefreshCcw size={14} />
        </button>
      )}
      {onEdit === undefined ? null : (
        <button
          type="button"
          className="lyra-ai-message-copy-button lyra-ai-message-edit-button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onEdit();
          }}
          aria-label={editLabel ?? "Edit message"}
        >
          <Undo2 size={14} />
        </button>
      )}
    </div>
  );
};
