import type { SidebarQuestionPanelViewModel } from "../../sidebar/types";
import type {
  AiPanelQuestionFlowDirection,
  AiPanelQuestionFlowQuestion,
  AiPanelQuestionFlowQuestionSeed,
  AiPanelQuestionFlowState,
  AiPanelQuestionFlowSubmitResult
} from "./types";

const normalizeText = (value: string): string => value.replace(/\s+/g, " ").trim();

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const hasPendingQuestions = (questions: readonly AiPanelQuestionFlowQuestion[]): boolean =>
  questions.some((question) => question.answeredValue === null);

const resolveNextPendingIndex = (
  questions: readonly AiPanelQuestionFlowQuestion[],
  currentIndex: number
): number | null => {
  for (let index = currentIndex + 1; index < questions.length; index += 1) {
    if (questions[index]?.answeredValue === null) {
      return index;
    }
  }

  for (let index = 0; index < questions.length; index += 1) {
    if (questions[index]?.answeredValue === null) {
      return index;
    }
  }

  return null;
};

const mapSeedQuestion = (
  seed: AiPanelQuestionFlowQuestionSeed
): AiPanelQuestionFlowQuestion | null => {
  const id = seed.id.trim();
  const prompt = seed.prompt.trim();
  if (id.length === 0 || prompt.length === 0) {
    return null;
  }

  const options = seed.options
    .map((option) => ({
      id: option.id.trim(),
      label: option.label.trim()
    }))
    .filter((option) => option.id.length > 0 && option.label.length > 0);

  if (options.length === 0) {
    return null;
  }

  return {
    id,
    prompt,
    options,
    customDraft: "",
    answeredValue: null,
    answeredAt: null
  };
};

export const createQuestionFlowState = (
  seeds: readonly AiPanelQuestionFlowQuestionSeed[]
): AiPanelQuestionFlowState | null => {
  const questions = seeds
    .map(mapSeedQuestion)
    .filter((question): question is AiPanelQuestionFlowQuestion => question !== null);

  if (questions.length === 0) {
    return null;
  }

  return {
    questions,
    activeQuestionIndex: 0
  };
};

export const closeQuestionFlowState = (): null => null;

export const navigateQuestionFlowState = (
  state: AiPanelQuestionFlowState,
  direction: AiPanelQuestionFlowDirection
): AiPanelQuestionFlowState => {
  if (state.questions.length <= 1) {
    return state;
  }

  const delta = direction === "up" ? -1 : 1;
  const nextIndex = clamp(
    state.activeQuestionIndex + delta,
    0,
    state.questions.length - 1
  );

  if (nextIndex === state.activeQuestionIndex) {
    return state;
  }

  return {
    ...state,
    activeQuestionIndex: nextIndex
  };
};

export const updateQuestionFlowCustomDraft = (
  state: AiPanelQuestionFlowState,
  questionId: string,
  value: string
): AiPanelQuestionFlowState => ({
  ...state,
  questions: state.questions.map((question) =>
    question.id !== questionId
      ? question
      : {
          ...question,
          customDraft: value
        }
  )
});

const commitQuestionAnswer = (
  state: AiPanelQuestionFlowState,
  questionId: string,
  submittedText: string
): AiPanelQuestionFlowSubmitResult | null => {
  const normalized = normalizeText(submittedText);
  if (normalized.length === 0) {
    return null;
  }

  const targetIndex = state.questions.findIndex((question) => question.id === questionId);
  if (targetIndex < 0) {
    return null;
  }

  const nextQuestions = state.questions.map((question) =>
    question.id !== questionId
      ? question
      : {
          ...question,
          answeredValue: normalized,
          answeredAt: Date.now(),
          customDraft: ""
        }
  );

  if (hasPendingQuestions(nextQuestions) === false) {
    return {
      nextState: null,
      submittedText: normalized
    };
  }

  const nextIndex = resolveNextPendingIndex(nextQuestions, targetIndex);
  if (nextIndex === null) {
    return {
      nextState: null,
      submittedText: normalized
    };
  }

  return {
    nextState: {
      questions: nextQuestions,
      activeQuestionIndex: nextIndex
    },
    submittedText: normalized
  };
};

