export const MENU_VIEWPORT_MARGIN = 8;
export const MENU_GAP = 8;
export const DEFAULT_MENU_WIDTH = 224;
export const DEFAULT_MENU_HEIGHT = 148;
export const DEFAULT_SUBMENU_WIDTH = 268;
export const DEFAULT_SUBMENU_HEIGHT = 320;

export type MenuPlacement = {
  readonly menuLeft: number;
  readonly menuTop: number;
  readonly submenuLeft: number;
  readonly submenuTop: number;
};

export const clampNumber = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(value, max));

export const measureElementSize = (
  element: HTMLElement | null,
  fallbackWidth: number,
  fallbackHeight: number
): { readonly width: number; readonly height: number } => ({
  width: element?.offsetWidth && element.offsetWidth > 0 ? element.offsetWidth : fallbackWidth,
  height: element?.offsetHeight && element.offsetHeight > 0 ? element.offsetHeight : fallbackHeight,
});

export const createMenuPlacement = (
  anchor: HTMLElement,
  portal: HTMLElement | null
): MenuPlacement => {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const anchorRect = anchor.getBoundingClientRect();
  const menuElement = portal?.querySelector<HTMLElement>(".lyra-ai-agent-composer-menu") ?? null;
  const submenuElement = portal?.querySelector<HTMLElement>(".lyra-ai-agent-composer-submenu") ?? null;
  const menuSize = measureElementSize(menuElement, DEFAULT_MENU_WIDTH, DEFAULT_MENU_HEIGHT);
  const submenuSize = measureElementSize(submenuElement, DEFAULT_SUBMENU_WIDTH, DEFAULT_SUBMENU_HEIGHT);
  const menuLeft = clampNumber(
    anchorRect.left,
    MENU_VIEWPORT_MARGIN,
    Math.max(MENU_VIEWPORT_MARGIN, viewportWidth - menuSize.width - MENU_VIEWPORT_MARGIN)
  );
  const menuTop = clampNumber(
    anchorRect.top - menuSize.height - MENU_GAP >= MENU_VIEWPORT_MARGIN
      ? anchorRect.top - menuSize.height - MENU_GAP
      : anchorRect.bottom + MENU_GAP,
    MENU_VIEWPORT_MARGIN,
    Math.max(MENU_VIEWPORT_MARGIN, viewportHeight - menuSize.height - MENU_VIEWPORT_MARGIN)
  );
  const opensRight = menuLeft + menuSize.width + MENU_GAP + submenuSize.width <= viewportWidth - MENU_VIEWPORT_MARGIN;
  const submenuLeft = opensRight
    ? menuLeft + menuSize.width + MENU_GAP
    : clampNumber(
        menuLeft - submenuSize.width - MENU_GAP,
        MENU_VIEWPORT_MARGIN,
        Math.max(MENU_VIEWPORT_MARGIN, viewportWidth - submenuSize.width - MENU_VIEWPORT_MARGIN)
      );
  const submenuTop = clampNumber(
    menuTop,
    MENU_VIEWPORT_MARGIN,
    Math.max(MENU_VIEWPORT_MARGIN, viewportHeight - submenuSize.height - MENU_VIEWPORT_MARGIN)
  );

  return {
    menuLeft,
    menuTop,
    submenuLeft,
    submenuTop,
  };
};
