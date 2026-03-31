import { describe, expect, test } from "vitest";

import {
  createQuestionFlowState,
  navigateQuestionFlowState,
  selectQuestionFlowOption,
  submitQuestionFlowCustom,
  updateQuestionFlowCustomDraft
} from "../state";

const createBaseState = () => {
  const state = createQuestionFlowState([
    {
      id: "q-1",
      prompt: "question-1",
      options: [
        { id: "a", label: "A" },
        { id: "b", label: "B" }
      ]
    },
    {
      id: "q-2",
      prompt: "question-2",
      options: [
        { id: "c", label: "C" }
      ]
    }
  ]);

  if (state === null) {
    throw new Error("expected seeded question flow state");
  }

  return state;
};

describe("ai question flow state", () => {
  test("starts at the first question", () => {
    const state = createBaseState();

    expect(state.activeQuestionIndex).toBe(0);
    expect(state.questions).toHaveLength(2);
  });

  test("keeps navigation within boundaries", () => {
    const state = createBaseState();

    const upAtFirst = navigateQuestionFlowState(state, "up");
    expect(upAtFirst.activeQuestionIndex).toBe(0);

    const movedDown = navigateQuestionFlowState(state, "down");
    expect(movedDown.activeQuestionIndex).toBe(1);

    const downAtLast = navigateQuestionFlowState(movedDown, "down");
    expect(downAtLast.activeQuestionIndex).toBe(1);
  });

  test("submits option and moves to the next question", () => {
    const state = createBaseState();
    const submit = selectQuestionFlowOption(state, "q-1", "a");

    expect(submit).not.toBeNull();
    expect(submit?.submittedText).toBe("A");
    expect(submit?.nextState?.activeQuestionIndex).toBe(1);
    expect(submit?.nextState?.questions[0]?.answeredValue).toBe("A");
  });

  test("blocks empty custom answer and accepts non-empty custom answer", () => {
    const state = createBaseState();

    const emptySubmit = submitQuestionFlowCustom(state, "q-1");
    expect(emptySubmit).toBeNull();

    const drafted = updateQuestionFlowCustomDraft(state, "q-1", "  custom  answer  ");
    const submit = submitQuestionFlowCustom(drafted, "q-1");
    expect(submit).not.toBeNull();
    expect(submit?.submittedText).toBe("custom answer");
    expect(submit?.nextState?.activeQuestionIndex).toBe(1);
  });

  test("closes when the last question is answered", () => {
    const state = createBaseState();
    const firstSubmit = selectQuestionFlowOption(state, "q-1", "a");
    expect(firstSubmit?.nextState).not.toBeNull();

    const secondState = firstSubmit?.nextState;
    if (secondState === null || secondState === undefined) {
      throw new Error("expected second state");
    }

    const secondSubmit = selectQuestionFlowOption(secondState, "q-2", "c");
    expect(secondSubmit?.submittedText).toBe("C");
    expect(secondSubmit?.nextState).toBeNull();
  });
});
