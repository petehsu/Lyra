export { cx } from "./classnames";
export type { ClassNameValue } from "./classnames";
export {
  closestChromeTabLayoutIndex,
  computeChromeTabStripLayout
} from "./chrome-tab-layout";
export type {
  ChromeTabDensity,
  ChromeTabLayoutItem,
  ChromeTabStripLayout
} from "./chrome-tab-layout";
export { PanelHost, PanelResizer } from "./panel-chrome";

// Chrome control primitives now resolve to the shared Lyra App components.
// Pack authors consuming `context.primitives` keep the legacy names; the values
// are the canonical App components instead of bespoke chrome shells.
export {
  AppButton,
  AppButton as ChromeTabButton,
  AppIconButton,
  AppIconButton as ChromeIconButton
} from "@renderer/ui/components";
