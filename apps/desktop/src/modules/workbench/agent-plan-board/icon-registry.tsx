import { BookText } from "lucide-react";

import type { AgentPlanBoardAppIconKey } from "./types";

const wrapIcon = (node: JSX.Element) => (
  <span className="lyra-file-manager-icon-shell" aria-hidden="true">
    {node}
  </span>
);

export const renderAgentPlanBoardAppIcon = (
  _iconKey: AgentPlanBoardAppIconKey
): JSX.Element => wrapIcon(<BookText size={15} />);
