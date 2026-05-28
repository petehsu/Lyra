import { KeyRound } from "lucide-react";

import type { WorkspaceAppTabOpenRequest } from "../workspace-tabs";
import type { LoginManagerAppIconKey } from "./types";

export const LOGIN_MANAGER_APP_ID = "login-manager" as const;
export const LOGIN_MANAGER_INSTANCE_ID = "login-manager-default-instance" as const;
export const LOGIN_MANAGER_ICON_KEY = "login-manager-default" as const satisfies LoginManagerAppIconKey;

export const createLoginManagerAppRequest = (
  title: string
): WorkspaceAppTabOpenRequest => ({
  appId: LOGIN_MANAGER_APP_ID,
  appInstanceId: LOGIN_MANAGER_INSTANCE_ID,
  title,
  iconKey: LOGIN_MANAGER_ICON_KEY
});

const wrapIcon = (node: JSX.Element) => (
  <span className="lyra-file-manager-icon-shell" aria-hidden="true">
    {node}
  </span>
);

export const renderLoginManagerAppIcon = (
  iconKey: LoginManagerAppIconKey
): JSX.Element => {
  if (iconKey === "login-manager-default") {
    return wrapIcon(<KeyRound size={15} />);
  }
  return wrapIcon(<KeyRound size={15} />);
};
