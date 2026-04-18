import type {
  WorkbenchWebQueryRequest,
  WorkbenchWebTargetIntent,
} from "../../../shared/workbench-web-automation";
import { normalizeActionTargetValues } from "./action-target-helpers";
import { normalizeText } from "./query-skeleton-helpers";

export type WorkbenchWebQueryIntentBuilderRuntime = {
  readonly focusAtlasIntent: WorkbenchWebTargetIntent;
};

export const createWorkbenchWebQueryIntentBuilder = (
  runtime: WorkbenchWebQueryIntentBuilderRuntime
): {
  readonly buildQueryIntentFromRequest: (request?: WorkbenchWebQueryRequest) => WorkbenchWebTargetIntent;
} => {
  const { focusAtlasIntent } = runtime;

  const roleToIntentTags = (role: string): readonly string[] => {
    switch (normalizeText(role)) {
      case "textbox":
      case "searchbox":
      case "combobox":
        return ["input", "textarea", "select"];
      case "button":
        return ["button", "div"];
      case "link":
        return ["a", "button"];
      case "menuitem":
      case "tab":
        return ["button", "a", "li", "div"];
      case "option":
        return ["option", "li", "div"];
      case "listitem":
      case "row":
      case "gridcell":
        return ["li", "tr", "td", "div", "a", "button"];
      case "checkbox":
      case "radio":
        return ["input", "button", "div"];
      default:
        return [];
    }
  };

  const buildQueryIntentFromRequest = (
    request?: WorkbenchWebQueryRequest
  ): WorkbenchWebTargetIntent => {
    if (request === undefined) {
      return focusAtlasIntent;
    }

    const requestedRoles = normalizeActionTargetValues([
      ...(Array.isArray(request.role) ? request.role : request.role === undefined ? [] : [request.role])
    ]);
    const textHints = normalizeActionTargetValues([
      request.text,
      request.name,
      request.near,
      request.within,
      request.before,
      request.after,
      request.currentSubgoal
    ]);

    const stateHintsRequested =
      request.state !== undefined
      && (
        typeof request.state.selected === "boolean"
        || typeof request.state.checked === "boolean"
        || typeof request.state.expanded === "boolean"
      );
    const contextualHintsRequested =
      request.underMenu === true
      || request.inDialog === true
      || request.inTableRow === true
      || stateHintsRequested;
    if (requestedRoles.length === 0 && textHints.length === 0 && !contextualHintsRequested) {
      return focusAtlasIntent;
    }

    const wantsTypeTargets = requestedRoles.some((role) =>
      role === "textbox" || role === "searchbox" || role === "combobox"
    );
    const wantsSelectTargets = requestedRoles.some((role) =>
      role === "option" || role === "listbox" || role === "menuitemradio" || role === "menuitemcheckbox"
    );
    const operation: WorkbenchWebTargetIntent["operation"] =
      wantsTypeTargets
        ? "type"
        : wantsSelectTargets
          ? "select"
          : "click";

    const defaultRoles = operation === "type"
      ? ["textbox", "searchbox", "combobox"]
      : operation === "select"
        ? ["option", "listbox", "combobox", "menuitem"]
        : ["button", "link", "menuitem", "tab", "option", "listitem"];
    const contextualRoles = [
      ...(request.underMenu === true ? ["menuitem", "option"] : []),
      ...(request.inDialog === true ? ["button", "textbox", "link"] : []),
      ...(request.inTableRow === true ? ["row", "gridcell", "listitem"] : [])
    ];
    const desiredRoles = normalizeActionTargetValues([
      ...requestedRoles,
      ...defaultRoles,
      ...contextualRoles
    ]);
    const desiredTags = normalizeActionTargetValues([
      ...requestedRoles.flatMap((role) => roleToIntentTags(role)),
      "button",
      "a",
      "input",
      "textarea",
      "select",
      "option",
      "li",
      "label",
      "summary",
      "div"
    ]);
    const placeholderHints = normalizeActionTargetValues([
      request.name,
      request.text
    ]);

    return {
      operation,
      desiredTags,
      desiredRoles,
      textHints,
      placeholderHints,
      ...(operation === "type" ? { allowContentEditable: true } : {})
    };
  };

  return {
    buildQueryIntentFromRequest,
  };
};
