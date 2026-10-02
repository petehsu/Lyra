import { SURFACE_DOM_ACCESS } from "./surface-dom-access";
import { SURFACE_TARGET_LOOKUP } from "./surface-target";
import { browserTargetVisibilityRuntime } from "./agent-target-visibility";
import { browserEditableTextRuntime, browserEditingHostRuntime } from "./agent-editable-runtime";
import { browserMapSemanticsScript } from "./agent-page-semantics";
import type { WorkbenchBrowserControlSemantics } from "../types";

export type BrowserInputEvidence = {
  readonly valueMatches: boolean;
  readonly inputEventObserved: boolean;
  readonly beforeInputCancelled: boolean;
};

export type BrowserTextInsertionResult = {
  readonly ok: boolean;
  readonly method?: string;
  readonly textChanged?: boolean;
  readonly textPreview?: string;
  readonly alreadyMatched?: boolean;
  readonly validation?: { readonly valid: boolean; readonly message: string };
  readonly fieldState?: WorkbenchBrowserControlSemantics;
  readonly evidence?: BrowserInputEvidence;
  readonly errorKind?: string;
  readonly message?: string;
};

// DOM code only resolves the editing host and prepares its selection. Text-like
// controls receive Chromium input, including cancellable, trusted beforeinput.
// Date/color/range controls have no portable text caret: their explicit value
// pathway is kept separate, as in Playwright's native form-control handling.
const runtime = String.raw`
  ${SURFACE_TARGET_LOOKUP}
  ${SURFACE_DOM_ACCESS}
  const fail = errorKind => ({ok:false, errorKind, message:({
    editable_changed: "The editor was replaced or focus moved outside the requested field. Map the page before retrying.",
    input_not_accepted: "The current field value differs from the requested edit. Inspect the returned value before deciding whether to replace it; do not repeat or submit the write automatically.",
    editable_covered: "Another element covers the editor; no text was inserted.",
    editable_not_ready: "The editor is disabled, readonly or inert; no text was inserted."
  })[errorKind]});
  const focused = surfaceActiveElement;
  const editable = node => {
    if (!node) return null;
    if (node.matches('input:not([type=hidden]),textarea')) return node;
    const host = (${browserEditingHostRuntime})(node);
    if (host) return host;
    return node.querySelector?.('input:not([type=hidden]),textarea,[contenteditable=true],[contenteditable=""],[contenteditable="plaintext-only"]') || null;
  };
  const selection = node => node.getRootNode().getSelection?.() ?? node.ownerDocument.getSelection();
  const ownsSelection = node => {
    const sel = selection(node);
    return node.isContentEditable && sel?.rangeCount && node.contains(sel.anchorNode) && node.contains(sel.focusNode);
  };
  const check = node => {
    if (!node?.isConnected) return fail('editable_changed');
    for (let owner = node; owner; owner = owner.parentElement || owner.getRootNode()?.host) {
      if (owner.matches(':disabled,[aria-disabled=true],[aria-readonly=true],[inert]') || owner.readOnly) return fail('editable_not_ready');
    }
    if (!(${browserTargetVisibilityRuntime})(node)) return fail('editable_not_visible');
    const rect = node.getBoundingClientRect(), doc = node.ownerDocument;
    const hit = surfaceHitForNode(node, rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (hit !== node && !node.contains(hit)) return fail('editable_covered');
    let view = doc.defaultView;
    while (view.frameElement) {
      const owner = view.frameElement;
      if (!(${browserTargetVisibilityRuntime})(owner)) return fail('editable_not_visible');
      const box = owner.getBoundingClientRect(), parent = owner.ownerDocument;
      let over = parent.elementFromPoint(box.left + box.width/2, box.top + box.height/2);
      while (over?.shadowRoot?.elementFromPoint) {
        const inner = over.shadowRoot.elementFromPoint(box.left + box.width/2, box.top + box.height/2);
        if (!inner || inner === over) break; over = inner;
      }
      if (over !== owner) return fail('editable_covered');
      view = parent.defaultView;
    }
    return null;
  };
  const editorText = ${browserEditableTextRuntime};
  const value = node => node.matches('input,textarea') ? node.value : editorText(node);
  const canonical = (node, text) => node.isContentEditable ? text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ') : text;
`;

export const prepareTextInputScript = (key: string, targetRef: string, preferFocused: boolean): string => `(() => {
  ${runtime}
  const candidate = ${preferFocused ? "focused(document)" : `findSurfaceTarget(${JSON.stringify(targetRef)})`};
  const node = editable(candidate) || (candidate?.matches('[role=textbox],[role=searchbox]') ? candidate : null);
  const error = check(node); if (error) return error;
  const preserve = !!editable(node) && (focused(node.ownerDocument) === node || (ownsSelection(node) && !selection(node).isCollapsed));
  const bounds = surfaceGlobalRect(node);
  window[${JSON.stringify(key)}] = {node, preserve, bounds};
  const nativeValue = node.tagName === 'INPUT' && ['date','time','datetime-local','month','week','color','range'].includes(node.type);
  // These controls are filled through their native value contract. A pointer
  // click would open an OS picker unrelated to the requested value assignment.
  return {ok:true, needsClick:!preserve && !nativeValue, x:bounds.x + bounds.width/2, y:bounds.y + bounds.height/2};
})()`;

