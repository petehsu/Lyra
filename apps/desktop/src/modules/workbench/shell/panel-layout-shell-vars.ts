export type PanelLayoutCssVars = {
  readonly "--left-width": string;
  readonly "--left-panel-content-width": string;
  readonly "--left-panel-mobile-height": string;
  readonly "--left-panel-content-mobile-height": string;
  readonly "--bottom-height": string;
  readonly "--bottom-panel-content-height": string;
};

export type PanelLayoutShellVarInput = {
  readonly leftWidth: number;
  readonly bottomHeight: number;
  readonly isLeftPanelVisible: boolean;
  readonly isBottomPanelVisible: boolean;
};

export const buildPanelLayoutCssVars = (
  input: PanelLayoutShellVarInput
): PanelLayoutCssVars => ({
  "--left-width": input.isLeftPanelVisible ? `${input.leftWidth}px` : "0px",
  "--left-panel-content-width": `${input.leftWidth}px`,
  "--left-panel-mobile-height": input.isLeftPanelVisible ? "var(--lyra-unit-180)" : "0px",
  "--left-panel-content-mobile-height": "var(--lyra-unit-180)",
  "--bottom-height": input.isBottomPanelVisible ? `${input.bottomHeight}px` : "0px",
  "--bottom-panel-content-height": `${input.bottomHeight}px`
});

export const applyPanelLayoutCssVars = (
  target: HTMLElement | null | undefined,
  vars: PanelLayoutCssVars
): void => {
  if (target === null || target === undefined) {
    return;
  }
  for (const [name, value] of Object.entries(vars)) {
    target.style.setProperty(name, value);
  }
};