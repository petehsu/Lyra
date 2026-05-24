import { FolderTree } from "lucide-react";

import type { AgentProjectTreeAppIconKey } from "./types";

const wrapIcon = (node: JSX.Element) => (
  <span className="lyra-file-manager-icon-shell" aria-hidden="true">
    {node}
  </span>
);

export const renderAgentProjectTreeAppIcon = (
  iconKey: AgentProjectTreeAppIconKey
): JSX.Element => {
  if (iconKey === "agent-project-tree-default") {
    return wrapIcon(<FolderTree size={15} />);
  }
  return wrapIcon(<FolderTree size={15} />);
};
