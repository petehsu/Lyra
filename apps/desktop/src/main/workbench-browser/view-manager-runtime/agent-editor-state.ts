import { SURFACE_DOM_ACCESS } from "./surface-dom-access";
import { SURFACE_TARGET_LOOKUP } from "./surface-target";
import { browserTargetVisibilityRuntime } from "./agent-target-visibility";

export type BrowserEditorPreparation = { readonly ok: boolean; readonly errorKind?: string; readonly message?: string };

// A key target is focused, never clicked. Clicking a submit button merely to
// focus it is an extra action; clicking an editor destroys its caret/selection.
export const prepareBrowserKeyTargetScript = (targetRef: string, selectText?: string, occurrence?: number): string => `(() => {
  ${SURFACE_TARGET_LOOKUP}
  ${SURFACE_DOM_ACCESS}
  const node = findSurfaceTarget(${JSON.stringify(targetRef)});
  const fail = errorKind => ({ ok: false, errorKind, message: ({
    target_not_visible: "The target has no visible rendered box. Reveal it before retrying; no key was sent.",
    target_not_ready: "The target is disabled or inert; no key was sent.",
    target_covered: "Another element covers the target. Dismiss the obstruction before retrying; no key was sent.",
    target_not_focusable: "The target did not accept keyboard focus; no key was sent."
  })[errorKind] });
  if (!node?.isConnected) return fail("stale_target");
  const doc = node.ownerDocument, win = doc.defaultView;
  for (let parent = node; parent; parent = parent.parentElement || parent.getRootNode?.().host) {
    if (parent.inert || parent.getAttribute?.("aria-disabled") === "true") return fail("target_not_ready");
  }
  if (!(${browserTargetVisibilityRuntime})(node)) return fail("target_not_visible");
  if (node.matches(":disabled")) return fail("target_not_ready");
  node.scrollIntoView({block:"nearest",inline:"nearest",behavior:"instant"});
  const rect = node.getBoundingClientRect();
  if (!rect.width || !rect.height) return fail("target_not_visible");
  const hit = surfaceHitForNode(node, rect.left + rect.width / 2, rect.top + rect.height / 2);
  if (hit !== node && !node.contains(hit)) return fail("target_covered");
  const text = ${JSON.stringify(selectText ?? null)}, occurrence = ${JSON.stringify(occurrence ?? null)};
  const input = node instanceof win.HTMLInputElement || node instanceof win.HTMLTextAreaElement;
  let start = 0;
  if (text !== null) {
    if ((!input && !node.isContentEditable) || node.type === "password") return fail("text_selection_unavailable");
    if (!text.length) return fail("selection_text_empty");
    const contents = input ? node.value : node.textContent;
    const matches = [];
    for (let offset = contents.indexOf(text); offset >= 0; offset = contents.indexOf(text, offset + 1)) matches.push(offset);
    if (!matches.length) return fail("selection_text_not_found");
    if (occurrence === null && matches.length !== 1) return { ok: false, errorKind: "selection_ambiguous", message: "Text occurs " + matches.length + " times. Supply a longer unique phrase or a 1-based occurrence." };
    if (occurrence !== null && (!Number.isInteger(occurrence) || occurrence < 1 || occurrence > matches.length)) return fail("selection_occurrence_invalid");
    start = matches[(occurrence ?? 1) - 1];
  }
  node.focus({preventScroll:true});
  const active = surfaceActiveElement(doc);
  if (active !== node && !node.contains(active)) return fail("target_not_focusable");
  if (text !== null) {
    if (input) {
      try { node.setSelectionRange(start, start + text.length); }
      catch { return fail("text_selection_unavailable"); }
      if (node.selectionStart !== start || node.selectionEnd !== start + text.length) return fail("text_selection_unavailable");
    } else {
      const walker = doc.createTreeWalker(node, win.NodeFilter.SHOW_TEXT);
      const range = doc.createRange();
      let offset = 0, began = false, ended = false;
      while (walker.nextNode()) {
        const item = walker.currentNode, end = offset + item.textContent.length;
        if (!began && start < end) { range.setStart(item, start - offset); began = true; }
        if (began && start + text.length <= end) { range.setEnd(item, start + text.length - offset); ended = true; break; }
        offset = end;
      }
      if (!ended) return fail("text_selection_unavailable");
      const selection = node.getRootNode().getSelection?.() ?? doc.getSelection();
      selection.removeAllRanges(); selection.addRange(range);
      if (selection.toString() !== text) return fail("text_selection_unavailable");
    }
  }
  return { ok: true };
})()`;

/** Read focus and selection without changing either. Never expose password text. */
export const browserEditorStateRuntime = String.raw`(doc => {
  ${SURFACE_DOM_ACCESS}
  const node = surfaceActiveElement(doc);
  if (!node || node.type === "password") return null;
  const input = node.tagName === "INPUT" || node.tagName === "TEXTAREA";
  if (!input && !node.isContentEditable) return null;
  const result = { targetRef: node.getAttribute("data-lyra-surface"), kind: input ? "input" : "richText" };
  if (input) {
    if (node.selectionStart === null) return result;
    result.start = node.selectionStart; result.end = node.selectionEnd;
    result.selectedText = node.value.slice(result.start, result.end).slice(0, 240);
  } else {
    const selection = node.getRootNode().getSelection?.() ?? doc.getSelection();
    if (!selection?.rangeCount || !node.contains(selection.anchorNode) || !node.contains(selection.focusNode)) return result;
    const selected = selection.getRangeAt(0), prefix = doc.createRange();
    prefix.selectNodeContents(node); prefix.setEnd(selected.startContainer, selected.startOffset);
    result.start = prefix.toString().length; result.end = result.start + selected.toString().length;
    result.selectedText = selection.toString().slice(0, 240);
    result.formats = {};
    for (const command of ["bold", "italic", "underline", "insertOrderedList", "insertUnorderedList"]) {
      try { result.formats[command] = doc.queryCommandIndeterm(command) ? "mixed" : doc.queryCommandState(command); } catch {}
    }
  }
  result.collapsed = result.start === result.end;
  return result;
})`;
