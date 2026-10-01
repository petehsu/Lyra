export type LayoutDragSize = {
  readonly leftWidth: number;
  readonly bottomHeight: number;
  readonly appSidebarWidth: number;
};

type LayoutDragFrameListener = (size: LayoutDragSize) => void;
type LayoutResizeListener = () => void;

const layoutDragFrameListeners = new Set<LayoutDragFrameListener>();
const layoutResizeEndListeners = new Set<LayoutResizeListener>();

/** Drag frames carry the sizes the divider just wrote. Listeners do not remeasure. */
export const subscribeLayoutDragFrame = (
  listener: LayoutDragFrameListener
): (() => void) => {
  layoutDragFrameListeners.add(listener);
  return () => {
    layoutDragFrameListeners.delete(listener);
  };
};

export const notifyLayoutDragFrame = (size: LayoutDragSize): void => {
  for (const listener of layoutDragFrameListeners) {
    listener(size);
  }
};

export const subscribeLayoutResizeEnd = (
  listener: LayoutResizeListener
): (() => void) => {
  layoutResizeEndListeners.add(listener);
  return () => {
    layoutResizeEndListeners.delete(listener);
  };
};

export const notifyLayoutResizeEnd = (): void => {
  for (const listener of layoutResizeEndListeners) {
    listener();
  }
};
