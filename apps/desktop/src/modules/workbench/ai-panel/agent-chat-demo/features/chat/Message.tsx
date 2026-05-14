import { Copy, Undo2 } from "lucide-react";
import type { ChatMessage } from "../../core/types";
import { ToolGroupBlock } from "../tools/ToolGroup";
import { BrailleSpinner } from "../../components/BrailleSpinner";
import { StreamingText } from "../rich-text/StreamingText";

/** Check if any tool group in the message is still running. */
function isMessageWorking(message: ChatMessage): boolean {
  return message.blocks.some(
    (b) => b.type === "tools" && b.group.status === "running"
  );
}

export function Message({ message }: { message: ChatMessage }) {
  const handleCopy = () => {
    const text = message.blocks
      .filter((b) => b.type === "text")
      .map((b) => (b as { body: string }).body)
      .join("\n\n");
    navigator.clipboard.writeText(text);
  };

  if (message.author === "user") {
    return (
      <div className="msg msg-user">
        <div className="msg-content-user">
          <div className="msg-bubble">
            {message.blocks.map((b) =>
              b.type === "text" ? (
                <p key={b.id} className="msg-text">
                  {b.body}
                </p>
              ) : null
            )}
          </div>
          {message.time && (
            <span className="msg-time msg-time-user">
              <span className="time-text">{message.time}</span>
              <span className="time-actions">
                <span className="time-copy" onClick={handleCopy} role="button" aria-label="Copy message">
                  <Copy size={12} strokeWidth={2} />
                </span>
                <span className="time-copy" role="button" aria-label="Undo message">
                  <Undo2 size={12} strokeWidth={2} />
                </span>
              </span>
            </span>
          )}
        </div>
      </div>
    );
  }

  const working = isMessageWorking(message);
  const textBlocks = message.blocks.filter((b) => b.type === "text");
  const lastTextId = textBlocks.at(-1)?.id ?? null;

  return (
    <div className="msg msg-agent">
      <div className="msg-body">
        {message.blocks.map((b) => {
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
          return <ToolGroupBlock key={b.id} group={b.group} />;
        })}
        {working ? (
          <span className="msg-time msg-time-agent">
            <BrailleSpinner />
          </span>
        ) : message.time ? (
          <span className="msg-time msg-time-agent">
            <span className="time-text">{message.time}</span>
            <span className="time-copy" onClick={handleCopy} role="button" aria-label="Copy message">
              <Copy size={12} strokeWidth={2} />
            </span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
