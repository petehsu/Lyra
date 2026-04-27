import type { MouseEvent as ReactMouseEvent } from "react";

export const preventContextMenuDefaults = (
  event: ReactMouseEvent<HTMLElement>
): void => {
  event.preventDefault();
  event.stopPropagation();
};
