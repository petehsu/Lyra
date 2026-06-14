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

const PROVIDER_NAME_RULES: ReadonlyArray<{ readonly needles: readonly string[]; readonly provider: string }> = [
  { needles: ["sign in with google", "continue with google", "使用 google", "使用google", "通过 google", "google 登录"], provider: "google" },
  { needles: ["continue with apple", "sign in with apple", "使用 apple", "apple 登录"], provider: "apple" },
  { needles: ["sign in with microsoft", "continue with microsoft", "使用 microsoft", "microsoft 登录"], provider: "microsoft" }
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
  role: string,
  name: string
): string | undefined => {
  const host = hostFromUrl(url);
  if (host.length > 0) {
    for (const rule of PROVIDER_HOST_RULES) {
      if (rule.match(host)) {
        return rule.provider;
      }
    }
  }
  const haystack = `${role} ${name}`.toLowerCase();
  for (const rule of PROVIDER_NAME_RULES) {
    if (rule.needles.some((needle) => haystack.includes(needle))) {
      return rule.provider;
    }
  }
  return undefined;
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const makeWholeWordPattern = (value: string): RegExp => new RegExp(`\\b${escapeRegex(value)}\\b`, "i");

const HIGH_RISK_STRONG_PATTERNS: readonly RegExp[] = [
  makeWholeWordPattern("continue as"),
  makeWholeWordPattern("authorize"),
  makeWholeWordPattern("authorise"),
  makeWholeWordPattern("grant access"),
  makeWholeWordPattern("password"),
  makeWholeWordPattern("passkey"),
  makeWholeWordPattern("token"),
  makeWholeWordPattern("verification code"),
  makeWholeWordPattern("one-time code"),
  makeWholeWordPattern("otp"),
  makeWholeWordPattern("2fa"),
  makeWholeWordPattern("mfa"),
  makeWholeWordPattern("delete"),
  /授权/,
  /删除/,
  /密码/,
  /令牌/,
  /验证码/,
  /的身份继续/
];

const HIGH_RISK_ACTION_PATTERNS: readonly RegExp[] = [
  makeWholeWordPattern("continue"),
  makeWholeWordPattern("submit"),
  makeWholeWordPattern("pay"),
  makeWholeWordPattern("allow"),
  /继续/,
  /提交/,
  /支付/,
  /允许/
];

const HIGH_RISK_CONTEXT_PATTERNS: readonly RegExp[] = [
  makeWholeWordPattern("account"),
  makeWholeWordPattern("payment"),
  makeWholeWordPattern("checkout"),
  makeWholeWordPattern("purchase"),
  makeWholeWordPattern("order"),
  makeWholeWordPattern("subscription"),
  makeWholeWordPattern("invoice"),
  makeWholeWordPattern("wallet"),
  makeWholeWordPattern("card"),
  makeWholeWordPattern("bank"),
  makeWholeWordPattern("consent"),
  makeWholeWordPattern("permission"),
  makeWholeWordPattern("access"),
  makeWholeWordPattern("password"),
  makeWholeWordPattern("passkey"),
  makeWholeWordPattern("token"),
  makeWholeWordPattern("verification"),
  makeWholeWordPattern("verify"),
  makeWholeWordPattern("login"),
  makeWholeWordPattern("log in"),
  makeWholeWordPattern("sign in"),
  makeWholeWordPattern("identity"),
  makeWholeWordPattern("camera"),
  makeWholeWordPattern("microphone"),
  makeWholeWordPattern("location"),
  makeWholeWordPattern("notifications"),
  makeWholeWordPattern("2fa"),
  makeWholeWordPattern("mfa"),
  makeWholeWordPattern("otp"),
  /账号/,
  /账户/,
  /支付/,
  /付款/,
  /订单/,
  /购买/,
  /订阅/,
  /银行卡/,
  /授权/,
  /权限/,
  /访问/,
  /密码/,
  /令牌/,
  /验证码/,
  /登录/,
  /身份/,
  /相机/,
  /麦克风/,
  /位置/,
  /通知/
];

export type BrowserAxRiskClassification = {
  readonly highRisk: boolean;
  readonly provider?: string;
  readonly reason?: string;
};

export const classifyRisk = (
  node: Pick<BrowserAxNode, "role" | "name" | "provider"> & { readonly frameUrl?: string }
): BrowserAxRiskClassification => {
  const provider = node.provider ?? detectProvider(node.frameUrl, node.role, node.name);
  if (provider !== undefined) {
    return { highRisk: true, provider, reason: "oauth_popup" };
  }
  const haystack = `${node.role} ${node.name}`.toLowerCase();
  if (HIGH_RISK_STRONG_PATTERNS.some((pattern) => pattern.test(haystack))) {
    return { highRisk: true, reason: "sensitive_action" };
  }
  const hasGenericAction = HIGH_RISK_ACTION_PATTERNS.some((pattern) => pattern.test(haystack));
  const hasSensitiveContext = HIGH_RISK_CONTEXT_PATTERNS.some((pattern) => pattern.test(haystack));
  if (hasGenericAction && hasSensitiveContext) {
    return { highRisk: true, reason: "sensitive_action" };
  }
  return { highRisk: false };
};
