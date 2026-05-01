import { Activity } from "lucide-react";

import type { ResourceMonitorAppIconKey } from "./types";

export const renderResourceMonitorAppIcon = (
  _iconKey: ResourceMonitorAppIconKey
): JSX.Element => (
  <span className="lyra-file-manager-icon-shell" aria-hidden="true">
    <Activity size={15} />
  </span>
);
