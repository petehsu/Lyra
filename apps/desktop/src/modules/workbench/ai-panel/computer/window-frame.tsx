import {
  ArrowUpRightSquare,
  CopyMinus,
  Square,
  X
} from "lucide-react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";

import type { AiComputerAppInstance } from "../../../../shared/desktop-bridge";

export type AiComputerResizeEdge =
  | "n"
  | "e"
  | "s"
  | "w"
  | "ne"
  | "nw"
  | "se"
  | "sw";

type AiComputerWindowFrameProps = {
  readonly app: AiComputerAppInstance;
  readonly variant: "workspace" | "timeline";
  readonly isActive: boolean;
  readonly title: string;
  readonly statusText?: string;
  readonly style?: CSSProperties;
  readonly className?: string;
  readonly isMaximized?: boolean;
  readonly children: ReactNode;
  readonly minimizeLabel?: string;
  readonly maximizeLabel?: string;
  readonly restoreLabel?: string;
  readonly closeLabel?: string;
  readonly openInWorkspaceLabel?: string;
  readonly onFocus?: () => void;
  readonly onTitlePointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onTitleDoubleClick?: () => void;
  readonly onResizePointerDown?: (
    edge: AiComputerResizeEdge,
    event: ReactPointerEvent<HTMLSpanElement>
  ) => void;
  readonly onMinimize?: () => void;
  readonly onMaximize?: () => void;
  readonly onRestore?: () => void;
  readonly onClose?: () => void;
  readonly onOpenInWorkspace?: () => void;
};

const RESIZE_EDGES: readonly AiComputerResizeEdge[] = [
  "n",
  "e",
  "s",
  "w",
  "ne",
  "nw",
  "se",
  "sw"
] as const;

export const AiComputerWindowFrame = ({
  app: _app,
  variant,
  isActive,
  title,
  statusText,
  style,
  className,
  isMaximized = false,
  children,
  minimizeLabel,
  maximizeLabel,
  restoreLabel,
  closeLabel,
  openInWorkspaceLabel,
  onFocus,
  onTitlePointerDown,
  onTitleDoubleClick,
  onResizePointerDown,
  onMinimize,
  onMaximize,
  onRestore,
  onClose,
  onOpenInWorkspace
}: AiComputerWindowFrameProps) => {
  const rootClassName = [
    "lyra-ai-computer-window",
    `lyra-ai-computer-window-${variant}`,
    isActive ? "lyra-ai-computer-window-active" : "",
    isMaximized ? "lyra-ai-computer-window-maximized" : "",
    className ?? ""
  ]
    .filter((entry) => entry.length > 0)
    .join(" ");

  return (
    <section
      className={rootClassName}
      style={style}
      aria-label={title}
      onPointerDown={() => {
        onFocus?.();
      }}
    >
      <header
        className="lyra-ai-computer-window-titlebar"
        onPointerDown={(event) => {
          onTitlePointerDown?.(event);
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          onTitleDoubleClick?.();
        }}
      >
        <div className="lyra-ai-computer-window-titlebar-start">
          <strong className="lyra-ai-computer-window-title">{title}</strong>
          {statusText === undefined ? null : (
            <span className="lyra-ai-computer-window-status">{statusText}</span>
          )}
        </div>
        <div className="lyra-ai-computer-window-titlebar-actions">
          {onOpenInWorkspace === undefined || openInWorkspaceLabel === undefined ? null : (
            <button
              type="button"
              className="lyra-ai-computer-window-action"
              aria-label={openInWorkspaceLabel}
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                onOpenInWorkspace();
              }}
            >
              <ArrowUpRightSquare size={12} />
            </button>
          )}
          {variant === "timeline" ? null : (
            <>
              {minimizeLabel === undefined ? null : (
                <button
                  type="button"
                  className="lyra-ai-computer-window-action"
                  aria-label={minimizeLabel}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onMinimize?.();
                  }}
                >
                  <CopyMinus size={12} />
                </button>
              )}
              {(isMaximized ? restoreLabel : maximizeLabel) === undefined ? null : (
                <button
                  type="button"
                  className="lyra-ai-computer-window-action"
                  aria-label={isMaximized ? restoreLabel : maximizeLabel}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (isMaximized) {
                      onRestore?.();
                      return;
                    }
                    onMaximize?.();
                  }}
                >
                  <Square size={11} />
                </button>
              )}
              {closeLabel === undefined ? null : (
                <button
                  type="button"
                  className="lyra-ai-computer-window-action lyra-ai-computer-window-action-close"
                  aria-label={closeLabel}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose?.();
                  }}
                >
                  <X size={12} />
                </button>
              )}
            </>
          )}
        </div>
      </header>
      <div className="lyra-ai-computer-window-body">{children}</div>
      {variant === "workspace" && isMaximized === false && onResizePointerDown !== undefined
        ? RESIZE_EDGES.map((edge) => (
            <span
              key={edge}
              className={`lyra-ai-computer-window-resize lyra-ai-computer-window-resize-${edge}`}
              onPointerDown={(event) => {
                event.stopPropagation();
                onResizePointerDown(edge, event);
              }}
            />
          ))
        : null}
    </section>
  );
};
