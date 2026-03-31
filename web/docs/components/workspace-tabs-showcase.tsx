"use client";

import {
  BookText,
  ChevronLeft,
  ChevronRight,
  FileText,
  Globe,
  House,
  Layers3,
  Plus,
  Search,
  Settings2,
  SquareTerminal,
  X,
  type LucideIcon
} from "lucide-react";
import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type WheelEvent
} from "react";

import styles from "./workspace-tabs-showcase.module.css";

type Locale = "zh-CN" | "en-US";

type SeedTab = {
  readonly id: string;
  readonly title: Record<Locale, string>;
  readonly icon: LucideIcon;
};

type ShowcaseTab = {
  readonly id: string;
  readonly title: string;
  readonly icon: LucideIcon;
};

type DropTarget = {
  readonly index: number;
  readonly indicatorX: number;
};

const REORDER_SNAP_PX = 16;

const SEED_TABS: readonly SeedTab[] = [
  { id: "home", title: { "zh-CN": "首页", "en-US": "Home" }, icon: House },
  { id: "search", title: { "zh-CN": "搜索结果", "en-US": "Search Results" }, icon: Search },
  { id: "architecture", title: { "zh-CN": "项目架构.md", "en-US": "architecture.md" }, icon: FileText },
  { id: "terminal", title: { "zh-CN": "终端", "en-US": "Terminal" }, icon: SquareTerminal },
  { id: "docs", title: { "zh-CN": "Lyra 文档", "en-US": "Lyra Docs" }, icon: BookText },
  { id: "site", title: { "zh-CN": "官网", "en-US": "Site" }, icon: Globe },
  { id: "settings", title: { "zh-CN": "设置", "en-US": "Settings" }, icon: Settings2 }
];

const COPY = {
  "zh-CN": {
    back: "后退",
    forward: "前进",
    stack: "堆叠标签",
    newTab: "新建标签",
    close: "关闭",
    dragHint: "按住标签可直接拖动换位",
    wheelHint: "标签超出时，在标签栏内滚轮即可横向滚动",
    buttonHint: "左侧是历史/堆叠按钮，右侧 + 用于新建标签"
  },
  "en-US": {
    back: "Go Back",
    forward: "Go Forward",
    stack: "Toggle Tab Stack",
    newTab: "Open New Tab",
    close: "Close",
    dragHint: "Drag tabs directly to reorder",
    wheelHint: "When overflowed, wheel-scroll in the strip moves horizontally",
    buttonHint: "Left: history/stack controls, Right: + for new tab"
  }
} as const;

const moveByInsertIndex = (tabs: readonly ShowcaseTab[], fromIndex: number, insertIndex: number): readonly ShowcaseTab[] => {
  if (fromIndex < 0 || fromIndex >= tabs.length) {
    return tabs;
  }
  const boundedInsert = Math.max(0, Math.min(tabs.length, insertIndex));
  if (fromIndex === boundedInsert || fromIndex + 1 === boundedInsert) {
    return tabs;
  }

  const next = [...tabs];
  const [moved] = next.splice(fromIndex, 1);
  const finalIndex = fromIndex < boundedInsert ? boundedInsert - 1 : boundedInsert;
  next.splice(Math.max(0, Math.min(next.length, finalIndex)), 0, moved!);
  return next;
};

type WorkspaceTabsShowcaseProps = {
  readonly locale?: Locale;
};

