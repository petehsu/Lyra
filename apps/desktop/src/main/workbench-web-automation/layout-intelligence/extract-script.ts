import type { WorkbenchWebTargetIntent, WorkbenchWebTargetScanScope } from "../../../shared/workbench-web-automation";

export const buildLayoutIntelligenceExtractScript = ({
  frameTreeNodeId,
  intent,
  scope,
  maxNodes,
  focusRegion,
}: {
  readonly frameTreeNodeId: number;
  readonly intent?: WorkbenchWebTargetIntent;
  readonly scope: WorkbenchWebTargetScanScope;
  readonly maxNodes: number;
  readonly focusRegion?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}): string => `
(() => {
  const FRAME_TREE_NODE_ID = ${JSON.stringify(frameTreeNodeId)};
  const SCOPE = ${JSON.stringify(scope)};
  const MAX_NODES = ${JSON.stringify(maxNodes)};
  const INTENT = ${JSON.stringify(intent ?? null)};
  const FOCUS_REGION = ${JSON.stringify(focusRegion ?? null)};

  const normalizeText = (value, maxLength = 120) => {
    if (typeof value !== "string") {
      return "";
    }
    const normalized = value.replace(/\\s+/g, " ").trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }
    return normalized.slice(0, maxLength - 1) + "…";
  };

  const classifyVisibility = (rect) => {
    const viewportBottom = window.innerHeight;
    const viewportRight = window.innerWidth;
    const nearbyBottom = window.innerHeight * 2;
    const nearbyRight = window.innerWidth * 2;
    const intersectsVisible = rect.bottom >= 0
      && rect.top <= viewportBottom
      && rect.right >= 0
      && rect.left <= viewportRight;
    if (intersectsVisible) {
      return "visible";
    }
    const intersectsNearby = rect.bottom >= -window.innerHeight
      && rect.top <= nearbyBottom
      && rect.right >= -window.innerWidth
      && rect.left <= nearbyRight;
    if (intersectsNearby) {
      return "nearby";
    }
    return rect.bottom < -1 || rect.right < -1 ? "offscreen" : "hidden";
  };

  const matchesScope = (visibilityState) => {
    if (SCOPE === "visible") {
      return visibilityState === "visible";
    }
    if (SCOPE === "nearby") {
      return visibilityState === "visible" || visibilityState === "nearby";
    }
    return visibilityState !== "hidden";
  };

  const matchesFocusRegion = (rect) => {
    if (!FOCUS_REGION || typeof FOCUS_REGION !== "object") {
      return true;
    }
    const expanded = {
      left: FOCUS_REGION.x - 96,
      top: FOCUS_REGION.y - 80,
      right: FOCUS_REGION.x + FOCUS_REGION.width + 96,
      bottom: FOCUS_REGION.y + FOCUS_REGION.height + 80
    };
    return rect.right >= expanded.left
      && rect.left <= expanded.right
      && rect.bottom >= expanded.top
      && rect.top <= expanded.bottom;
  };

  const isElementVisible = (element, rect) => {
    if (!(element instanceof Element)) {
      return false;
    }
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || "1") === 0) {
      return false;
    }
    return rect.width > 0 && rect.height > 0;
  };

  const isHitTargetable = (element, rect) => {
    if (!(element instanceof Element)) {
      return false;
    }
    if (rect.width < 2 || rect.height < 2) {
      return false;
    }
    const samplePoints = [
      [rect.left + rect.width / 2, rect.top + rect.height / 2],
      [rect.left + Math.min(rect.width * 0.25, rect.width - 1), rect.top + rect.height / 2],
      [rect.left + Math.min(rect.width * 0.75, rect.width - 1), rect.top + rect.height / 2]
    ];
    return samplePoints.some(([rawX, rawY]) => {
      const x = Math.max(1, Math.min(window.innerWidth - 1, Math.round(rawX)));
      const y = Math.max(1, Math.min(window.innerHeight - 1, Math.round(rawY)));
      const hit = document.elementFromPoint(x, y);
      return hit instanceof Element && (hit === element || element.contains(hit) || hit.contains(element));
    });
  };

  const selectorPreview = (element) => {
    const tagName = String(element.tagName || "div").toLowerCase();
    const parts = [tagName];
    const id = normalizeText(element.id || "", 30);
    if (id.length > 0) {
      parts.push("#" + id);
    }
    const classList = Array.from(element.classList || [])
      .map((item) => normalizeText(String(item), 16))
      .filter((item) => item.length > 0)
      .slice(0, 2);
    if (classList.length > 0) {
      parts.push(classList.map((item) => "." + item).join(""));
    }
    const name = normalizeText(element.getAttribute?.("name") || "", 20);
    if (name.length > 0) {
      parts.push('[name="' + name + '"]');
    }
    return normalizeText(parts.join(""), 120);
  };

  const readTextSnippet = (element, ariaLabel, placeholder) => {
    if (ariaLabel.length > 0 || placeholder.length > 0) {
      return "";
    }
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return normalizeText(element.value || "", 80);
    }
    return normalizeText(
      element.innerText || element.textContent || element.getAttribute?.("title") || "",
      80
    );
  };

  const readDescribedByText = (element) => {
    const describedBy = normalizeText(element.getAttribute?.("aria-describedby") || "", 200);
    if (describedBy.length === 0) {
      return "";
    }
    return describedBy
      .split(/\s+/g)
      .map((id) => document.getElementById(id))
      .filter((entry) => entry instanceof HTMLElement)
      .map((entry) => normalizeText(entry.innerText || entry.textContent || "", 120))
      .filter((entry) => entry.length > 0)
      .slice(0, 2)
      .join(" · ");
  };

  const readTooltipText = (element) => {
    const title = normalizeText(element.getAttribute?.("title") || "", 120);
    const ariaDescription = normalizeText(element.getAttribute?.("aria-description") || "", 120);
    const describedByText = readDescribedByText(element);
    return title || ariaDescription || describedByText;
  };

  const readCursorStyle = (element) => {
    try {
      return normalizeText(window.getComputedStyle(element).cursor || "", 32);
    } catch {
      return "";
    }
  };

  const readStateHint = (element) => {
    const ariaExpanded = element.getAttribute?.("aria-expanded");
    if (ariaExpanded === "true") return "expanded";
    if (ariaExpanded === "false") return "collapsed";
    const ariaSelected = element.getAttribute?.("aria-selected");
    if (ariaSelected === "true") return "selected";
    if (ariaSelected === "false") return "unselected";
    const ariaPressed = element.getAttribute?.("aria-pressed");
    if (ariaPressed === "true") return "pressed";
    if (ariaPressed === "false") return "unpressed";
    const dataState = normalizeText(element.getAttribute?.("data-state") || "", 40);
    if (dataState.length > 0) {
      return dataState;
    }
    return "";
  };

  const tagNameOf = (element) => String(element.tagName || "").toLowerCase();

  const roleOf = (element) => normalizeText(element.getAttribute?.("role") || "", 40);

  const inputTypeOf = (element) =>
    element instanceof HTMLInputElement ? normalizeText(element.type || "text", 24) : "";

  const inferAffordanceLabel = (element, role, ariaLabel, placeholder, textSnippet) => {
    if (ariaLabel.length > 0) return ariaLabel;
    if (placeholder.length > 0) return placeholder;
    if (textSnippet.length > 0) return textSnippet;
    const tooltipText = readTooltipText(element);
    if (tooltipText.length > 0) return tooltipText;
    if (role.length > 0) return role;
    return tagNameOf(element);
  };

  const inferAffordanceAction = ({
    element,
    role,
    clickable,
    typable,
    selectable
  }) => {
    const tagName = tagNameOf(element);
    const ariaHasPopup = normalizeText(element.getAttribute?.("aria-haspopup") || "", 40);
    const stateHint = readStateHint(element);
    const hintText = normalizeText(
      [
        element.getAttribute?.("aria-label") || "",
        element.getAttribute?.("data-testid") || "",
        Array.from(element.classList || []).join(" ")
      ].join(" "),
      120
    );
    if (typable) return "type text";
    if (selectable) return "choose an option";
    if (stateHint === "collapsed" || hintText.includes("open sidebar")) return "expand";
    if (stateHint === "expanded") return "collapse";
    if (ariaHasPopup === "menu" || role === "menuitem" || hintText.includes("options") || hintText.includes("menu")) {
      return "open menu";
    }
    if (tagName === "a") return "open link";
    if (clickable) return "click";
    return "";
  };

  const isTypable = (element, role) => {
    if (element instanceof HTMLTextAreaElement) {
      return true;
    }
    if (element instanceof HTMLInputElement) {
      const type = inputTypeOf(element);
      return !["checkbox", "radio", "range", "color", "file", "submit", "button", "reset"].includes(type);
    }
    if (element instanceof HTMLElement && element.isContentEditable === true) {
      return INTENT?.allowContentEditable === true;
    }
    return role === "textbox" || role === "searchbox" || role === "combobox";
  };

  const isClickable = (element, role) => {
    const tagName = tagNameOf(element);
    if (tagName === "button" || tagName === "summary") {
      return true;
    }
    if (tagName === "a" && element.getAttribute("href")) {
      return true;
    }
    return ["button", "link", "menuitem", "tab", "checkbox", "radio", "switch"].includes(role);
  };

  const isSelectable = (element, role) => {
    const tagName = tagNameOf(element);
    return tagName === "select" || role === "listbox" || role === "combobox";
  };

  const isFocusable = (element) => {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    return element.tabIndex >= 0
      || element instanceof HTMLInputElement
      || element instanceof HTMLTextAreaElement
      || element instanceof HTMLSelectElement
      || element instanceof HTMLButtonElement
      || element instanceof HTMLAnchorElement;
  };

  const countDescendantInteractives = (element) => {
    let count = 0;
    const stack = Array.from(element.children || []);
    while (stack.length > 0 && count < 12) {
      const next = stack.pop();
      if (!(next instanceof Element)) {
        continue;
      }
      const role = roleOf(next);
      if (isClickable(next, role) || isTypable(next, role) || isSelectable(next, role) || isFocusable(next)) {
        count += 1;
      }
      stack.push(...Array.from(next.children || []));
    }
    return count;
  };

  const isLowValueSurfaceCandidate = ({
    element,
    role,
    rect,
    clickable,
    typable,
    selectable,
    focusable
  }) => {
    const tagName = tagNameOf(element);
    const hintText = normalizeText(
      [
        element.getAttribute?.("aria-label") || "",
        element.getAttribute?.("placeholder") || "",
        element.getAttribute?.("title") || "",
        element.textContent || ""
      ].join(" "),
      120
    );
    if (tagName === "body" || tagName === "html") {
      return true;
    }
    if (typable || selectable) {
      return false;
    }
    if (clickable && (tagName === "button" || tagName === "a" || role === "button" || role === "menuitem" || role === "tab")) {
      return false;
    }
    if (
      (tagName === "div" || tagName === "span")
      && role.length === 0
      && hintText.length === 0
      && rect.width >= 640
      && rect.height >= 72
      && countDescendantInteractives(element) >= 2
    ) {
      return true;
    }
    if (!clickable && !typable && !selectable && focusable && hintText.length === 0 && rect.width >= 520) {
      return true;
    }
    return false;
  };

  const buildPath = (path, kind, index) => path + "/" + kind + ":" + index;

  const readContainerKind = (element, role, interactableCount) => {
    const tagName = tagNameOf(element);
    const hintText = normalizeText(
      [
        element.id || "",
        element.getAttribute?.("name") || "",
        element.getAttribute?.("aria-label") || "",
        element.getAttribute?.("data-testid") || "",
        Array.from(element.classList || []).join(" ")
      ].join(" "),
      200
    );
    if (tagName === "form" || role === "form") return "form";
    if (role === "dialog" || role === "alertdialog") return "dialog";
    if (role === "toolbar") return "toolbar";
    if (tagName === "nav" || role === "navigation") return "navigation";
    if (role === "search" || hintText.includes("search")) return "search";
    if (hintText.includes("login") || hintText.includes("sign in") || hintText.includes("signin")) return "login";
    if (hintText.includes("chat") || hintText.includes("composer") || hintText.includes("prompt")) return "chat";
    if (hintText.includes("captcha") || hintText.includes("turnstile") || hintText.includes("challenge")) return "protected";
    if (interactableCount >= 4 && (tagName === "section" || tagName === "article" || tagName === "div")) return "panel";
    return "";
  };

  const findContainerHint = (element, currentPath) => {
    const ancestors = [];
    let cursor = element.parentElement;
    let depth = 0;
    while (cursor instanceof Element && depth < 6) {
      ancestors.push(cursor);
      cursor = cursor.parentElement;
      depth += 1;
    }

    for (const ancestor of ancestors) {
      const rect = ancestor.getBoundingClientRect();
      if (!isElementVisible(ancestor, rect)) {
        continue;
      }
      const role = roleOf(ancestor);
      const interactableCount = countDescendantInteractives(ancestor);
      const kind = readContainerKind(ancestor, role, interactableCount);
      const tagName = tagNameOf(ancestor);
      const semantic = kind.length > 0
        || ["form", "section", "article", "dialog", "nav", "aside", "main", "header", "footer"].includes(tagName)
        || ["dialog", "alertdialog", "toolbar", "navigation", "search", "form", "menu", "tablist", "listbox"].includes(role);
      if (!semantic && interactableCount < 2) {
        continue;
      }
      return {
        selectorAddress: {
          frameTreeNodeId: FRAME_TREE_NODE_ID,
          path: typeof ancestor.__lyraPath === "string" ? ancestor.__lyraPath : currentPath
        },
        tagName,
        ...(role.length === 0 ? {} : { role }),
        ...(kind.length === 0 ? {} : { label: kind }),
        selectorPreview: selectorPreview(ancestor),
        bounds: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        },
        ...(kind === "protected" ? { protected: true } : {})
      };
    }
    return undefined;
  };

  const collectChildren = (container) => Array.from(container.children || []).filter((entry) => entry instanceof Element);

  const interactiveNodes = [];
  let documentOrder = 0;
  const walk = (container, path) => {
    const children = collectChildren(container);
    children.forEach((element, index) => {
      if (interactiveNodes.length >= MAX_NODES) {
        return;
      }
      const currentDocumentOrder = documentOrder;
      documentOrder += 1;
      const nextPath = buildPath(path, "d", index);
      try {
        element.__lyraPath = nextPath;
      } catch {
        // ignore expando failures on hostile pages
      }
      const role = roleOf(element);
      const rect = element.getBoundingClientRect();
      const visibilityState = classifyVisibility(rect);
      const clickable = isClickable(element, role);
      const typable = isTypable(element, role);
      const selectable = isSelectable(element, role);
      const focusable = isFocusable(element);
      const interactable = clickable || typable || selectable || focusable;
      const disabled = element instanceof HTMLElement && ("disabled" in element) ? Boolean(element.disabled) : false;
      const hitTargetable = isHitTargetable(element, rect);
      const cursorStyle = readCursorStyle(element);

      if (
        interactable
        && isElementVisible(element, rect)
        && matchesScope(visibilityState)
        && matchesFocusRegion(rect)
        && hitTargetable
        && !isLowValueSurfaceCandidate({
          element,
          role,
          rect,
          clickable,
          typable,
          selectable,
          focusable
        })
      ) {
        const tagName = tagNameOf(element);
        const ariaLabel = normalizeText(element.getAttribute?.("aria-label") || "", 80);
        const placeholder = normalizeText(
          element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
            ? element.getAttribute("placeholder") || ""
            : "",
          80
        );
        const textSnippet = readTextSnippet(element, ariaLabel, placeholder);
        const tooltipText = readTooltipText(element);
        const stateHint = readStateHint(element);
        const affordanceLabel = inferAffordanceLabel(element, role, ariaLabel, placeholder, textSnippet);
        const affordanceAction = inferAffordanceAction({
          element,
          role,
          clickable,
          typable,
          selectable
        });
        const containerHint = findContainerHint(element, nextPath);
        interactiveNodes.push({
          tagName,
          ...(role.length === 0 ? {} : { role }),
          ...(inputTypeOf(element).length === 0 ? {} : { inputType: inputTypeOf(element) }),
          selectorPreview: selectorPreview(element),
          ...(textSnippet ? { textSnippet } : {}),
          ...(ariaLabel ? { ariaLabel } : {}),
          ...(placeholder ? { placeholder } : {}),
          ...(affordanceLabel.length === 0 ? {} : { affordanceLabel }),
          ...(affordanceAction.length === 0 ? {} : { affordanceAction }),
          ...(cursorStyle.length === 0 ? {} : { cursorStyle }),
          ...(tooltipText.length === 0 ? {} : { tooltipText }),
          ...(stateHint.length === 0 ? {} : { stateHint }),
          isHumanOperable: hitTargetable && !disabled,
          ...(Number.isFinite(element.tabIndex) ? { tabIndex: Number(element.tabIndex) } : {}),
          documentOrder: currentDocumentOrder,
          ...(disabled ? { disabled: true } : {}),
          visibilityState,
          interactable: {
            clickable,
            typable,
            selectable,
            focusable
          },
          bounds: {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          },
          selectorAddress: {
            frameTreeNodeId: FRAME_TREE_NODE_ID,
            path: nextPath
          },
          stableSignature: {
            tagName,
            ...(role.length === 0 ? {} : { role }),
            ...(inputTypeOf(element).length === 0 ? {} : { inputType: inputTypeOf(element) }),
            ...(normalizeText(element.id || "", 60).length > 0 ? { id: normalizeText(element.id || "", 60) } : {}),
            ...(normalizeText(element.getAttribute?.("name") || "", 60).length > 0
              ? { name: normalizeText(element.getAttribute?.("name") || "", 60) }
              : {}),
            ...(normalizeText(element.getAttribute?.("data-testid") || "", 60).length > 0
              ? { testId: normalizeText(element.getAttribute?.("data-testid") || "", 60) }
              : {}),
            ...(ariaLabel.length > 0 ? { ariaLabel } : {})
          },
          ...(typeof element.getAttribute === "function" && element.getAttribute("href")
            ? { href: String(element.getAttribute("href") || "") }
            : {}),
          ...(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
            ? { value: String(element.value || "") }
            : {}),
          ...(element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")
            ? { checked: element.checked === true }
            : {}),
          ...(containerHint === undefined ? {} : { containerHint })
        });
      }

      if (element.shadowRoot) {
        walk(element.shadowRoot, buildPath(nextPath, "s", 0));
      }
      walk(element, nextPath);
    });
  };

  if (document.documentElement instanceof Element) {
    walk(document.documentElement, "r");
  }

  return {
    interactiveNodes: interactiveNodes.slice(0, MAX_NODES),
    viewport: {
      width: Math.round(window.innerWidth),
      height: Math.round(window.innerHeight),
      scrollX: Math.round(window.scrollX),
      scrollY: Math.round(window.scrollY)
    }
  };
})()
`;
