import type {
  BrowserActionEffect,
  WorkbenchBrowserAgentElement
} from "../types";
import { detectProvider } from "./ax-detectors";

const SUBMISSION_EFFECTS: ReadonlySet<BrowserActionEffect> = new Set([
  "submitExternal",
  "authorize",
  "purchase",
  "delete",
  "upload",
  "download",
  "communicate"
]);

const destinationRequiresAuthorization = (
  destinationUrl: string | undefined,
  element: WorkbenchBrowserAgentElement
): boolean => {
  const authorizationUrl = destinationUrl ?? element.frameUrl;
  if (detectProvider(authorizationUrl, element.role, element.label) !== undefined) {
    return true;
  }
  if (authorizationUrl === undefined || authorizationUrl.length === 0) {
    return false;
  }
  try {
    const destination = new URL(authorizationUrl, element.frameUrl);
    return destination.searchParams.has("client_id")
      && (
        destination.searchParams.has("redirect_uri")
        || destination.searchParams.has("response_type")
        || destination.searchParams.has("scope")
      );
  } catch {
    return false;
  }
};

export const browserElementEffectConflict = (
  element: WorkbenchBrowserAgentElement,
  effect: BrowserActionEffect | undefined
): string | null => {
  if (effect === undefined) {
    return null;
  }
  if (effect === "unknown") {
    return "The browser action effect is unknown.";
  }
  if (element.inputType === "file" && effect !== "upload") {
    return "A file input requires effect=upload.";
  }
  if (
    destinationRequiresAuthorization(element.destinationUrl, element)
    && effect !== "authorize"
  ) {
    return "An identity-provider destination requires effect=authorize.";
  }
  if (
    element.formAction !== undefined
    && element.formAction.length > 0
    && !SUBMISSION_EFFECTS.has(effect)
  ) {
    return "A form submission requires an external state-changing effect.";
  }
  return null;
};
