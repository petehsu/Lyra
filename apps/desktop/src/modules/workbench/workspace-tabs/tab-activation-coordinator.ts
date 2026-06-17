const USER_FOCUS_GUARD_MS = 5_000;

let lastUserTabActivationAt = 0;
let browserFollowModeEnabled = false;

export const recordUserTabActivation = (): void => {
  lastUserTabActivationAt = Date.now();
};

export const setBrowserFollowModeEnabled = (enabled: boolean): void => {
  browserFollowModeEnabled = enabled;
};

export const shouldSuppressAgentTabActivation = (): boolean =>
  browserFollowModeEnabled === false
  && Date.now() - lastUserTabActivationAt < USER_FOCUS_GUARD_MS;

export const readTabActivationCoordinatorStateForTests = (): {
  readonly lastUserTabActivationAt: number;
  readonly browserFollowModeEnabled: boolean;
  readonly userFocusGuardMs: number;
} => ({
  lastUserTabActivationAt,
  browserFollowModeEnabled,
  userFocusGuardMs: USER_FOCUS_GUARD_MS
});

export const resetTabActivationCoordinatorForTests = (): void => {
  lastUserTabActivationAt = 0;
  browserFollowModeEnabled = false;
};