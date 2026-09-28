import { SURFACE_DOM_ACCESS } from "./surface-dom-access";
import { sensitiveFieldRuntime } from "../../sensitive-values/browser-boundary";
import type { WorkbenchBrowserAgentObserveStrategy, WorkbenchBrowserFrameGlobalBounds } from "../types";
import { coerceFrameBounds } from "./normalizers";
import { browserMapSemanticsScript } from "./agent-page-semantics";
import { surfaceNameRuntime } from "./surface-name-runtime";
import { CURSOR_RUNTIME } from "./agent-cursor-semantics";
import { browserTargetVisibilityRuntime } from "./agent-target-visibility";
import { browserEditingHostRuntime } from "./agent-editable-runtime";

export {
  authSignalsFromPageDiagnostics,
  normalizeAuthChallengeSignals
} from "./agent-auth-signals";

const readAxValueText = (value: unknown): string => {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return typeof record.value === "string" ? record.value.trim() : "";
  }
  return "";
};

const boundsFromCdpBoxModel = (value: unknown): WorkbenchBrowserFrameGlobalBounds | null => {
  const model = value !== null && typeof value === "object"
    ? (value as Record<string, unknown>).model
    : null;
  const record = model !== null && typeof model === "object" ? model as Record<string, unknown> : {};
  const quad = Array.isArray(record.border)
    ? record.border
    : Array.isArray(record.content) ? record.content : [];
  const numbers = quad.filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry));
  if (numbers.length < 8) {
    return null;
  }
  const xs = numbers.filter((_value, index) => index % 2 === 0);
  const ys = numbers.filter((_value, index) => index % 2 === 1);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return coerceFrameBounds({
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  });
};


