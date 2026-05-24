import { FlaskConical } from "lucide-react";

import type { AgentSelfDevAppIconKey } from "./types";

const wrapIcon = (node: JSX.Element) => (
  <span className="lyra-file-manager-icon-shell" aria-hidden="true">
    {node}
  </span>
);

export const renderAgentSelfDevAppIcon = (
  iconKey: AgentSelfDevAppIconKey
): JSX.Element => {
  if (iconKey === "agent-selfdev-default") {
    return wrapIcon(<FlaskConical size={15} />);
  }
  return wrapIcon(<FlaskConical size={15} />);
};
