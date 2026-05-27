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
import type { MouseEvent as ReactMouseEvent } from "react";

import {
  ChromeIconButton,
  ChromeTabButton,
  ChromeTabFrame,
  ChromeTabShape,
  cx
} from "../ui-primitives";
import { renderWorkspaceAppIcon } from "../workspace-apps";
import type { WorkspaceTab } from "../workspace-tabs/types";
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

const renderTabIcon = (tab: WorkspaceTab) => {
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

  if (tab.faviconUrl !== undefined && tab.faviconUrl.length > 0) {
    return (
      <img
        src={tab.faviconUrl}
        alt=""
        className="lyra-browser-tab-favicon"
        loading="eager"
        decoding="async"
      />
    );
  }

  return <Globe size={14} className="lyra-browser-tab-icon-svg" />;
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
    <ChromeIconButton
      className="lyra-browser-nav-button"
      aria-label={goBackLabel}
      disabled={!canGoBack}
      onClick={onGoBack}
    >
      <ChevronLeft size={14} />
    </ChromeIconButton>
    <ChromeIconButton
      className="lyra-browser-nav-button"
      aria-label={goForwardLabel}
      disabled={!canGoForward}
      onClick={onGoForward}
    >
      <ChevronRight size={14} />
    </ChromeIconButton>
    <ChromeIconButton
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
    </ChromeIconButton>
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
      {hasNavigationControl ? (
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
      ) : navigationButtons}

      <div
        className={renderModel.stripClassName}
        onWheel={runtime.onTabStripWheel}
        onPointerLeave={onClearTabCloseLock}
      >
        <div className="lyra-browser-tab-list">
          {renderModel.tabs.map((tabModel) => (
            <ChromeTabFrame
              key={tabModel.tab.id}
              className={cx(
                tabModel.tabClassName,
                newlyAddedTabIds.has(tabModel.tab.id)
                  && "lyra-browser-tab-item-new"
              )}
              data-lyra-tab-id={tabModel.tab.id}
              allowWebDrag
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
              <ChromeTabShape />
              <ChromeTabButton
                className={tabModel.tabMainClassName}
                aria-label={tabModel.tab.title}
                title={tabModel.tab.title}
                allowWebDrag
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
                  {renderTabIcon(tabModel.tab)}
                </span>
                {!tabModel.isCollapsed ? (
                  <span className="lyra-browser-tab-title">{tabModel.tab.title}</span>
                ) : null}
              </ChromeTabButton>
              {!tabModel.isCollapsed ? (
                <ChromeIconButton
                  className="lyra-browser-tab-close"
                  aria-label={tabModel.closeLabel}
                  draggable={false}
                  onClick={(event) => {
                    onCloseTab(tabModel.tab.id, event);
                  }}
                >
                  <X size={12} />
                </ChromeIconButton>
              ) : null}
            </ChromeTabFrame>
          ))}
        </div>
        <ChromeIconButton
          className="lyra-browser-tab-add"
          aria-label={openNewTabLabel}
          onClick={onOpenNewTab}
        >
          <Plus size={14} />
        </ChromeIconButton>
      </div>
      {renderModel.preview !== null ? (
        <div
          className="lyra-browser-tab-right-drag-preview-shell"
          style={renderModel.preview.shellStyle}
          aria-hidden="true"
        >
          <ChromeTabFrame
            className={renderModel.preview.tabClassName}
            style={renderModel.preview.tabStyle}
          >
            <ChromeTabShape />
            <span className={renderModel.preview.mainClassName}>
              <span className="lyra-browser-tab-icon" aria-hidden="true">
                {renderTabIcon(renderModel.preview.tab)}
              </span>
              <span className="lyra-browser-tab-title">{renderModel.preview.tab.title}</span>
            </span>
            {renderModel.preview.isCollapsed ? null : (
              <ChromeIconButton
                className="lyra-browser-tab-close lyra-browser-tab-right-drag-preview-close"
                tabIndex={-1}
                aria-hidden="true"
              >
                <X size={12} />
              </ChromeIconButton>
            )}
          </ChromeTabFrame>
        </div>
      ) : null}
    </nav>
  );
};
