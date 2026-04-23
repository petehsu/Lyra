import type { CommandApprovalRequest } from "../../command-approval-bar";
import type {
  AgentPendingInteraction,
  PlanQuestionRequest,
} from "../../../../shared/desktop-bridge";
import {
  resolveCommandApprovalCommandPreview,
  resolveCommandApprovalToolLabel,
} from "../command-approval-display";
import { toPendingInteractionPanel } from "../interaction/pending-interaction-mappers";
import {
  isRecord,
  pickNumber,
  pickRawString,
  pickString,
} from "../view-helpers";
import type { RuntimeEventProcessingContext } from "./runtime-event-context";

const stopStreamingForInteraction = ({
  event,
  streamingTurnIdRef,
  setIsSending,
  setIsStreamActive,
  setIsInteractionSubmitting,
  setStreamingAssistantText,
}: RuntimeEventProcessingContext): void => {
  setIsSending(false);
  setIsStreamActive(false);
  setIsInteractionSubmitting(false);
  if (streamingTurnIdRef.current === event.turnId) {
    setStreamingAssistantText("");
  }
};

export const handleInteractionPanels = (context: RuntimeEventProcessingContext): void => {
  const {
    event,
    payload,
    interactionTextLabels,
    setTransientInteractionPanel,
    setActiveInteractionId,
    setIsSending,
    setIsStreamActive,
    setIsInteractionSubmitting,
    streamingTurnIdRef,
    setStreamingAssistantText,
  } = context;

  if (event.phase === "command_approval_request") {
    const approvalPayload = isRecord(event.payload) ? event.payload : {};
    const inputPayload = isRecord(approvalPayload.input) ? approvalPayload.input : {};
    const metadataPayload = isRecord(approvalPayload.metadata) ? approvalPayload.metadata : {};
    const toolCallId =
      pickString(approvalPayload, "toolCallId") ?? `${event.turnId}-tool-call`;
    const riskLevelCandidate = pickString(metadataPayload, "riskLevel");
    const riskLevel: CommandApprovalRequest["riskLevel"] =
      riskLevelCandidate === "safe"
      || riskLevelCandidate === "low"
      || riskLevelCandidate === "medium"
      || riskLevelCandidate === "high"
      || riskLevelCandidate === "critical"
        ? riskLevelCandidate
        : "medium";

    const cwd = pickString(inputPayload, "cwd");
    const toolName = pickString(approvalPayload, "toolName") ?? "terminal.exec";
    void cwd;
    void toolName;
    void riskLevel;
    stopStreamingForInteraction(context);
    setTransientInteractionPanel({
      kind: "commandApproval",
      request: {
        id: toolCallId,
        interactionId: toolCallId,
        interactionKind: "command_execution_approval",
        sessionId: event.sessionId,
        turnId: event.turnId,
        toolCallId,
        toolName,
        toolLabel: resolveCommandApprovalToolLabel(toolName, interactionTextLabels),
        command: resolveCommandApprovalCommandPreview({
          toolName,
          inputPayload,
          metadataPayload,
        }),
        riskLevel,
        riskDescription:
          pickString(approvalPayload, "message") ?? interactionTextLabels.commandNeedsApproval,
        ...(cwd === null ? {} : { cwd }),
        ...(pickString(metadataPayload, "mode") === "command"
          || pickString(metadataPayload, "mode") === "shell"
            ? { mode: pickString(metadataPayload, "mode") as "command" | "shell" }
            : {}),
        ...(pickString(metadataPayload, "interactiveCategory") === null
          ? {}
          : { interactiveCategory: pickString(metadataPayload, "interactiveCategory")! }),
        isRepeat: metadataPayload.wasPreApproved === true,
      },
    });
    setActiveInteractionId(toolCallId);
  }

  if (event.phase === "plan_question_requested") {
    const requestId = pickString(payload, "requestId") ?? `${event.turnId}-plan-question`;
    stopStreamingForInteraction(context);
    const request = {
      id: requestId,
      interactionId: requestId,
      interactionKind: "tool_user_input" as const,
      sessionId: event.sessionId,
      turnId: event.turnId,
      questions: Array.isArray(payload.questions)
        ? payload.questions as PlanQuestionRequest["questions"]
        : [],
      ...(typeof payload.allowNote === "boolean" ? { allowNote: payload.allowNote } : {}),
    };
    if (request.questions.length > 0) {
      setTransientInteractionPanel({
        kind: "planQuestion",
        request,
      });
    }
    setActiveInteractionId(requestId);
  }

  if (event.phase === "plan_approval_requested") {
    const requestId = pickString(payload, "requestId") ?? `${event.turnId}-plan-approval`;
    stopStreamingForInteraction(context);
    const proposedMarkdown = pickRawString(payload, "proposedMarkdown");
    if (proposedMarkdown !== null) {
      setTransientInteractionPanel({
        kind: "planApproval",
        request: {
          id: requestId,
          interactionId: requestId,
          interactionKind: "tool_user_input" as const,
          sessionId: event.sessionId,
          turnId: event.turnId,
          version: pickNumber(payload, "version") ?? 0,
          status: "submitted",
          summary:
            pickString(payload, "summary")
            ?? proposedMarkdown.split("\n").find((line) => line.trim().length > 0)
            ?? interactionTextLabels.proposedPlanSummaryFallback,
          proposedMarkdown,
          ...(pickRawString(payload, "draftMarkdown") === null
            ? {}
            : { draftMarkdown: pickRawString(payload, "draftMarkdown")! }),
        },
      });
    }
    setActiveInteractionId(requestId);
  }

  if (event.phase === "interaction_pending") {
    const interactionPayload = isRecord(payload.interaction) ? payload.interaction : null;
    const interactionId = interactionPayload === null ? null : pickString(interactionPayload, "id");
    stopStreamingForInteraction(context);
    if (interactionPayload !== null) {
      const interactionPanel = toPendingInteractionPanel(
        interactionPayload as AgentPendingInteraction,
        interactionTextLabels
      );
      if (interactionPanel !== null) {
        setTransientInteractionPanel(interactionPanel);
      }
    }
    if (interactionId !== null) {
      setActiveInteractionId(interactionId);
    }
  }

  if (event.phase === "interaction_submitted") {
    setIsSending(false);
    setIsInteractionSubmitting(true);
  }

  if (event.phase === "interaction_resolved") {
    const interactionPayload = isRecord(payload.interaction) ? payload.interaction : null;
    const interactionId = interactionPayload === null ? null : pickString(interactionPayload, "id");
    if (interactionId !== null) {
      setActiveInteractionId((current) => (current === interactionId ? null : current));
      setTransientInteractionPanel((current) =>
        current !== null && current.request.id === interactionId ? null : current
      );
    }
  }

  if (event.phase === "plan_question_answered" || event.phase === "plan_approved" || event.phase === "plan_rejected") {
    setActiveInteractionId((current) => (current !== null ? current : null));
  }
};
