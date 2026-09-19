import type { RefObject } from "react";

import { useWindowResizeClass } from "./use-window-resize-class";

// ponytail: VS Code/Zed never walk chrome overflow at idle. The old
// MutationObserver + getComputedStyle rediscover is what kept the fan on.
// Native CSS scrollbars stay visible; ceiling is tiny overflow hosts no
// longer get data-lyra-scrollbar-hidden.
export const useScrollbarVisibilityGuard = (_rootRef: RefObject<HTMLElement>): void => {
  useWindowResizeClass();
};
