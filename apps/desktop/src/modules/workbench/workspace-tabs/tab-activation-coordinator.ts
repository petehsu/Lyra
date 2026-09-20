export const recordUserTabActivation = (): void => undefined;

export const shouldSuppressAgentTabActivation = (): boolean => false;

export const readTabActivationCoordinatorStateForTests = (): {
  readonly userFocusGuardMs: number;
} => ({
  userFocusGuardMs: 0
});

export const resetTabActivationCoordinatorForTests = (): void => undefined;
