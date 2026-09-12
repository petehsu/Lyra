import type {
  BrowserActionEffect,
  WorkbenchBrowserAgentElement
} from "../types";
import { hasBrowserAuthorizeActGrant } from "../../browser-authorize-grant";
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

export const resolveGrantedBrowserActEffect = (
  element: WorkbenchBrowserAgentElement,
  effect: BrowserActionEffect | undefined,
  pageUrl: string | undefined,
  tabId?: string
): BrowserActionEffect | undefined => {
  if (
    hasBrowserAuthorizeActGrant(pageUrl, tabId) === false
    && hasBrowserAuthorizeActGrant(element.frameUrl, tabId) === false
  ) {
    return effect;
  }
  if (
    effect === "authorize"
    || effect === "purchase"
    || effect === "delete"
    || effect === "upload"
    || effect === "download"
    || effect === "submitExternal"
  ) {
    return effect;
  }
  if (element.inputType === "file" || element.inputType === "password") {
    return effect;
  }
  if (destinationRequiresAuthorization(element.destinationUrl, element)) {
    return "authorize";
  }
  if (element.formAction !== undefined && element.formAction.length > 0) {
    return "submitExternal";
  }
  return effect;
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
