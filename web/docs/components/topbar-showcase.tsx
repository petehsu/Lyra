"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  BookText,
  Folder,
  Minus,
  PanelBottom,
  PanelLeft,
  Settings2,
  Square,
  X,
  type LucideIcon
} from "lucide-react";

import styles from "./topbar-showcase.module.css";

type TopbarLocale = "zh-CN" | "en-US";

type TopbarControlId =
  | "toggle-left-panel"
  | "toggle-bottom-panel"
  | "open-settings"
  | "open-files"
  | "open-docs"
  | "window-minimize"
  | "window-maximize"
  | "window-close";

type TopbarControl = {
  readonly id: TopbarControlId;
  readonly icon: LucideIcon;
  readonly iconSize: number;
  readonly label: Record<TopbarLocale, string>;
};

type TopbarGuideLayout = {
  readonly labelXRatio: number;
  readonly labelY: number;
  readonly elbowY: number;
  readonly note: Record<TopbarLocale, string>;
};

type GuideAnchorPoint = {
  readonly x: number;
  readonly y: number;
};

type GuideAnchorMap = Partial<Record<TopbarControlId, GuideAnchorPoint>>;

const CONTROL_ORDER: readonly TopbarControlId[] = [
  "toggle-left-panel",
  "toggle-bottom-panel",
  "open-settings",
  "open-files",
  "open-docs",
  "window-minimize",
  "window-maximize",
  "window-close"
];

const CONTROLS: Record<TopbarControlId, TopbarControl> = {
  "toggle-left-panel": {
    id: "toggle-left-panel",
    icon: PanelLeft,
    iconSize: 14,
    label: {
      "zh-CN": "左侧面板",
      "en-US": "Left Panel"
    }
  },
  "toggle-bottom-panel": {
    id: "toggle-bottom-panel",
    icon: PanelBottom,
    iconSize: 14,
    label: {
      "zh-CN": "底部终端",
      "en-US": "Bottom Terminal"
    }
  },
  "open-settings": {
    id: "open-settings",
    icon: Settings2,
    iconSize: 14,
    label: {
      "zh-CN": "设置",
      "en-US": "Settings"
    }
  },
  "open-files": {
    id: "open-files",
    icon: Folder,
    iconSize: 14,
    label: {
      "zh-CN": "文件管理",
      "en-US": "File Manager"
    }
  },
  "open-docs": {
    id: "open-docs",
    icon: BookText,
    iconSize: 14,
    label: {
      "zh-CN": "官方文档",
      "en-US": "Official Docs"
    }
  },
  "window-minimize": {
    id: "window-minimize",
    icon: Minus,
    iconSize: 14,
    label: {
      "zh-CN": "最小化",
      "en-US": "Minimize"
    }
  },
  "window-maximize": {
    id: "window-maximize",
    icon: Square,
    iconSize: 11,
    label: {
      "zh-CN": "最大化",
      "en-US": "Maximize"
    }
  },
  "window-close": {
    id: "window-close",
    icon: X,
    iconSize: 14,
    label: {
      "zh-CN": "关闭",
      "en-US": "Close"
    }
  }
};

const TOPBAR_BUTTON_WIDTH = 26;
const TOPBAR_BUTTON_GAP = 6;
const TOPBAR_GUIDE_HEIGHT = 292;
const TOPBAR_GUIDE_LABEL_WIDTH = 120;
const TOPBAR_GUIDE_LABEL_HALF_WIDTH = TOPBAR_GUIDE_LABEL_WIDTH / 2;
const TOPBAR_GUIDE_ORIGIN_OFFSET_Y = 24;
const TOPBAR_CONTROL_STRIP_WIDTH =
  CONTROL_ORDER.length * TOPBAR_BUTTON_WIDTH + (CONTROL_ORDER.length - 1) * TOPBAR_BUTTON_GAP;
const TOPBAR_GUIDE_MIN_WIDTH = 700;
const TOPBAR_GUIDE_DEFAULT_WIDTH = 980;
const TOPBAR_GUIDE_RIGHT_GUTTER = 10;
const TOPBAR_GUIDE_LABEL_MIN_GUTTER = 10;

