import type {
  WorkbenchWebAction,
  WorkbenchWebTargetIntent,
} from "../../../shared/workbench-web-automation";

export const toActionIntent = (
  action: WorkbenchWebAction,
  seed?: {
    readonly tagName?: string;
    readonly role?: string;
    readonly ariaLabel?: string;
    readonly placeholder?: string;
    readonly textSnippet?: string;
    readonly selectorPreview?: string;
  }
): WorkbenchWebTargetIntent => {
  const textHints = [
    seed?.ariaLabel,
    seed?.textSnippet,
    seed?.selectorPreview,
    seed?.role
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  const placeholderHints = [seed?.placeholder].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );

  switch (action.kind) {
    case "type":
    case "clear_and_type":
      return {
        operation: "type",
        desiredTags: [seed?.tagName ?? "textarea", "input"],
        desiredRoles: [seed?.role ?? "textbox", "searchbox", "combobox"],
        textHints,
        placeholderHints,
        allowContentEditable: true
      };
    case "select_option":
      return {
        operation: "select",
        desiredTags: [seed?.tagName ?? "select"],
        desiredRoles: [seed?.role ?? "combobox", "listbox"],
        textHints,
        placeholderHints
      };
    case "focus":
    case "press_key":
      return {
        operation: "focus",
        desiredTags: [seed?.tagName ?? "textarea", "input", "button"],
        desiredRoles: [seed?.role ?? "textbox", "button"],
        textHints,
        placeholderHints,
        allowContentEditable: true
      };
    case "hover":
      return {
        operation: "hover",
        desiredTags: [seed?.tagName ?? "button", "a", "div"],
        desiredRoles: [seed?.role ?? "button", "link", "menuitem", "tab"],
        textHints,
        placeholderHints
      };
    case "submit_form":
      return {
        operation: "submit",
        desiredTags: [seed?.tagName ?? "button", "form"],
        desiredRoles: [seed?.role ?? "button"],
        textHints,
        placeholderHints
      };
    default:
      return {
        operation: "click",
        desiredTags: [seed?.tagName ?? "button", "a"],
        desiredRoles: [seed?.role ?? "button", "link", "menuitem", "tab"],
        textHints,
        placeholderHints
      };
  }
};

export const isWeakStableSignatureTarget = (value: unknown): boolean => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const signature = value as Record<string, unknown>;
  const tagName = typeof signature.tagName === "string" ? signature.tagName.trim() : "";
  if (tagName.length === 0) {
    return false;
  }
  const strongKeys = ["id", "name", "testId", "structureHash"];
  if (strongKeys.some((key) => typeof signature[key] === "string" && (signature[key] as string).trim().length > 0)) {
    return false;
  }
  const weakKeys = ["textHash", "ariaLabel", "role", "inputType"];
  return weakKeys.some((key) => typeof signature[key] === "string" && (signature[key] as string).trim().length > 0);
};
