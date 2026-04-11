import type {
  WorkbenchBrowserAgentTargetInfo,
  WorkbenchBrowserElementPickerAppearance
} from "../../../shared/desktop-bridge";
import { WORKBENCH_ELEMENT_PICKER_CONSOLE_PREFIX } from "./types";

const OVERLAY_ROOT_ID = "__lyra_element_picker_root";
const SESSION_KEY = "__lyraElementPickerSession";

const quote = (value: string): string => JSON.stringify(value);

const serializeAgentTarget = (target: WorkbenchBrowserAgentTargetInfo): string => JSON.stringify(target);

export const buildElementPickerPrimeScript = (
  frameTreeNodeId: number,
  appearance: WorkbenchBrowserElementPickerAppearance
): string => `
(() => {
  const PREFIX = ${quote(WORKBENCH_ELEMENT_PICKER_CONSOLE_PREFIX)};
  const ROOT_ID = ${quote(OVERLAY_ROOT_ID)};
  const SESSION_KEY = ${quote(SESSION_KEY)};
  const FRAME_TREE_NODE_ID = ${JSON.stringify(frameTreeNodeId)};
  const APPEARANCE = ${JSON.stringify(appearance)};

  const normalizeText = (value, maxLength = 160) => {
    if (typeof value !== "string") {
      return "";
    }
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }
    return normalized.slice(0, maxLength - 1) + "…";
  };

  const emit = (payload) => {
    try {
      console.debug(PREFIX + JSON.stringify(payload));
    } catch (_error) {
      // Ignore console channel failures inside untrusted pages.
    }
  };

  const readSelectorPreview = (element) => {
    const tagName = String(element.tagName || "div").toLowerCase();
    const parts = [tagName];
    const id = normalizeText(element.id || "", 40);
    if (id.length > 0) {
      parts.push("#" + id);
    }
    const classList = Array.from(element.classList || [])
      .map((item) => normalizeText(String(item), 24))
      .filter((item) => item.length > 0)
      .slice(0, 2);
    if (classList.length > 0) {
      parts.push(classList.map((item) => "." + item).join(""));
    }
    const name = normalizeText(element.getAttribute?.("name") || "", 24);
    if (name.length > 0) {
      parts.push('[name="' + name + '"]');
    }
    const testId = normalizeText(
      element.getAttribute?.("data-testid") || element.getAttribute?.("data-test-id") || "",
      24
    );
    if (testId.length > 0) {
      parts.push('[data-testid="' + testId + '"]');
    }
    const type = normalizeText(element.getAttribute?.("type") || "", 20);
    if (type.length > 0) {
      parts.push('[type="' + type + '"]');
    }
    const preview = parts.join("");
    return preview.length <= 120 ? preview : preview.slice(0, 119) + "…";
  };

  const readTextSnippet = (element, ariaLabel, placeholder) => {
    if (ariaLabel.length > 0 || placeholder.length > 0) {
      return "";
    }
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return normalizeText(element.value || "", 80);
    }
    return normalizeText(
      element.innerText
        || element.textContent
        || element.getAttribute?.("title")
        || element.getAttribute?.("alt")
        || "",
      80
    );
  };

  const toBounds = (rect) => ({
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  });

  const ensureSession = () => {
    if (window[SESSION_KEY] && typeof window[SESSION_KEY] === "object") {
      return window[SESSION_KEY];
    }

    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.setAttribute("aria-hidden", "true");
    root.style.position = "fixed";
    root.style.inset = "0";
    root.style.pointerEvents = "none";
    root.style.zIndex = "2147483647";

    const shadow = root.attachShadow({ mode: "open" });
    shadow.innerHTML = [
      '<style>',
      ':host { all: initial; }',
      '.frame {',
      '  position: fixed;',
      '  border: ' + APPEARANCE.strokeWidth + ' solid ' + APPEARANCE.accentColor + ';',
      '  background: ' + APPEARANCE.accentFill + ';',
      '  box-shadow: inset 0 0 0 ' + APPEARANCE.strokeWidth + ' color-mix(in srgb, ' + APPEARANCE.accentColor + ' 22%, transparent);',
      '  border-radius: ' + APPEARANCE.frameRadius + ';',
      '  pointer-events: none;',
      '  display: none;',
      '}',
      '.bubble {',
      '  position: fixed;',
      '  min-width: 0;',
      '  max-width: min(420px, calc(100vw - 24px));',
      '  display: none;',
      '  padding: 8px 10px;',
      '  border: ' + APPEARANCE.strokeWidth + ' solid ' + APPEARANCE.surfaceBorder + ';',
      '  border-radius: ' + APPEARANCE.bubbleRadius + ';',
      '  background: ' + APPEARANCE.surfaceBackground + ';',
      '  color: ' + APPEARANCE.textPrimary + ';',
      '  font-family: ' + APPEARANCE.fontFamily + ';',
      '  font-size: 12px;',
      '  line-height: 1.35;',
      '  box-shadow: ' + APPEARANCE.surfaceShadow + ';',
      '  -webkit-backdrop-filter: ' + APPEARANCE.surfaceBackdropFilter + ';',
      '  backdrop-filter: ' + APPEARANCE.surfaceBackdropFilter + ';',
      '  pointer-events: none;',
      '  white-space: normal;',
      '  overflow: hidden;',
      '}',
      '.row {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 6px;',
      '  min-width: 0;',
      '  margin-bottom: 4px;',
      '}',
      '.tag, .phase {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  min-height: 18px;',
      '  padding: 0 6px;',
      '  border-radius: 999px;',
      '  font-weight: 600;',
      '}',
      '.tag {',
      '  background: ' + APPEARANCE.tagBackground + ';',
      '  color: ' + APPEARANCE.tagText + ';',
      '}',
      '.phase {',
      '  background: color-mix(in srgb, ' + APPEARANCE.accentColor + ' 12%, transparent);',
      '  color: ' + APPEARANCE.textSecondary + ';',
      '  display: none;',
      '}',
      '.meta { color: ' + APPEARANCE.textSecondary + '; }',
      '.text, .selector, .size {',
      '  display: block;',
      '  min-width: 0;',
      '  overflow: hidden;',
      '  text-overflow: ellipsis;',
      '  white-space: nowrap;',
      '}',
      '.text { color: ' + APPEARANCE.textPrimary + '; }',
      '.selector { color: ' + APPEARANCE.textSecondary + '; margin-top: 2px; }',
      '.size { color: ' + APPEARANCE.textMuted + '; margin-top: 2px; }',
      '</style>',
      '<div class="frame"></div>',
      '<div class="bubble">',
      '  <div class="row">',
      '    <span class="tag"></span>',
      '    <span class="meta"></span>',
      '    <span class="phase"></span>',
      '  </div>',
      '  <span class="text"></span>',
      '  <span class="selector"></span>',
      '  <span class="size"></span>',
      '</div>'
    ].join('');

    const frame = shadow.querySelector('.frame');
    const bubble = shadow.querySelector('.bubble');
    const tag = shadow.querySelector('.tag');
    const meta = shadow.querySelector('.meta');
    const phase = shadow.querySelector('.phase');
    const text = shadow.querySelector('.text');
    const selector = shadow.querySelector('.selector');
    const size = shadow.querySelector('.size');
    const previousCursor = document.documentElement.style.cursor;

    const session = {
      root,
      frame,
      bubble,
      tag,
      meta,
      phase,
      text,
      selector,
      size,
      previousCursor,
      mounted: false,
      manualEnabled: false,
      currentElement: null,
      currentSnapshot: null,
      agentTarget: null,
      lastHoverKey: '',
      rafId: 0,
      pointerMove: null,
      refresh: null,
      keydown: null,
      visibility: null,
      scroll: null,
      hideOverlay: null,
      renderSnapshot: null,
      renderActive: null,
      setManualMode: null,
      setAgentTarget: null,
      clearAgentTarget: null,
      dispose: null,
      teardown: null,
    };

    session.hideOverlay = () => {
      session.frame.style.display = 'none';
      session.bubble.style.display = 'none';
    };

    const placeBubble = (rect) => {
      const bubbleWidth = session.bubble.offsetWidth || 240;
      const bubbleHeight = session.bubble.offsetHeight || 54;
      const maxLeft = Math.max(8, window.innerWidth - bubbleWidth - 8);
      const preferredLeft = Math.round(Math.min(maxLeft, Math.max(8, rect.left)));
      const aboveTop = rect.top - bubbleHeight - 10;
      const fallbackTop = rect.bottom + 10;
      const nextTop = aboveTop >= 8
        ? Math.round(aboveTop)
        : Math.round(Math.min(window.innerHeight - bubbleHeight - 8, Math.max(8, fallbackTop)));
      session.bubble.style.left = preferredLeft + 'px';
      session.bubble.style.top = nextTop + 'px';
    };

    session.renderSnapshot = (snapshot, phaseLabel = '') => {
      if (!snapshot || typeof snapshot !== 'object') {
        session.hideOverlay();
        return;
      }
      const bounds = snapshot.bounds;
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
        session.hideOverlay();
        return;
      }
      session.frame.style.display = 'block';
      session.frame.style.left = String(bounds.x) + 'px';
      session.frame.style.top = String(bounds.y) + 'px';
      session.frame.style.width = String(bounds.width) + 'px';
      session.frame.style.height = String(bounds.height) + 'px';
      session.tag.textContent = '<' + String(snapshot.tagName || 'div') + '>';
      const metaParts = [];
      if (typeof snapshot.role === 'string' && snapshot.role.trim().length > 0) {
        metaParts.push(snapshot.role.trim());
      }
      if (typeof snapshot.inputType === 'string' && snapshot.inputType.trim().length > 0) {
        metaParts.push(snapshot.inputType.trim());
      }
      session.meta.textContent = metaParts.join(' · ');
      const preferredText = normalizeText(
        snapshot.ariaLabel || snapshot.placeholder || snapshot.textSnippet || '',
        80
      );
      session.text.textContent = preferredText;
      session.text.style.display = preferredText.length > 0 ? 'block' : 'none';
      session.selector.textContent = normalizeText(snapshot.selectorPreview || '', 120);
      session.size.textContent = String(bounds.width) + ' × ' + String(bounds.height);
      if (phaseLabel.length > 0) {
        session.phase.textContent = phaseLabel;
        session.phase.style.display = 'inline-flex';
      } else {
        session.phase.textContent = '';
        session.phase.style.display = 'none';
      }
      session.bubble.style.display = 'block';
      placeBubble({
        left: bounds.x,
        top: bounds.y,
        bottom: bounds.y + bounds.height,
        width: bounds.width,
        height: bounds.height
      });
    };

    session.renderActive = () => {
      if (session.agentTarget && typeof session.agentTarget === 'object') {
        session.renderSnapshot(session.agentTarget, String(session.agentTarget.phase || '').trim());
        return;
      }
      if (session.manualEnabled !== true) {
        session.hideOverlay();
        return;
      }
      if (session.currentSnapshot && typeof session.currentSnapshot === 'object') {
        session.renderSnapshot(session.currentSnapshot, '');
        return;
      }
      session.hideOverlay();
    };

    const resolveElement = (event) => {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      for (const candidate of path) {
        if (candidate === root) {
          continue;
        }
        if (candidate instanceof Element) {
          return candidate;
        }
      }
      return event.target instanceof Element ? event.target : null;
    };

    const toManualSnapshot = (element) => {
      if (!(element instanceof Element)) {
        return null;
      }
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return null;
      }
      const role = normalizeText(element.getAttribute?.('role') || '', 40);
      const inputType = element instanceof HTMLInputElement ? normalizeText(element.type || '', 32) : '';
      const ariaLabel = normalizeText(element.getAttribute?.('aria-label') || '', 80);
      const placeholder = normalizeText(
        element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
          ? element.getAttribute('placeholder') || ''
          : '',
        80
      );
      const textSnippet = readTextSnippet(element, ariaLabel, placeholder);
      const tagName = String(element.tagName || 'div').toLowerCase();
      const selectorPreview = readSelectorPreview(element);
      const bounds = toBounds(rect);
      const crossOriginBoundary = tagName === 'iframe';
      return {
        kind: 'hover',
        frameTreeNodeId: FRAME_TREE_NODE_ID,
        tagName,
        selectorPreview,
        bounds,
        frameUrl: normalizeText(String(window.location.href || ''), 400),
        ...(role.length === 0 ? {} : { role }),
        ...(inputType.length === 0 ? {} : { inputType }),
        ...(ariaLabel.length === 0 ? {} : { ariaLabel }),
        ...(placeholder.length === 0 ? {} : { placeholder }),
        ...(textSnippet.length === 0 ? {} : { textSnippet }),
        ...(crossOriginBoundary ? { crossOriginBoundary: true } : {})
      };
    };

    session.pointerMove = (event) => {
      if (session.manualEnabled !== true) {
        return;
      }
      const target = resolveElement(event);
      if (session.rafId !== 0) {
        cancelAnimationFrame(session.rafId);
      }
      session.rafId = requestAnimationFrame(() => {
        session.rafId = 0;
        const snapshot = toManualSnapshot(target);
        const hoverKey = snapshot ? JSON.stringify(snapshot) : '';
        session.currentElement = target;
        session.currentSnapshot = snapshot;
        if (hoverKey !== session.lastHoverKey) {
          session.lastHoverKey = hoverKey;
          if (snapshot) {
            emit(snapshot);
          }
        }
        session.renderActive();
      });
    };

    session.refresh = () => {
      if (session.agentTarget !== null) {
        session.renderActive();
        return;
      }
      if (!(session.currentElement instanceof Element)) {
        session.currentSnapshot = null;
        session.renderActive();
        return;
      }
      session.currentSnapshot = toManualSnapshot(session.currentElement);
      session.renderActive();
    };

    session.keydown = (event) => {
      if (event.key !== 'Escape' || session.manualEnabled !== true || session.agentTarget !== null) {
        return;
      }
      event.stopPropagation();
      event.preventDefault();
      session.teardown('escape', true);
    };

    session.visibility = () => {
      if (document.visibilityState === 'hidden') {
        session.hideOverlay();
        return;
      }
      session.refresh();
    };

    session.scroll = () => {
      session.refresh();
    };

    session.setManualMode = (enabled) => {
      session.manualEnabled = enabled === true;
      document.documentElement.style.cursor = session.manualEnabled ? 'crosshair' : session.previousCursor;
      session.renderActive();
    };

    session.setAgentTarget = (target) => {
      session.agentTarget = target && typeof target === 'object' ? target : null;
      session.renderActive();
    };

    session.clearAgentTarget = () => {
      session.agentTarget = null;
      session.renderActive();
    };

    session.dispose = () => {
      if (session.rafId !== 0) {
        cancelAnimationFrame(session.rafId);
        session.rafId = 0;
      }
      document.removeEventListener('pointermove', session.pointerMove, true);
      document.removeEventListener('keydown', session.keydown, true);
      document.removeEventListener('scroll', session.scroll, true);
      window.removeEventListener('resize', session.refresh, true);
      document.removeEventListener('visibilitychange', session.visibility, true);
      document.documentElement.style.cursor = session.previousCursor;
      root.remove();
      delete window[SESSION_KEY];
    };

    session.teardown = (cause, emitState) => {
      const wasMounted = session.mounted === true;
      session.mounted = false;
      if (wasMounted) {
        session.dispose();
      }
      if (emitState) {
        emit({ kind: 'state', enabled: false, cause });
      }
    };

    document.addEventListener('pointermove', session.pointerMove, true);
    document.addEventListener('keydown', session.keydown, true);
    document.addEventListener('scroll', session.scroll, true);
    window.addEventListener('resize', session.refresh, true);
    document.addEventListener('visibilitychange', session.visibility, true);
    document.documentElement.appendChild(root);
    session.mounted = true;
    window[SESSION_KEY] = session;
    return session;
  };

  const session = ensureSession();
  if (!session || session.mounted !== true) {
    emit({ kind: 'state', enabled: false, cause: 'script_error' });
    return false;
  }
  return true;
})();
`;

