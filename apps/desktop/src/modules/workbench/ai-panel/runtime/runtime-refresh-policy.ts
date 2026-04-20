import type { RuntimeEventProcessingContext } from "./runtime-event-context";

const shouldRefreshSessionDetail = (phase: string): boolean =>
  phase === "accepted"
  || phase === "tool_started"
  || phase === "tool_finished"
  || phase === "interaction_pending"
  || phase === "interaction_submitted"
  || phase === "interaction_resolved"
  || phase === "interaction_queue_updated"
  || phase === "plan_mode_entered"
  || phase === "plan_mode_reentered"
  || phase === "plan_draft_updated"
  || phase === "plan_question_answered"
  || phase === "plan_approved"
  || phase === "plan_rejected"
  || phase === "plan_mode_exited"
  || phase === "paused"
  || phase === "completed"
  || phase === "failed";

const shouldRefreshSessions = (phase: string): boolean =>
  phase === "accepted"
  || phase === "plan_mode_entered"
  || phase === "plan_mode_reentered"
  || phase === "plan_mode_exited"
  || phase === "paused"
  || phase === "completed"
  || phase === "failed";

export const triggerRuntimeRefreshes = ({
  event,
  loadSessionDetail,
  loadSessions,
}: RuntimeEventProcessingContext): void => {
  if (shouldRefreshSessionDetail(event.phase)) {
    void loadSessionDetail(event.sessionId);
  }
  if (shouldRefreshSessions(event.phase)) {
    void loadSessions();
  }
};
