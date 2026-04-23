import type { LyraDesktopApi } from "../../../shared/desktop-bridge";

export type AiHistorySurfaceProps = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly locale: string;
  readonly title: string;
  readonly newSessionTitle: string;
  readonly newConversationLabel: string;
  readonly openConversationLabel: string;
  readonly deleteConversationLabel: string;
  readonly profileLabel: string;
  readonly sessionIdLabel: string;
  readonly loadingSessionsLabel: string;
  readonly emptyStateTitle: string;
  readonly emptyStateDescription: string;
  readonly defaultProfileId?: string | null;
  readonly defaultProviderId?: string | null;
};
