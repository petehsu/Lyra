import type { WorkbenchBrowserElementPickerAppearance } from "../../../shared/desktop-bridge";
import { WORKBENCH_ELEMENT_PICKER_CONSOLE_PREFIX } from "./types";

const OVERLAY_ROOT_ID = "__lyra_element_picker_root";
const SESSION_KEY = "__lyraElementPickerSession";

const quote = (value: string): string => JSON.stringify(value);

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

  const readDescribedByText = (element) => {
    if (!(element instanceof Element)) {
      return '';
    }
    return String(element.getAttribute('aria-describedby') || '')
      .split(/\s+/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
      .map((id) => document.getElementById(id))
      .filter((entry) => entry instanceof HTMLElement)
      .map((entry) => normalizeText(entry.innerText || entry.textContent || '', 80))
      .find((value) => value.length > 0) || '';
  };

  const readTooltipText = (element) => {
    const direct = normalizeText(
      element instanceof Element
        ? element.getAttribute?.('title')
          || readDescribedByText(element)
          || ''
        : '',
      80
    );
    if (direct.length > 0) {
      return direct;
    }
    return Array.from(document.querySelectorAll("[role='tooltip'], [data-radix-tooltip-content], [data-tooltip], [data-state='delayed-open']"))
      .filter((entry) => entry instanceof HTMLElement)
      .map((entry) => normalizeText(entry.innerText || entry.textContent || '', 80))
      .find((value) => value.length > 0) || '';
  };

  const readCursorStyle = (element) => {
    if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) {
      return '';
    }
    return normalizeText(window.getComputedStyle(element).cursor || '', 32);
  };

  const readStateHint = (element) => {
    if (!(element instanceof Element)) {
      return '';
    }
    const expanded = element.getAttribute('aria-expanded');
    if (expanded === 'true') return 'expanded';
    if (expanded === 'false') return 'collapsed';
    const selected = element.getAttribute('aria-selected');
    if (selected === 'true') return 'selected';
    if (selected === 'false') return 'unselected';
    const pressed = element.getAttribute('aria-pressed');
    if (pressed === 'true') return 'pressed';
    if (pressed === 'false') return 'unpressed';
    return normalizeText(element.getAttribute('data-state') || '', 32);
  };

  const inferAffordanceLabel = (element) => normalizeText(
    element instanceof Element
      ? element.getAttribute?.('aria-label')
        || element.getAttribute?.('title')
        || ''
      : '',
    80
  );

  const inferAffordanceAction = (element) => {
    if (!(element instanceof Element)) {
      return '';
    }
    const hasPopup = normalizeText(element.getAttribute?.('aria-haspopup') || '', 24);
    if (hasPopup.length > 0) {
      return 'open ' + hasPopup;
    }
    if (
      element instanceof HTMLInputElement
      || element instanceof HTMLTextAreaElement
      || (element instanceof HTMLElement && element.isContentEditable)
    ) {
      return 'type';
    }
    if (readCursorStyle(element) === 'pointer') {
      return 'click';
    }
    return '';
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
      '.intervention-glow {',
      '  position: fixed;',
      '  inset: 8px;',
      '  border-radius: 22px;',
      '  border: 1.5px solid color-mix(in srgb, ' + APPEARANCE.accentColor + ' 52%, white);',
      '  box-shadow: 0 0 0 1px color-mix(in srgb, ' + APPEARANCE.accentColor + ' 24%, transparent);',
      '  background: none;',
      '  display: none;',
      '}',
      '.intervention-pill {',
      '  position: fixed;',
      '  left: 50%;',
      '  bottom: 18px;',
      '  transform: translateX(-50%);',
      '  display: none;',
      '  align-items: center;',
      '  gap: 8px;',
      '  padding: 10px 14px;',
      '  max-width: min(560px, calc(100vw - 28px));',
      '  border-radius: 999px;',
      '  border: 1px solid color-mix(in srgb, ' + APPEARANCE.accentColor + ' 22%, ' + APPEARANCE.surfaceBorder + ');',
      '  background: color-mix(in srgb, ' + APPEARANCE.surfaceBackground + ' 90%, white);',
      '  color: ' + APPEARANCE.textPrimary + ';',
      '  font-family: ' + APPEARANCE.fontFamily + ';',
      '  font-size: 12px;',
      '  line-height: 1.2;',
      '  box-shadow: ' + APPEARANCE.surfaceShadow + ';',
      '  -webkit-backdrop-filter: ' + APPEARANCE.surfaceBackdropFilter + ';',
      '  backdrop-filter: ' + APPEARANCE.surfaceBackdropFilter + ';',
      '}',
      '.intervention-dot {',
      '  width: 8px;',
      '  height: 8px;',
      '  border-radius: 999px;',
      '  background: ' + APPEARANCE.accentColor + ';',
      '}',
      '.intervention-copy {',
      '  display: inline-flex;',
      '  gap: 6px;',
      '  min-width: 0;',
      '  overflow: hidden;',
      '  text-overflow: ellipsis;',
      '  white-space: nowrap;',
      '}',
      '.intervention-quiet { color: ' + APPEARANCE.textMuted + '; }',
      '.frame, .container-frame {',
      '  position: fixed;',
      '  border: ' + APPEARANCE.strokeWidth + ' solid ' + APPEARANCE.accentColor + ';',
      '  background: ' + APPEARANCE.accentFill + ';',
      '  box-shadow: inset 0 0 0 ' + APPEARANCE.strokeWidth + ' color-mix(in srgb, ' + APPEARANCE.accentColor + ' 22%, transparent);',
      '  border-radius: ' + APPEARANCE.frameRadius + ';',
      '  pointer-events: none;',
      '  display: none;',
      '}',
      '.container-frame {',
      '  border-style: dashed;',
      '  background: color-mix(in srgb, ' + APPEARANCE.accentColor + ' 5%, transparent);',
      '  box-shadow: none;',
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
      '.tag, .phase, .reveal {',
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
      '.reveal {',
      '  background: color-mix(in srgb, ' + APPEARANCE.accentColor + ' 10%, transparent);',
      '  color: ' + APPEARANCE.textMuted + ';',
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
      '<div class="intervention-glow"></div>',
      '<div class="intervention-pill"><span class="intervention-dot"></span><span class="intervention-copy"></span></div>',
      '<div class="container-frame"></div>',
      '<div class="frame"></div>',
      '<div class="bubble">',
      '  <div class="row">',
      '    <span class="tag"></span>',
      '    <span class="meta"></span>',
      '    <span class="phase"></span>',
      '    <span class="reveal"></span>',
      '  </div>',
      '  <span class="text"></span>',
      '  <span class="selector"></span>',
      '  <span class="size"></span>',
      '</div>'
    ].join('');

    const interventionGlow = shadow.querySelector('.intervention-glow');
    const interventionPill = shadow.querySelector('.intervention-pill');
    const interventionCopy = shadow.querySelector('.intervention-copy');
    const containerFrame = shadow.querySelector('.container-frame');
    const frame = shadow.querySelector('.frame');
    const bubble = shadow.querySelector('.bubble');
    const tag = shadow.querySelector('.tag');
    const meta = shadow.querySelector('.meta');
    const phase = shadow.querySelector('.phase');
    const reveal = shadow.querySelector('.reveal');
    const text = shadow.querySelector('.text');
    const selector = shadow.querySelector('.selector');
    const size = shadow.querySelector('.size');
    const previousCursor = document.documentElement.style.cursor;

    const session = {
      root,
      interventionGlow,
      interventionPill,
      interventionCopy,
      containerFrame,
      frame,
      bubble,
      tag,
      meta,
      phase,
      reveal,
      text,
      selector,
      size,
      previousCursor,
      mounted: false,
      manualEnabled: false,
      manualMode: 'inspect',
      currentElement: null,
      currentSnapshot: null,
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
      dispose: null,
      teardown: null,
    };

    session.hideOverlay = () => {
      session.interventionGlow.style.display = 'none';
      session.interventionPill.style.display = 'none';
      session.containerFrame.style.display = 'none';
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
      session.interventionGlow.style.display = 'none';
      session.interventionPill.style.display = 'none';
      session.interventionCopy.textContent = '';
      const bounds = snapshot.bounds;
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
        session.hideOverlay();
        return;
      }
      const outerBounds = snapshot.containerBounds || snapshot.widgetBounds || null;
      if (outerBounds && outerBounds.width > 0 && outerBounds.height > 0) {
        session.containerFrame.style.display = 'block';
        session.containerFrame.style.left = String(outerBounds.x) + 'px';
        session.containerFrame.style.top = String(outerBounds.y) + 'px';
        session.containerFrame.style.width = String(outerBounds.width) + 'px';
        session.containerFrame.style.height = String(outerBounds.height) + 'px';
      } else {
        session.containerFrame.style.display = 'none';
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
      if (typeof snapshot.widgetKind === 'string' && snapshot.widgetKind.trim().length > 0) {
        metaParts.push(snapshot.widgetKind.trim());
      }
      if (typeof snapshot.cursorStyle === 'string' && snapshot.cursorStyle.trim().length > 0) {
        metaParts.push('cursor:' + snapshot.cursorStyle.trim());
      }
      session.meta.textContent = metaParts.join(' · ');
      const preferredText = normalizeText(
        snapshot.affordanceLabel
          || snapshot.tooltipText
          || snapshot.stateHint
          || snapshot.widgetLabel
          || snapshot.ariaLabel
          || snapshot.placeholder
          || snapshot.textSnippet
          || '',
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
      const revealLabel = snapshot.discoveryMode === 'hover_revealed'
        ? 'hover reveal'
        : snapshot.discoveryMode === 'action_revealed'
          ? 'action reveal'
          : '';
      if (revealLabel.length > 0) {
        session.reveal.textContent = revealLabel;
        session.reveal.style.display = 'inline-flex';
      } else {
        session.reveal.textContent = '';
        session.reveal.style.display = 'none';
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

    const resolveLayoutContainer = (element) => {
      let cursor = element instanceof HTMLElement ? element : null;
      while (cursor instanceof HTMLElement) {
        const role = normalizeText(cursor.getAttribute?.('role') || '', 40);
        const tag = cursor.tagName.toLowerCase();
        const label = normalizeText([
          cursor.id || '',
          cursor.getAttribute?.('name') || '',
          cursor.getAttribute?.('aria-label') || '',
          Array.from(cursor.classList || []).join(' ')
        ].join(' '), 200);
        const semantic = tag === 'form'
          || tag === 'dialog'
          || tag === 'nav'
          || tag === 'section'
          || tag === 'article'
          || role === 'dialog'
          || role === 'toolbar'
          || role === 'navigation'
          || role === 'search'
          || label.includes('composer')
          || label.includes('chat')
          || label.includes('search')
          || label.includes('login')
          || label.includes('captcha')
          || label.includes('challenge');
        if (semantic) {
          return cursor;
        }
        cursor = cursor.parentElement;
      }
      return element instanceof HTMLElement ? element.parentElement : null;
    };

    const inferWidgetKind = (container, element) => {
      if (!(container instanceof HTMLElement)) {
        return undefined;
      }
      const label = normalizeText([
        container.id || '',
        container.getAttribute?.('name') || '',
        container.getAttribute?.('aria-label') || '',
        Array.from(container.classList || []).join(' ')
      ].join(' '), 240);
      const tag = container.tagName.toLowerCase();
      const textboxes = container.querySelectorAll('textarea, input, [contenteditable=\"true\"], [role=\"textbox\"], [role=\"searchbox\"]');
      const buttons = container.querySelectorAll('button, [role=\"button\"], a[href]');
      if (label.includes('captcha') || label.includes('challenge') || label.includes('verification')) return 'protected';
      if (label.includes('chat') || label.includes('composer') || (textboxes.length >= 1 && buttons.length >= 1 && element.getBoundingClientRect().top >= window.innerHeight * 0.45)) return 'chat-composer';
      if (tag === 'form' && container.querySelector('input[type=\"password\"]')) return 'login-form';
      if (label.includes('search') || container.getAttribute?.('role') === 'search') return 'search-bar';
      if (container.getAttribute?.('role') === 'toolbar') return 'toolbar';
      if (container.getAttribute?.('role') === 'navigation' || tag === 'nav') return 'navigation';
      if (tag === 'dialog' || container.getAttribute?.('role') === 'dialog') return 'dialog';
      if (tag === 'form') return 'form';
      return 'panel';
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
      const affordanceLabel = inferAffordanceLabel(element);
      const affordanceAction = inferAffordanceAction(element);
      const cursorStyle = readCursorStyle(element);
      const tooltipText = readTooltipText(element);
      const stateHint = readStateHint(element);
      const container = session.manualMode === 'layout' ? resolveLayoutContainer(element) : null;
      const containerRect = container instanceof HTMLElement ? container.getBoundingClientRect() : null;
      const widgetKind = session.manualMode === 'layout' ? inferWidgetKind(container, element) : undefined;
      const widgetLabel = session.manualMode === 'layout' && container instanceof HTMLElement
        ? normalizeText(
            container.getAttribute?.('aria-label')
              || container.getAttribute?.('name')
              || container.id
              || container.innerText
              || '',
            80
          )
        : '';
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
        ...(containerRect && containerRect.width > 0 && containerRect.height > 0
          ? { containerBounds: toBounds(containerRect) }
          : {}),
        ...(widgetKind === undefined ? {} : { widgetKind }),
        ...(widgetLabel.length === 0 ? {} : { widgetLabel }),
        ...(affordanceLabel.length === 0 ? {} : { affordanceLabel }),
        ...(affordanceAction.length === 0 ? {} : { affordanceAction }),
        ...(cursorStyle.length === 0 ? {} : { cursorStyle }),
        ...(tooltipText.length === 0 ? {} : { tooltipText }),
        ...(stateHint.length === 0 ? {} : { stateHint }),
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
      if (!(session.currentElement instanceof Element)) {
        session.currentSnapshot = null;
        session.renderActive();
        return;
      }
      session.currentSnapshot = toManualSnapshot(session.currentElement);
      session.renderActive();
    };

    session.keydown = (event) => {
      if (event.key !== 'Escape' || session.manualEnabled !== true) {
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

    session.setManualMode = (enabled, mode = 'inspect') => {
      session.manualEnabled = enabled === true;
      session.manualMode = mode === 'layout' ? 'layout' : 'inspect';
      document.documentElement.style.cursor = session.manualEnabled ? 'crosshair' : session.previousCursor;
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

export const buildElementPickerSetManualModeScript = (
  enabled: boolean,
  mode: "inspect" | "layout" = "inspect"
): string => `
(() => {
  const SESSION_KEY = ${quote(SESSION_KEY)};
  const session = window[SESSION_KEY];
  if (!session || typeof session.setManualMode !== 'function') {
    return false;
  }
  session.setManualMode(${enabled ? "true" : "false"}, ${quote(mode)});
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
