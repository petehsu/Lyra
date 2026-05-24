import { History } from "lucide-react";

import type { AgentSessionHistoryAppIconKey } from "./types";

const wrapIcon = (node: JSX.Element) => (
  <span className="lyra-file-manager-icon-shell" aria-hidden="true">
    {node}
  </span>
);

export const renderAgentSessionHistoryAppIcon = (
  iconKey: AgentSessionHistoryAppIconKey
): JSX.Element => {
  if (iconKey === "agent-session-history-default") {
    return wrapIcon(<History size={15} />);
  }
  return wrapIcon(<History size={15} />);
};
