import { useState } from "react";
import { Undo2 } from "lucide-react";

import type {
  AgentMessage,
  AgentPreviewMessageRollbackRequest,
  AgentPreviewMessageRollbackResult,
  AgentRecoverySummary,
} from "./agent-ui-types";
import { canPreviewMessageRollback } from "./rollback-preview-model";

type RollbackMessageActionProps = {
  readonly message: AgentMessage;
  readonly recoverySummary: AgentRecoverySummary | null | undefined;
  readonly previewMessageRollback?:
    | ((request: AgentPreviewMessageRollbackRequest) => Promise<AgentPreviewMessageRollbackResult>)
    | undefined;
  readonly onPreviewComplete?: (() => Promise<void> | void) | undefined;
};

export const RollbackMessageAction = ({
  message,
  recoverySummary,
  previewMessageRollback,
  onPreviewComplete,
}: RollbackMessageActionProps) => {
  const [isPreviewing, setIsPreviewing] = useState(false);
  if (
    previewMessageRollback === undefined
    || canPreviewMessageRollback(recoverySummary, message) === false
  ) {
    return null;
  }
  return (
    <button
      className="lyra-ai-message-rollback-action"
      type="button"
      aria-label="Rollback preview"
      title="Rollback preview"
      disabled={isPreviewing}
      onClick={(event) => {
        event.stopPropagation();
        setIsPreviewing(true);
        void previewMessageRollback({
          sessionId: message.sessionId,
          targetUserMessageId: message.id,
        })
          .then(async () => {
            await onPreviewComplete?.();
          })
          .finally(() => {
            setIsPreviewing(false);
          });
      }}
    >
      <Undo2 size={13} aria-hidden="true" />
    </button>
  );
};
