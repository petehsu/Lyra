import type {
  CSSProperties,
  ComponentProps,
  DragEventHandler,
  ReactNode,
  RefObject
} from "react";
import {
  BookText,
  Folder,
  History,
  KeyRound,
  Minus,
  PanelBottom,
  PanelTop,
  Settings2,
  Square,
  Store,
  X
} from "lucide-react";

import { WorkbenchNotificationTopbar } from "../notifications";
import type { WorkbenchUiRuntime } from "../ui-platform";
import { ChromeIconButton, cx, PanelHost, PanelResizer } from "../ui-primitives";
import { TitlebarAiLaunchPill } from "./titlebar-ai-launch-pill";
import type {
  WorkbenchActionApi,
  WorkbenchChromeLabels,
  WorkbenchPresentationState
} from "./use-workbench-action-api";
import type { PanelLayoutModel } from "./use-panel-layout";

export type WorkbenchChromeLayoutState = Pick<
  PanelLayoutModel,
  | "aiPanelSide"
  | "terminalPanelSide"
  | "isLeftPanelVisible"
  | "isBottomPanelVisible"
>;

export type WorkbenchChromeLayoutActions = Pick<
  PanelLayoutModel,
  | "onLeftResizeMouseDown"
  | "onBottomResizeMouseDown"
>;

export type WorkbenchChromeSlots = {
  readonly titlebarNavigation: ReactNode;
  readonly titlebarContext: ReactNode;
  readonly leftPanel: ReactNode;
  readonly workspace: ReactNode;
  readonly browserTabs: ReactNode;
  readonly terminalPanel: ReactNode;
  readonly overlays: ReactNode;
};

export type WorkbenchShellAdapterProps = {
  readonly rootRef: RefObject<HTMLElement>;
  readonly rootClassName: string;
  readonly rootStyle: CSSProperties;
  readonly uiRuntime: WorkbenchUiRuntime;
  readonly actions: WorkbenchActionApi;
  readonly labels: WorkbenchChromeLabels;
  readonly presentationState: WorkbenchPresentationState;
  readonly isMac: boolean;
  readonly layout: WorkbenchChromeLayoutState;
  readonly layoutActions: WorkbenchChromeLayoutActions;
  readonly slots: WorkbenchChromeSlots;
  readonly notificationTopbar: ComponentProps<typeof WorkbenchNotificationTopbar>;
  readonly aiLaunch: {
    readonly logoUrl: string;
    readonly prefix: string;
    readonly verbs: readonly string[];
  };
  readonly onRootDragStartCapture: DragEventHandler<HTMLElement>;
};

export type WorkbenchChromeProps = WorkbenchShellAdapterProps;

const WorkbenchTitlebarActions = ({
  actions,
  labels,
  presentationState,
  notificationTopbar,
  aiLaunch
}: Pick<
  WorkbenchShellAdapterProps,
  "actions" | "labels" | "presentationState" | "notificationTopbar" | "aiLaunch"
>) => (
  <>
    <WorkbenchNotificationTopbar {...notificationTopbar} />
    <ChromeIconButton
      className="lyra-window-button"
      aria-label={labels.openAgentSessionHistory}
      onClick={actions.openAgentSessionHistory}
    >
      <History size={14} />
    </ChromeIconButton>
    <ChromeIconButton
      className="lyra-window-button"
      aria-label={labels.toggleTerminalPanel}
      onClick={actions.toggleTerminalPanel}
    >
      {presentationState.terminalPanelSide === "top" ? (
        <PanelTop size={14} />
      ) : (
        <PanelBottom size={14} />
      )}
    </ChromeIconButton>
    <ChromeIconButton
      className="lyra-window-button"
      aria-label={labels.openLoginManager}
      onClick={actions.openLoginManager}
    >
      <KeyRound size={14} />
    </ChromeIconButton>
    <ChromeIconButton
      className="lyra-window-button"
      aria-label={labels.openSettings}
      onClick={actions.openSettings}
    >
      <Settings2 size={14} />
    </ChromeIconButton>
    <ChromeIconButton
      className="lyra-window-button"
      aria-label={labels.openSoftwareStore}
      onClick={actions.openSoftwareStore}
    >
      <Store size={14} />
    </ChromeIconButton>
    <ChromeIconButton
      className="lyra-window-button"
      aria-label={labels.openFiles}
      onClick={actions.openFileManager}
    >
      <Folder size={14} />
    </ChromeIconButton>
    <ChromeIconButton
      className="lyra-window-button"
      aria-label={labels.openDocs}
      onClick={actions.openDocs}
    >
      <BookText size={14} />
    </ChromeIconButton>
    <TitlebarAiLaunchPill
      isOpen={presentationState.isAiPanelVisible}
      onToggle={actions.toggleAiPanel}
      logoUrl={aiLaunch.logoUrl}
      prefix={aiLaunch.prefix}
      verbs={aiLaunch.verbs}
      ariaLabel={labels.toggleAiPanel}
    />
    {presentationState.isMac ? null : (
      <>
        <ChromeIconButton
          className="lyra-window-button"
          aria-label={labels.minimizeWindow}
          onClick={actions.minimizeWindow}
        >
          <Minus size={14} />
        </ChromeIconButton>
        <ChromeIconButton
          className="lyra-window-button"
          aria-label={labels.toggleMaximizeWindow}
          onClick={actions.toggleMaximizeWindow}
        >
          <Square
            size={11}
            fill={presentationState.isMaximized ? "currentColor" : "none"}
          />
        </ChromeIconButton>
        <ChromeIconButton
          className="lyra-window-button lyra-window-button-close"
          aria-label={labels.closeWindow}
          onClick={actions.closeWindow}
        >
          <X size={14} />
        </ChromeIconButton>
      </>
    )}
  </>
);

