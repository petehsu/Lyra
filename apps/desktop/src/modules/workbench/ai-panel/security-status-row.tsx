import { useMemo } from "react";

import type { AgentSessionDetail } from "./agent-ui-types";
import { createSecurityStatusModel } from "./security-status-model";

type SecurityStatusRowProps = {
  readonly detail: AgentSessionDetail | null;
};

export const SecurityStatusRow = ({ detail }: SecurityStatusRowProps) => {
  const model = useMemo(() => createSecurityStatusModel(detail), [detail]);
  if (model === null) {
    return null;
  }
  const Icon = model.icon;
  return (
    <section
      className={`lyra-ai-security-status-row lyra-ai-security-status-row--${model.kind}`}
      title={model.tooltip}
      aria-label="Policy and security status"
    >
      <span className="lyra-ai-security-status-icon" aria-hidden="true">
        <Icon size={13} />
      </span>
      <span className="lyra-ai-security-status-main">
        <span className="lyra-ai-security-status-title">{model.title}</span>
        <span className="lyra-ai-security-status-detail">{model.detail}</span>
      </span>
      <span className="lyra-ai-security-status-badge">{model.badge}</span>
    </section>
  );
};