export const buildElementPickerSetManualModeScript = (enabled: boolean): string => `
(() => {
  const SESSION_KEY = ${quote(SESSION_KEY)};
  const session = window[SESSION_KEY];
  if (!session || typeof session.setManualMode !== 'function') {
    return false;
  }
  session.setManualMode(${enabled ? "true" : "false"});
  return true;
})();
`;

export const buildElementPickerSetAgentTargetScript = (
  target: WorkbenchBrowserAgentTargetInfo
): string => `
(() => {
  const SESSION_KEY = ${quote(SESSION_KEY)};
  const session = window[SESSION_KEY];
  if (!session || typeof session.setAgentTarget !== 'function') {
    return false;
  }
  session.setAgentTarget(${serializeAgentTarget(target)});
  return true;
})();
`;

export const buildElementPickerClearAgentTargetScript = (): string => `
(() => {
  const SESSION_KEY = ${quote(SESSION_KEY)};
  const session = window[SESSION_KEY];
  if (!session || typeof session.clearAgentTarget !== 'function') {
    return false;
  }
  session.clearAgentTarget();
  return true;
})();
`;

export const buildElementPickerDisableScript = (): string => `
(() => {
  const SESSION_KEY = ${quote(SESSION_KEY)};
  const session = window[SESSION_KEY];
  if (!session || typeof session.teardown !== 'function') {
    return false;
  }
  session.teardown('user_toggle', false);
  return true;
})();
`;