export const WorkbenchChrome = ({
  rootRef,
  rootClassName,
  rootStyle,
  uiRuntime,
  actions,
  labels,
  presentationState,
  isMac,
  layout,
  layoutActions,
  slots,
  notificationTopbar,
  aiLaunch,
  onRootDragStartCapture
}: WorkbenchShellAdapterProps) => (
  <main
    {...uiRuntime.rootAttributes}
    ref={rootRef}
    className={rootClassName}
    style={rootStyle}
    onDragStartCapture={onRootDragStartCapture}
  >
    <header
      className={cx(
        "lyra-titlebar",
        isMac && "lyra-titlebar-macos",
        slots.titlebarNavigation === null && "lyra-titlebar-no-navigation"
      )}
    >
      {isMac ? (
        <div
          className="lyra-titlebar-traffic-spacer"
          aria-hidden="true"
        />
      ) : null}
      {slots.titlebarNavigation}
      {slots.titlebarContext}
      <div className="lyra-titlebar-fill" aria-hidden="true" />
      <div className="lyra-window-controls lyra-no-drag">
        <WorkbenchTitlebarActions
          actions={actions}
          labels={labels}
          presentationState={presentationState}
          notificationTopbar={notificationTopbar}
          aiLaunch={aiLaunch}
        />
      </div>
    </header>

    <section
      className={cx(
        "lyra-main",
        layout.aiPanelSide === "right"
          ? "lyra-main-ai-panel-right"
          : "lyra-main-ai-panel-left"
      )}
    >
      <PanelHost
        placement="left"
        visible={layout.isLeftPanelVisible}
        ariaLabel="left-panel"
      >
        {slots.leftPanel}
      </PanelHost>
      <PanelResizer
        orientation="vertical"
        visible={layout.isLeftPanelVisible}
        ariaLabel="left-resizer"
        onMouseDown={layoutActions.onLeftResizeMouseDown}
      />

      <section
        className={cx(
          "lyra-center-stack",
          layout.terminalPanelSide === "top"
            ? "lyra-center-stack-terminal-top"
            : "lyra-center-stack-terminal-bottom"
        )}
      >
        <section className="lyra-workspace" aria-label="workspace">
          {slots.workspace}
          {slots.browserTabs}
        </section>

        <PanelResizer
          orientation="horizontal"
          visible={layout.isBottomPanelVisible}
          ariaLabel="bottom-resizer"
          onMouseDown={layoutActions.onBottomResizeMouseDown}
        />
        <PanelHost
          placement="bottom"
          visible={layout.isBottomPanelVisible}
          ariaLabel="bottom-panel"
        >
          {slots.terminalPanel}
        </PanelHost>
      </section>
    </section>

    {slots.overlays}
  </main>
);
