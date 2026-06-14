import type { WorkbenchBrowserAgentObserveStrategy, WorkbenchBrowserFrameGlobalBounds } from "../types";
import { coerceFrameBounds } from "./normalizers";

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
  includeChildFrames
}: {
  readonly frameTreeNodeId: number;
  readonly frameRef: string;
  readonly frameBounds: WorkbenchBrowserFrameGlobalBounds;
  readonly strategy: WorkbenchBrowserAgentObserveStrategy;
  readonly includeChildFrames: boolean;
}): string => `
  (() => {
    const FRAME_TREE_NODE_ID = ${JSON.stringify(frameTreeNodeId)};
    const FRAME_REF = ${JSON.stringify(frameRef)};
    const FRAME_BOUNDS = ${JSON.stringify(frameBounds)};
    const STRATEGY = ${JSON.stringify(strategy)};
    const INCLUDE_CHILD_FRAMES = ${JSON.stringify(includeChildFrames)};
    const LIGHTWEIGHT_STRATEGY = STRATEGY === "interactiveOnly" || STRATEGY === "picker" || STRATEGY === "focus";
    const MAX_LIGHTWEIGHT_SCAN_NODES = 3000;
    const MAX_LIGHTWEIGHT_CANDIDATES = 220;
    const MAX_LIGHTWEIGHT_SHADOW_HOSTS = 180;
    const warnings = [];
    const blockedRegions = [];

    const normalizeText = (value, maxLength = 160) => {
      if (typeof value !== "string") return "";
      const normalized = value.replace(/\\s+/g, " ").trim();
      return normalized.length <= maxLength ? normalized : normalized.slice(0, maxLength - 3) + "...";
    };

    const isDisabled = (element) =>
      element.disabled === true
      || element.getAttribute?.("disabled") !== null
      || element.getAttribute?.("aria-disabled") === "true";

    const isVisible = (element, win = window) => {
      const ElementCtor = win.Element || Element;
      if (!(element instanceof ElementCtor) || !element.isConnected) return false;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = win.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return false;
      if (Number.parseFloat(style.opacity || "1") <= 0) return false;
      return true;
    };

    const visibilityState = (element, win = window) => {
      const viewportWidth = win.innerWidth || element.ownerDocument?.documentElement?.clientWidth || 0;
      const viewportHeight = win.innerHeight || element.ownerDocument?.documentElement?.clientHeight || 0;
      const rect = element.getBoundingClientRect();
      const visible = isVisible(element, win);
      const offscreen = rect.right < 0 || rect.bottom < 0 || rect.left > viewportWidth || rect.top > viewportHeight;
      const ariaHidden = element.closest?.("[aria-hidden='true']") !== null;
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      let covered = false;
      if (visible && !offscreen && centerX >= 0 && centerY >= 0 && centerX <= viewportWidth && centerY <= viewportHeight) {
        const hit = element.ownerDocument?.elementFromPoint?.(centerX, centerY) ?? null;
        covered = hit !== null && hit !== element && !element.contains(hit) && !hit.contains(element);
      }
      return { visible, offscreen, ariaHidden, covered };
    };

    const associatedLabel = (element, doc = document) => {
      if (element.id) {
        const label = doc.querySelector("label[for=" + JSON.stringify(element.id) + "]");
        if (label) return label.innerText || label.textContent || "";
      }
      let parent = element.parentElement;
      while (parent) {
        if (parent.tagName === "LABEL") return parent.innerText || parent.textContent || "";
        parent = parent.parentElement;
      }
      return "";
    };

    const describedByText = (element, doc = document) => String(element.getAttribute?.("aria-describedby") || "")
      .split(/\\s+/)
      .map((value) => value.trim())
      .filter(Boolean)
      .map((id) => doc.getElementById(id))
      .filter((entry) => entry instanceof HTMLElement)
      .map((entry) => normalizeText(entry.innerText || entry.textContent || "", 80))
      .find(Boolean) || "";

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

    const checkedState = (element) => {
      const checked = element.getAttribute?.("aria-checked");
      if (checked === "true") return true;
      if (checked === "false") return false;
      return element.checked === true ? true : undefined;
    };

    const expandedState = (element) => {
      const expanded = element.getAttribute?.("aria-expanded");
      if (expanded === "true") return true;
      if (expanded === "false") return false;
      return undefined;
    };

    const isEditable = (element) => {
      const win = element?.ownerDocument?.defaultView || window;
      const contentEditable = String(element.getAttribute?.("contenteditable") || "").toLowerCase();
      const role = String(element.getAttribute?.("role") || "").toLowerCase();
      return element instanceof win.HTMLInputElement
        || element instanceof win.HTMLTextAreaElement
        || element instanceof win.HTMLSelectElement
        || (element instanceof win.HTMLElement && element.isContentEditable)
        || (contentEditable.length > 0 && contentEditable !== "false")
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

    const labelFor = (element, doc = document) => {
      const label = normalizeText(
        element.getAttribute?.("aria-label")
          || element.getAttribute?.("placeholder")
          || element.getAttribute?.("title")
          || element.getAttribute?.("alt")
          || associatedLabel(element, doc)
          || element.innerText
          || element.textContent
          || element.value
          || "",
        120
      );
      return label || "(no label)";
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
      const identityProviderDetailsFor = (urlText, labelText = "") => {
        const combined = normalizeText([urlText, labelText].filter(Boolean).join(" "), 1000).toLowerCase();
        let host = "";
        let path = "";
        try {
          const parsed = new URL(urlText || String(win.location.href || frameUrl || "https://invalid.local"), String(win.location.href || frameUrl || "https://invalid.local"));
          host = parsed.hostname.toLowerCase();
          path = parsed.pathname.toLowerCase();
        } catch (_error) {
          host = combined;
        }
        const accountBoundaryText = combined.includes("continue as ")
          || combined.includes("choose an account")
          || combined.includes("select an account")
          || combined.includes("authorize")
          || combined.includes("consent")
          || combined.includes("allow ")
          || combined.includes("以 ")
          || combined.includes("的身份继续")
          || combined.includes("授权")
          || combined.includes("允许");
        const googleHost = host.includes("accounts.google.com") || host.includes("googleusercontent.com");
        const googleTrigger = path.includes("/gsi/button")
          || combined.includes("sign in with google")
          || combined.includes("continue with google")
          || combined.includes("使用 google")
          || combined.includes("使用google")
          || combined.includes("google 登录");
        const googleBoundary = path.includes("/gsi/iframe/select")
          || path.includes("/gsi/iframe/confirm")
          || path.includes("/gsi/iframe/consent")
          || path.includes("/o/oauth")
          || path.includes("/signin/oauth")
          || combined.includes("google one tap")
          || combined.includes("fedcm")
          || (accountBoundaryText && (googleHost || combined.includes("google")));
        if (googleBoundary) {
          return { label: "Google identity prompt", boundary: true };
        }
        if (googleTrigger || googleHost) {
          return { label: "Google sign-in trigger", boundary: false };
        }
        const appleTrigger = combined.includes("sign in with apple") || combined.includes("continue with apple");
        const appleBoundary = host.includes("appleid.apple.com") && (!appleTrigger || accountBoundaryText);
        if (appleBoundary) {
          return { label: "Apple identity prompt", boundary: true };
        }
        if (appleTrigger) {
          return { label: "Apple sign-in trigger", boundary: false };
        }
        const microsoftTrigger = combined.includes("sign in with microsoft") || combined.includes("continue with microsoft");
        const microsoftBoundary = (
          host.includes("login.microsoftonline.com")
          || host.includes("login.live.com")
        ) && (!microsoftTrigger || accountBoundaryText);
        if (microsoftBoundary) {
          return { label: "Microsoft identity prompt", boundary: true };
        }
        if (microsoftTrigger) {
          return { label: "Microsoft sign-in trigger", boundary: false };
        }
        if (host.includes("okta.com") || host.includes("auth0.com") || combined.includes("openid") || combined.includes("oauth")) {
          return { label: "OAuth identity prompt", boundary: true };
        }
        return null;
      };
      const passwordFields = Array.from(doc.querySelectorAll("input[type='password']"))
        .filter((element) => isVisible(element, win) && !isDisabled(element));
      if (passwordFields.length > 0) {
        pushSignal({
          kind: "login_wall",
          confidence: "medium",
          source: "dom",
          label: "visible password field",
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
            url: String(url.href)
          });
        }
      } catch (_error) {
        // URL parsing is best effort; DOM and frame signals remain authoritative.
      }
      const fileInputs = Array.from(doc.querySelectorAll("input[type='file']"))
        .filter((element) => isVisible(element, win) && !isDisabled(element));
      if (fileInputs.length > 0) {
        pushSignal({
          kind: "permission_prompt",
          confidence: "medium",
          source: "attribute",
          label: "visible file chooser",
          url: frameUrl
        });
      }
      const paymentFields = Array.from(doc.querySelectorAll(
        "input[autocomplete='cc-number'], input[autocomplete='cc-csc'], input[autocomplete='cc-exp'], iframe[src*='stripe'], iframe[src*='paypal']"
      )).filter((element) => isVisible(element, win) && !isDisabled(element));
      if (paymentFields.length > 0) {
        pushSignal({
          kind: "payment_auth",
          confidence: "high",
          source: "attribute",
          label: "payment credential field",
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
          url: frameUrl
        });
      }
      for (const element of Array.from(doc.querySelectorAll("button, a[href], [role='button'], [role='link']"))) {
        if (!isVisible(element, win) || isDisabled(element)) continue;
        const label = normalizeText([
          element.getAttribute?.("aria-label") || "",
          element.getAttribute?.("title") || "",
          element.textContent || ""
        ].join(" "), 200);
        const provider = identityProviderDetailsFor("", label);
        if (provider !== null) {
          const bounds = boundsFor(element);
          pushSignal({
            kind: "oauth_popup",
            confidence: provider.boundary ? "high" : "medium",
            source: "dom",
            label: provider.boundary ? provider.label : provider.label + " trigger",
            url: frameUrl,
            frameRef: FRAME_REF,
            frameTreeNodeId: FRAME_TREE_NODE_ID,
            ...(bounds === undefined ? {} : { bounds })
          });
        }
      }
      for (const frame of Array.from(doc.querySelectorAll("iframe, frame"))) {
        const src = normalizeText(frame.getAttribute?.("src") || "", 600);
        if (!src) continue;
        const frameLabel = normalizeText([
          frame.getAttribute?.("title") || "",
          frame.getAttribute?.("aria-label") || "",
          frame.getAttribute?.("name") || ""
        ].join(" "), 200);
        const provider = identityProviderDetailsFor(src, frameLabel);
        if (provider !== null) {
          const bounds = boundsFor(frame);
          pushSignal({
            kind: "oauth_popup",
            confidence: provider.boundary && isVisible(frame, win) ? "high" : "medium",
            source: "frame",
            label: provider.label,
            url: src,
            frameRef: FRAME_REF,
            frameTreeNodeId: FRAME_TREE_NODE_ID,
            ...(bounds === undefined ? {} : { bounds })
          });
        }
        let host = "";
        try {
          host = new URL(src, String(win.location.href || "https://invalid.local")).hostname.toLowerCase();
        } catch (_error) {
          host = src.toLowerCase();
        }
        if (
          host.includes("recaptcha")
          || host.includes("hcaptcha")
          || host.includes("challenges.cloudflare")
          || host.includes("turnstile")
        ) {
          const bounds = boundsFor(frame);
          pushSignal({
            kind: "captcha",
            confidence: "high",
            source: "frame",
            label: host,
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
    const seen = new Set();
    const authChallengeSignals = [];
    let activeElementId = null;

    const crawl = (doc, win, offsetX = 0, offsetY = 0, frameUrl = "") => {
      const selector = [
        "a[href]",
        "button",
        "input",
        "select",
        "textarea",
        "summary",
        "[contenteditable]",
        "[tabindex]",
        "[role='button']",
        "[role='link']",
        "[role='checkbox']",
        "[role='textbox']",
        "[role='searchbox']",
        "[role='menuitem']"
      ].join(",");
      const collectCandidates = (root, scope = "document", hostChain = []) => {
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
      const candidates = collectCandidates(doc, "document");

      for (const candidate of candidates) {
        const { element, scope, hostChain } = candidate;
        if (!(element instanceof win.Element) || seen.has(element)) continue;
        seen.add(element);
        const visibility = visibilityState(element, win);
        if (!visibility.visible) continue;
        if (element instanceof win.HTMLInputElement && element.type === "hidden") continue;
        const focusable = isFocusable(element);
        if (STRATEGY === "focus" && !focusable) continue;
        const rect = element.getBoundingClientRect();
        const style = win.getComputedStyle(element);
        const cursor = normalizeText(style.cursor || "", 32);
        const editable = isEditable(element);
        const tabIndex = element instanceof win.HTMLElement ? element.tabIndex : -1;
        const id = items.length + 1;
        if (element === doc.activeElement) activeElementId = id;
        const hostChainFingerprint = hostChain.length > 0
          ? hostChain.join(">")
          : "";
        items.push({
          id,
          frameTreeNodeId: FRAME_TREE_NODE_ID,
          frameRef: FRAME_REF,
          tagName: String(element.tagName || "div").toLowerCase(),
          role: normalizeText(element.getAttribute?.("role") || String(element.tagName || "element").toLowerCase(), 40),
          label: labelFor(element, doc),
          actionHint: actionHint(element, cursor),
          stateHint: stateHint(element),
          tooltipText: normalizeText(element.getAttribute?.("title") || describedByText(element, doc), 80),
          textSnippet: normalizeText(
            element instanceof win.HTMLInputElement || element instanceof win.HTMLTextAreaElement
              ? element.value || ""
              : element.innerText || element.textContent || "",
            80
          ),
          selectorPreview: selectorPreview(element),
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
          checked: checkedState(element),
          expanded: expandedState(element),
          focusable,
          tabIndex,
          disabled: isDisabled(element),
          editable,
          href: element instanceof win.HTMLAnchorElement ? element.href : "",
          inputType: element instanceof win.HTMLInputElement ? normalizeText(element.type || "", 32) : "",
          frameUrl,
          discoveryScope: scope,
          hostChain,
          hostChainFingerprint
        });
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
          crawl(
            childDoc,
            childWin,
            offsetX + frameRect.left,
            offsetY + frameRect.top,
            normalizeText(String(childWin.location?.href || ""), 400)
          );
        } catch (_error) {
          warnings.push("cross_origin_frame_skipped");
          const src = normalizeText(frame.getAttribute?.("src") || "", 600);
          if (src) {
            const rect = frame.getBoundingClientRect();
            const bounds = rect.width > 0 && rect.height > 0
              ? {
                x: Math.round(rect.left + offsetX),
                y: Math.round(rect.top + offsetY),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
              }
              : undefined;
            authChallengeSignals.push({
              kind: "oauth_popup",
              confidence: "low",
              source: "frame",
              label: "cross-origin frame",
              url: src,
              frameRef: FRAME_REF,
              frameTreeNodeId: FRAME_TREE_NODE_ID,
              ...(bounds === undefined ? {} : { bounds })
            });
          }
        }
      }
    };

    crawl(
      document,
      window,
      Number(FRAME_BOUNDS.x) || 0,
      Number(FRAME_BOUNDS.y) || 0,
      normalizeText(String(window.location.href || ""), 400)
    );

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