export function WorkspaceTabsShowcase({ locale = "zh-CN" }: WorkspaceTabsShowcaseProps) {
  const text = COPY[locale];
  const seed = useMemo<readonly ShowcaseTab[]>(
    () => SEED_TABS.map((tab) => ({ id: tab.id, title: tab.title[locale], icon: tab.icon })),
    [locale]
  );

  const [tabs, setTabs] = useState<readonly ShowcaseTab[]>(seed);
  const [activeTabId, setActiveTabId] = useState<string>(seed[0]?.id ?? "");
  const [stackedMode, setStackedMode] = useState(false);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [dropIndicatorX, setDropIndicatorX] = useState<number | null>(null);

  const navRef = useRef<HTMLElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setTabs(seed);
    setActiveTabId(seed[0]?.id ?? "");
    setDraggingTabId(null);
    setDropIndicatorX(null);
  }, [seed]);

  const activeIndex = tabs.findIndex((tab) => tab.id === activeTabId);
  const canGoBack = activeIndex > 0;
  const canGoForward = activeIndex >= 0 && activeIndex < tabs.length - 1;

  const resolveDropTarget = useCallback(
    (event: DragEvent<HTMLElement>, draggingId?: string): DropTarget => {
      const host = navRef.current;
      const strip = stripRef.current;
      if (host === null || strip === null) {
        return { index: tabs.length, indicatorX: 0 };
      }

      const hostRect = host.getBoundingClientRect();
      const tabElements = Array.from(
        strip.querySelectorAll<HTMLElement>("[data-lyra-showcase-tab-id]")
      );

      if (tabElements.length === 0) {
        const fallbackX = Math.max(0, Math.min(hostRect.width, strip.getBoundingClientRect().left - hostRect.left));
        return { index: 0, indicatorX: fallbackX };
      }

      const indicatorScreenXFor = (targetIndex: number): number => {
        if (targetIndex <= 0) {
          return tabElements[0]!.getBoundingClientRect().left;
        }
        if (targetIndex >= tabElements.length) {
          return tabElements[tabElements.length - 1]!.getBoundingClientRect().right;
        }
        return tabElements[targetIndex]!.getBoundingClientRect().left;
      };

      if (draggingId !== undefined) {
        const draggedIndex = tabs.findIndex((tab) => tab.id === draggingId);
        if (draggedIndex >= 0) {
          const hoveredIndex = tabElements.findIndex((tabElement) => {
            const rect = tabElement.getBoundingClientRect();
            return event.clientX >= rect.left - REORDER_SNAP_PX && event.clientX <= rect.right + REORDER_SNAP_PX;
          });
          if (hoveredIndex >= 0) {
            const index =
              hoveredIndex === draggedIndex ? draggedIndex : hoveredIndex > draggedIndex ? hoveredIndex + 1 : hoveredIndex;
            const indicatorX = Math.max(0, Math.min(hostRect.width, indicatorScreenXFor(index) - hostRect.left));
            return { index, indicatorX };
          }
        }
      }

      let index = tabElements.length;
      let indicatorScreenX = tabElements[tabElements.length - 1]!.getBoundingClientRect().right;
      for (let i = 0; i < tabElements.length; i += 1) {
        const rect = tabElements[i]!.getBoundingClientRect();
        if (event.clientX < rect.left + rect.width / 2) {
          index = i;
          indicatorScreenX = rect.left;
          break;
        }
      }

      return {
        index,
        indicatorX: Math.max(0, Math.min(hostRect.width, indicatorScreenX - hostRect.left))
      };
    },
    [tabs]
  );

  const clearDragUi = useCallback(() => {
    setDropIndicatorX(null);
  }, []);

  const onStripWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (event.ctrlKey) {
      return;
    }
    const strip = stripRef.current;
    if (strip === null || strip.scrollWidth <= strip.clientWidth) {
      return;
    }
    const delta = Math.abs(event.deltaX) > 0.01 ? event.deltaX : event.deltaY;
    if (Math.abs(delta) <= 0.01) {
      return;
    }
    strip.scrollLeft += delta;
    event.preventDefault();
  }, []);

  const onTabDragStart = (event: DragEvent<HTMLElement>, tabId: string) => {
    setDraggingTabId(tabId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", tabId);
  };

  const onTabBarDragOver = (event: DragEvent<HTMLElement>) => {
    if (draggingTabId === null) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const target = resolveDropTarget(event, draggingTabId);
    setDropIndicatorX(target.indicatorX);
  };

  const onTabBarDrop = (event: DragEvent<HTMLElement>) => {
    if (draggingTabId === null) {
      return;
    }
    event.preventDefault();
    const fromIndex = tabs.findIndex((tab) => tab.id === draggingTabId);
    const target = resolveDropTarget(event, draggingTabId);
    setTabs((current) => moveByInsertIndex(current, fromIndex, target.index));
    clearDragUi();
    setDraggingTabId(null);
  };

  const onTabBarDragLeave = (event: DragEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    clearDragUi();
  };

  const onCreateTab = () => {
    const count = tabs.length + 1;
    const nextTab: ShowcaseTab = {
      id: `new-${count}`,
      title: locale === "zh-CN" ? `新标签 ${count}` : `New Tab ${count}`,
      icon: FileText
    };
    setTabs((current) => [...current, nextTab]);
    setActiveTabId(nextTab.id);
  };

  const onCloseTab = (tabId: string) => {
    const index = tabs.findIndex((tab) => tab.id === tabId);
    if (index < 0) {
      return;
    }
    const nextTabs = tabs.filter((tab) => tab.id !== tabId);
    setTabs(nextTabs);
    if (activeTabId === tabId) {
      const fallback = nextTabs[Math.max(0, index - 1)];
      setActiveTabId(fallback?.id ?? "");
    }
  };

  const onGoBack = () => {
    if (canGoBack === false) {
      return;
    }
    setActiveTabId(tabs[activeIndex - 1]!.id);
  };

  const onGoForward = () => {
    if (canGoForward === false) {
      return;
    }
    setActiveTabId(tabs[activeIndex + 1]!.id);
  };

  const navClassName = [styles.browserTabs, dropIndicatorX !== null ? styles.browserTabsReorderActive : ""]
    .filter((value) => value.length > 0)
    .join(" ");

  const navStyle =
    dropIndicatorX === null
      ? undefined
      : ({ "--lyra-browser-drop-indicator-x": `${dropIndicatorX}px` } as CSSProperties);

  return (
    <section className={styles.root} aria-label="workspace-tabs-showcase">
      <section className={styles.workspaceStage}>
        <div className={styles.workspaceCanvas} />

        <nav
          ref={navRef}
          className={navClassName}
          style={navStyle}
          aria-label="workspace-tabs"
          onDragOver={onTabBarDragOver}
          onDragEnter={onTabBarDragOver}
          onDragLeave={onTabBarDragLeave}
          onDrop={onTabBarDrop}
        >
          <button className={styles.browserNavButton} aria-label={text.back} disabled={!canGoBack} onClick={onGoBack}>
            <ChevronLeft size={14} />
          </button>

          <button
            className={styles.browserNavButton}
            aria-label={text.forward}
            disabled={!canGoForward}
            onClick={onGoForward}
          >
            <ChevronRight size={14} />
          </button>

          <button
            className={stackedMode ? `${styles.browserNavButton} ${styles.browserNavButtonActive}` : styles.browserNavButton}
            aria-label={text.stack}
            aria-pressed={stackedMode}
            onClick={() => setStackedMode((value) => !value)}
          >
            <Layers3 size={14} />
          </button>

          <div
            ref={stripRef}
            className={stackedMode ? `${styles.browserTabStrip} ${styles.browserTabStripStacked}` : styles.browserTabStrip}
            onWheel={onStripWheel}
          >
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = tab.id === activeTabId;
              const isCollapsed = stackedMode && !isActive;
              const itemClassName = [
                styles.browserTabItem,
                isActive ? styles.browserTabItemActive : "",
                isCollapsed ? styles.browserTabItemCollapsed : "",
                draggingTabId === tab.id ? styles.browserTabItemDragging : ""
              ]
                .filter((value) => value.length > 0)
                .join(" ");

              return (
                <div
                  key={tab.id}
                  className={itemClassName}
                  data-lyra-showcase-tab-id={tab.id}
                  draggable
                  onDragStart={(event) => onTabDragStart(event, tab.id)}
                  onDragEnd={() => {
                    setDraggingTabId(null);
                    clearDragUi();
                  }}
                >
                  <button
                    className={isCollapsed ? `${styles.browserTabMain} ${styles.browserTabMainCollapsed}` : styles.browserTabMain}
                    title={tab.title}
                    onClick={() => setActiveTabId(tab.id)}
                    draggable
                    onDragStart={(event) => onTabDragStart(event, tab.id)}
                    onDragEnd={() => {
                      setDraggingTabId(null);
                      clearDragUi();
                    }}
                  >
                    <span className={styles.browserTabIcon} aria-hidden="true">
                      <Icon size={13} className={styles.browserTabIconSvg} />
                    </span>
                    {isCollapsed ? null : <span className={styles.browserTabTitle}>{tab.title}</span>}
                  </button>

                  {isCollapsed ? null : (
                    <button
                      className={styles.browserTabClose}
                      aria-label={`${text.close}-${tab.title}`}
                      onClick={() => onCloseTab(tab.id)}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              );
            })}

            <button className={styles.browserTabAdd} aria-label={text.newTab} onClick={onCreateTab}>
              <Plus size={14} />
            </button>
          </div>
        </nav>
      </section>

      <div className={styles.guideText}>
        <p>{text.dragHint}</p>
        <p>{text.wheelHint}</p>
        <p>{text.buttonHint}</p>
      </div>
    </section>
  );
}
