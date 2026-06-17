type LayoutResizeEndListener = () => void;

const layoutResizeEndListeners = new Set<LayoutResizeEndListener>();

export const subscribeLayoutResizeEnd = (
  listener: LayoutResizeEndListener
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