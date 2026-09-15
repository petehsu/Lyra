import { Bot } from "@lyra/icons";

import type { AgentSubagentAppIconKey } from "./types";

const wrapIcon = (node: JSX.Element) => (
  <span className="lyra-file-manager-icon-shell" aria-hidden="true">
    {node}
  </span>
);

export const renderAgentSubagentAppIcon = (
  _iconKey: AgentSubagentAppIconKey
): JSX.Element => wrapIcon(<Bot size={15} />);
