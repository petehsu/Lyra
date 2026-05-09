import type {
  AgentPendingInteraction,
  AgentSessionDetail,
  QuestionTicketOption,
} from "./agent-ui-types";
import { isRecord, readString } from "./patch-artifact";

export type ClarificationOptionId = "A" | "B" | "C" | "D";

export type ClarificationQuestion = {
  readonly questionTicketId: string;
  readonly title: string;
  readonly question: string;
  readonly why: string;
  readonly targetSummary: string | null;
  readonly options: readonly QuestionTicketOption[];
  readonly allowCustomAnswer: boolean;
};

export type ClarificationPanel = {
  readonly interaction: AgentPendingInteraction;
  readonly panelId: string;
  readonly title: string;
  readonly description: string;
  readonly presentation: string;
  readonly blocksExecution: boolean;
  readonly questions: readonly ClarificationQuestion[];
};

export type ClarificationRow = ClarificationQuestion & {
  readonly interaction: AgentPendingInteraction;
};

const OPTION_IDS: readonly ClarificationOptionId[] = ["A", "B", "C", "D"];

export const extractClarificationPanels = (
  detail: AgentSessionDetail | null
): readonly ClarificationPanel[] =>
  detail?.pendingInteractions
    .filter((interaction) => interaction.kind === "clarification" && interaction.status === "pending")
    .map(extractClarificationPanel)
    .filter((panel): panel is ClarificationPanel => panel !== null)
  ?? [];

export const extractClarificationRows = (
  detail: AgentSessionDetail | null
): readonly ClarificationRow[] =>
  extractClarificationPanels(detail).flatMap((panel) =>
    panel.questions.map((question) => ({
      ...question,
      interaction: panel.interaction,
    }))
  );

export const hasPendingClarification = (detail: AgentSessionDetail | null): boolean =>
  extractClarificationPanels(detail).length > 0;

const extractClarificationPanel = (
  interaction: AgentPendingInteraction
): ClarificationPanel | null => {
  const payload = isRecord(interaction.payload) ? interaction.payload : {};
  const questions = Array.isArray(payload.questions)
    ? payload.questions
      .map(extractClarificationQuestion)
      .filter((question): question is ClarificationQuestion => question !== null)
    : [];
  const fallbackQuestion = extractClarificationQuestion(payload);
  const panelQuestions = questions.length > 0
    ? questions
    : fallbackQuestion === null
      ? []
      : [fallbackQuestion];
  if (panelQuestions.length === 0) {
    return null;
  }
  return {
    interaction,
    panelId: readString(payload.panelId) ?? interaction.id,
    title: readString(payload.title) ?? panelQuestions[0]?.title ?? "Clarification",
    description: readString(payload.description)
      ?? readString(payload.why)
      ?? panelQuestions[0]?.why
      ?? "",
    presentation: readString(payload.presentation) ?? "inline_card",
    blocksExecution: payload.blocksExecution === true || readString(payload.blockingLevel) === "hard_block",
    questions: panelQuestions,
  };
};

const extractClarificationQuestion = (value: unknown): ClarificationQuestion | null => {
  if (!isRecord(value)) {
    return null;
  }
  const questionTicketId = readString(value.questionTicketId);
  if (questionTicketId === null) {
    return null;
  }
  const title = readString(value.title) ?? "Clarification";
  const question = readString(value.question) ?? title;
  const why = readString(value.why) ?? readString(value.whyItMatters) ?? "";
  const rawOptions = Array.isArray(value.options) ? value.options : [];
  const options = rawOptions
    .map((value): QuestionTicketOption | null => {
      if (!isRecord(value)) {
        return null;
      }
      const id = readString(value.id);
      if (id !== "A" && id !== "B" && id !== "C" && id !== "D") {
        return null;
      }
      return {
        id,
        label: readString(value.label) ?? id,
        description: readString(value.description) ?? "",
        recommended: value.recommended === true,
      };
    })
    .filter((option): option is QuestionTicketOption => option !== null)
    .sort((left, right) => OPTION_IDS.indexOf(left.id) - OPTION_IDS.indexOf(right.id));
  if (options.length !== 4) {
    return null;
  }
  return {
    questionTicketId,
    title,
    question,
    why,
    targetSummary: readString(value.targetSummary),
    options,
    allowCustomAnswer: value.allowCustomAnswer !== false,
  };
};
