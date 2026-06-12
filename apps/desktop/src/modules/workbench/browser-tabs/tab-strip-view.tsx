import {
  ChevronLeft,
  ChevronRight,
  Globe,
  House,
  Layers3,
  Plus,
  Search,
  Settings2,
  SquareTerminal,
  X
} from "lucide-react";
import {
  type SyntheticEvent,
  type MouseEvent as ReactMouseEvent
} from "react";

import { AppButton, AppIconButton } from "@renderer/ui/components";
import { cx } from "../ui-primitives";
import { renderWorkspaceAppIcon } from "../workspace-apps";
import type { WorkspaceTab } from "../workspace-tabs/types";
import { BrowserChromeSurface } from "./browser-chrome-surface";
import type { BrowserTabStripRenderModel } from "./tab-strip-render-model";
import type { BrowserTabStripProps } from "./tab-strip-types";
import type { BrowserTabStripRuntime } from "./use-browser-tab-strip-runtime";

type BrowserTabStripViewProps = Pick<
  BrowserTabStripProps,
  | "goBackLabel"
  | "goForwardLabel"
  | "toggleTabStackLabel"
  | "stackedMode"
  | "canGoBack"
  | "canGoForward"
  | "openNewTabLabel"
  | "navigationControl"
  | "toolbarContextControl"
  | "onGoBack"
  | "onGoForward"
  | "onToggleStackedMode"
  | "onActivateTab"
  | "onOpenNewTab"
> & {
  readonly newlyAddedTabIds: ReadonlySet<string>;
  readonly onClearTabCloseLock: () => void;
  readonly onCloseTab: (
    tabId: string,
    event: ReactMouseEvent<HTMLElement>
  ) => void;
  readonly renderModel: BrowserTabStripRenderModel;
  readonly runtime: BrowserTabStripRuntime;
};

type BrowserTabStripControlsProps = Pick<
  BrowserTabStripViewProps,
  | "goBackLabel"
  | "goForwardLabel"
  | "toggleTabStackLabel"
  | "stackedMode"
  | "canGoBack"
  | "canGoForward"
  | "onGoBack"
  | "onGoForward"
  | "onToggleStackedMode"
>;

const BrowserTabShape = () => (
  <div className="lyra-chrome-tab-shape" aria-hidden="true">
    <div className="lyra-chrome-tab-dividers" />
    <div className="lyra-chrome-tab-background">
      <svg
        className="lyra-chrome-tab-background-svg"
        focusable="false"
      >
        <svg
          width="52%"
          height="100%"
          viewBox="0 0 214 36"
          preserveAspectRatio="none"
        >
          <path
            className="lyra-chrome-tab-geometry"
            d="M17 0h197v36H0v-2c4.5 0 9-3.5 9-8V8c0-4.5 3.5-8 8-8z"
          />
        </svg>
        <g transform="scale(-1, 1)">
          <svg
            width="52%"
            height="100%"
            x="-100%"
            y="0"
            viewBox="0 0 214 36"
            preserveAspectRatio="none"
          >
            <path
              className="lyra-chrome-tab-geometry"
              d="M17 0h197v36H0v-2c4.5 0 9-3.5 9-8V8c0-4.5 3.5-8 8-8z"
            />
          </svg>
        </g>
      </svg>
    </div>
  </div>
);

const BrowserTabDefaultIcon = () => (
  <Globe size={14} className="lyra-browser-tab-icon-svg" />
);

const handleFaviconLoad = (event: SyntheticEvent<HTMLImageElement>) => {
  delete event.currentTarget.dataset.failed;
};

const handleFaviconError = (event: SyntheticEvent<HTMLImageElement>) => {
  event.currentTarget.dataset.failed = "true";
};