export const selectQuestionFlowOption = (
  state: AiPanelQuestionFlowState,
  questionId: string,
  optionId: string
): AiPanelQuestionFlowSubmitResult | null => {
  const question = state.questions.find((entry) => entry.id === questionId);
  if (question === undefined) {
    return null;
  }
  const option = question.options.find((entry) => entry.id === optionId);
  if (option === undefined) {
    return null;
  }

  return commitQuestionAnswer(state, questionId, option.label);
};

export const submitQuestionFlowCustom = (
  state: AiPanelQuestionFlowState,
  questionId: string
): AiPanelQuestionFlowSubmitResult | null => {
  const question = state.questions.find((entry) => entry.id === questionId);
  if (question === undefined) {
    return null;
  }

  return commitQuestionAnswer(state, questionId, question.customDraft);
};

const isOption = (value: unknown): value is AiPanelQuestionFlowQuestion["options"][number] => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as { id?: unknown; label?: unknown };
  return typeof candidate.id === "string" && typeof candidate.label === "string";
};

const isQuestion = (value: unknown): value is AiPanelQuestionFlowQuestion => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as {
    id?: unknown;
    prompt?: unknown;
    options?: unknown;
    customDraft?: unknown;
    answeredValue?: unknown;
    answeredAt?: unknown;
  };

  if (typeof candidate.id !== "string" || candidate.id.trim().length === 0) {
    return false;
  }
  if (typeof candidate.prompt !== "string" || candidate.prompt.trim().length === 0) {
    return false;
  }
  if (Array.isArray(candidate.options) === false || candidate.options.length === 0) {
    return false;
  }
  if (candidate.options.every(isOption) === false) {
    return false;
  }

  if (candidate.customDraft !== undefined && typeof candidate.customDraft !== "string") {
    return false;
  }

  const answeredValue = candidate.answeredValue;
  if (answeredValue !== undefined && answeredValue !== null && typeof answeredValue !== "string") {
    return false;
  }

  const answeredAt = candidate.answeredAt;
  if (
    answeredAt !== undefined
    && answeredAt !== null
    && (typeof answeredAt !== "number" || Number.isFinite(answeredAt) === false)
  ) {
    return false;
  }

  return true;
};

export const parseQuestionFlowState = (value: unknown): AiPanelQuestionFlowState | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as {
    questions?: unknown;
    activeQuestionIndex?: unknown;
  };

  if (Array.isArray(candidate.questions) === false || candidate.questions.length === 0) {
    return null;
  }

  if (candidate.questions.every(isQuestion) === false) {
    return null;
  }

  const questions = candidate.questions.map((question) => ({
    id: question.id.trim(),
    prompt: question.prompt.trim(),
    options: question.options.map((option) => ({
      id: option.id.trim(),
      label: option.label.trim()
    })),
    customDraft: typeof question.customDraft === "string" ? question.customDraft : "",
    answeredValue: typeof question.answeredValue === "string" ? question.answeredValue : null,
    answeredAt: typeof question.answeredAt === "number" ? question.answeredAt : null
  } satisfies AiPanelQuestionFlowQuestion));

  if (questions.length === 0) {
    return null;
  }

  const activeIndex =
    typeof candidate.activeQuestionIndex === "number" && Number.isFinite(candidate.activeQuestionIndex)
      ? clamp(Math.floor(candidate.activeQuestionIndex), 0, questions.length - 1)
      : 0;

  return {
    questions,
    activeQuestionIndex: activeIndex
  };
};

export const toSidebarQuestionPanelViewModel = (
  state: AiPanelQuestionFlowState | null
): SidebarQuestionPanelViewModel | null => {
  if (state === null || state.questions.length === 0) {
    return null;
  }

  const index = clamp(state.activeQuestionIndex, 0, state.questions.length - 1);
  const question = state.questions[index];
  if (question === undefined) {
    return null;
  }

  return {
    questionId: question.id,
    prompt: question.prompt,
    options: question.options,
    customDraft: question.customDraft,
    currentIndex: index + 1,
    totalCount: state.questions.length,
    canNavigateUp: index > 0,
    canNavigateDown: index < state.questions.length - 1
  };
};
