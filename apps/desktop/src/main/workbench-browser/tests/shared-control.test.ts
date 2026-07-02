import { describe, expect, test } from "vitest";

import {
  createIdleSharedControlSnapshot,
  transitionSharedControlForAgentAction,
  transitionSharedControlForDecision,
  transitionSharedControlForUserInput
} from "../shared-control";

describe("shared browser control state machine", () => {
  test("locks only critical live input actions", () => {
    const idle = createIdleSharedControlSnapshot("tab-1", "follow-1", 100);

    expect(
      transitionSharedControlForAgentAction(idle, {
        action: "read",
        criticalInput: false,
        at: 110
      }).snapshot.state
    ).toBe("agent_active");

    expect(
      transitionSharedControlForAgentAction(idle, {
        action: "type",
        criticalInput: true,
        at: 120
      }).snapshot.state
    ).toBe("locked_input");
  });

  test("synthetic input never interrupts Agent control", () => {
    const active = transitionSharedControlForAgentAction(
      createIdleSharedControlSnapshot("tab-1", "follow-1", 100),
      {
        action: "type",
        criticalInput: true,
        at: 110
      }
    ).snapshot;

    const transition = transitionSharedControlForUserInput(active, {
      inputType: "keyboard",
      synthetic: true,
      at: 120
    });

    expect(transition.interrupted).toBe(false);
    expect(transition.snapshot.state).toBe("locked_input");
  });

  test("real user input pauses control and blocks physical input during critical lock", () => {
    const active = transitionSharedControlForAgentAction(
      createIdleSharedControlSnapshot("tab-1", "follow-1", 100),
      {
        action: "press",
        criticalInput: true,
        at: 110
      }
    ).snapshot;

    const transition = transitionSharedControlForUserInput(active, {
      inputType: "keyboard",
      synthetic: false,
      at: 120
    });

    expect(transition.interrupted).toBe(true);
    expect(transition.preventPhysicalInput).toBe(true);
    expect(transition.snapshot.state).toBe("user_interrupted");
  });

  test("passive pointer input does not pause Agent control", () => {
    const active = transitionSharedControlForAgentAction(
      createIdleSharedControlSnapshot("tab-1", "follow-1", 100),
      {
        action: "read",
        criticalInput: false,
        at: 110
      }
    ).snapshot;

    for (const inputType of ["mouse_move", "wheel"] as const) {
      const transition = transitionSharedControlForUserInput(active, {
        inputType,
        synthetic: false,
        at: 120
      });
      expect(transition.interrupted).toBe(false);
      expect(transition.snapshot.state).toBe("agent_active");
    }
  });

  test("continue decision resumes before returning to idle", () => {
    const active = transitionSharedControlForAgentAction(
      createIdleSharedControlSnapshot("tab-1", "follow-1", 100),
      {
        action: "act",
        interaction: "click",
        criticalInput: true,
        at: 110
      }
    ).snapshot;
    const interrupted = transitionSharedControlForUserInput(active, {
      inputType: "mouse_down",
      synthetic: false,
      at: 120
    }).snapshot;

    expect(
      transitionSharedControlForDecision(interrupted, "continue_agent", 130).snapshot.state
    ).toBe("resuming");
  });
});
