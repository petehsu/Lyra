import React from "react";
import { Copy, Check } from "lucide-react";
import { useMessageCopy } from "./use-message-copy";

export interface MessageActionsProps {
  content: string;
  messageType: "user" | "assistant";
  className?: string;
}

export const MessageActions: React.FC<MessageActionsProps> = ({
  content,
  messageType,
  className = "",
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
        className="lyra-ai-message-copy-button"
        onClick={handleCopy}
        aria-label={isCopied ? "已复制" : "复制消息"}
        title={isCopied ? "已复制" : "复制消息"}
      >
        {isCopied ? (
          <>
            <Check size={14} />
            <span className="lyra-ai-message-copy-text">已复制</span>
          </>
        ) : (
          <Copy size={14} />
        )}
      </button>
    </div>
  );
};