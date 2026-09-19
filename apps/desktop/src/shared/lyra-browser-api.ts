import { isBrowserShellEvent } from "./browser-shell-api";
import type { BrowserShellEvent } from "./browser-shell-api";
import type { DownloadManagerApi } from "./download-manager";
import type {
  BrowserSessionSnapshot,
  BrowserStorageStateRef,
  PageDragCitationPayload,
  WorkbenchBrowserClearSiteDataRequest,
  WorkbenchBrowserClearSiteDataResult,
  WorkbenchBrowserEvent,
  WorkbenchBrowserExecutePageContextActionRequest,
  WorkbenchBrowserNavigateRequest,
  WorkbenchBrowserNavigateResult,
  WorkbenchBrowserPageRuntimeState,
  WorkbenchBrowserReadPageStateRequest,
  WorkbenchBrowserSearchInPageRequest,
  WorkbenchBrowserSearchInPageResult,
  WorkbenchBrowserSetElementPickerModeRequest,
  WorkbenchBrowserStorageStateRequest
} from "./workbench-browser";
import type {
  WorkbenchVisualCaptureRequest,
  WorkbenchVisualCaptureResult
} from "./workbench-observation";

export type LyraBrowserEvent = Exclude<WorkbenchBrowserEvent, BrowserShellEvent>;

export const isLyraBrowserEvent = (
  event: WorkbenchBrowserEvent
): event is LyraBrowserEvent => !isBrowserShellEvent(event);

export type LyraBrowserCdpEvent =
  | {
      readonly kind: "message";
      readonly method: string;
      readonly params: unknown;
      readonly sessionId?: string;
    }
  | {
      readonly kind: "detached";
      readonly reason: string;
    };

export type LyraBrowserCdpSession = {
  readonly tabId: string;
  readonly pageAddress?: string;
  readonly sendCommand: (
    method: string,
    commandParams?: Record<string, unknown>,
    sessionId?: string
  ) => Promise<Record<string, unknown>>;
  readonly subscribe: (listener: (event: LyraBrowserCdpEvent) => void) => () => void;
  readonly close: () => Promise<void>;
};

export type LyraBrowserCdpApi = {
  readonly attach: (tabId: string) => Promise<LyraBrowserCdpSession>;
  readonly sendCommand: (
    tabId: string,
    method: string,
    commandParams?: Record<string, unknown>,
    sessionId?: string
  ) => Promise<Record<string, unknown>>;
  readonly onEvent: (
    listener: (event: LyraBrowserCdpEvent & { readonly tabId: string }) => void
  ) => () => void;
};

export type LyraBrowserApi = {
  readonly navigate: (
    request: WorkbenchBrowserNavigateRequest
  ) => Promise<WorkbenchBrowserNavigateResult>;
  readonly goBack: (request: { readonly tabId: string }) => Promise<void>;
  readonly goForward: (request: { readonly tabId: string }) => Promise<void>;
  readonly reload: (
    request: { readonly tabId: string; readonly ignoreCache?: boolean }
  ) => Promise<void>;
  readonly stop: (request: { readonly tabId: string }) => Promise<void>;
  readonly readPageState: (
    request?: WorkbenchBrowserReadPageStateRequest
  ) => Promise<WorkbenchBrowserPageRuntimeState | null>;
  readonly readSessionSnapshot: () => Promise<BrowserSessionSnapshot | null>;
  readonly readStorageState: (
    request?: WorkbenchBrowserStorageStateRequest
  ) => Promise<BrowserStorageStateRef>;
  readonly clearSiteData: (
    request: WorkbenchBrowserClearSiteDataRequest
  ) => Promise<WorkbenchBrowserClearSiteDataResult>;
  readonly searchInPage: (
    request: WorkbenchBrowserSearchInPageRequest
  ) => Promise<WorkbenchBrowserSearchInPageResult>;
  readonly setElementPickerMode: (
    request: WorkbenchBrowserSetElementPickerModeRequest
  ) => Promise<void>;
  readonly capturePage: (
    request?: WorkbenchVisualCaptureRequest
  ) => Promise<WorkbenchVisualCaptureResult>;
  readonly captureWindow: () => Promise<WorkbenchVisualCaptureResult>;
  readonly executePageContextAction: (
    request: WorkbenchBrowserExecutePageContextActionRequest
  ) => Promise<void>;
  readonly readActivePageDragCitation: () => PageDragCitationPayload | null;
  readonly consumePageDragCitation: () => void;
  readonly onEvent: (listener: (event: LyraBrowserEvent) => void) => () => void;
  /**
   * Host-only CDP. Electron renderer omits this; main
   * `openDebuggerSession` is the current adapter. Do not preload `sendCommand`.
   */
  readonly cdp?: LyraBrowserCdpApi;
  /** Engine-owned. Electron still also exposes this as `LyraDesktopApi.downloads`. */
  readonly downloads?: DownloadManagerApi;
};
