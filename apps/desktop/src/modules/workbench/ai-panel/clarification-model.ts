import type {
  AgentPendingInteraction,
  AgentSessionDetail,
  QuestionTicketOption,
} from "./agent-ui-types";
import { isRecord, readString } from "./patch-artifact";

export type ClarificationOptionId = "A" | "B" | "C" | "D";

export type ClarificationRow = {
  readonly interaction: AgentPendingInteraction;
  readonly questionTicketId: string;
  readonly title: string;
  readonly question: string;
  readonly why: string;
  readonly targetSummary: string | null;
  readonly options: readonly QuestionTicketOption[];
  readonly allowCustomAnswer: boolean;
};

const OPTION_IDS: readonly ClarificationOptionId[] = ["A", "B", "C", "D"];

export const extractClarificationRows = (
  detail: AgentSessionDetail | null
): readonly ClarificationRow[] =>
  detail?.pendingInteractions
    .filter((interaction) => interaction.kind === "clarification" && interaction.status === "pending")
    .map(extractClarificationRow)
    .filter((row): row is ClarificationRow => row !== null)
  ?? [];

const extractClarificationRow = (
  interaction: AgentPendingInteraction
): ClarificationRow | null => {
  const payload = isRecord(interaction.payload) ? interaction.payload : {};
  const questionTicketId = readString(payload.questionTicketId) ?? interaction.id;
  const title = readString(payload.title) ?? "Clarification";
  const question = readString(payload.question) ?? title;
  const why = readString(payload.why) ?? "";
  const rawOptions = Array.isArray(payload.options) ? payload.options : [];
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
      };
    })
    .filter((option): option is QuestionTicketOption => option !== null)
    .sort((left, right) => OPTION_IDS.indexOf(left.id) - OPTION_IDS.indexOf(right.id));
  if (options.length !== 4) {
    return null;
  }
  return {
    interaction,
    questionTicketId,
    title,
    question,
    why,
    targetSummary: readString(payload.targetSummary),
    options,
    allowCustomAnswer: payload.allowCustomAnswer === true,
  };
};