export const armTextInputScript = (key: string, text: string, clear: boolean): string => `(() => {
  ${runtime}
  const state = window[${JSON.stringify(key)}];
  if (!state) return fail('editable_changed');
  let node = state.node;
  // A click can replace a placeholder shell with a real editor. Only follow
  // the actual focused editing host in that same on-screen field.
  if (!state.preserve && focused(node.ownerDocument) !== node && node.matches('input,textarea')) {
    // A code widget can redirect focus during pointer handling. Focus the
    // exact connected native field; never follow that redirection elsewhere.
    if (!node.isConnected) return fail('editable_changed');
    node.focus({preventScroll:true});
    if (focused(node.ownerDocument) !== node) return fail('editable_changed');
  }
  if (!state.preserve && focused(node.ownerDocument) !== node) {
    const active = editable(focused(document));
    const rect = active?.isConnected ? surfaceGlobalRect(active) : null;
    const box = state.bounds;
    if (!rect || rect.x >= box.x + box.width || rect.y >= box.y + box.height
      || rect.x + rect.width <= box.x || rect.y + rect.height <= box.y) return fail('editable_changed');
    node = active;
  }
  const error = check(node); if (error) return error;
  if (!node.matches('input,textarea') && !node.isContentEditable) return fail('editable_changed');
  const TEXT = ${JSON.stringify(text)}, CLEAR = ${clear};
  const before = value(node), input = node.matches('input,textarea');
  const special = node.tagName === 'INPUT' && ['date','time','datetime-local','month','week','color','range'].includes(node.type);
  if (node.tagName === 'INPUT' && !special && !['text','email','number','password','search','tel','url'].includes(node.type)) return fail('unsupported_input_type');
  node.focus({preventScroll:true});
  if (focused(node.ownerDocument) !== node || !node.isConnected) return fail('editable_changed');
  state.node = node; state.before = before;
  state.method = special ? 'nativeFormValue' : 'chromium.insertText';
  // Skipping is safe for incremental input too: only an exact whole-value
  // match skips, so partial appends still insert at the caret.
  state.alreadyMatched = canonical(node,before) === canonical(node,TEXT);
  state.expected = TEXT;
  if (state.alreadyMatched) return {ok:true, skipInput:true};
  if (special) {
    if (!CLEAR && before) return fail('non_text_control_requires_clear');
    const setter = Object.getOwnPropertyDescriptor(node.ownerDocument.defaultView.HTMLInputElement.prototype, 'value').set;
    setter.call(node, TEXT);
    if (node.value !== TEXT) { setter.call(node, before); return fail('invalid_native_value'); }
    node.dispatchEvent(new node.ownerDocument.defaultView.Event('input', {bubbles:true,composed:true}));
    node.dispatchEvent(new node.ownerDocument.defaultView.Event('change', {bubbles:true}));
    return {ok:true, skipInput:true};
  }
  if (input) {
    if (CLEAR) node.select();
    else if (!state.preserve) {
      try { node.setSelectionRange(before.length, before.length); } catch {}
    }
    const start = CLEAR ? 0 : node.selectionStart;
    const end = CLEAR ? before.length : node.selectionEnd;
    state.expected = start === null ? null : before.slice(0,start) + TEXT + before.slice(end);
  } else {
    const sel = selection(node);
    if (CLEAR || !state.preserve || !ownsSelection(node)) {
      const range = node.ownerDocument.createRange(); range.selectNodeContents(node);
      if (!CLEAR) range.collapse(false);
      sel.removeAllRanges(); sel.addRange(range);
    }
    const range = sel.getRangeAt(0), prefix = node.ownerDocument.createRange();
    prefix.selectNodeContents(node); prefix.setEnd(range.startContainer, range.startOffset);
    const start = editorText(prefix.cloneContents()).length;
    prefix.setEnd(range.endContainer, range.endOffset);
    const end = editorText(prefix.cloneContents()).length;
    state.expected = before.slice(0,start) + TEXT + before.slice(end);
  }
  state.text = TEXT; state.events = [];
  state.listener = event => { if (event.target === node && event.isTrusted) state.events.push(event); };
  node.addEventListener('beforeinput', state.listener, true);
  node.addEventListener('input', state.listener, true);
  return {ok:true, skipInput:!TEXT && !CLEAR};
})()`;

export const verifyTextInputScript = (key: string): string => `(() => {
  ${runtime}
  const state = window[${JSON.stringify(key)}];
  if (!state?.node) return fail('editable_changed');
  const node = state.node;
  if (!node.isConnected) return fail('editable_changed');
  const actual = value(node);
  const inputEventObserved = !!state.events?.some(event => event.type === 'input');
  const matches = state.expected === null
    ? actual.includes(state.text) && (actual !== state.before || inputEventObserved)
    : canonical(node,actual) === canonical(node,state.expected);
  const evidence = {valueMatches:matches, inputEventObserved,
    beforeInputCancelled:!!state.events?.some(event => event.type === 'beforeinput' && event.defaultPrevented)};
  const preview = node.type === 'password' ? {} : {textPreview:actual.slice(0,240)};
  // Editors can stop propagation or handle beforeinput themselves. Native
  // insertion plus the exact connected-host outcome is authoritative; absence
  // of our optional event listener is not evidence that the write failed.
  if (!matches) return {...fail('input_not_accepted'), ...preview, evidence, textChanged:actual !== state.before};
  const fieldState = (${browserMapSemanticsScript}).control(node);
  return {ok:true, fieldState, validation:{valid:!fieldState.invalid && (!node.validity || node.validity.valid),message:fieldState.validationMessage || node.validationMessage || ""}, method:state.alreadyMatched ? 'alreadyMatched' : state.method,
    alreadyMatched:state.alreadyMatched, textChanged:actual !== state.before, evidence, ...preview};
})()`;

export const cleanupTextInputScript = (key: string): string => `(() => {
  const state = window[${JSON.stringify(key)}]; delete window[${JSON.stringify(key)}];
  if (state?.listener) for (const event of ['beforeinput','input']) state.node.removeEventListener(event,state.listener,true);
})()`;
