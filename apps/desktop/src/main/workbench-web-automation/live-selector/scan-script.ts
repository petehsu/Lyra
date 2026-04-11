import type { WorkbenchWebTargetIntent, WorkbenchWebTargetScanScope } from "../../../shared/workbench-web-automation";

export const buildLiveSelectorScanScript = ({
  frameTreeNodeId,
  intent,
  scope,
  maxCandidates,
}: {
  readonly frameTreeNodeId: number;
  readonly intent: WorkbenchWebTargetIntent;
  readonly scope: WorkbenchWebTargetScanScope;
  readonly maxCandidates: number;
}): string => `
(() => {
  const FRAME_TREE_NODE_ID = ${JSON.stringify(frameTreeNodeId)};
  const INTENT = ${JSON.stringify(intent)};
  const SCOPE = ${JSON.stringify(scope)};
  const MAX_CANDIDATES = ${JSON.stringify(maxCandidates)};

  const normalizeText = (value, maxLength = 120) => {
    if (typeof value !== 'string') {
      return '';
    }
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }
    return normalized.slice(0, maxLength - 1) + '…';
  };

  const isElementVisible = (element, rect) => {
    if (!(element instanceof Element)) {
      return false;
    }
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0) {
      return false;
    }
    return rect.width > 0 && rect.height > 0;
  };

  const classifyVisibility = (rect) => {
    const viewportTop = 0;
    const viewportLeft = 0;
    const viewportBottom = window.innerHeight;
    const viewportRight = window.innerWidth;
    const nearbyBottom = window.innerHeight * 2;
    const nearbyRight = window.innerWidth * 2;
    const intersectsVisible = rect.bottom >= viewportTop
      && rect.top <= viewportBottom
      && rect.right >= viewportLeft
      && rect.left <= viewportRight;
    if (intersectsVisible) {
      return 'visible';
    }
    const intersectsNearby = rect.bottom >= -window.innerHeight
      && rect.top <= nearbyBottom
      && rect.right >= -window.innerWidth
      && rect.left <= nearbyRight;
    if (intersectsNearby) {
      return 'nearby';
    }
    return rect.bottom < -1 || rect.right < -1 ? 'offscreen' : 'hidden';
  };

  const selectorPreview = (element) => {
    const tagName = String(element.tagName || 'div').toLowerCase();
    const parts = [tagName];
    const id = normalizeText(element.id || '', 30);
    if (id.length > 0) {
      parts.push('#' + id);
    }
    const classList = Array.from(element.classList || [])
      .map((item) => normalizeText(String(item), 16))
      .filter((item) => item.length > 0)
      .slice(0, 2);
    if (classList.length > 0) {
      parts.push(classList.map((item) => '.' + item).join(''));
    }
    const name = normalizeText(element.getAttribute?.('name') || '', 20);
    if (name.length > 0) {
      parts.push('[name="' + name + '"]');
    }
    return normalizeText(parts.join(''), 120);
  };

  const readTextSnippet = (element, ariaLabel, placeholder) => {
    if (ariaLabel.length > 0 || placeholder.length > 0) {
      return '';
    }
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return normalizeText(element.value || '', 80);
    }
    return normalizeText(
      element.innerText || element.textContent || element.getAttribute?.('title') || '',
      80
    );
  };

  const isTypable = (element, role) => {
    if (element instanceof HTMLTextAreaElement) {
      return true;
    }
    if (element instanceof HTMLInputElement) {
      const type = String(element.type || 'text').toLowerCase();
      return !['checkbox', 'radio', 'range', 'color', 'file', 'submit', 'button', 'reset'].includes(type);
    }
    if (element instanceof HTMLElement && element.isContentEditable === true) {
      return INTENT.allowContentEditable === true;
    }
    return role === 'textbox' || role === 'searchbox' || role === 'combobox';
  };

  const isClickable = (element, role) => {
    const tagName = String(element.tagName || '').toLowerCase();
    if (tagName === 'button' || tagName === 'summary') {
      return true;
    }
    if (tagName === 'a' && element.getAttribute('href')) {
      return true;
    }
    return ['button', 'link', 'menuitem', 'tab', 'checkbox', 'radio', 'switch'].includes(role);
  };

  const isSelectable = (element, role) => {
    const tagName = String(element.tagName || '').toLowerCase();
    return tagName === 'select' || role === 'listbox' || role === 'combobox';
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

  const matchesDesiredTag = (element) => {
    const tags = Array.isArray(INTENT.desiredTags) ? INTENT.desiredTags : [];
    if (tags.length === 0) {
      return true;
    }
    return tags.map((item) => normalizeText(item, 40)).includes(String(element.tagName || '').toLowerCase());
  };

  const matchesDesiredRole = (role) => {
    const roles = Array.isArray(INTENT.desiredRoles) ? INTENT.desiredRoles : [];
    if (roles.length === 0) {
      return true;
    }
    return roles.map((item) => normalizeText(item, 40)).includes(role);
  };

  const collectChildren = (container) => Array.from(container.children || []).filter((entry) => entry instanceof Element);

  const candidates = [];
  const walk = (container, path) => {
    const children = collectChildren(container);
    children.forEach((element, index) => {
      const nextPath = path + '/d:' + index;
      const role = normalizeText(element.getAttribute?.('role') || '', 40);
      const rect = element.getBoundingClientRect();
      const visibilityState = classifyVisibility(rect);
      const clickable = isClickable(element, role);
      const typable = isTypable(element, role);
      const selectable = isSelectable(element, role);
      const focusable = isFocusable(element);
      const interactable = clickable || typable || selectable || focusable;
      const disabled = element instanceof HTMLElement && ('disabled' in element) ? Boolean(element.disabled) : false;
      const passesScope = SCOPE === 'visible'
        ? visibilityState === 'visible'
        : SCOPE === 'nearby'
          ? visibilityState === 'visible' || visibilityState === 'nearby'
          : visibilityState !== 'hidden';

      if (interactable && isElementVisible(element, rect) && passesScope && matchesDesiredTag(element) && matchesDesiredRole(role)) {
        const tagName = String(element.tagName || 'div').toLowerCase();
        const ariaLabel = normalizeText(element.getAttribute?.('aria-label') || '', 80);
        const placeholder = normalizeText(
          element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
            ? element.getAttribute('placeholder') || ''
            : '',
          80
        );
        candidates.push({
          tagName,
          role: role.length === 0 ? undefined : role,
          inputType: element instanceof HTMLInputElement ? normalizeText(element.type || 'text', 24) || undefined : undefined,
          selectorPreview: selectorPreview(element),
          textSnippet: readTextSnippet(element, ariaLabel, placeholder) || undefined,
          ariaLabel: ariaLabel || undefined,
          placeholder: placeholder || undefined,
          disabled,
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
            ...(element instanceof HTMLInputElement && normalizeText(element.type || 'text', 24).length > 0
              ? { inputType: normalizeText(element.type || 'text', 24) }
              : {}),
            ...(normalizeText(element.id || '', 60).length > 0 ? { id: normalizeText(element.id || '', 60) } : {}),
            ...(normalizeText(element.getAttribute?.('name') || '', 60).length > 0
              ? { name: normalizeText(element.getAttribute?.('name') || '', 60) }
              : {}),
            ...(normalizeText(element.getAttribute?.('data-testid') || '', 60).length > 0
              ? { testId: normalizeText(element.getAttribute?.('data-testid') || '', 60) }
              : {}),
            ...(ariaLabel.length > 0 ? { ariaLabel } : {})
          }
        });
      }

      if (candidates.length < MAX_CANDIDATES && element.shadowRoot) {
        walk(element.shadowRoot, nextPath + '/s');
      }
      if (candidates.length < MAX_CANDIDATES) {
        walk(element, nextPath);
      }
    });
  };

  if (document.documentElement instanceof Element) {
    walk(document.documentElement, 'r');
  }

  return {
    candidates: candidates.slice(0, MAX_CANDIDATES),
    viewport: {
      width: Math.round(window.innerWidth),
      height: Math.round(window.innerHeight),
      scrollX: Math.round(window.scrollX),
      scrollY: Math.round(window.scrollY)
    }
  };
})();
`;

export const buildLiveSelectorScrollScript = (): string => `
(() => {
  const nextTop = Math.round(window.scrollY + window.innerHeight * 0.8);
  const maxTop = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const clamped = Math.min(maxTop, nextTop);
  window.scrollTo({ top: clamped, behavior: 'instant' });
  return {
    scrollY: Math.round(window.scrollY),
    atEnd: Math.round(window.scrollY) >= maxTop
  };
})();
`;