const BrowserTabIcon = ({ tab }: { readonly tab: WorkspaceTab }) => {
  const faviconUrl = tab.faviconUrl?.trim();

  if (tab.pageKind === "settings") {
    return <Settings2 size={14} className="lyra-browser-tab-icon-svg" />;
  }

  if (tab.pageKind === "results") {
    return <Search size={14} className="lyra-browser-tab-icon-svg" />;
  }

  if (tab.pageKind === "search") {
    return <House size={14} className="lyra-browser-tab-icon-svg" />;
  }

  if (tab.pageKind === "terminal") {
    return <SquareTerminal size={14} className="lyra-browser-tab-icon-svg" />;
  }

  if (tab.pageKind === "app" && tab.appId !== undefined && tab.appIconKey !== undefined) {
    return renderWorkspaceAppIcon(tab.appId, tab.appIconKey);
  }

  if (faviconUrl !== undefined && faviconUrl.length > 0) {
    return (
      <>
        <img
          src={faviconUrl}
          alt=""
          className="lyra-browser-tab-favicon"
          loading="eager"
          decoding="async"
          onLoad={handleFaviconLoad}
          onError={handleFaviconError}
        />
        <span className="lyra-browser-tab-favicon-fallback">
          <BrowserTabDefaultIcon />
        </span>
      </>
    );
  }

  return <BrowserTabDefaultIcon />;
};

const BrowserTabStripControls = ({
  goBackLabel,
  goForwardLabel,
  toggleTabStackLabel,
  stackedMode,
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
  onToggleStackedMode
}: BrowserTabStripControlsProps) => (
  <>
    <AppIconButton
      className="lyra-browser-nav-button"
      aria-label={goBackLabel}
      disabled={!canGoBack}
      onClick={onGoBack}
    >
      <ChevronLeft size={14} />
    </AppIconButton>
    <AppIconButton
      className="lyra-browser-nav-button"
      aria-label={goForwardLabel}
      disabled={!canGoForward}
      onClick={onGoForward}
    >
      <ChevronRight size={14} />
    </AppIconButton>
    <AppIconButton
      className={
        stackedMode
          ? "lyra-browser-nav-button lyra-browser-nav-button-active"
          : "lyra-browser-nav-button"
      }
      aria-label={toggleTabStackLabel}
      aria-pressed={stackedMode}
      onClick={onToggleStackedMode}
    >
      <Layers3 size={14} />
    </AppIconButton>
  </>
);

