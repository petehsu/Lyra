import { Plus, X } from "lucide-react";
import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent
} from "react";

import { ChromeTabButton, ChromeTabShape, cx } from "../ui-primitives";
import { ProjectIdentityIcon } from "../project-identity";
import type { LyraThreadTab } from "./use-lyra-thread-runtime";

const AI_THREAD_TAB_DRAG_MIME = "application/x-lyra-ai-thread-tab";

const setAiThreadTabDragImage = (
  dataTransfer: DataTransfer,
  element: HTMLElement,
  clientX: number,
  clientY: number
): void => {
  const rect = element.getBoundingClientRect();
  const width = Math.max(2, rect.width);
  const height = Math.max(2, rect.height);
  const rawOffsetX = Number.isFinite(clientX) ? clientX - rect.left : width / 2;
  const rawOffsetY = Number.isFinite(clientY) ? clientY - rect.top : height / 2;
  const offsetX = Math.max(1, Math.min(width - 1, rawOffsetX));
  const offsetY = Math.max(1, Math.min(height - 1, rawOffsetY));
  dataTransfer.setDragImage(element, offsetX, offsetY);
};

type AiPanelThreadTabsProps = {
  readonly tabs: readonly LyraThreadTab[];
  readonly activeTabId: string | null;
  readonly newThreadLabel: string;
  readonly closeThreadLabel: string;
  readonly draftTitle: string;
  readonly tabProjectRootById?: ReadonlyMap<string, string | null> | undefined;
  readonly onActivateTab: (tabId: string) => void;
  readonly onCloseTab: (tabId: string) => void;
  readonly onCreateTab: () => void;
  readonly onReorderTab: (tabId: string, targetIndex: number) => void;
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
  tabProjectRootById,
  onActivateTab,
  onCloseTab,
  onCreateTab,
  onReorderTab,
}: AiPanelThreadTabsProps) => {
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const clearDragState = useCallback((): void => {
    setDraggedTabId(null);
    setDropIndex(null);
  }, []);

  const resolveDropIndex = useCallback((
    event: ReactDragEvent<HTMLElement>,
    targetIndex: number
  ): number => {
    const rect = event.currentTarget.getBoundingClientRect();
    const isAfter = rect.width > 0 && event.clientX > rect.left + rect.width / 2;
    return targetIndex + (isAfter ? 1 : 0);
  }, []);

  const onTabDragStart = useCallback((
    event: ReactDragEvent<HTMLElement>,
    tabId: string
  ): void => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(AI_THREAD_TAB_DRAG_MIME, tabId);
    event.dataTransfer.setData("text/plain", tabId);
    setAiThreadTabDragImage(
      event.dataTransfer,
      event.currentTarget,
      event.clientX,
      event.clientY
    );
    setDraggedTabId(tabId);
    setDropIndex(null);
  }, []);

  const readDraggedTabId = useCallback((event: ReactDragEvent<HTMLElement>): string | null => {
    const transferTabId = event.dataTransfer.getData(AI_THREAD_TAB_DRAG_MIME)
      || event.dataTransfer.getData("text/plain");
    return transferTabId.length > 0 ? transferTabId : draggedTabId;
  }, [draggedTabId]);

  const onTabDragOver = useCallback((
    event: ReactDragEvent<HTMLElement>,
    targetIndex: number
  ): void => {
    if (draggedTabId === null) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropIndex(resolveDropIndex(event, targetIndex));
  }, [draggedTabId, resolveDropIndex]);

  const onTabDrop = useCallback((
    event: ReactDragEvent<HTMLElement>,
    targetIndex: number
  ): void => {
    const tabId = readDraggedTabId(event);
    if (tabId === null) {
      clearDragState();
      return;
    }
    event.preventDefault();
    onReorderTab(tabId, resolveDropIndex(event, targetIndex));
    clearDragState();
  }, [clearDragState, onReorderTab, readDraggedTabId, resolveDropIndex]);

  return (
    <div className="lyra-ai-thread-tabs" aria-label="AI conversations">
      <div className="lyra-ai-thread-tabs-scroll lyra-browser-tab-strip" role="tablist">
        {tabs.map((tab, index) => {
          const title = tab.threadId === null ? draftTitle : tab.title;
          const isActive = tab.tabId === activeTabId;
          const projectRoot = tabProjectRootById?.get(tab.tabId) ?? null;
          return (
            <div
              key={tab.tabId}
              className={cx(
                "lyra-browser-tab-item lyra-ai-thread-tab-item lyra-allow-web-drag",
                isActive && "lyra-browser-tab-item-active",
                draggedTabId === tab.tabId && "lyra-ai-thread-tab-item-dragging",
                dropIndex === index && "lyra-ai-thread-tab-item-drop-before",
                dropIndex === index + 1 && "lyra-ai-thread-tab-item-drop-after"
              )}
              data-status={tab.status}
              draggable
              onDragStart={(event) => {
                onTabDragStart(event, tab.tabId);
              }}
              onDragOver={(event) => {
                onTabDragOver(event, index);
              }}
              onDrop={(event) => {
                onTabDrop(event, index);
              }}
              onDragEnd={clearDragState}
            >
              <ChromeTabShape />
              <ChromeTabButton
                className="lyra-browser-tab-main lyra-ai-thread-tab-main"
                role="tab"
                aria-selected={isActive}
                title={title}
                allowWebDrag
                onClick={() => {
                  onActivateTab(tab.tabId);
                }}
              >
                <ProjectIdentityIcon
                  className="lyra-browser-tab-icon lyra-ai-thread-tab-icon"
                  projectRoot={projectRoot}
                  projectLogoUrl={null}
                  title={title}
                />
                <ScrollableTabTitle title={title} />
              </ChromeTabButton>
              <button
                type="button"
                className="lyra-browser-tab-close lyra-ai-thread-tab-close"
                aria-label={`${closeThreadLabel}: ${title}`}
                title={closeThreadLabel}
                draggable={false}
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
};
