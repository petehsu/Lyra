import { AiHistorySurfaceView } from "./surface-view";
import type { AiHistorySurfaceProps } from "./types";
import { useAiHistoryRuntime } from "./use-ai-history-runtime";

export const AiHistorySurface = (surfaceProps: AiHistorySurfaceProps) => {
  const runtime = useAiHistoryRuntime({
    desktopApi: surfaceProps.desktopApi,
    newSessionTitle: surfaceProps.newSessionTitle,
    defaultProviderId: surfaceProps.defaultProviderId,
    openDialog: surfaceProps.openDialog,
    deleteArchivedConversationTitle: surfaceProps.deleteArchivedConversationTitle,
    deleteArchivedConversationDescription: surfaceProps.deleteArchivedConversationDescription,
    deleteArchivedConversationConfirm: surfaceProps.deleteArchivedConversationConfirm,
    deleteArchivedConversationCancel: surfaceProps.deleteArchivedConversationCancel,
    threadPreviewEmptyLabel: surfaceProps.threadPreviewEmptyLabel
  });

  return (
    <AiHistorySurfaceView
      surfaceProps={surfaceProps}
      runtime={runtime}
    />
  );
};
