import { Store } from "lucide-react";

import type { WorkspaceAppTabOpenRequest } from "../workspace-tabs";
import type { SoftwareStoreAppIconKey } from "./types";

export const SOFTWARE_STORE_APP_ID = "software-store" as const;
export const SOFTWARE_STORE_INSTANCE_ID = "software-store" as const;
export const SOFTWARE_STORE_ICON_KEY = "software-store-default" as const satisfies SoftwareStoreAppIconKey;

export type SoftwareStoreDetailRequest =
  | {
      readonly kind: "software";
      readonly id: string;
    }
  | {
      readonly kind: "uiux";
      readonly id: string;
    };

const detailRequestListeners = new Set<(request: SoftwareStoreDetailRequest) => void>();
let pendingDetailRequest: SoftwareStoreDetailRequest | null = null;

export const softwareStoreDetailKey = (request: SoftwareStoreDetailRequest): string =>
  `${request.kind}:${request.id}`;

export const requestSoftwareStoreDetail = (request: SoftwareStoreDetailRequest): void => {
  pendingDetailRequest = request;
  for (const listener of detailRequestListeners) {
    listener(request);
  }
};

export const subscribeSoftwareStoreDetailRequests = (
  listener: (request: SoftwareStoreDetailRequest) => void
): (() => void) => {
  detailRequestListeners.add(listener);
  if (pendingDetailRequest !== null) {
    listener(pendingDetailRequest);
  }
  return () => {
    detailRequestListeners.delete(listener);
  };
};

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
