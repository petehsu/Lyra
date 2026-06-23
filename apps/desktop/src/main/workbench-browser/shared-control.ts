import type {
  BrowserAgentCursorOverlayAction
} from "./agent-cursor-overlay";
import type {
  WorkbenchBrowserAgentInteraction
} from "./types";

export type SharedControlState =
  | "idle"
  | "agent_active"
  | "locked_input"
  | "user_interrupted"
  | "awaiting_user_decision"
  | "resuming";

export type SharedControlInputType =
  | "mouse_move"
  | "mouse_down"
  | "wheel"
  | "keyboard";

export type SharedControlDecision =
  | "continue_agent"
  | "user_takeover"
  | "use_isolated"
  | "cancel_task";

export type SharedControlSnapshot = {
  readonly state: SharedControlState;
  readonly tabId: string;
  readonly sessionId: string;
  readonly updatedAt: number;
  readonly action?: BrowserAgentCursorOverlayAction;
  readonly interaction?: WorkbenchBrowserAgentInteraction;
  readonly criticalInput: boolean;
  readonly interruptedAt?: number;
  readonly inputType?: SharedControlInputType;
};

export type SharedControlTransition = {
  readonly snapshot: SharedControlSnapshot;
  readonly previousState: SharedControlState;
  readonly changed: boolean;
};

export type SharedControlUserInputTransition = SharedControlTransition & {
  readonly interrupted: boolean;
  readonly preventPhysicalInput: boolean;
};

export const createIdleSharedControlSnapshot = (
  tabId: string,
  sessionId: string,
  at = Date.now()
): SharedControlSnapshot => ({
  state: "idle",
  tabId,
  sessionId,
  updatedAt: at,
  criticalInput: false
});

export const isSharedControlPaused = (
  snapshot: Pick<SharedControlSnapshot, "state">
): boolean =>
  snapshot.state === "user_interrupted"
  || snapshot.state === "awaiting_user_decision";

export const isCriticalBrowserAgentAction = (
  action: BrowserAgentCursorOverlayAction,
  interaction?: WorkbenchBrowserAgentInteraction
): boolean => {
  if (action === "type" || action === "press" || action === "navigate") {
    return true;
  }
  if (action !== "act") {
    return false;
  }
  return interaction !== "hover";
};

export const transitionSharedControlForAgentAction = (
  current: SharedControlSnapshot,
  request: {
    readonly action: BrowserAgentCursorOverlayAction;
    readonly interaction?: WorkbenchBrowserAgentInteraction;
    readonly criticalInput: boolean;
    readonly at?: number;
  }
): SharedControlTransition & { readonly blocked: boolean } => {
  const at = request.at ?? Date.now();
  if (isSharedControlPaused(current)) {
    return {
      snapshot: {
        ...current,
        updatedAt: at
      },
      previousState: current.state,
      changed: false,
      blocked: true
    };
  }

  const nextState: SharedControlState = request.criticalInput
    ? "locked_input"
    : "agent_active";
  const snapshot: SharedControlSnapshot = {
    state: nextState,
    tabId: current.tabId,
    sessionId: current.sessionId,
    updatedAt: at,
    action: request.action,
    ...(request.interaction === undefined ? {} : { interaction: request.interaction }),
    criticalInput: request.criticalInput
  };
  return {
    snapshot,
    previousState: current.state,
    changed:
      current.state !== snapshot.state
      || current.action !== snapshot.action
      || current.interaction !== snapshot.interaction
      || current.criticalInput !== snapshot.criticalInput,
    blocked: false
  };
};

// Passive gestures (moving the mouse over the page, scrolling to read) are
// observation, not an intent to take control. They must NOT interrupt the agent
// — only a deliberate click or keystroke counts as the user grabbing the wheel.
const PASSIVE_SHARED_CONTROL_INPUTS: ReadonlySet<SharedControlInputType> =
  new Set(["mouse_move", "wheel"]);

export const transitionSharedControlForUserInput = (
  current: SharedControlSnapshot,
  request: {
    readonly inputType: SharedControlInputType;
    readonly synthetic: boolean;
    readonly at?: number;
  }
): SharedControlUserInputTransition => {
  const at = request.at ?? Date.now();
  if (
    request.synthetic
    || PASSIVE_SHARED_CONTROL_INPUTS.has(request.inputType)
    || current.state === "idle"
    || current.state === "user_interrupted"
    || current.state === "awaiting_user_decision"
  ) {
    return {
      snapshot: current,
      previousState: current.state,
      changed: false,
      interrupted: false,
      preventPhysicalInput: false
    };
  }

  const snapshot: SharedControlSnapshot = {
    ...current,
    state: "user_interrupted",
    updatedAt: at,
    interruptedAt: at,
    inputType: request.inputType
  };
  return {
    snapshot,
    previousState: current.state,
    changed: true,
    interrupted: true,
    preventPhysicalInput: current.state === "locked_input" || current.criticalInput
  };
};

export const transitionSharedControlToAwaitingDecision = (
  current: SharedControlSnapshot,
  at = Date.now()
): SharedControlTransition => {
  if (current.state !== "user_interrupted") {
    return {
      snapshot: current,
      previousState: current.state,
      changed: false
    };
  }
  return {
    snapshot: {
      ...current,
      state: "awaiting_user_decision",
      updatedAt: at
    },
    previousState: current.state,
    changed: true
  };
};

export const transitionSharedControlForDecision = (
  current: SharedControlSnapshot,
  decision: SharedControlDecision,
  at = Date.now()
): SharedControlTransition => {
  const nextState: SharedControlState = decision === "continue_agent"
    ? "resuming"
    : "idle";
  const snapshot: SharedControlSnapshot = {
    state: nextState,
    tabId: current.tabId,
    sessionId: current.sessionId,
    updatedAt: at,
    criticalInput: false
  };
  return {
    snapshot,
    previousState: current.state,
    changed: current.state !== snapshot.state
  };
};

export const transitionSharedControlToIdle = (
  current: SharedControlSnapshot,
  at = Date.now()
): SharedControlTransition => {
  if (isSharedControlPaused(current)) {
    return {
      snapshot: current,
      previousState: current.state,
      changed: false
    };
  }
  const snapshot: SharedControlSnapshot = {
    state: "idle",
    tabId: current.tabId,
    sessionId: current.sessionId,
    updatedAt: at,
    criticalInput: false
  };
  return {
    snapshot,
    previousState: current.state,
    changed: current.state !== "idle"
  };
};
