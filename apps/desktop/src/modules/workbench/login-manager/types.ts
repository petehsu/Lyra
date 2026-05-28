import type { LyraDesktopApi } from "../../../shared/desktop-bridge";

export type LoginManagerAppId = "login-manager";
export type LoginManagerAppIconKey = "login-manager-default";

export type LoginManagerSurfaceProps = {
  readonly desktopApi: LyraDesktopApi | null;
};
