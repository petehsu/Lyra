import { SURFACE_TARGET_LOOKUP } from "./surface-target";

/** Rendered text only. Shared by dialog context and scoped page reads. */
export const VISIBLE_TEXT_RUNTIME = String.raw`(() => {
  const parent = node => node.parentElement || node.getRootNode?.()?.host || null;
  const exposed = node => {
    if (!node?.isConnected) return false;
    for (let current = node; current; current = parent(current)) {
      if (current.hidden || current.getAttribute('aria-hidden') === 'true' || current.inert) return false;
      const style = current.ownerDocument.defaultView.getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) return false;
    }
    return true;
  };
  const frameClip = (node, viewport = false) => {
    if (!exposed(node)) return null;
    let box = node.getBoundingClientRect();
    let left = box.left, right = box.right, top = box.top, bottom = box.bottom;
    if (viewport) {
      const win = node.ownerDocument.defaultView;
      left = Math.max(0,left); top = Math.max(0,top);
      right = Math.min(win.innerWidth,right); bottom = Math.min(win.innerHeight,bottom);
      for (let owner = parent(node); owner; owner = parent(owner)) {
        const style = win.getComputedStyle(owner), rect = owner.getBoundingClientRect();
        if (owner === node.ownerDocument.body || owner === node.ownerDocument.documentElement) continue;
        if (/(hidden|clip|scroll|auto)/.test(style.overflowX)) {left = Math.max(left,rect.left); right = Math.min(right,rect.right);}
        if (/(hidden|clip|scroll|auto)/.test(style.overflowY)) {top = Math.max(top,rect.top); bottom = Math.min(bottom,rect.bottom);}
      }
    }
    return right > left && bottom > top ? {left:left-box.left-node.clientLeft, top:top-box.top-node.clientTop,
      right:right-box.left-node.clientLeft, bottom:bottom-box.top-node.clientTop} : null;
  };
  const frameVisible = (node, viewport = false) => frameClip(node,viewport) !== null;
  const read = (root, { viewport = false, limit = 6000, excludeControls = false, readToken, clip, scanAll = false, tail = false, textNeedle } = {}) => {
    const parts = []; let length = 0, visited = 0, truncated = false, unreadFrames = 0, scanComplete = true;
    if (readToken) root.ownerDocument.defaultView.__lyraTextReadToken = readToken;
    const visit = node => {
      if (++visited > 25000 || (!scanAll && length > limit)) { truncated = true; scanComplete = false; return; }
      if (node.nodeType === 3) {
        const value = node.textContent.replace(/\s+/g, ' ').trim();
        if (!value || !exposed(parent(node))) return;
        const doc = node.ownerDocument, win = doc.defaultView;
        const range = doc.createRange(); range.selectNodeContents(node);
        const rects = Array.from(range.getClientRects());
        if (!rects.some(rect => {
          let left = viewport ? Math.max(clip?.left ?? 0, rect.left) : rect.left;
          let top = viewport ? Math.max(clip?.top ?? 0, rect.top) : rect.top;
          let right = viewport ? Math.min(clip?.right ?? win.innerWidth, rect.right) : rect.right;
          let bottom = viewport ? Math.min(clip?.bottom ?? win.innerHeight, rect.bottom) : rect.bottom;
          if (viewport) for (let owner = parent(node); owner;) {
            const style = win.getComputedStyle(owner), box = owner.getBoundingClientRect();
            const rootStyle = win.getComputedStyle(doc.documentElement);
            // Root overflow (and body overflow propagated by the root) clips
            // the viewport, not a possibly zero-height body layout box.
            const viewportOverflow = owner === doc.documentElement || (owner === doc.body
              && rootStyle.overflowX === 'visible' && rootStyle.overflowY === 'visible'
              && rootStyle.contain === 'none' && style.contain === 'none');
            if (!viewportOverflow) {
              if (/(hidden|clip|scroll|auto)/.test(style.overflowX)) { left = Math.max(left, box.left); right = Math.min(right, box.right); }
              if (/(hidden|clip|scroll|auto)/.test(style.overflowY)) { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom); }
            }
            // Out-of-flow descendants escape intermediate overflow ancestors.
            // Chromium's offsetParent supplies their actual containing block,
            // including blocks established by transforms and containment.
            owner = style.position === 'absolute' || style.position === 'fixed' ? owner.offsetParent : parent(owner);
          }
          if (viewport) {
            let view = win;
            while (view.frameElement) {
              const frame = view.frameElement;
              if (!frameVisible(frame,true)) return false;
              const box = frame.getBoundingClientRect();
              left += box.left + frame.clientLeft; right += box.left + frame.clientLeft;
              top += box.top + frame.clientTop; bottom += box.top + frame.clientTop;
              view = frame.ownerDocument.defaultView;
              left = Math.max(0,left); top = Math.max(0,top);
              right = Math.min(view.innerWidth,right); bottom = Math.min(view.innerHeight,bottom);
            }
          }
          return right > left && bottom > top;
        })) return;
        parts.push(value); length += value.length + 1;
        return;
      }
      if (node.nodeType === 1) {
        if (node.matches('script,style,noscript,template') || !exposed(node)) return;
        if (excludeControls && node !== root && node.matches('button,input,textarea,select,[role=button],[role=textbox]')) return;
        if (node.tagName === 'SLOT') {
          const assigned = node.assignedNodes({ flatten: true });
          if (assigned.length) { for (const child of assigned) visit(child); return; }
        }
        if (node.shadowRoot) { visit(node.shadowRoot); return; }
        if (node.matches('iframe,frame')) {
          if (!frameVisible(node,viewport)) return;
          try {
            const body = node.contentDocument?.body;
            if (body) {
              if (readToken) body.ownerDocument.defaultView.__lyraTextReadToken = readToken;
              visit(viewport ? focusRoot(body.ownerDocument) : body); return;
            }
          } catch {}
          unreadFrames++; return;
        }
      }
      for (const child of node.childNodes || []) {
        visit(child);
        if (truncated) break;
      }
    };
    visit(root);
    const text = parts.join(' ');
    // Fingerprint the complete rendered text, independently of output budget.
    // A stable excerpt must never conceal a changing offscreen remainder.
    let h1 = 2166136261, h2 = 5381;
    if (scanAll) for (let i = 0; i < text.length; i++) {
      h1 = Math.imul(h1 ^ text.charCodeAt(i), 16777619); h2 = Math.imul(h2, 33) ^ text.charCodeAt(i);
    }
    const startChar = tail ? Math.max(0, text.length - limit) : 0;
    return { text: text.slice(startChar, startChar + limit), startChar, totalChars: text.length,
      textMatch: typeof textNeedle === "string" ? text.includes(textNeedle) : undefined,
      textFingerprint: scanAll && scanComplete ? [h1 >>> 0,h2 >>> 0,text.length].join(':') : undefined,
      scanComplete: scanComplete && !unreadFrames, truncated: truncated || text.length > limit, unreadFrames };
  };
  const focusRoot = doc => {
    const dialogs = [];
    const scan = root => {
      for (const node of root.querySelectorAll('*')) {
        if (node.matches('dialog[open],[role=dialog][aria-modal=true],[role=alertdialog]') && exposed(node) && node.getClientRects().length) dialogs.push(node);
        if (node.shadowRoot) scan(node.shadowRoot);
      }
    };
    scan(doc);
    return dialogs.at(-1) || doc.body;
  };
  return { read, exposed, focusRoot, frameVisible, frameClip };
})()`;

