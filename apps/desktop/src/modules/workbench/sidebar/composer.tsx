import type { RefObject } from "react";

import {
  TEXTAREA_AUTO_HEIGHT_MAX_PX,
  TEXTAREA_AUTO_HEIGHT_MIN_PX,
  useTextareaAutoHeight
} from "../text-metrics";

export const SIDEBAR_COMPOSER_MIN_HEIGHT_PX = TEXTAREA_AUTO_HEIGHT_MIN_PX;
export const SIDEBAR_COMPOSER_MAX_HEIGHT_PX = TEXTAREA_AUTO_HEIGHT_MAX_PX;

/** Sidebar composer entry point — height driven by workbench/text-metrics. */
export const useSidebarComposerTextareaHeight = (
  value: string,
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  enabled: boolean
): void => {
  useTextareaAutoHeight(value, textareaRef, enabled);
};