const buildBrowserAgentObservationScript = ({
  frameTreeNodeId,
  frameRef,
  frameBounds,
  strategy,
  includeChildFrames,
  isMainFrame = false,
  activeFileChooserPending = false,
  followCursor = false
}: {
  readonly frameTreeNodeId: number;
  readonly frameRef: string;
  readonly frameBounds: WorkbenchBrowserFrameGlobalBounds;
  readonly strategy: WorkbenchBrowserAgentObserveStrategy;
  readonly includeChildFrames: boolean;
  readonly isMainFrame?: boolean;
  readonly activeFileChooserPending?: boolean;
  readonly followCursor?: boolean;
}): string => `
  (async () => {
    const FRAME_TREE_NODE_ID = ${JSON.stringify(frameTreeNodeId)};
    const FRAME_REF = ${JSON.stringify(frameRef)};
    const FRAME_BOUNDS = ${JSON.stringify(frameBounds)};
    const STRATEGY = ${JSON.stringify(strategy)};
    const INCLUDE_CHILD_FRAMES = ${JSON.stringify(includeChildFrames)};
    const IS_MAIN_FRAME = ${JSON.stringify(isMainFrame)};
    const ACTIVE_FILE_CHOOSER_PENDING = ${JSON.stringify(activeFileChooserPending)};
    const FOLLOW_CURSOR = ${JSON.stringify(followCursor === true)};
    const LIGHTWEIGHT_STRATEGY = STRATEGY === "interactiveOnly" || STRATEGY === "picker" || STRATEGY === "focus";
    const MAX_LIGHTWEIGHT_SCAN_NODES = 3000;
    const MAX_LIGHTWEIGHT_CANDIDATES = 220;
    const MAX_LIGHTWEIGHT_SHADOW_HOSTS = 180;
    const semantics = ${browserMapSemanticsScript};
    ${SURFACE_DOM_ACCESS}
    const surfaceNames = ${surfaceNameRuntime};
    const cursorSemantics = ${CURSOR_RUNTIME};
    const editingHost = ${browserEditingHostRuntime};
    const isEditingHost = element => editingHost(element) === element;
    const warnings = [];
    const blockedRegions = [];
    const surfaceRegistry = window.__lyraSurfaceNodeRegistry ??= {
      nodes: new WeakMap(), serial: 0,
      prefix: (window.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)).slice(0, 8)
    };
    surfaceRegistry.byRef ??= new Map();
    for (const [ref, weak] of surfaceRegistry.byRef) if (!weak.deref()?.isConnected) surfaceRegistry.byRef.delete(ref);

    const normalizeText = (value, maxLength = 160) => {
      if (typeof value !== "string") return "";
      const normalized = value.replace(/\\s+/g, " ").trim();
      return normalized.length <= maxLength ? normalized : normalized.slice(0, maxLength - 3) + "...";
    };

    const isDisabled = (element) =>
      semantics.disabled(element);

    const isTypedField = (element) => {
      const tag = String(element.tagName || "").toLowerCase();
      const role = String(element.getAttribute?.("role") || "").toLowerCase();
      if (tag === "textarea" || tag === "select" || role === "textbox" || role === "searchbox") return true;
      if (isEditingHost(element)) return true;
      return tag === "input" && String(element.getAttribute?.("type") || element.type || "text").toLowerCase() !== "hidden";
    };
    const isFileInputElement = (element, win = window) =>
      element instanceof (win.HTMLInputElement || HTMLInputElement) && element.type === "file";

    const isVisible = (element, win = window) => {
      const ElementCtor = win.Element || Element;
      if (!(element instanceof ElementCtor) || !(${browserTargetVisibilityRuntime})(element)) return false;
      const style = win.getComputedStyle(element);
      if (Number.parseFloat(style.opacity || "1") <= 0) {
        if (isFileInputElement(element, win) || isTypedField(element)) return true;
        // A styled widget may paint its label on a tight parent and put a
        // transparent native button over it. Require visible owner content and
        // a real hit; an arbitrary invisible button is not a visual target.
        if (!element.matches('button,[role=button]')) return false;
        const owner = element.parentElement;
        if (!owner || !(${browserTargetVisibilityRuntime})(owner) || Number(win.getComputedStyle(owner).opacity) === 0) return false;
        const box = element.getBoundingClientRect(), outer = owner.getBoundingClientRect();
        if (outer.width > box.width + 24 || outer.height > box.height + 24) return false;
        const paintedText = Array.from(owner.childNodes).some(node => node.nodeType === 3 && String(node.textContent || '').trim())
          || Array.from(owner.children).some(node => node !== element && String(node.textContent || '').trim()
            && (${browserTargetVisibilityRuntime})(node) && Number(win.getComputedStyle(node).opacity) > 0);
        if (!paintedText) return false;
        const hit = surfaceHitForNode(element, box.left + box.width / 2, box.top + box.height / 2);
        return hit === element || !!hit && element.contains(hit);
      }
      if ((style.pointerEvents || "").toLowerCase() === "none" && !isTypedField(element)) {
        return false;
      }
      return true;
    };

    const hoverPlacedControl = (element, win = window) => {
      const rect = element.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8 || rect.width > 48 || rect.height > 48) return false;
      const viewportWidth = win.innerWidth || 0;
      const viewportHeight = win.innerHeight || 0;
      if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= viewportHeight || rect.left >= viewportWidth) return false;
      let faded = false;
      let node = element;
      while (node instanceof win.Element) {
        const style = win.getComputedStyle(node);
        if (style.display === "none") return false;
        if (Number.parseFloat(style.opacity || "1") <= 0
          || style.visibility === "hidden"
          || (style.pointerEvents || "").toLowerCase() === "none") {
          faded = true;
        }
        if (node !== element) {
          const box = node.getBoundingClientRect();
          if (box.width > rect.width * 2 && box.width > rect.width + 24) return faded;
        }
        const parentRect = node.getBoundingClientRect();
        if (parentRect.bottom > 0 && parentRect.right > 0 && parentRect.top < viewportHeight && parentRect.left < viewportWidth && faded) {
          return true;
        }
        node = node.parentElement;
      }
      return false;
    };

    const visibilityState = (element, win = window) => {
      const viewportWidth = win.innerWidth || element.ownerDocument?.documentElement?.clientWidth || 0;
      const viewportHeight = win.innerHeight || element.ownerDocument?.documentElement?.clientHeight || 0;
      const rect = element.getBoundingClientRect();
      const visible = isVisible(element, win);
      const offscreen = rect.right < 0 || rect.bottom < 0 || rect.left > viewportWidth || rect.top > viewportHeight;
      const ariaHidden = element.closest?.("[aria-hidden='true']") !== null;
      const inPopup = element.closest?.("[role='dialog'], [role='alertdialog'], [role='menu'], [aria-modal='true']") !== null;
      let covered = false;
      if (visible && !offscreen && rect.width > 0 && rect.height > 0) {
        const samples = [0.2, 0.5, 0.8];
        let hitOwn = false;
        for (const xRatio of samples) {
          for (const yRatio of samples) {
            const x = rect.left + rect.width * xRatio;
            const y = rect.top + rect.height * yRatio;
            if (x < 0 || y < 0 || x > viewportWidth || y > viewportHeight) continue;
            const hit = typeof element.ownerDocument?.elementFromPoint === "function" ? surfaceHitForNode(element,x,y) : null;
            if (hit === element || (hit !== null && element.contains(hit))
              || (hit !== null && hit.contains(element) && isTypedField(element))) {
              hitOwn = true;
              break;
            }
          }
          if (hitOwn) break;
        }
        covered = typeof element.ownerDocument?.elementFromPoint === "function" && !hitOwn;
      }
      return { visible, offscreen, ariaHidden, covered, inPopup };
    };

    const describedByText = (element, doc = document) => String(element.getAttribute?.("aria-describedby") || "")
      .split(/\\s+/)
      .map((value) => value.trim())
      .filter(Boolean)
      .map((id) => doc.getElementById(id))
      .filter((entry) => entry instanceof HTMLElement)
      .map((entry) => normalizeText(entry.innerText || entry.textContent || "", 80))
      .find(Boolean) || "";

    const cssEscape = (value) => {
      if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
        return CSS.escape(String(value));
      }
      return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\\\$&");
    };

    const selectorPreview = (element) => {
      const tagName = String(element.tagName || "div").toLowerCase();
      const parts = [tagName];
      const id = normalizeText(element.id || "", 40);
      if (id) parts.push("#" + id);
      const classes = Array.from(element.classList || [])
        .map((item) => normalizeText(String(item), 24))
        .filter((item) => item.length > 0 && !item.startsWith("__lyra"))
        .slice(0, 2);
      if (classes.length > 0) parts.push(classes.map((item) => "." + item).join(""));
      const name = normalizeText(element.getAttribute?.("name") || "", 24);
      if (name) parts.push("[name=\\"" + name + "\\"]");
      const testId = normalizeText(
        element.getAttribute?.("data-testid") || element.getAttribute?.("data-test-id") || "",
        24
      );
      if (testId) parts.push("[data-testid=\\"" + testId + "\\"]");
      const type = normalizeText(element.getAttribute?.("type") || "", 20);
      if (type) parts.push("[type=\\"" + type + "\\"]");
      const preview = parts.join("");
      return preview.length <= 120 ? preview : preview.slice(0, 117) + "...";
    };

    const buildElementXPath = (element) => {
      if (!(element instanceof Element)) return "";
      const segments = [];
      let current = element;
      while (current instanceof Element) {
        // An ID anchor must retain the descendant path. IDs containing quotes
        // use the absolute path, rather than CSS escaping inside XPath syntax.
        if (current.id && !current.id.includes('"')) {
          segments.unshift('//*[@id="' + current.id + '"]');
          break;
        }
        const tag = current.tagName.toLowerCase();
        const parent = current.parentElement;
        if (parent === null) {
          segments.unshift(tag);
          break;
        }
        const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
        const index = siblings.indexOf(current) + 1;
        segments.unshift(siblings.length > 1 ? tag + "[" + index + "]" : tag);
        current = parent;
      }
      return segments.join("/").startsWith("//*")
        ? segments.join("/")
        : "/" + segments.join("/");
    };

    const stateHint = (element) => {
      const expanded = element.getAttribute?.("aria-expanded");
      if (expanded === "true") return "expanded";
      if (expanded === "false") return "collapsed";
      const selected = element.getAttribute?.("aria-selected");
      if (selected === "true") return "selected";
      if (selected === "false") return "unselected";
      const pressed = element.getAttribute?.("aria-pressed");
      if (pressed === "true") return "pressed";
      if (pressed === "false") return "unpressed";
      return normalizeText(element.getAttribute?.("data-state") || "", 32);
    };

    const expandedState = (element) => {
      if (element.tagName === "SUMMARY" && element.parentElement?.tagName === "DETAILS") return element.parentElement.open;
      const expanded = element.getAttribute?.("aria-expanded");
      if (expanded === "true") return true;
      if (expanded === "false") return false;
      return undefined;
    };

    const isEditable = (element) => {
      const win = element?.ownerDocument?.defaultView || window;
      const role = String(element.getAttribute?.("role") || "").toLowerCase();
      return element instanceof win.HTMLInputElement
        || element instanceof win.HTMLTextAreaElement
        || element instanceof win.HTMLSelectElement
        || isEditingHost(element)
        || role === "textbox"
        || role === "searchbox";
    };

    const isFocusable = (element) => {
      if (isDisabled(element)) return false;
      if (element.getAttribute?.("tabindex") === "-1") return false;
      const win = element?.ownerDocument?.defaultView || window;
      if (element instanceof win.HTMLElement && element.tabIndex >= 0) return true;
      if (element instanceof win.HTMLAnchorElement && element.href) return true;
      if (element instanceof win.HTMLButtonElement) return true;
      if (isEditable(element)) return true;
      const role = element.getAttribute?.("role");
      return role === "button" || role === "link" || role === "checkbox" || role === "menuitem";
    };

    const actionHint = (element, cursor) => {
      const win = element?.ownerDocument?.defaultView || window;
      if (element instanceof win.HTMLSelectElement) return "select";
      if (isEditable(element)) return "type";
      const role = normalizeText(element.getAttribute?.("role") || "", 32);
      const popup = normalizeText(element.getAttribute?.("aria-haspopup") || "", 32);
      if (popup) return "open " + popup;
      if (element instanceof win.HTMLAnchorElement && element.href) return "open";
      if (role === "button" || role === "link" || cursor === "pointer") return "click";
      return "";
    };

    const labelFor = (element) => surfaceNames.label(element) || "(no label)";

    const panelCornerLabel = (element) => {
      const tag = String(element.tagName || "").toLowerCase();
      const role = String(element.getAttribute?.("role") || "").toLowerCase();
      if (tag !== "button" && role !== "button") return "";
      const box = element.getBoundingClientRect();
      if (box.width > 48 || box.height > 48 || box.width < 8 || box.height < 8) return "";
      const view = element.ownerDocument?.defaultView || window;
      let node = element.parentElement;
      while (node instanceof Element && node !== element.ownerDocument?.body) {
        const panel = node.getBoundingClientRect();
        const style = view.getComputedStyle(node);
        const dialog = node.getAttribute("role") === "dialog" || node.getAttribute("aria-modal") === "true";
        const floating = style.position === "fixed" || style.position === "absolute" || dialog;
        const sized = panel.width > box.width + 48
          && panel.height > box.height + 48
          && panel.width < (view.innerWidth || 0) * 0.95
          && panel.height < (view.innerHeight || 0) * 0.95;
        if (floating && sized) {
          const top = Math.abs(box.top - panel.top) <= 28;
          const end = Math.abs(box.right - panel.right) <= 28 || Math.abs(box.left - panel.left) <= 28;
          return top && end ? "icon at the top corner of this panel" : "";
        }
        node = node.parentElement;
      }
      return "";
    };

    const collectLimitedElements = (root, limit, warning) => {
      const ownerDocument = root.ownerDocument || (root.nodeType === 9 ? root : document);
      const win = ownerDocument.defaultView || window;
      const walker = ownerDocument.createTreeWalker(root, win.NodeFilter.SHOW_ELEMENT);
      const elements = [];
      let visited = 0;
      let node = root instanceof win.Element ? root : walker.nextNode();
      while (node) {
        if (node instanceof win.Element) {
          elements.push(node);
        }
        visited += 1;
        if (visited >= limit) {
          warnings.push(warning);
          break;
        }
        node = walker.nextNode();
      }
      return elements;
    };

    const collectInteractiveCandidates = (root, selector, scope, hostChain) => {
      if (!LIGHTWEIGHT_STRATEGY) {
        return Array.from(root.querySelectorAll(selector))
          .map((element) => ({ element, scope, hostChain }));
      }
      const collected = [];
      for (const element of collectLimitedElements(root, MAX_LIGHTWEIGHT_SCAN_NODES, "interactive_scan_limited")) {
        if (element.matches?.(selector)) {
          collected.push({ element, scope, hostChain });
          if (collected.length >= MAX_LIGHTWEIGHT_CANDIDATES) {
            warnings.push("interactive_candidate_limit");
            break;
          }
        }
      }
      return collected;
    };

    const collectShadowHosts = (root) => {
      if (!LIGHTWEIGHT_STRATEGY) {
        return Array.from(root.querySelectorAll("*"));
      }
      return collectLimitedElements(root, MAX_LIGHTWEIGHT_SHADOW_HOSTS, "shadow_host_scan_limited");
    };

    const detectAuthChallengeSignals = (doc, win, frameUrl = "", offsetX = 0, offsetY = 0) => {
      const signals = [];
      const pushSignal = (signal) => {
        if (!signals.some((entry) => entry.kind === signal.kind && entry.label === signal.label && entry.url === signal.url)) {
          signals.push(signal);
        }
      };
      const boundsFor = (element) => {
        try {
          const rect = element.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return undefined;
          return {
            x: Math.round(rect.left + offsetX),
            y: Math.round(rect.top + offsetY),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          };
        } catch (_error) {
          return undefined;
        }
      };
      const identityBoundaryForUrl = (urlText) => {
        try {
          const parsed = new URL(
            urlText || String(win.location.href || frameUrl || "https://invalid.local"),
            String(win.location.href || frameUrl || "https://invalid.local")
          );
          const host = parsed.hostname.toLowerCase();
          const path = parsed.pathname.toLowerCase();
          const provider = host === "accounts.google.com" || host.endsWith(".accounts.google.com")
            ? "google"
            : host === "appleid.apple.com"
              ? "apple"
              : host === "login.microsoftonline.com" || host === "login.live.com"
                ? "microsoft"
                : host === "auth0.com" || host.endsWith(".auth0.com")
                  ? "auth0"
                  : host === "okta.com" || host.endsWith(".okta.com")
                    ? "okta"
                    : undefined;
          const oauthParameters = parsed.searchParams.has("client_id")
            && (
              parsed.searchParams.has("redirect_uri")
              || parsed.searchParams.has("response_type")
              || parsed.searchParams.has("scope")
            );
          const oauthPath = path === "/oauth"
            || path.startsWith("/oauth/")
            || path.startsWith("/o/oauth")
            || path.startsWith("/signin/oauth");
          if (provider !== undefined || oauthParameters || oauthPath) {
            const googleSignInTrigger = provider === "google"
              && (path === "/gsi/button" || path.startsWith("/gsi/button/"));
            const googleIdentityPrompt = provider === "google"
              && (path === "/gsi/iframe/select" || path.startsWith("/gsi/iframe/select/"));
            return {
              label: googleSignInTrigger
                ? "Google sign-in trigger"
                : googleIdentityPrompt
                  ? "Google identity prompt"
                  : provider === undefined
                    ? "OAuth identity boundary"
                    : provider + " identity boundary",
              provider,
              confidence: googleSignInTrigger ? "medium" : "high"
            };
          }
        } catch (_error) {
          return null;
        }
        return null;
      };
      const passwordFields = Array.from(doc.querySelectorAll("input[type='password']"))
        .filter((element) => isVisible(element, win) && !isDisabled(element));
      if (passwordFields.length > 0) {
        const topLevelDocument = IS_MAIN_FRAME && doc === document;
        pushSignal({
          kind: "login_wall",
          confidence: topLevelDocument ? "high" : "medium",
          source: "dom",
          label: "visible password field",
          scope: topLevelDocument ? "main_document" : "frame",
          // A password field is a form the agent can fill, elevate, or ask
          // about. Marking it user_only stole the turn into a forced pause.
          actionability: "automatic",
          reasonCode: "visible_password_field",
          stableObservationCount: 1,
          url: frameUrl
        });
      }
      const oneTimeCodeFields = Array.from(doc.querySelectorAll("input[autocomplete='one-time-code'], input[inputmode='numeric']"))
        .filter((element) => {
          if (!isVisible(element, win) || isDisabled(element)) return false;
          const input = element;
          const maxLength = Number(input.getAttribute?.("maxlength") || NaN);
          return input.getAttribute?.("autocomplete") === "one-time-code"
            || (Number.isFinite(maxLength) && maxLength >= 4 && maxLength <= 8);
        });
      if (oneTimeCodeFields.length > 0) {
        pushSignal({
          kind: "mfa",
          confidence: "high",
          source: "attribute",
          label: "one-time-code input",
          scope: "frame",
          actionability: "user_only",
          reasonCode: "mfa_one_time_code",
          stableObservationCount: 1,
          url: frameUrl
        });
      }
      try {
        const url = new URL(String(win.location.href || frameUrl || "https://invalid.local"));
        const params = url.searchParams;
        if (
          params.has("client_id")
          && (params.has("redirect_uri") || params.has("response_type") || params.has("scope"))
        ) {
          pushSignal({
            kind: "oauth_popup",
            confidence: "high",
            source: "browser",
            label: "oauth authorization parameters",
            scope: "frame",
            actionability: "automatic",
            reasonCode: "oauth_authorization_url",
            stableObservationCount: 1,
            url: String(url.href)
          });
        }
      } catch (_error) {
        // URL parsing is best effort; DOM and frame signals remain authoritative.
      }
      const fileInputs = Array.from(doc.querySelectorAll("input[type='file']"))
        .filter((element) => isVisible(element, win) && !isDisabled(element));
      if (fileInputs.length > 0 || ACTIVE_FILE_CHOOSER_PENDING) {
        if (ACTIVE_FILE_CHOOSER_PENDING && IS_MAIN_FRAME && doc === document) {
          pushSignal({
            kind: "active_file_chooser",
            confidence: "high",
            source: "browser",
            label: "webpage awaiting files; use browser_upload, no system dialog is open",
            scope: "main_document",
            actionability: "automatic",
            reasonCode: "active_file_chooser",
            stableObservationCount: 1,
            url: frameUrl
          });
        } else {
          pushSignal({
            kind: "dormant_file_input",
            confidence: "low",
            source: "attribute",
            label: "dormant page upload control",
            scope: "frame",
            actionability: "informational",
            reasonCode: "dormant_file_input",
            stableObservationCount: 1,
            url: frameUrl
          });
          warnings.push("dormant_file_input_detected");
        }
      }
      const paymentFields = Array.from(doc.querySelectorAll(
        "input[autocomplete='cc-number'], input[autocomplete='cc-csc'], input[autocomplete='cc-exp']"
      )).filter((element) => isVisible(element, win) && !isDisabled(element));
      if (paymentFields.length > 0) {
        pushSignal({
          kind: "payment_auth",
          confidence: "high",
          source: "attribute",
          label: "payment credential field",
          scope: "frame",
          actionability: "user_only",
          reasonCode: "payment_credentials",
          stableObservationCount: 1,
          url: frameUrl
        });
      }
      const downloadLinks = Array.from(doc.querySelectorAll("a[download]"))
        .filter((element) => isVisible(element, win));
      if (downloadLinks.length > 0) {
        pushSignal({
          kind: "download_prompt",
          confidence: "medium",
          source: "attribute",
          label: "download attribute link",
          scope: "frame",
          actionability: "informational",
          reasonCode: "download_link",
          stableObservationCount: 1,
          url: frameUrl
        });
      }
      for (const frame of Array.from(doc.querySelectorAll("iframe, frame"))) {
        const src = normalizeText(frame.getAttribute?.("src") || "", 600);
        if (!src) continue;
        const provider = identityBoundaryForUrl(src);
        if (provider !== null) {
          const bounds = boundsFor(frame);
          pushSignal({
            kind: "oauth_popup",
            confidence: isVisible(frame, win) ? provider.confidence : "medium",
            source: "frame",
            label: provider.label,
            scope: "frame",
            actionability: "automatic",
            reasonCode: "oauth_identity_boundary",
            stableObservationCount: 1,
            provider: provider.provider,
            url: src,
            frameRef: FRAME_REF,
            frameTreeNodeId: FRAME_TREE_NODE_ID,
            ...(bounds === undefined ? {} : { bounds })
          });
        }
        let host = "";
        let challengeUrl = src.toLowerCase();
        try {
          const parsed = new URL(src, String(win.location.href || "https://invalid.local"));
          host = parsed.hostname.toLowerCase();
          challengeUrl = parsed.href.toLowerCase();
        } catch (_error) {
          host = src.toLowerCase();
        }
        if (
          host.includes("recaptcha")
          || host.includes("hcaptcha")
          || host.includes("challenges.cloudflare")
          || host.includes("turnstile")
          || challengeUrl.includes("recaptcha")
          || challengeUrl.includes("hcaptcha")
          || challengeUrl.includes("challenges.cloudflare")
          || challengeUrl.includes("turnstile")
        ) {
          const bounds = boundsFor(frame);
          pushSignal({
            kind: "captcha",
            confidence: "high",
            source: "frame",
            label: host || challengeUrl,
            scope: "frame",
            actionability: "user_only",
            reasonCode: "captcha_interactive",
            stableObservationCount: 1,
            url: src,
            frameRef: FRAME_REF,
            frameTreeNodeId: FRAME_TREE_NODE_ID,
            ...(bounds === undefined ? {} : { bounds })
          });
        }
      }
      return signals;
    };

    const items = [];
    const cursorNotes = [];
    const cursorContextSeen = new WeakSet();
    const itemNodes = [];
    const seen = new Set();
    const authChallengeSignals = [];
    let activeElementId = null;

    const crawl = async (doc, win, offsetX = 0, offsetY = 0, frameUrl = "") => {
      semantics.observeRoot(doc);
      const selector = [
        "a[href]",
        "button",
        "input",
        "select",
        "textarea",
        "summary",
        "label",
        "[contenteditable]",
        "[tabindex]",
        "[onclick]",
        "[draggable='true']",
        "[ondrop]",
        "[ondragover]",
        "[role='button']",
        "[role='link']",
        "[role='checkbox']",
        "[role='textbox']",
        "[role='searchbox']",
        "[role='menuitem']",
        "[role='combobox']",
        "div[role='button']",
        "div[role='combobox']",
        "span[role='button']",
        "span[role='combobox']",
        "input[role='combobox']"
      ].join(",");
      const collectCandidates = (root, scope = "document", hostChain = []) => {
        semantics.observeRoot(root);
        const collected = collectInteractiveCandidates(root, selector, scope, hostChain);
        const descendants = collectShadowHosts(root);
        for (const element of descendants) {
          if (element.shadowRoot) {
            collected.push(...collectCandidates(
              element.shadowRoot,
              "shadow",
              [...hostChain, selectorPreview(element)]
            ));
          } else if (String(element.tagName || "").includes("-") && isVisible(element, win)) {
            warnings.push("closed_shadow_or_custom_element_boundary");
            const rect = element.getBoundingClientRect();
            blockedRegions.push({
              id: "closed-shadow-" + selectorPreview(element),
              kind: "closed-shadow",
              frameRef: FRAME_REF,
              frameTreeNodeId: FRAME_TREE_NODE_ID,
              bounds: {
                x: Math.round(rect.left + offsetX),
                y: Math.round(rect.top + offsetY),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
              },
              reason: "custom element has no open shadowRoot; closed shadow DOM may require visual or user fallback",
              fallback: "visual",
              confidence: "low"
            });
          }
        }
        return collected;
      };
      const cursorKeyword = element => cursorSemantics.read(element)?.keyword || "auto";
      const REAL_CONTROL_SELECTOR = "button, a[href], input:not([type='hidden']), select, textarea, summary, label, [contenteditable='true'], [contenteditable=''], [contenteditable='plaintext-only']";
      const ROLE_CONTROL_SELECTOR = "[role='button'], [role='link'], [role='textbox'], [role='searchbox'], [role='checkbox'], [role='radio'], [role='switch'], [role='tab'], [role='menuitem'], [role='combobox'], [role='option'], [role='menuitemcheckbox'], [role='menuitemradio'], [role='treeitem'], [role='slider'], [role='spinbutton'], [aria-pressed], [aria-checked], [aria-expanded], [aria-haspopup]";
      const DRAG_CONTROL_SELECTOR = "[draggable='true'], [ondrop], [ondragover]";
      const CONTROL_SELECTOR = REAL_CONTROL_SELECTOR + ", " + ROLE_CONTROL_SELECTOR + ", " + DRAG_CONTROL_SELECTOR;
      const isNativeControl = (element) =>
        element.matches?.(CONTROL_SELECTOR) === true
        || isEditingHost(element);
      const isDeclaredControl = element => isNativeControl(element)
        || (element.hasAttribute?.("tabindex") && element.getAttribute("tabindex") !== "-1")
        || element.hasAttribute?.("onclick") || typeof element.onclick === "function"
        || typeof element.ondrop === "function" || typeof element.ondragover === "function";
      const addCursorContext = (element, cursor) => {
        if (!cursor || cursorContextSeen.has(element)) return;
        if ((cursor.keyword === "auto" || cursor.keyword === "default") && !cursor.customImage) return;
        cursorContextSeen.add(element);
        if (cursorNotes.length >= 16) { if (!warnings.includes("cursor_context_limited")) warnings.push("cursor_context_limited"); return; }
        cursorNotes.push(semantics.cursorNote(element, cursorSemantics.describe(cursor), element === doc.body || element === doc.documentElement));
      };
      const keepSurfaceControl = (element) => {
        return isDeclaredControl(element) || cursorSemantics.discover(cursorSemantics.read(element));
      };
      const muchTaller = (outer, inner) => {
        const outerBox = outer.getBoundingClientRect();
        const innerBox = inner.getBoundingClientRect();
        return outerBox.height > innerBox.height * 1.6 && outerBox.height > innerBox.height + 24;
      };
      const isSurfaceControl = (element) => {
        const tabIndex = element.getAttribute?.("tabindex");
        return keepSurfaceControl(element)
          || (tabIndex !== null && tabIndex !== "-1")
          || element.matches?.(CONTROL_SELECTOR) === true;
      };
      const controlRoot = (hit) => {
        if (hit.matches?.(DRAG_CONTROL_SELECTOR) || typeof hit.ondrop === "function" || typeof hit.ondragover === "function") return hit;
        const graphic = new Set(["path", "g", "circle", "rect", "line", "polyline", "polygon", "use", "tspan"]);
        let start = hit;
        while (start.parentElement && graphic.has(String(start.tagName || "").toLowerCase())) {
          start = start.parentElement;
        }
        const editor = editingHost(start);
        if (editor && editor !== start && !isDeclaredControl(start)) {
          const control = start.closest?.(CONTROL_SELECTOR + ", [tabindex]:not([tabindex='-1']), [onclick]");
          if (control && control !== editor && editor.contains(control)) return control;
          // Preserve a separately styled handle; inherited text cursors and
          // formatting nodes belong to the editor, regardless of their size.
          if (cursorKeyword(start) === cursorKeyword(editor)
            || !cursorSemantics.discover(cursorSemantics.read(start))) return editor;
        }
        const real = start.closest?.(REAL_CONTROL_SELECTOR);
        // A differently styled resize/drag handle is distinct from its enclosing
        // clickable control even when both inherit the same event listener.
        const cursorOwner = real && real !== start ? real : start.parentElement;
        if (cursorOwner && cursorKeyword(start) !== cursorKeyword(cursorOwner)
          && cursorSemantics.discover(cursorSemantics.read(start)) && cursorKeyword(start) !== "pointer") return start;
        if (real && real !== start && real.tagName === "BUTTON" && start.matches?.(CONTROL_SELECTOR) !== true) return real;
        if (real && real !== start && !muchTaller(real, start) && !distinctSmallControl(start)) return real;
        const role = start.closest?.(ROLE_CONTROL_SELECTOR);
        if (role && role !== start && !muchTaller(role, start) && !distinctSmallControl(start)) return role;
        // CSS cursor is inherited. Collapse a graphic/text child onto its tight
        // cursor owner; keep distinct row-end controls and semantic children.
        if (start.matches?.(CONTROL_SELECTOR) !== true && !start.hasAttribute?.("tabindex")) {
          let owner = start;
          for (let parent = owner.parentElement; parent && parent !== doc.body; parent = owner.parentElement) {
            if (cursorKeyword(parent) !== cursorKeyword(owner)) break;
            const a = owner.getBoundingClientRect(), b = parent.getBoundingClientRect();
            if (b.width > a.width + 24 || b.height > a.height + 24) {
              // A leading graphic inherits its labelled, compact control's
              // cursor. Keep separately declared controls and trailing actions.
              if (!distinctSmallControl(start) && b.height <= 48 && b.width <= 360 && surfaceNames.label(parent)) owner = parent;
              break;
            }
            owner = parent;
            if (owner.matches?.(CONTROL_SELECTOR)) break;
          }
          return owner;
        }
        return start;
      };
      const distinctSmallControl = (element) => {
        const tag = String(element.tagName || "").toLowerCase();
        if (tag === "path" || tag === "g" || tag === "circle" || tag === "rect" || tag === "line" || tag === "polyline" || tag === "polygon" || tag === "use" || tag === "tspan") return false;
        const box = element.getBoundingClientRect();
        if (box.width > 48 || box.height > 48 || box.width < 8 || box.height < 8) return false;
        let wide = false;
        let trailing = false;
        let ancestor = element.parentElement;
        while (ancestor) {
          const ancestorBox = ancestor.getBoundingClientRect();
          if (ancestorBox.width > box.width * 2 && ancestorBox.width > box.width + 24) {
            wide = true;
            trailing = box.x + box.width >= ancestorBox.x + ancestorBox.width - 48;
            break;
          }
          ancestor = ancestor.parentElement;
        }
        if (!wide) return false;
        if (element.style?.cursor || (ancestor && !surfaceNames.label(ancestor))) return isSurfaceControl(element);
        // Inherited pointer cursors do not make a leading decorative icon a
        // second control. Explicit controls and trailing row actions stay distinct.
        if (element.matches?.(CONTROL_SELECTOR) || element.hasAttribute?.("tabindex") || hoverPlacedControl(element, win)) return true;
        if (trailing && isSurfaceControl(element)) return true;
        const role = String(element.getAttribute?.("role") || "").toLowerCase();
        return trailing && (tag === "svg" || tag === "button" || role === "button");
      };
      const collectSurfaceCandidates = async () => {
        const roots = [];
        const seenRoots = new Set();
        const surfaceRoots = new Map();
        const tightToggle = (element) => {
          // A choice's label is an independent hit target, not an enclosing
          // toggle to infer from a parent's theme or active class.
          if (semantics.choices.inputOf(element)) return element;
          let node = element;
          const box = element.getBoundingClientRect();
          let parent = element.parentElement;
          while (parent && parent !== doc.body && parent !== doc.documentElement) {
            if (cursorKeyword(parent) !== cursorKeyword(node) && cursorSemantics.discover(cursorSemantics.read(node)) && cursorKeyword(node) !== "pointer") break;
            const parentBox = parent.getBoundingClientRect();
            if (parentBox.width > box.width + 80 || parentBox.height > box.height + 28) break;
            const pressed = parent.getAttribute?.("aria-pressed");
            const checked = parent.getAttribute?.("aria-checked");
            const role = String(parent.getAttribute?.("role") || "").toLowerCase();
            const data = String(parent.getAttribute?.("data-state") || "").toLowerCase();
            const tokens = String(parent.className || "").toLowerCase().split(/\s+/);
            const classOn = tokens.some((token) => token === "active" || token === "selected" || token === "on" || token.endsWith("-active") || token.endsWith("--on"));
            if (pressed === "true" || pressed === "false" || checked === "true" || checked === "false" || role === "switch" || role === "button" || data === "on" || data === "off" || data === "checked" || data === "unchecked" || classOn) node = parent;
            parent = parent.parentElement;
          }
          return node;
        };
        const pushRoot = async (element, follow) => {
          if (!(element instanceof win.Element) || seenRoots.has(element)) return;
          const native = element.matches?.(REAL_CONTROL_SELECTOR) === true;
          const picked = native ? element : controlRoot(element);
          const root = picked instanceof win.Element ? tightToggle(picked) : picked;
          if (!(root instanceof win.Element) || seenRoots.has(root)) return;
          if (!isSurfaceControl(root) && !distinctSmallControl(root)) return;
          seenRoots.add(root);
          const context = surfaceRoots.get(root.getRootNode()) || { scope: "document", hostChain: [] };
          roots.push({ element: root, ...context });

        };
        if (STRATEGY === "interactiveOnly") {
          const width = win.innerWidth || 0;
          const height = win.innerHeight || 0;
          const inView = (rect) => rect.width > 0 && rect.height > 0
            && rect.bottom > 0 && rect.right > 0
            && rect.top < height && rect.left < width;
          const visibleSelector = CONTROL_SELECTOR + ", [tabindex]:not([tabindex='-1']), [onclick]";
          const visitSelector = async (root, scope = "document", hostChain = []) => {
            if (surfaceRoots.has(root)) return;
            surfaceRoots.set(root, { scope, hostChain });
            semantics.observeRoot(root);
            for (const element of root.querySelectorAll?.(visibleSelector) ?? []) {
              if (isVisible(element, win)) await pushRoot(element, FOLLOW_CURSOR);
            }
            for (const host of collectShadowHosts(root)) {
              if (host.shadowRoot) await visitSelector(host.shadowRoot, "shadow", [...hostChain, selectorPreview(host)]);
            }
          };
          await visitSelector(doc);
          for (const weak of win.__lyraKnownShadowRoots ?? []) {
            const root = weak.deref();
            if (root?.host?.isConnected) await visitSelector(root, "shadow", [selectorPreview(root.host)]);
          }
          const focusSelector = "a[href], button, input:not([type='hidden']), select, textarea, summary, [contenteditable='true'], [contenteditable=''], [contenteditable='plaintext-only'], [tabindex]:not([tabindex='-1'])";
          const positive = [];
          const rest = [];
          const visitFocus = (root) => {
            for (const element of root.querySelectorAll?.(focusSelector) ?? []) {
              if (element.disabled === true) continue;
              if (!isVisible(element, win)) continue;
              const index = Number(element.tabIndex || 0);
              if (index > 0) positive.push(element);
              else rest.push(element);
            }
            for (const host of collectShadowHosts(root)) {
              if (host.shadowRoot) visitFocus(host.shadowRoot);
            }
          };
          visitFocus(doc);
          positive.sort((left, right) => left.tabIndex - right.tabIndex);
          let focusAdded = 0;
          for (const element of [...positive, ...rest]) {
            if (focusAdded >= 48) break;
            const before = roots.length;
            await pushRoot(element, FOLLOW_CURSOR);
            if (roots.length > before) focusAdded += 1;
          }
          let cursorScanRemaining = MAX_LIGHTWEIGHT_SCAN_NODES;
          for (const scanRoot of surfaceRoots.keys()) {
            if (cursorScanRemaining <= 0) break;
            const scanned = collectLimitedElements(scanRoot.nodeType === 9 ? scanRoot.body || scanRoot.documentElement : scanRoot, cursorScanRemaining, "cursor_scan_limited");
            cursorScanRemaining -= scanned.length;
            for (const element of scanned) {
              if (!(element instanceof win.Element) || element.matches?.(visibleSelector) === true) continue;
              if (isDeclaredControl(element)) {
                if (inView(element.getBoundingClientRect()) && isVisible(element, win)) await pushRoot(element, false);
                continue;
              }
              const cursor = cursorSemantics.read(element);
              if (!cursor) continue;
              if (element === doc.body || element === doc.documentElement) continue;
              if (cursor.sameAsParent && !distinctSmallControl(element)) continue;
              if (!inView(element.getBoundingClientRect()) || !isVisible(element, win)) continue;
              if (!cursorSemantics.discover(cursor)) { addCursorContext(element, cursor); continue; }
              if (element.querySelector?.(CONTROL_SELECTOR) && ["text", "vertical-text"].includes(cursor.keyword)) continue;
              await pushRoot(element, false);
            }
          }
          let hoverAdded = 0;
          for (const element of collectLimitedElements(doc.body || doc.documentElement, MAX_LIGHTWEIGHT_SCAN_NODES, "hover_control_scan_limited")) {
            if (hoverAdded >= 40 || !(element instanceof win.Element)) continue;
            if (!hoverPlacedControl(element, win)) continue;
            pushRoot(element, false);
            hoverAdded += 1;
          }
          // Native/ARIA targets from every visited DOM root are indexed above,
          // including offscreen nodes. Only presentation is viewport-prioritized.
          return roots;
        }
        return null;
      };
      for (const element of [doc.documentElement, doc.body].filter(Boolean)) {
        const cursor = cursorSemantics.read(element);
        if (element === doc.body && cursor?.sameAsParent) continue;
        addCursorContext(element, cursor);
      }
      const surfaceCandidates = await collectSurfaceCandidates();
      const candidates = surfaceCandidates ?? collectCandidates(doc, "document");
      const pointerStyledCandidates = [];
      if (surfaceCandidates === null && LIGHTWEIGHT_STRATEGY) {
        for (const element of collectLimitedElements(doc, MAX_LIGHTWEIGHT_SCAN_NODES, "pointer_scan_limited")) {
          if (!(element instanceof win.Element) || element.matches?.(selector)) {
            continue;
          }
          const tagName = String(element.tagName || "").toLowerCase();
          if (tagName !== "div" && tagName !== "span") {
            continue;
          }
          const style = win.getComputedStyle(element);
          if (!cursorSemantics.discover(cursorSemantics.parse(style.cursor))) {
            continue;
          }
          pointerStyledCandidates.push({ element, scope: "document", hostChain: [] });
          if (pointerStyledCandidates.length >= 48) {
            warnings.push("pointer_candidate_limit");
            break;
          }
        }
      }

      const allCandidates = [...candidates, ...pointerStyledCandidates];
      const candidateNodes = new Set(allCandidates.map(candidate => candidate.element));
      const representedByLabel = (element, visibility) => {
        if (!semantics.choices.isChoice(element) || !visibility.covered || visibility.offscreen) return false;
        const labels = semantics.choices.labelsFor(element).filter(label => candidateNodes.has(label)
          && (() => { const state = visibilityState(label, win); return state.visible && !state.covered && !state.offscreen; })());
        if (!labels.length) return false;
        const box = element.getBoundingClientRect();
        // Remove only a duplicate, covered native representation. Every sampled
        // obstruction must be its own mapped label; external overlays stay blocked.
        return [0.2, 0.5, 0.8].every(x => [0.2, 0.5, 0.8].every(y => {
          const hit = surfaceHitForNode(element, box.left + box.width * x, box.top + box.height * y);
          return hit && labels.some(label => label === hit || label.contains(hit));
        }));
      };
      for (const candidate of allCandidates) {
        const { element, scope, hostChain } = candidate;
        if (!(element instanceof win.Element) || seen.has(element)) continue;
        seen.add(element);
        const visibility = visibilityState(element, win);
        if (representedByLabel(element, visibility)) continue;
        const hoverOnly = !visibility.visible && hoverPlacedControl(element, win);
        if (!visibility.visible && !hoverOnly && !isFileInputElement(element, win)) continue;
        if (element instanceof win.HTMLInputElement && element.type === "hidden") continue;
        const focusable = isFocusable(element);
        if (STRATEGY === "focus" && !focusable) continue;
        const rect = element.getBoundingClientRect();
        const style = win.getComputedStyle(element);
        const cursor = cursorSemantics.read(element);
        const editable = isEditable(element);
        const tabIndex = element instanceof win.HTMLElement ? element.tabIndex : -1;
        const id = items.length + 1;
        if (element === semantics.focusIn(doc)) activeElementId = id;
        const controlSemantics = semantics.control(element);
        const hostChainFingerprint = hostChain.length > 0
          ? hostChain.join(">")
          : "";
        const tagName = String(element.tagName || "div").toLowerCase();
        const ownerForm = "form" in element && element.form instanceof win.HTMLFormElement
          ? element.form
          : element.closest?.("form");
        // A field belonging to a form is not itself a submission action.
        // formAction feeds the activation guard, so only publish it on submitters.
        const submitsForm = ownerForm && (
          element instanceof win.HTMLButtonElement && element.type === "submit"
          || element instanceof win.HTMLInputElement && ["submit", "image"].includes(element.type)
        );
        const formAction = submitsForm ? normalizeText(
          element.hasAttribute("formaction") ? element.formAction : ownerForm.action, 600
        ) : "";
        const formMethod = normalizeText(ownerForm?.method || "", 16).toLowerCase();
        const href = element instanceof win.HTMLAnchorElement ? element.href : "";
        const autocompleteTokens = normalizeText(element.getAttribute?.("autocomplete") || "", 200)
          .toLowerCase()
          .split(/\s+/u)
          .filter(Boolean);
        const controlKind = tagName === "button"
          ? "button"
          : tagName === "a"
            ? "link"
            : tagName === "input"
              ? "input"
              : tagName === "select"
                ? "select"
                : tagName === "textarea"
                  ? "textarea"
                  : editable
                    ? "editable"
                    : "other";
        items.push({
          id,
          frameTreeNodeId: FRAME_TREE_NODE_ID,
          frameRef: FRAME_REF,
          tagName,
          role: normalizeText(element.getAttribute?.("role") || (tagName === "label" ? semantics.choices.inputOf(element)?.type : "") || tagName, 40),
          label: labelFor(element, doc),
          cursor,
          cursorOnly: !isDeclaredControl(element),
          actionHint: actionHint(element, cursor?.customImage ? "" : cursor?.keyword || ""),
          stateHint: stateHint(element),
          semantics: {
            ...controlSemantics,
            ...(panelCornerLabel(element) && !surfaceNames.label(element)
              ? { context: [...(controlSemantics.context || []), panelCornerLabel(element)] } : {})
          },
          tooltipProbe: surfaceNames.cached(element) ? (surfaceNames.cached(element).text ? "found" : "empty") : undefined,
          tooltipText: normalizeText(element.getAttribute?.("title") || describedByText(element, doc) || surfaceNames.tooltip(element) || surfaceNames.cached(element)?.text, 160),
          sensitiveValue: (${sensitiveFieldRuntime})(element),
          textSnippet: normalizeText(
            element instanceof win.HTMLSelectElement
              ? (element.selectedOptions?.[0]?.textContent || element.value || "")
              : element instanceof win.HTMLInputElement || element instanceof win.HTMLTextAreaElement
                ? element.value || ""
                : element.innerText || element.textContent || "",
            80
          ),
          formGroup: "",
          existingRef: (() => {
            // Stamp the node we collected, not a later hit test at its center.
            // Keep identity across layout changes; replacement nodes get new refs.
            let ref = surfaceRegistry.nodes.get(element);
            if (!ref) {
              ref = "lumen:s" + surfaceRegistry.prefix + (++surfaceRegistry.serial).toString(36);
              surfaceRegistry.nodes.set(element, ref);
            }
            surfaceRegistry.byRef.set(ref, new WeakRef(element));
            if (element.getAttribute("data-lyra-surface") !== ref) element.setAttribute("data-lyra-surface", ref);
            return ref;
          })(),
          selectorPreview: selectorPreview(element),
          xpath: buildElementXPath(element),
          bounds: {
            x: Math.round(rect.left + offsetX),
            y: Math.round(rect.top + offsetY),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          },
          localBounds: {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          },
          frameBounds: FRAME_BOUNDS,
          visibility,
          hoverOnly,
          checked: typeof controlSemantics.checked === "boolean" ? controlSemantics.checked : undefined,
          expanded: expandedState(element),
          focusable,
          tabIndex,
          disabled: isDisabled(element) || (semantics.choices.inputOf(element) ? isDisabled(semantics.choices.inputOf(element)) : false),
          editable,
          href,
          inputType: element instanceof win.HTMLInputElement ? normalizeText(element.type || "", 32) : "",
          autocompleteTokens,
          formAction,
          formMethod,
          destinationUrl: href || formAction,
          secure: (() => {
            try {
              return new URL(frameUrl || String(win.location.href || "")).protocol === "https:";
            } catch (_error) {
              return false;
            }
          })(),
          controlKind,
          frameUrl,
          discoveryScope: scope,
          hostChain,
          hostChainFingerprint
        });
        itemNodes.push(element);
      }

      authChallengeSignals.push(...detectAuthChallengeSignals(doc, win, frameUrl, offsetX, offsetY));

      if (!INCLUDE_CHILD_FRAMES) {
        return;
      }
      for (const frame of Array.from(doc.querySelectorAll("iframe, frame"))) {
        try {
          if (!isVisible(frame, win)) continue;
          const childDoc = frame.contentDocument || frame.contentWindow?.document;
          const childWin = frame.contentWindow;
          if (!childDoc || !childWin) continue;
          const frameRect = frame.getBoundingClientRect();
          await crawl(
            childDoc,
            childWin,
            offsetX + frameRect.left,
            offsetY + frameRect.top,
            normalizeText(String(childWin.location?.href || ""), 400)
          );
        } catch (_error) {
          warnings.push("cross_origin_frame_skipped");
        }
      }
    };

    await crawl(
      document,
      window,
      Number(FRAME_BOUNDS.x) || 0,
      Number(FRAME_BOUNDS.y) || 0,
      normalizeText(String(window.location.href || ""), 400)
    );

    const groupTokens = new WeakMap();
    const mappedNodes = new Map(itemNodes.map((node, index) => [node, items[index].existingRef]));
    for (let index = 0; index < items.length; index += 1) {
      const refs = [];
      let ancestor = itemNodes[index]?.parentElement || itemNodes[index]?.getRootNode()?.host;
      while (ancestor) {
        const ref = mappedNodes.get(ancestor);
        if (ref) refs.push(ref);
        ancestor = ancestor.parentElement || ancestor.getRootNode()?.host;
      }
      items[index].ancestorTargetRefs = refs;
    }
    let groupSerial = 0;
    const tokenFor = (node) => {
      const existing = groupTokens.get(node);
      if (existing !== undefined) return existing;
      groupSerial += 1;
      const token = "group:" + groupSerial;
      groupTokens.set(node, token);
      return token;
    };
    const isValueField = (element) => {
      const tag = String(element.tagName || "").toLowerCase();
      if (tag === "textarea" || tag === "select") return true;
      if (tag === "input") {
        const type = String(element.type || "").toLowerCase();
        return type !== "hidden" && type !== "button" && type !== "submit" && type !== "reset" && type !== "file";
      }
      return String(element.getAttribute?.("contenteditable") || "").toLowerCase() === "true";
    };
    for (let index = 0; index < items.length; index += 1) {
      const node = itemNodes[index];
      const form = node?.form instanceof HTMLFormElement ? node.form : node?.closest?.("form");
      if (form instanceof Element) items[index].formGroup = tokenFor(form);
    }
    for (let index = 0; index < items.length; index += 1) {
      if (items[index].disabled !== true || items[index].formGroup) continue;
      let ancestor = itemNodes[index]?.parentElement ?? null;
      while (ancestor instanceof Element) {
        const fields = [];
        for (let fieldIndex = 0; fieldIndex < itemNodes.length; fieldIndex += 1) {
          const field = itemNodes[fieldIndex];
          if (field !== itemNodes[index] && ancestor.contains(field) && isValueField(field)) fields.push(fieldIndex);
        }
        if (fields.length > 0) {
          const token = tokenFor(ancestor);
          items[index].formGroup = token;
          for (const fieldIndex of fields) {
            if (!items[fieldIndex].formGroup) items[fieldIndex].formGroup = token;
          }
          break;
        }
        ancestor = ancestor.parentElement;
      }
    }

    for (const node of itemNodes) {
      if (node instanceof Element) node.setAttribute("data-lyra-collected", "1");
    }

    const focusOrder = items
      .filter((item) => item.focusable)
      .slice()
      .sort((a, b) => {
        const aTab = a.tabIndex > 0 ? a.tabIndex : Number.MAX_SAFE_INTEGER;
        const bTab = b.tabIndex > 0 ? b.tabIndex : Number.MAX_SAFE_INTEGER;
        if (aTab !== bTab) return aTab - bTab;
        return a.id - b.id;
      })
      .map((item) => item.id);

    return {
      title: normalizeText(document.title || "", 200),
      url: normalizeText(String(window.location.href || ""), 600),
      elements: items,
      focusOrder,
      activeElementId,
      pageNotes: [...semantics.pageNotes(), ...cursorNotes],
      authChallengeSignals,
      blockedRegions,
      warnings
    };
  })()
`;


export {
  boundsFromCdpBoxModel,
  buildBrowserAgentObservationScript,
  readAxValueText
};
