import { Moon } from "lucide-react";

import type { AgentOvernightAppIconKey } from "./types";

const wrapIcon = (node: JSX.Element) => (
  <span className="lyra-file-manager-icon-shell" aria-hidden="true">
    {node}
  </span>
);

export const renderAgentOvernightAppIcon = (
  iconKey: AgentOvernightAppIconKey
): JSX.Element => {
  if (iconKey === "agent-overnight-default") {
    return wrapIcon(<Moon size={15} />);
  }
  return wrapIcon(<Moon size={15} />);
};