export const buildVisiblePageReadScript = (scope: "viewport" | "full", limit: number, waitTargetRef?: string, readToken?: string, clip?: {left:number;top:number;right:number;bottom:number}, tail = false, textNeedle?: string): string => `(() => {
  ${SURFACE_TARGET_LOOKUP}
  const visibleText = ${VISIBLE_TEXT_RUNTIME};
  const root = ${scope === "viewport"} ? visibleText.focusRoot(document) : document.body;
  const rendered = visibleText.read(root, { viewport: ${scope === "viewport"}, limit: ${limit}, readToken: ${JSON.stringify(readToken ?? null)}, clip: ${JSON.stringify(clip ?? null)}, scanAll: true, tail: ${tail}, textNeedle: ${JSON.stringify(textNeedle ?? null)} });
  const target = ${waitTargetRef === undefined ? "null" : `findSurfaceTarget(${JSON.stringify(waitTargetRef)})`};
  const visible = node => !!node && visibleText.exposed(node) && Array.from(node.getClientRects()).some(rect => rect.width > 0 && rect.height > 0);
  const enabled = node => {
    if (!visible(node)) return false;
    for (let owner = node; owner; owner = owner.parentElement || owner.getRootNode()?.host) {
      if (owner.matches(':disabled,[aria-disabled=true],[inert]')) return false;
    }
    return true;
  };
  let embeddedReadiness = "complete";
  const busyIn = root => {
    if (!root) return false;
    if (root.nodeType === 1 && root.matches('[aria-busy=true]') && visible(root)) return true;
    for (const node of root.querySelectorAll('[aria-busy=true]')) if (visible(node)) return true;
    let busy = false;
    for (const node of root.querySelectorAll('*')) {
      if (node.shadowRoot && busyIn(node.shadowRoot)) busy = true;
      if (node.matches('iframe,frame') && visibleText.frameVisible(node, ${scope === "viewport"})) {
        try {
          const doc = node.contentDocument;
          if (doc?.readyState && doc.readyState !== 'complete') embeddedReadiness = doc.readyState;
          if (doc?.body && busyIn(doc.body)) busy = true;
        } catch {}
      }
    }
    return busy;
  };
  const busy = busyIn(root);
  const waitState = { readyState: document.readyState === 'complete' ? embeddedReadiness : document.readyState, busy, textFingerprint: rendered.textFingerprint, textMatch: rendered.textMatch,
    coverage: { scope: ${JSON.stringify(scope)}, scanComplete: rendered.scanComplete, startChar: rendered.startChar, totalChars: rendered.totalChars, excerpt: ${JSON.stringify(tail ? "tail" : "head")} },
    ${waitTargetRef === undefined ? "" : `target: { visible: visible(target), enabled: enabled(target) },`}
  };
  return { text: rendered.text, startChar: rendered.startChar, endChar: rendered.startChar + rendered.text.length,
    totalChars: rendered.totalChars, unreadFrames: rendered.unreadFrames, truncated: rendered.truncated, hasMore: rendered.truncated, waitState };
})()`;