export const BrowserTabStripView = ({
  renderModel,
  runtime,
  newlyAddedTabIds,
  goBackLabel,
  goForwardLabel,
  toggleTabStackLabel,
  stackedMode,
  canGoBack,
  canGoForward,
  openNewTabLabel,
  navigationControl,
  toolbarContextControl,
  onGoBack,
  onGoForward,
  onToggleStackedMode,
  onActivateTab,
  onCloseTab,
  onClearTabCloseLock,
  onOpenNewTab
}: BrowserTabStripViewProps) => {
  const hasNavigationControl =
    navigationControl !== undefined && navigationControl !== null;
  const navigationButtons = (
    <BrowserTabStripControls
      goBackLabel={goBackLabel}
      goForwardLabel={goForwardLabel}
      toggleTabStackLabel={toggleTabStackLabel}
      stackedMode={stackedMode}
      canGoBack={canGoBack}
      canGoForward={canGoForward}
      onGoBack={onGoBack}
      onGoForward={onGoForward}
      onToggleStackedMode={onToggleStackedMode}
    />
  );

  const toolbar = hasNavigationControl ? (
    <div className="lyra-browser-tabs-toolbar">
      <div className="lyra-browser-tabs-toolbar-controls">
        {navigationButtons}
      </div>
      <div className="lyra-browser-tabs-navigation">
        {navigationControl}
      </div>
      <div className="lyra-browser-tabs-toolbar-context">
        {toolbarContextControl}
      </div>
    </div>
  ) : navigationButtons;

  const tabStrip = (
    <>
      <div
        className={renderModel.stripClassName}
        onWheel={runtime.onTabStripWheel}
        onPointerLeave={onClearTabCloseLock}
      >
        <div className="lyra-browser-tab-list">
          {renderModel.tabs.map((tabModel) => (
            <div
              key={tabModel.tab.id}
              className={cx(
                tabModel.tabClassName,
                newlyAddedTabIds.has(tabModel.tab.id)
                  && "lyra-browser-tab-item-new"
              )}
              style={tabModel.tabStyle}
              data-lyra-tab-id={tabModel.tab.id}
              data-agent-active={tabModel.isAgentActive ? "true" : "false"}
              data-lyra-allow-web-drag="true"
              draggable
              onMouseDown={(event) => {
                runtime.onTabItemMouseDown(event, tabModel.tab.id);
              }}
              onMouseUp={(event) => {
                runtime.onTabItemMouseUp(event, tabModel.tab);
              }}
              onDragStart={(event) => {
                runtime.onWorkspaceTabDragStart(event, tabModel.tab);
              }}
              onDragEnd={runtime.onTabDragEnd}
              onContextMenu={runtime.onTabItemContextMenu}
            >
              <BrowserTabShape />
              <AppButton
                variant="ghost"
                size="sm"
                className={tabModel.tabMainClassName}
                aria-label={tabModel.tab.title}
                title={tabModel.tab.title}
                data-lyra-allow-web-drag="true"
                draggable
                onMouseDown={(event) => {
                  runtime.onTabItemMouseDown(event, tabModel.tab.id);
                }}
                onDragStart={(event) => {
                  runtime.onWorkspaceTabDragStart(event, tabModel.tab);
                }}
                onDragEnd={runtime.onTabDragEnd}
                onClick={() => {
                  onActivateTab(tabModel.tab.id);
                }}
              >
                <span className="lyra-browser-tab-icon" aria-hidden="true">
                  <BrowserTabIcon tab={tabModel.tab} />
                </span>
                {!tabModel.isCollapsed ? (
                  <span className="lyra-browser-tab-title">{tabModel.tab.title}</span>
                ) : null}
              </AppButton>
              {!tabModel.isCollapsed ? (
                <AppIconButton
                  className="lyra-browser-tab-close"
                  aria-label={tabModel.closeLabel}
                  draggable={false}
                  onClick={(event) => {
                    onCloseTab(tabModel.tab.id, event);
                  }}
                >
                  <X size={12} />
                </AppIconButton>
              ) : null}
            </div>
          ))}
        </div>
        <AppIconButton
          className="lyra-browser-tab-add"
          style={renderModel.addButtonStyle}
          aria-label={openNewTabLabel}
          onClick={onOpenNewTab}
        >
          <Plus size={14} />
        </AppIconButton>
      </div>
      {renderModel.preview !== null ? (
        <div
          className="lyra-browser-tab-right-drag-preview-shell"
          style={renderModel.preview.shellStyle}
          aria-hidden="true"
        >
          <div
            className={renderModel.preview.tabClassName}
            style={renderModel.preview.tabStyle}
          >
            <BrowserTabShape />
            <span className={renderModel.preview.mainClassName}>
              <span className="lyra-browser-tab-icon" aria-hidden="true">
                <BrowserTabIcon tab={renderModel.preview.tab} />
              </span>
              <span className="lyra-browser-tab-title">{renderModel.preview.tab.title}</span>
            </span>
            {renderModel.preview.isCollapsed ? null : (
              <AppIconButton
                className="lyra-browser-tab-close lyra-browser-tab-right-drag-preview-close"
                tabIndex={-1}
                aria-hidden="true"
              >
                <X size={12} />
              </AppIconButton>
            )}
          </div>
        </div>
      ) : null}
    </>
  );

  return (
    <nav
      ref={runtime.navRef}
      className={cx(
        renderModel.navClassName,
        hasNavigationControl && "lyra-browser-tabs-with-navigation"
      )}
      style={renderModel.navStyle}
      aria-label="browser-tabs"
      onDragOver={runtime.onTabBarDragOver}
      onDragEnter={runtime.onTabBarDragOver}
      onDragLeave={runtime.onTabBarDragLeave}
      onDrop={runtime.onTabBarDrop}
    >
      <BrowserChromeSurface toolbar={toolbar} tabStrip={tabStrip} />
    </nav>
  );
};
