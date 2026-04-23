export const LYRA_PROMPT_READY_MARKER = "\u001b]633;LyraPrompt\u0007";

export type PromptStreamState = {
  atPrompt: boolean;
  suppressUntilPromptReady: boolean;
  markerCarry: string;
  pendingEchoSuppression: string;
  pendingNewlineSuppression: "\r\n" | "\n" | "";
};

export const createPromptStreamState = (): PromptStreamState => ({
  atPrompt: false,
  suppressUntilPromptReady: false,
  markerCarry: "",
  pendingEchoSuppression: "",
  pendingNewlineSuppression: ""
});

export const notePromptUserInput = (state: PromptStreamState): void => {
  state.atPrompt = false;
};

export const queuePromptEchoSuppression = (
  state: PromptStreamState,
  echoedCommand: string
): void => {
  state.atPrompt = false;
  state.suppressUntilPromptReady = true;
  state.pendingEchoSuppression = echoedCommand;
  state.pendingNewlineSuppression = "\r\n";
};

const consumePrefix = (
  input: string,
  expected: string
): { readonly output: string; readonly remaining: string } => {
  let consumed = 0;
  const max = Math.min(input.length, expected.length);
  while (consumed < max && input[consumed] === expected[consumed]) {
    consumed += 1;
  }
  if (consumed === 0) {
    return {
      output: input,
      remaining: expected
    };
  }
  return {
    output: input.slice(consumed),
    remaining: expected.slice(consumed)
  };
};

const resolveLongestMarkerCarry = (input: string, marker: string): number => {
  const max = Math.min(input.length, marker.length - 1);
  for (let length = max; length > 0; length -= 1) {
    if (input.endsWith(marker.slice(0, length))) {
      return length;
    }
  }
  return 0;
};

const stripPromptMarkers = (state: PromptStreamState, chunk: string): string => {
  const buffered = `${state.markerCarry}${chunk}`;
  state.markerCarry = "";

  let output = "";
  let cursor = 0;
  while (cursor < buffered.length) {
    const markerIndex = buffered.indexOf(LYRA_PROMPT_READY_MARKER, cursor);
    if (markerIndex === -1) {
      const tail = buffered.slice(cursor);
      const carryLength = resolveLongestMarkerCarry(tail, LYRA_PROMPT_READY_MARKER);
      output += tail.slice(0, tail.length - carryLength);
      state.markerCarry = tail.slice(tail.length - carryLength);
      break;
    }
    output += buffered.slice(cursor, markerIndex);
    state.atPrompt = true;
    cursor = markerIndex + LYRA_PROMPT_READY_MARKER.length;
  }

  return output;
};

export const filterPromptRuntimeData = (
  state: PromptStreamState,
  chunk: string
): string => {
  if (state.suppressUntilPromptReady) {
    const buffered = `${state.markerCarry}${chunk}`;
    state.markerCarry = "";
    const markerIndex = buffered.indexOf(LYRA_PROMPT_READY_MARKER);
    if (markerIndex === -1) {
      const carryLength = resolveLongestMarkerCarry(buffered, LYRA_PROMPT_READY_MARKER);
      state.markerCarry = buffered.slice(buffered.length - carryLength);
      return "";
    }
    state.suppressUntilPromptReady = false;
    state.pendingEchoSuppression = "";
    state.pendingNewlineSuppression = "";
    state.atPrompt = true;
    return stripPromptMarkers(
      state,
      buffered.slice(markerIndex + LYRA_PROMPT_READY_MARKER.length)
    );
  }

  let output = chunk;

  if (state.pendingEchoSuppression.length > 0) {
    const consumed = consumePrefix(output, state.pendingEchoSuppression);
    output = consumed.output;
    state.pendingEchoSuppression = consumed.remaining;
  }

  if (state.pendingEchoSuppression.length === 0 && state.pendingNewlineSuppression.length > 0) {
    const consumed = consumePrefix(output, state.pendingNewlineSuppression);
    output = consumed.output;
    state.pendingNewlineSuppression = consumed.remaining as "\r\n" | "\n" | "";
    if (state.pendingNewlineSuppression === "\r\n" && output.length > 0) {
      const fallback = consumePrefix(output, "\n");
      if (fallback.remaining.length === 0) {
        output = fallback.output;
        state.pendingNewlineSuppression = "";
      }
    }
  }

  return stripPromptMarkers(state, output);
};
