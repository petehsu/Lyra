import type {
  WorkbenchBrowserChromePopoverRequest,
  WorkbenchBrowserEvent,
  WorkbenchBrowserLayoutSnapshot,
  WorkbenchBrowserTopologySnapshot
} from "./workbench-browser";

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
