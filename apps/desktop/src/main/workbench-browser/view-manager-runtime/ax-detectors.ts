import type {
  BrowserAxNode,
  WorkbenchBrowserAxActionCapability,
  WorkbenchBrowserAxNodeState
} from "../types";
import { hashStableString } from "./normalizers";

// --- axRef generation (ax:<snapshotHash>:<nodeHash>) ---

export const browserAxSnapshotHash = (
  tabId: string,
  targetMode: string,
  createdAt: number,
  mapEpoch: number
): string => hashStableString([tabId, targetMode, createdAt, mapEpoch].join("|"));

export const browserAxNodeHash = (input: {
  readonly backendDOMNodeId?: number;
  readonly nodeId?: string;
  readonly role: string;
  readonly name: string;
  readonly boundsX?: number;
  readonly boundsY?: number;
  readonly frameUrl?: string;
}): string =>
  hashStableString(
    [
      input.backendDOMNodeId ?? input.nodeId ?? "",
      input.role,
      input.name,
      input.boundsX ?? "",
      input.boundsY ?? "",
      input.frameUrl ?? ""
    ].join("|")
  );

// --- role -> action capabilities ---

export const roleToActionCapabilities = (
  role: string,
  state: WorkbenchBrowserAxNodeState,
  hasBounds: boolean
): readonly WorkbenchBrowserAxActionCapability[] => {
  const normalized = role.toLowerCase();
  const capabilities = new Set<WorkbenchBrowserAxActionCapability>();
  if (BROWSER_AX_TEXT_ROLES.has(normalized)) {
    return [];
  }
  capabilities.add("focus");
  switch (normalized) {
    case "button":
    case "link":
    case "tab":
    case "menuitem":
    case "menuitemcheckbox":
    case "menuitemradio":
      capabilities.add("click");
      capabilities.add("press");
      if (normalized === "menuitem" || normalized === "menuitemcheckbox" || normalized === "menuitemradio") {
        capabilities.add("select");
      }
      break;
    case "textbox":
    case "searchbox":
    case "combobox":
      capabilities.add("type");
      capabilities.add("press");
      if (normalized === "combobox") {
        capabilities.add("select");
      }
      break;
    case "checkbox":
    case "switch":
    case "radio":
      capabilities.add("toggle");
      capabilities.add("click");
      capabilities.add("press");
      break;
    case "option":
    case "listbox":
      capabilities.add("select");
      capabilities.add("click");
      break;
    default:
      capabilities.add("click");
      capabilities.add("press");
      break;
  }
  // A node with no bounds and no DOM backing cannot receive a pointer click.
  if (!hasBounds) {
    capabilities.delete("click");
  }
  if (state.disabled === true) {
    capabilities.delete("click");
    capabilities.delete("toggle");
    capabilities.delete("type");
  }
  return [...capabilities];
};

export const BROWSER_AX_ACTIONABLE_ROLES: ReadonlySet<string> = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "checkbox",
  "radio",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "combobox",
  "switch",
  "tab",
  "option",
  "listbox"
]);

export const BROWSER_AX_TEXT_ROLES: ReadonlySet<string> = new Set([
  "statictext",
  "inlinetextbox",
  "text",
  "paragraph",
  "heading",
  "caption",
  "labeltext"
]);

// --- provider / auth detection ---

const hostMatchesDomain = (host: string, domain: string): boolean =>
  host === domain || host.endsWith(`.${domain}`);

const PROVIDER_HOST_RULES: ReadonlyArray<{ readonly match: (host: string) => boolean; readonly provider: string }> = [
  {
    match: (host) => hostMatchesDomain(host, "accounts.google.com") || hostMatchesDomain(host, "googleusercontent.com"),
    provider: "google"
  },
  { match: (host) => hostMatchesDomain(host, "appleid.apple.com"), provider: "apple" },
  {
    match: (host) => hostMatchesDomain(host, "login.microsoftonline.com") || hostMatchesDomain(host, "login.live.com"),
    provider: "microsoft"
  },
  { match: (host) => hostMatchesDomain(host, "okta.com"), provider: "okta" },
  { match: (host) => hostMatchesDomain(host, "auth0.com"), provider: "auth0" },
  { match: (host) => hostMatchesDomain(host, "stripe.com"), provider: "stripe" },
  { match: (host) => hostMatchesDomain(host, "paypal.com"), provider: "paypal" }
];

const hostFromUrl = (url: string | undefined): string => {
  if (url === undefined || url.length === 0) {
    return "";
  }
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
};

export const detectProvider = (
  url: string | undefined,
  _role: string,
  _name: string
): string | undefined => {
  const host = hostFromUrl(url);
  if (host.length > 0) {
    for (const rule of PROVIDER_HOST_RULES) {
      if (rule.match(host)) {
        return rule.provider;
      }
    }
  }
  return undefined;
};

export type BrowserAxRiskClassification = {
  readonly highRisk: boolean;
  readonly provider?: string;
  readonly reason?: string;
  readonly requiredEffect?: import("../types").BrowserActionEffect;
};

export const classifyRisk = (
  node: Pick<BrowserAxNode, "role" | "name" | "provider"> & { readonly frameUrl?: string },
  effect: import("../types").BrowserActionEffect = "unknown"
): BrowserAxRiskClassification => {
  const provider = node.provider ?? detectProvider(node.frameUrl, node.role, node.name);
  if (provider !== undefined && effect !== "observe") {
    return {
      highRisk: true,
      provider,
      reason: "oauth_popup",
      requiredEffect: "authorize"
    };
  }
  if (effect === "unknown") {
    return { highRisk: true, reason: "unknown_effect" };
  }
  if (
    effect === "submitExternal"
    || effect === "authorize"
    || effect === "purchase"
    || effect === "delete"
    || effect === "upload"
    || effect === "download"
    || effect === "communicate"
  ) {
    return { highRisk: true, reason: effect };
  }
  return { highRisk: false };
};
