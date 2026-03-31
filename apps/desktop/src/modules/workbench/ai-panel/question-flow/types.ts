import type { SidebarQuestionPanelViewModel } from "../../sidebar/types";

export type AiPanelQuestionFlowOption = {
  readonly id: string;
  readonly label: string;
};

export type AiPanelQuestionFlowQuestionSeed = {
  readonly id: string;
  readonly prompt: string;
  readonly options: readonly AiPanelQuestionFlowOption[];
};

export type AiPanelQuestionFlowQuestion = {
  readonly id: string;
  readonly prompt: string;
  readonly options: readonly AiPanelQuestionFlowOption[];
  readonly customDraft: string;
  readonly answeredValue: string | null;
  readonly answeredAt: number | null;
};

export type AiPanelQuestionFlowState = {
  readonly questions: readonly AiPanelQuestionFlowQuestion[];
  readonly activeQuestionIndex: number;
};

export type AiPanelQuestionFlowDirection = "up" | "down";

export type AiPanelQuestionFlowSubmitResult = {
  readonly nextState: AiPanelQuestionFlowState | null;
  readonly submittedText: string;
};

export type { SidebarQuestionPanelViewModel };
