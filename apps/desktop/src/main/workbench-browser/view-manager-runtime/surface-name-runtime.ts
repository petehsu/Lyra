import { FIELD_DESCRIPTION_RUNTIME } from "./field-description-runtime";
import { CHOICE_CONTROL_RUNTIME } from "./choice-control-runtime";
import { SURFACE_TARGET_LOOKUP } from "./surface-target";

// Page-owned evidence only. A tooltip is a description, not an invented
// accessible name. Cache by physical node and naming/state signature, never ref
// ordinal, screen coordinates, CSS class, or a previous page's label.
export const surfaceNameRuntime = String.raw`(() => {
  const key = "__lyraSurfaceNamesV5";
  if (window[key]) return window[key];
  const choices = ${CHOICE_CONTROL_RUNTIME};
  const cache = new WeakMap(), pending = new WeakMap(), pointers = new WeakMap(), tracked = new WeakSet();
  const clean = value => String(value || "").replace(/\s+/g, " ").trim().slice(0, 160);
  const parent = node => node.parentElement || node.getRootNode()?.host;
  const tooltipAttributes = ["data-tooltip", "data-tooltip-content", "data-tippy-content", "data-tip", "data-original-title", "data-bs-title", "data-bs-original-title"];
  const signature = node => JSON.stringify([
    String(node.ownerDocument.location?.href), node.innerHTML,
    node.matches(':disabled,[aria-disabled=true]'), node.getAttribute('class'),
    node.closest('form')?.querySelector('input:not([type=hidden]),textarea,[contenteditable=true]')?.value?.length > 0, ...["title", "aria-label", "aria-labelledby", "aria-describedby", "aria-expanded",
      "aria-pressed", "aria-checked", "data-state", "disabled", "placeholder", "alt", ...tooltipAttributes].map(attr => node.getAttribute(attr))
  ]);
  const visible = node => {
    if (!node?.isConnected) return false;
    const box = node.getBoundingClientRect();
    if (!box.width || !box.height) return false;
    for (let current = node; current; current = parent(current)) {
      const style = current.ownerDocument.defaultView.getComputedStyle(current);
      if (current.hidden || style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    }
    return true;
  };
  const related = node => String(node.getAttribute("aria-describedby") || "").split(/\s+/)
    .map(id => node.getRootNode().getElementById?.(id)).filter(Boolean);
  const controlSelector = 'button,a[href],input,select,textarea,[role=button],[role=link],[role=menuitem],[tabindex]';
  const tooltip = node => {
    // Read tooltip text already supplied by the page without causing hover.
    for (const attr of tooltipAttributes) {
      const value = clean(node.getAttribute(attr));
      if (value && !/^(true|false|#[\w-]+)$/.test(value)) return value;
    }
    const described = related(node).filter(item => item.getAttribute("role") === "tooltip");
    const description = clean(described.map(item => item.textContent).join(" "));
    return description;
  };
  const hint = node => {
    const description = tooltip(node);
    if (description) return description;
    for (const child of node.querySelectorAll('svg[aria-label],svg title,img[alt],[title]')) {
      // Do not steal a nested control's name for its container.
      const owner = child.closest(controlSelector);
      if (owner && owner !== node && node.contains(owner)) continue;
      const value = clean(child.getAttribute("aria-label") || child.getAttribute("alt") || child.getAttribute("title") || child.textContent);
      if (value) return value;
    }
    for (const pseudo of ["::before", "::after"]) {
      const content = node.ownerDocument.defaultView.getComputedStyle(node, pseudo).content || "";
      const match = content.match(/^(["'])(.*?)\1$/);
      // Icon-font codepoints and lone glyphs carry no textual meaning.
      if (match && /[\p{L}\p{N}]{2}/u.test(match[2])) return clean(match[2]);
    }
    return "";
  };
  const cached = node => {
    const found = cache.get(node);
    return node.isConnected && found && found.owner === parent(node) && found.signature === signature(node)
      && (found.text || Date.now() < found.until) ? found : null;
  };
  const label = node => {
    const root = node.getRootNode();
    const referenced = String(node.getAttribute("aria-labelledby") || "").split(/\s+/)
      .map(id => root.getElementById?.(id)?.textContent || "").join(" ");
    const values = [referenced, node.getAttribute("aria-label"),
      choices.isChoice(node) ? choices.labelText(node) : Array.from(node.labels || []).map(item => item.textContent).join(" "),
      node.getAttribute("title"),
      /^[Xx•●_\-\s]+$/.test(node.getAttribute("placeholder") || "") ? (${FIELD_DESCRIPTION_RUNTIME})(node) : "",
      node.getAttribute("placeholder"), node.getAttribute("alt"),
      typeof node.innerText === "string" ? node.innerText : node.textContent,
      node.matches('input[type=button],input[type=submit],input[type=reset]') ? node.value : ""];
    for (const value of values) {
      const text = clean(value);
      if (text.replace(/[\s\u3164\u2800\u200b\u200c\u200d\ufeff]/g, "")) return text;
    }
    return hint(node) || cached(node)?.text || "";
  };
  // Positive evidence belongs to this node/state, not a wall-clock lease.
  // Only failed probes expire, so transient missing tooltips can be retried.
  const remember = (node, text) => cache.set(node, { text, owner: parent(node), signature: signature(node), until: Date.now() + 30000 });
  // Observe tooltip candidates, not the first N nodes of the document. Portals
  // are commonly appended after thousands of chat/message nodes.
  const watch = node => {
    const candidates = new Set(), roots = new WeakSet();
    const collect = root => {
      if (root.nodeType === 1) candidates.add(root);
      for (const item of root.querySelectorAll?.('*') || []) {
        candidates.add(item);
        if (item.shadowRoot) seed(item.shadowRoot);
      }
    };
    const accept = records => {
      for (const record of records) {
        const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
        if (target) candidates.add(target);
        for (const added of record.addedNodes || []) if (added.nodeType === 1) collect(added);
      }
    };
    const observer = new MutationObserver(accept);
    const seed = root => {
      if (roots.has(root)) return;
      roots.add(root);
      for (const tip of root.querySelectorAll('[role=tooltip],[popover]')) candidates.add(tip);
      for (const item of root.querySelectorAll('*')) if (item.shadowRoot) seed(item.shadowRoot);
      observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true,
        attributeFilter: ['class','style','hidden','aria-hidden','aria-describedby','role'] });
    };
    seed(node.ownerDocument);
    // Include already-visible custom floating text near the control so it is
    // not mistaken for a new tooltip when the pointer moves.
    const box = node.getBoundingClientRect();
    for (const x of [box.left - 20, box.left + box.width / 2, box.right + 20]) {
      for (const y of [box.top - 20, box.top + box.height / 2, box.bottom + 20]) {
        for (const item of node.getRootNode().elementsFromPoint?.(x, y) || []) candidates.add(item);
      }
    }
    const expiry = setTimeout(() => observer.disconnect(), 2500);
    return { candidates, drain: () => accept(observer.takeRecords()), close: () => { clearTimeout(expiry); observer.disconnect(); } };
  };
  const snapshot = (node, watched) => {
    watched.drain();
    const result = new Map(), linkedNodes = related(node);
    for (const item of linkedNodes) watched.candidates.add(item);
    const a = node.getBoundingClientRect();
    for (const item of watched.candidates) {
      if (!item.isConnected || item === node || node.contains(item) || item.contains?.(node)) continue;
      const linked = linkedNodes.includes(item), explicit = item.getAttribute('role') === 'tooltip' || linked;
      if (item.matches(controlSelector) || item.querySelector(controlSelector)) continue;
      if (item.closest('[role=alert],[role=status],[role=menu],[role=listbox]')) continue;
      const b = item.getBoundingClientRect();
      const gapX = Math.max(a.left - b.right, b.left - a.right, 0);
      const gapY = Math.max(a.top - b.bottom, b.top - a.bottom, 0);
      if (!linked && (gapX > (explicit ? 80 : 40) || gapY > (explicit ? 80 : 40))) continue;
      const style = item.ownerDocument.defaultView.getComputedStyle(item);
      if (!explicit && !['fixed','absolute'].includes(style.position)) continue;
      const text = clean(item.innerText || item.textContent);
      if (text && text.length <= 120 && visible(item)) result.set(item, { text, linked });
    }
    return result;
  };
  const begin = (node, force) => {
    if (!node || !visible(node) || (!force && cached(node))) return false;
    track(node.ownerDocument);
    pending.get(node)?.watched.close();
    const watched = watch(node);
    pending.set(node, { before: snapshot(node, watched), signature: signature(node), watched });
    return true;
  };
  const finish = async (node, timeout) => {
    const started = pending.get(node);
    if (!started) return "";
    const deadline = Date.now() + timeout;
    try {
      do {
        // Chromium does not consistently expose :hover for CDP mouse moves
        // when the page has no hover styles. Use the actual pointer event and
        // a live hit test, also rejecting a pointer that left the target.
        const localPointer = pointers.get(node.ownerDocument);
        if (!node.isConnected || !localPointer) return "";
        const hit = node.getRootNode().elementFromPoint?.(localPointer.x, localPointer.y);
        if (hit !== node && !node.contains(hit)) return "";
        const hints = hint(node);
        const now = snapshot(node, started.watched);
        const added = [...now].filter(([item, value]) => value.linked || started.before.get(item)?.text !== value.text);
        const linked = added.filter(([, value]) => value.linked);
        const texts = [...new Set((linked.length ? linked : added).map(([, value]) => value.text))];
        const text = hints || (texts.length === 1 ? texts[0] : "");
        if (text) { remember(node, text); return text; }
        if (Date.now() >= deadline) break;
        await new Promise(resolve => setTimeout(resolve, 40));
      } while (true);
      if (started.signature === signature(node)) remember(node, "");
      return "";
    } finally { started.watched.close(); pending.delete(node); }
  };
  let pointer = null;
  const track = doc => {
    if (tracked.has(doc)) return;
    tracked.add(doc);
    doc.defaultView.addEventListener("pointermove", event => {
      const local = { x: event.clientX, y: event.clientY };
      pointers.set(doc, local);
      let x = local.x, y = local.y, view = doc.defaultView;
      while (view && view !== window) {
        const frame = view.frameElement;
        if (!frame) break;
        const box = frame.getBoundingClientRect();
        x += box.left + frame.clientLeft; y += box.top + frame.clientTop;
        view = frame.ownerDocument.defaultView;
      }
      pointer = { x, y };
    }, true);
  };
  track(document);
  const api = { label, hint, tooltip, cached, begin, finish, pointer: () => pointer };
  window[key] = api;
  return api;
})()`;

export const beginSurfaceNameProbeScript = (targetRef: string, force = false): string => `(() => {
  ${SURFACE_TARGET_LOOKUP}
  const names = ${surfaceNameRuntime};
  const node = findSurfaceTarget(${JSON.stringify(targetRef)});
  if (!node || node.matches(':disabled') || node.closest('[inert],[aria-disabled=true]')) return null;
  const box = node.getBoundingClientRect();
  const root = node.getRootNode();
  const x = box.left + box.width / 2, y = box.top + box.height / 2;
  const hit = root.elementFromPoint?.(x, y);
  if (hit !== node && !node.contains(hit)) return null;
  if (!names.begin(node, ${force})) return null;
  const global = surfaceGlobalRect(node);
  return { x: Math.round(global.x + box.width / 2), y: Math.round(global.y + box.height / 2), restore: names.pointer() };
})()`;

export const finishSurfaceNameProbeScript = (targetRef: string, timeoutMs = 650): string => `(() => {
  ${SURFACE_TARGET_LOOKUP}
  const names = ${surfaceNameRuntime};
  const node = findSurfaceTarget(${JSON.stringify(targetRef)});
  return node ? names.finish(node, ${Math.max(0, Math.min(timeoutMs, 1500))}) : "";
})()`;
