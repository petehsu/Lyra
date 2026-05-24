import { GitBranch } from "lucide-react";

import type { AgentGitAppIconKey } from "./types";

const wrapIcon = (node: JSX.Element) => (
  <span className="lyra-file-manager-icon-shell" aria-hidden="true">
    {node}
  </span>
);

export const renderAgentGitAppIcon = (
  iconKey: AgentGitAppIconKey
): JSX.Element => {
  if (iconKey === "agent-git-default") {
    return wrapIcon(<GitBranch size={15} />);
  }
  return wrapIcon(<GitBranch size={15} />);
};
