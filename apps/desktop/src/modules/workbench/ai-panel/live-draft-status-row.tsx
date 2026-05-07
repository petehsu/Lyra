import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  FileText,
  Loader2,
} from "lucide-react";

import type { AgentSessionDetail } from "./agent-ui-types";
import {
  activeLiveDraft,
  liveDraftDetail,
  liveDraftLabel,
  liveDraftTone,
} from "./live-draft-model";

type LiveDraftStatusRowProps = {
  readonly detail: AgentSessionDetail | null;
};

export const LiveDraftStatusRow = ({ detail }: LiveDraftStatusRowProps) => {
  const draft = activeLiveDraft(detail?.followSummary);
  if (draft === null) {
    return null;
  }
  const tone = liveDraftTone(draft.status);
  return (
    <section
      className="lyra-ai-live-draft-row"
      data-status={draft.status}
      data-tone={tone}
      aria-label="Live draft"
    >
      <span className="lyra-ai-live-draft-icon" aria-hidden="true">
        {iconForTone(tone)}
      </span>
      <span className="lyra-ai-live-draft-main">
        <span className="lyra-ai-live-draft-title">{liveDraftLabel(draft.status)}</span>
        <span className="lyra-ai-live-draft-detail">{liveDraftDetail(draft)}</span>
      </span>
    </section>
  );
};

const iconForTone = (tone: ReturnType<typeof liveDraftTone>) => {
  switch (tone) {
    case "ready":
      return <FileText size={13} />;
    case "committing":
      return <Loader2 size={13} />;
    case "done":
      return <CheckCircle2 size={13} />;
    case "blocked":
      return <AlertTriangle size={13} />;
    default:
      return <CircleDashed size={13} />;
  }
};
