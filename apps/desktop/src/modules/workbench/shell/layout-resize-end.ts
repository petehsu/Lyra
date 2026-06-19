type LayoutResizeListener = () => void;

const layoutResizeStartListeners = new Set<LayoutResizeListener>();
const layoutResizeEndListeners = new Set<LayoutResizeListener>();

export const subscribeLayoutResizeStart = (
  listener: LayoutResizeListener
): (() => void) => {
  layoutResizeStartListeners.add(listener);
  return () => {
    layoutResizeStartListeners.delete(listener);
  };
};

export const notifyLayoutResizeStart = (): void => {
  for (const listener of layoutResizeStartListeners) {
    listener();
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