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
  ChromeIconButton,
  ChromeTabButton,
  ChromeTabFrame
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
  | "onGoBack"
  | "onGoForward"
  | "onToggleStackedMode"
  | "onActivateTab"
  | "onCloseTab"
  | "onOpenNewTab"
> & {
  readonly renderModel: BrowserTabStripRenderModel;
  readonly runtime: BrowserTabStripRuntime;
};

const renderTabIcon = (tab: WorkspaceTab) => {
  if (tab.pageKind === "settings") {
    return <Settings2 size={13} className="lyra-browser-tab-icon-svg" />;
  }

  if (tab.pageKind === "results") {
    return <Search size={13} className="lyra-browser-tab-icon-svg" />;
  }

  if (tab.pageKind === "search") {
    return <House size={13} className="lyra-browser-tab-icon-svg" />;
  }

  if (tab.pageKind === "terminal") {
    return <SquareTerminal size={13} className="lyra-browser-tab-icon-svg" />;
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

  return <Globe size={13} className="lyra-browser-tab-icon-svg" />;
};

export const BrowserTabStripView = ({
  renderModel,
  runtime,
  goBackLabel,
  goForwardLabel,
  toggleTabStackLabel,
  stackedMode,
  canGoBack,
  canGoForward,
  openNewTabLabel,
  onGoBack,
  onGoForward,
  onToggleStackedMode,
  onActivateTab,
  onCloseTab,
  onOpenNewTab
}: BrowserTabStripViewProps) => (
  <nav
    ref={runtime.navRef}
    className={renderModel.navClassName}
    style={renderModel.navStyle}
    aria-label="browser-tabs"
    onDragOver={runtime.onTabBarDragOver}
    onDragEnter={runtime.onTabBarDragOver}
    onDragLeave={runtime.onTabBarDragLeave}
    onDrop={runtime.onTabBarDrop}
  >
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

    <div
      className={renderModel.stripClassName}
      onWheel={runtime.onTabStripWheel}
    >
      {renderModel.tabs.map((tabModel) => (
        <ChromeTabFrame
          key={tabModel.tab.id}
          className={tabModel.tabClassName}
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
              onClick={() => {
                onCloseTab(tabModel.tab.id);
              }}
            >
              <X size={12} />
            </ChromeIconButton>
          ) : null}
        </ChromeTabFrame>
      ))}
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
