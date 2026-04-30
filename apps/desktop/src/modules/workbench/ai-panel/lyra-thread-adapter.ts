import type {
  AiPanelAgentSessionDetail,
  LyraThread,
} from "./lyra-thread-adapter-shared";
import { aiPanelViewModelToAgentDetail } from "./lyra-thread-ai-panel-view-model-adapter";
import { lyraThreadTurnsToAgentDetail } from "./lyra-thread-legacy-turns-adapter";

export type {
  AiPanelAgentSessionDetail,
  LyraThread,
  LyraThreadItem,
  LyraTurn,
  ThreadAiPanelMessage,
  ThreadAiPanelMessageContentPart,
  ThreadAiPanelPendingInteraction,
  ThreadAiPanelPlan,
  ThreadAiPanelPlanStep,
  ThreadAiPanelToolCall,
  ThreadAiPanelTurn,
  ThreadAiPanelTurnMeta,
  ThreadAiPanelViewModel,
} from "./lyra-thread-adapter-shared";
export {
  attachThreadAiPanelViewModel,
  readThreadAiPanelViewModel,
} from "./lyra-thread-ai-panel-view-model-adapter";
export {
  buildThreadTitle,
  readLyraThread,
  threadItemToToolCall,
} from "./lyra-thread-legacy-turns-adapter";

export const lyraThreadToAgentDetail = (thread: LyraThread): AiPanelAgentSessionDetail => {
  if (thread.aiPanelViewModel !== undefined && thread.aiPanelViewModel !== null) {
    return aiPanelViewModelToAgentDetail(thread, thread.aiPanelViewModel);
  }
  return lyraThreadTurnsToAgentDetail(thread);
};
