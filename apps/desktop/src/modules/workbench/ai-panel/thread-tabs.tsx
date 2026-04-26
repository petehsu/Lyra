import { Plus, X } from "lucide-react";
import { useCallback, useRef, useState, type CSSProperties } from "react";

import type { LyraThreadTab } from "./use-lyra-thread-runtime";

type AiPanelThreadTabsProps = {
  readonly tabs: readonly LyraThreadTab[];
  readonly activeTabId: string | null;
  readonly newThreadLabel: string;
  readonly closeThreadLabel: string;
  readonly draftTitle: string;
  readonly onActivateTab: (tabId: string) => void;
  readonly onCloseTab: (tabId: string) => void;
  readonly onCreateTab: () => void;
};

type ScrollableTabTitleProps = {
  readonly title: string;
};

const ScrollableTabTitle = ({ title }: ScrollableTabTitleProps) => {
  const viewportRef = useRef<HTMLSpanElement | null>(null);
  const contentRef = useRef<HTMLSpanElement | null>(null);
  const [scrollDistance, setScrollDistance] = useState(0);

  const measure = useCallback((): void => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (viewport === null || content === null) {
      setScrollDistance(0);
      return;
    }
    setScrollDistance(Math.max(0, content.scrollWidth - viewport.clientWidth));
  }, []);

  return (
    <span
      ref={viewportRef}
      className="lyra-browser-tab-title lyra-ai-thread-tab-title"
      onPointerEnter={measure}
      onFocus={measure}
      style={{ "--lyra-ai-thread-tab-title-scroll": `${scrollDistance}px` } as CSSProperties}
    >
      <span ref={contentRef} className="lyra-ai-thread-tab-title-inner">
        {title}
      </span>
    </span>
  );
};

export const AiPanelThreadTabs = ({
  tabs,
  activeTabId,
  newThreadLabel,
  closeThreadLabel,
  draftTitle,
  onActivateTab,
  onCloseTab,
  onCreateTab,
}: AiPanelThreadTabsProps) => (
  <div className="lyra-ai-thread-tabs" aria-label="AI conversations">
    <div className="lyra-ai-thread-tabs-scroll lyra-browser-tab-strip" role="tablist">
      {tabs.map((tab) => {
        const title = tab.threadId === null ? draftTitle : tab.title;
        const isActive = tab.tabId === activeTabId;
        return (
          <div
            key={tab.tabId}
            className={
              isActive
                ? "lyra-browser-tab-item lyra-browser-tab-item-active lyra-ai-thread-tab-item"
                : "lyra-browser-tab-item lyra-ai-thread-tab-item"
            }
            data-status={tab.status}
          >
            <button
              type="button"
              className="lyra-browser-tab-main lyra-ai-thread-tab-main"
              role="tab"
              aria-selected={isActive}
              title={title}
              onClick={() => {
                onActivateTab(tab.tabId);
              }}
            >
              <span className="lyra-browser-tab-icon lyra-ai-thread-tab-status" aria-hidden="true" />
              <ScrollableTabTitle title={title} />
            </button>
            <button
              type="button"
              className="lyra-browser-tab-close lyra-ai-thread-tab-close"
              aria-label={`${closeThreadLabel}: ${title}`}
              title={closeThreadLabel}
              onClick={(event) => {
                event.stopPropagation();
                onCloseTab(tab.tabId);
              }}
            >
              <X size={11} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
    <button
      type="button"
      className="lyra-ai-thread-tab-new"
      aria-label={newThreadLabel}
      title={newThreadLabel}
      onClick={onCreateTab}
    >
      <Plus size={14} aria-hidden="true" />
    </button>
  </div>
);