const GUIDE_LAYOUTS: Record<TopbarControlId, TopbarGuideLayout> = {
  "toggle-left-panel": {
    labelXRatio: 0.09,
    labelY: 0,
    elbowY: 58,
    note: {
      "zh-CN": "左侧面板",
      "en-US": "Left Panel"
    }
  },
  "toggle-bottom-panel": {
    labelXRatio: 0.19,
    labelY: 246,
    elbowY: 214,
    note: {
      "zh-CN": "底部终端",
      "en-US": "Bottom Terminal"
    }
  },
  "open-settings": {
    labelXRatio: 0.32,
    labelY: 14,
    elbowY: 78,
    note: {
      "zh-CN": "设置",
      "en-US": "Settings"
    }
  },
  "open-files": {
    labelXRatio: 0.46,
    labelY: 264,
    elbowY: 226,
    note: {
      "zh-CN": "文件管理",
      "en-US": "File Manager"
    }
  },
  "open-docs": {
    labelXRatio: 0.61,
    labelY: 0,
    elbowY: 66,
    note: {
      "zh-CN": "官方文档",
      "en-US": "Docs"
    }
  },
  "window-minimize": {
    labelXRatio: 0.74,
    labelY: 246,
    elbowY: 220,
    note: {
      "zh-CN": "最小化",
      "en-US": "Minimize"
    }
  },
  "window-maximize": {
    labelXRatio: 0.85,
    labelY: 16,
    elbowY: 86,
    note: {
      "zh-CN": "最大化",
      "en-US": "Maximize"
    }
  },
  "window-close": {
    labelXRatio: 0.95,
    labelY: 264,
    elbowY: 234,
    note: {
      "zh-CN": "关闭",
      "en-US": "Close"
    }
  }
};

const STATIC_COPY = {
  "zh-CN": {
    dragZone: "拖拽区"
  },
  "en-US": {
    dragZone: "Drag Zone"
  }
} as const;

type TopbarShowcaseProps = {
  readonly locale?: TopbarLocale;
};

