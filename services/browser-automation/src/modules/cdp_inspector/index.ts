export type CdpSnapshot = {
  readonly domNodes: number;
  readonly consoleErrors: number;
};

export const captureCdpSnapshot = (): CdpSnapshot => ({
  domNodes: 0,
  consoleErrors: 0
});
