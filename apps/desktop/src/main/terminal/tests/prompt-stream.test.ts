import { describe, expect, test } from "vitest";

import {
  LYRA_PROMPT_READY_MARKER,
  createPromptStreamState,
  filterPromptRuntimeData,
  notePromptUserInput,
  queuePromptEchoSuppression
} from "../prompt-stream";

describe("terminal prompt stream filtering", () => {
  test("suppresses echoed prompt injection command", () => {
    const state = createPromptStreamState();
    const command = ". '/tmp/lyra-prompt.sh' 2>/dev/null || true";

    queuePromptEchoSuppression(state, command);

    const filtered = filterPromptRuntimeData(
      state,
      `${command}\r\n${LYRA_PROMPT_READY_MARKER}petehsu % `
    );

    expect(filtered).toBe("petehsu % ");
  });

  test("suppresses echoed prompt injection command with lf-only line ending", () => {
    const state = createPromptStreamState();
    const command = ". '/tmp/lyra-prompt.sh' 2>/dev/null || true";

    queuePromptEchoSuppression(state, command);

    const filtered = filterPromptRuntimeData(
      state,
      `${command}\n${LYRA_PROMPT_READY_MARKER}petehsu % `
    );

    expect(filtered).toBe("petehsu % ");
  });

  test("suppresses wrapped prompt injection echo until next prompt marker", () => {
    const state = createPromptStreamState();
    const command = ". '/Users/petehsu/.lyra/modules/terminal/prompt-scripts/zsh-abc.sh' 2>/dev/null || true";

    queuePromptEchoSuppression(state, command);

    const first = filterPromptRuntimeData(
      state,
      "<terminal/prompt-scripts/zsh-abc.sh' 2>/dev/"
    );
    const second = filterPromptRuntimeData(
      state,
      `null || true\r\n${LYRA_PROMPT_READY_MARKER}petehsu % `
    );

    expect(first).toBe("");
    expect(second).toBe("petehsu % ");
  });

  test("marks session at prompt and strips hidden prompt marker", () => {
    const state = createPromptStreamState();

    const filtered = filterPromptRuntimeData(
      state,
      `${LYRA_PROMPT_READY_MARKER}petehsu % `
    );

    expect(filtered).toBe("petehsu % ");
    expect(state.atPrompt).toBe(true);
  });

  test("handles prompt marker split across chunks", () => {
    const state = createPromptStreamState();
    const splitIndex = 5;

    const first = filterPromptRuntimeData(
      state,
      LYRA_PROMPT_READY_MARKER.slice(0, splitIndex)
    );
    const second = filterPromptRuntimeData(
      state,
      `${LYRA_PROMPT_READY_MARKER.slice(splitIndex)}prompt`
    );

    expect(first).toBe("");
    expect(second).toBe("prompt");
    expect(state.atPrompt).toBe(true);
  });

  test("user input clears prompt-ready state", () => {
    const state = createPromptStreamState();

    filterPromptRuntimeData(state, `${LYRA_PROMPT_READY_MARKER}prompt`);
    expect(state.atPrompt).toBe(true);

    notePromptUserInput(state);
    expect(state.atPrompt).toBe(false);
  });
});