export const TopbarShowcase = ({ locale = "zh-CN" }: TopbarShowcaseProps) => {
  const rootRef = useRef<HTMLElement | null>(null);
  const buttonRefs = useRef<Partial<Record<TopbarControlId, HTMLButtonElement | null>>>({});
  const [overlayWidth, setOverlayWidth] = useState(TOPBAR_GUIDE_DEFAULT_WIDTH);
  const [anchorMap, setAnchorMap] = useState<GuideAnchorMap>({});
  const controls = useMemo(() => CONTROL_ORDER.map((id) => CONTROLS[id]), []);

  useEffect(() => {
    const node = rootRef.current;
    if (node === null) {
      return;
    }
    const sync = () => {
      const rootRect = node.getBoundingClientRect();
      const nextWidth = Math.max(TOPBAR_GUIDE_MIN_WIDTH, Math.round(node.clientWidth));
      const nextAnchors: GuideAnchorMap = {};
      for (const id of CONTROL_ORDER) {
        const button = buttonRefs.current[id];
        if (button === null || button === undefined) {
          continue;
        }
        const buttonRect = button.getBoundingClientRect();
        nextAnchors[id] = {
          x: buttonRect.left - rootRect.left + buttonRect.width / 2,
          y: buttonRect.top - rootRect.top + buttonRect.height / 2
        };
      }
      setOverlayWidth(nextWidth);
      setAnchorMap(nextAnchors);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const guideNodes = useMemo(
    () =>
      controls.map((control, index) => {
        const layout = GUIDE_LAYOUTS[control.id];
        const stripStartX = overlayWidth - TOPBAR_GUIDE_RIGHT_GUTTER - TOPBAR_CONTROL_STRIP_WIDTH;
        const fallbackAnchorX =
          stripStartX + TOPBAR_BUTTON_WIDTH / 2 + index * (TOPBAR_BUTTON_WIDTH + TOPBAR_BUTTON_GAP);
        const fallbackAnchorY = 120;
        const anchor = anchorMap[control.id];
        const anchorX = anchor?.x ?? fallbackAnchorX;
        const iconCenterY = anchor?.y ?? fallbackAnchorY;
        const isTopGuide = layout.labelY < iconCenterY;
        const anchorY = isTopGuide
          ? iconCenterY - TOPBAR_GUIDE_ORIGIN_OFFSET_Y
          : iconCenterY + TOPBAR_GUIDE_ORIGIN_OFFSET_Y;
        const minLabelX = TOPBAR_GUIDE_LABEL_HALF_WIDTH + TOPBAR_GUIDE_LABEL_MIN_GUTTER;
        const maxLabelX = overlayWidth - TOPBAR_GUIDE_LABEL_HALF_WIDTH - TOPBAR_GUIDE_LABEL_MIN_GUTTER;
        const targetLabelX = overlayWidth * layout.labelXRatio;
        const labelX = Math.max(minLabelX, Math.min(maxLabelX, targetLabelX));
        const labelAnchorY = layout.labelY > anchorY ? layout.labelY - 8 : layout.labelY + 14;
        const points = `${anchorX},${anchorY} ${anchorX},${layout.elbowY} ${labelX},${layout.elbowY} ${labelX},${labelAnchorY}`;
        return {
          control,
          layout,
          anchorX,
          anchorY,
          labelAnchorY,
          points,
          labelX
        };
      }),
    [anchorMap, controls, overlayWidth]
  );

  const [activeId, setActiveId] = useState<TopbarControlId>("open-settings");
  const text = STATIC_COPY[locale];

  return (
    <section ref={rootRef} className={styles.root} aria-label="lyra-topbar-showcase">
      <header className={styles.titlebar}>
        <div className={styles.dragZone}>
          <span>{text.dragZone}</span>
        </div>
        <div className={styles.controls}>
          {controls.map((control) => {
            const Icon = control.icon;
            const activeClass = activeId === control.id ? styles.buttonActive : "";
            const closeClass = control.id === "window-close" ? styles.buttonClose : "";
            return (
              <button
                key={control.id}
                type="button"
                className={`${styles.button} ${activeClass} ${closeClass}`.trim()}
                aria-label={control.id}
                ref={(element) => {
                  buttonRefs.current[control.id] = element;
                }}
                onMouseEnter={() => setActiveId(control.id)}
                onFocus={() => setActiveId(control.id)}
              >
                <Icon size={control.iconSize} strokeWidth={2} />
              </button>
            );
          })}
        </div>
      </header>

      <div className={styles.guideOverlay}>
        <svg
          className={styles.guideSvg}
          viewBox={`0 0 ${overlayWidth} ${TOPBAR_GUIDE_HEIGHT}`}
          aria-hidden
        >
          {guideNodes.map((node) => {
            const activeClass = activeId === node.control.id ? styles.guidePathActive : "";
            return (
              <polyline
                key={`${node.control.id}-path`}
                className={`${styles.guidePath} ${activeClass}`.trim()}
                points={node.points}
              />
            );
          })}
          {guideNodes.map((node) => {
            const activeClass = activeId === node.control.id ? styles.guideAnchorActive : "";
            return (
              <circle
                key={`${node.control.id}-anchor`}
                className={`${styles.guideAnchor} ${activeClass}`.trim()}
                cx={node.anchorX}
                cy={node.anchorY}
                r={2.8}
              />
            );
          })}
          {guideNodes.map((node) => {
            const activeClass = activeId === node.control.id ? styles.guideAnchorActive : "";
            return (
              <circle
                key={`${node.control.id}-label-anchor`}
                className={`${styles.guideAnchor} ${activeClass}`.trim()}
                cx={node.labelX}
                cy={node.labelAnchorY}
                r={2.2}
              />
            );
          })}
        </svg>

        <ol className={styles.guideTexts}>
          {guideNodes.map((node) => {
            const isActive = activeId === node.control.id;
            const labelClass = isActive ? styles.guideTextActive : "";
            const style = {
              "--lyra-guide-x": `${node.labelX}px`,
              "--lyra-guide-y": `${node.layout.labelY}px`
            } as CSSProperties;
            return (
              <li
                key={node.control.id}
                className={`${styles.guideText} ${labelClass}`.trim()}
                style={style}
                onMouseEnter={() => setActiveId(node.control.id)}
              >
                <span className={styles.guideTextBody}>{node.layout.note[locale]}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
};
