export const WORKBENCH_ALLOW_SELECT_CLASS = "lyra-allow-select";
export const WORKBENCH_ALLOW_WEB_DRAG_CLASS = "lyra-allow-web-drag";

const resolveTargetElement = (target: EventTarget | null): Element | null => {
  if (target instanceof Element) {
    return target;
  }
  if (target instanceof Node) {
    return target.parentElement;
  }
  return null;
};

const matchesClosestSelector = (target: EventTarget | null, selector: string): boolean => {
  const element = resolveTargetElement(target);
  if (element === null) {
    return false;
  }

  return element.closest(selector) !== null;
};

export const shouldPreventWorkbenchDragStart = (target: EventTarget | null): boolean =>
  matchesClosestSelector(
    target,
    `.${WORKBENCH_ALLOW_WEB_DRAG_CLASS}, [data-lyra-allow-web-drag="true"]`
  ) === false;
