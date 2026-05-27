import { Store } from "lucide-react";

import type { WorkspaceAppTabOpenRequest } from "../workspace-tabs";
import type { SoftwareStoreAppIconKey } from "./types";

export const SOFTWARE_STORE_APP_ID = "software-store" as const;
export const SOFTWARE_STORE_INSTANCE_ID = "software-store" as const;
export const SOFTWARE_STORE_ICON_KEY = "software-store-default" as const satisfies SoftwareStoreAppIconKey;

export const createSoftwareStoreAppRequest = (
  title: string
): WorkspaceAppTabOpenRequest => ({
  appId: SOFTWARE_STORE_APP_ID,
  appInstanceId: SOFTWARE_STORE_INSTANCE_ID,
  title,
  iconKey: SOFTWARE_STORE_ICON_KEY
});

const wrapIcon = (node: JSX.Element) => (
  <span className="lyra-file-manager-icon-shell" aria-hidden="true">
    {node}
  </span>
);

export const renderSoftwareStoreAppIcon = (
  iconKey: SoftwareStoreAppIconKey
): JSX.Element => {
  if (iconKey === "software-store-default") {
    return wrapIcon(<Store size={15} />);
  }
  return wrapIcon(<Store size={15} />);
};
