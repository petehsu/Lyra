import {
  WORKBENCH_BROWSER_LAYOUT_COORDINATE_SPACE,
  WORKBENCH_BROWSER_LAYOUT_ORIGIN,
  WORKBENCH_BROWSER_LAYOUT_UNIT,
  type WorkbenchBrowserChromePopoverRequest,
  type WorkbenchBrowserEvent,
  type WorkbenchBrowserLayoutSnapshot,
  type WorkbenchBrowserPageLayout,
  type WorkbenchBrowserTopologySnapshot
} from "./workbench-browser";

export const BROWSER_SHELL_LAYOUT_COORDINATE_SPACE =
  WORKBENCH_BROWSER_LAYOUT_COORDINATE_SPACE;
export const BROWSER_SHELL_LAYOUT_ORIGIN = WORKBENCH_BROWSER_LAYOUT_ORIGIN;
export const BROWSER_SHELL_LAYOUT_UNIT = WORKBENCH_BROWSER_LAYOUT_UNIT;

export const BROWSER_SHELL_METHODS = [
  "syncTopology",
  "syncLayout",
  "setChromePopover",
  "setModalOcclusion",
  "onEvent"
] as const;

export type BrowserShellMethod = (typeof BROWSER_SHELL_METHODS)[number];

export const BROWSER_SHELL_EVENT_KINDS = [
  "chrome-popover-state",
  "request-page-find",
  "request-page-find-match-select",
  "request-omnibox-suggestion-select"
] as const;

export type BrowserShellEventKind = (typeof BROWSER_SHELL_EVENT_KINDS)[number];

export type BrowserShellEvent = Extract<
  WorkbenchBrowserEvent,
  { readonly kind: BrowserShellEventKind }
>;

export const isBrowserShellEvent = (
  event: WorkbenchBrowserEvent
): event is BrowserShellEvent =>
  (BROWSER_SHELL_EVENT_KINDS as readonly string[]).includes(event.kind);

export type BrowserShellApi = {
  readonly syncTopology: (snapshot: WorkbenchBrowserTopologySnapshot) => void;
  readonly syncLayout: (snapshot: WorkbenchBrowserLayoutSnapshot) => void;
  readonly setChromePopover: (
    request: WorkbenchBrowserChromePopoverRequest
  ) => Promise<void>;
  readonly setModalOcclusion: (request: { readonly active: boolean }) => Promise<void>;
  readonly onEvent: (listener: (event: BrowserShellEvent) => void) => () => void;
};

export const toWorkbenchLayoutBounds = (rect: {
  readonly x?: number;
  readonly y?: number;
  readonly left?: number;
  readonly top?: number;
  readonly width: number;
  readonly height: number;
}): Pick<WorkbenchBrowserPageLayout, "x" | "y" | "width" | "height"> => ({
  x: Math.round(rect.x ?? rect.left ?? 0),
  y: Math.round(rect.y ?? rect.top ?? 0),
  width: Math.max(0, Math.round(rect.width)),
  height: Math.max(0, Math.round(rect.height))
});
