import type {
  LoginManagerAuthMethodKind,
  LoginManagerSnapshot,
  LyraDesktopApi
} from "../../../shared/desktop-bridge";

export type LoginManagerAppId = "login-manager";
export type LoginManagerAppIconKey = "login-manager-default";

export type LoginManagerLabels = {
  readonly title: string;
  readonly open: string;
  readonly tabTitle: string;
  readonly searchPlaceholder: string;
  readonly refresh: string;
  readonly sessionsTab: string;
  readonly credentialsTab: string;
  readonly reviewTab: string;
  readonly passwordsUnavailable: string;
  readonly emptySessionsTitle: string;
  readonly emptySessionsDescription: string;
  readonly emptyCredentialsTitle: string;
  readonly emptyCredentialsDescription: string;
  readonly openSite: string;
  readonly logoutSite: string;
  readonly deleteCredential: string;
  readonly reveal: string;
  readonly copy: string;
  readonly copied: string;
  readonly fill: string;
  readonly edit: string;
  readonly save: string;
  readonly cancel: string;
  readonly accountLabel: string;
  readonly authMethodLabel: string;
  readonly notesLabel: string;
  readonly statusObserved: string;
  readonly statusPossible: string;
  readonly sourceObserved: string;
  readonly sourceInferred: string;
  readonly sourceManual: string;
  readonly sourceUnknown: string;
  readonly methodLabels: Readonly<Record<LoginManagerAuthMethodKind, string>>;
};

export type LoginManagerSurfaceProps = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly labels: LoginManagerLabels;
  readonly onOpenSite: (url: string, title?: string) => void;
};

export type LoginManagerViewState = {
  readonly snapshot: LoginManagerSnapshot | null;
  readonly loading: boolean;
  readonly error: string | null;
};
