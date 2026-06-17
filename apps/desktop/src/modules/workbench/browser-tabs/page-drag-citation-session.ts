type PageDragCitationSessionListener = () => void;

let sessionActive = false;
const listeners = new Set<PageDragCitationSessionListener>();

const notify = (): void => {
  listeners.forEach((listener) => listener());
};

export const isPageDragCitationSessionActive = (): boolean => sessionActive;

export const setPageDragCitationSessionActive = (active: boolean): void => {
  if (sessionActive === active) {
    return;
  }
  sessionActive = active;
  notify();
};

export const subscribePageDragCitationSession = (
  listener: PageDragCitationSessionListener
): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};