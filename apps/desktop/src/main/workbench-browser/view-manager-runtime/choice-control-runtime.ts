import type { WorkbenchBrowserControlSemantics } from "../types";

// Read DOM relationships and page-owned state independently. A local label on
// malformed markup is evidence of presentation, not proof of native activation.
// No persisted node cache: labels, groups and classes can change between actions.
export const CHOICE_CONTROL_RUNTIME = String.raw`(() => {
  const selector = 'input[type=radio],input[type=checkbox]';
  const isChoice = node => node?.matches?.(selector) === true;
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  const matches = (label, control) => label.contains(control)
    || !!control.id && label.htmlFor === control.id;
  const localControl = label => {
    for (let owner = label, depth = 0; owner && depth < 4; owner = owner.parentElement, depth++) {
      if (owner.matches('fieldset,form,[role=group],[role=radiogroup],body,html')) break;
      const inputs = owner.querySelectorAll(selector);
      if (inputs.length > 1) break;
      if (inputs.length === 1 && matches(label, inputs[0])) return inputs[0];
    }
    // A plain input/label pair can be a direct child of a multi-choice group.
    for (const sibling of [label.previousElementSibling, label.nextElementSibling]) {
      if (isChoice(sibling) && matches(label, sibling)) return sibling;
    }
    return null;
  };
  const inputOf = node => {
    if (isChoice(node)) return node;
    if (node?.tagName !== 'LABEL') return null;
    return localControl(node) || (isChoice(node.control) ? node.control : null);
  };
  const labelsFor = control => {
    if (!isChoice(control)) return [];
    const root = control.getRootNode();
    const candidates = new Set(control.labels || []);
    if (control.id) for (const label of root.querySelectorAll('label[for="' + CSS.escape(control.id) + '"]')) candidates.add(label);
    const wrapper = control.closest('label');
    if (wrapper) candidates.add(wrapper);
    return [...candidates].filter(label => {
      const local = localControl(label);
      return local ? local === control : label.control === control;
    });
  };
  const labelText = node => isChoice(node)
    ? clean(labelsFor(node).map(label => label.textContent).join(' ')) : '';
  const groupOf = control => control.closest('fieldset,[role=radiogroup],[role=group]');
  const groupName = group => {
    if (!group) return '';
    const root = group.getRootNode();
    return clean(String(group.getAttribute('aria-labelledby') || '').split(/\s+/)
      .map(id => root.getElementById?.(id)?.textContent || '').join(' '))
      || clean(group.getAttribute('aria-label'))
      || clean(group.querySelector('legend')?.textContent)
      || clean([...group.children].find(child => child.matches('h1,h2,h3,h4,h5,h6,[role=heading]'))?.textContent);
  };
  const exposed = node => {
    for (let item = node; item; item = item.parentElement) {
      const style = item.ownerDocument.defaultView.getComputedStyle(item);
      if (item.hidden || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    }
    return node.getClientRects().length > 0;
  };
  const tri = value => ['true','checked','on'].includes(value) ? true
    : ['false','unchecked','off'].includes(value) ? false : ['mixed','indeterminate'].includes(value) ? 'mixed' : undefined;
  const describe = node => {
    const control = inputOf(node);
    if (!control) return undefined;
    const labels = labelsFor(control);
    const nativeChecked = control.indeterminate ? 'mixed' : control.checked;
    const binding = node === control ? 'native' : node.control === control ? 'label' : 'local-label';
    const evidence = [], seen = new Set();
    const add = (source, value, detail) => {
      if (value === undefined) return;
      const key = source + ':' + value + ':' + detail;
      if (!seen.has(key) && evidence.length < 12) { seen.add(key); evidence.push({ source, value, detail }); }
    };
    for (const surface of [control, ...labels]) {
      // Native ARIA is still worth reporting even when the input is styled away.
      add('aria-checked', tri(surface.getAttribute('aria-checked')), surface === control ? 'input' : 'label');
      if (!exposed(surface)) continue;
      for (const item of [surface, ...surface.querySelectorAll('[class],[data-state],[aria-checked]')]) {
        // Never borrow state from nested independent controls.
        if (item !== surface && item.closest('label,button,input,[role=checkbox],[role=radio],[role=switch]') !== surface) continue;
        if (item !== surface && !exposed(item)) continue;
        add('data-state', tri(item.getAttribute('data-state')), item === control ? 'input' : 'label');
        for (const token of item.classList) {
          // Explicit choice-state tokens only. Generic "active" may mean focus,
          // hover, a theme, or a containing page; it is not checked evidence.
          const match = token.match(/(?:^|[-_])(?:radio|checkbox|check)(?:[-_])(?:icon[-_])?(on|off|checked|unchecked|indeterminate)$/i);
          if (match) add('class', tri(match[1].toLowerCase()), token);
        }
      }
    }
    const issues = [];
    if (control.id && control.getRootNode().querySelectorAll('[id="' + CSS.escape(control.id) + '"]').length > 1) issues.push('duplicate id; names scoped to the local control');
    if (binding === 'local-label') issues.push('label for resolves to a different native control; local association only');
    if (control.type === 'radio' && control.name) {
      const group = groupOf(control);
      const peers = [...control.getRootNode().querySelectorAll('input[type=radio][name="' + CSS.escape(control.name) + '"]')]
        .filter(peer => peer.form === control.form && groupOf(peer) !== group);
      if (peers.length) issues.push('native radio group ' + JSON.stringify(control.name) + ' spans displayed groups; selecting one clears native checked in the others');
    }
    const conflict = evidence.some(item => item.value !== nativeChecked) || binding === 'local-label';
    return { nativeChecked, binding, evidence, issues, conflict };
  };
  return { isChoice, inputOf, labelsFor, labelText, groupOf, groupName, describe };
})()`;

export const readChoiceSemantics = (value: unknown): WorkbenchBrowserControlSemantics["choice"] => {
  if (value === null || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if ((typeof record.nativeChecked !== "boolean" && record.nativeChecked !== "mixed")
    || !["native", "label", "local-label"].includes(String(record.binding))) return undefined;
  const evidence = Array.isArray(record.evidence) ? record.evidence.flatMap(item => {
    if (item === null || typeof item !== "object") return [];
    const entry = item as Record<string, unknown>;
    if (!["aria-checked", "data-state", "class"].includes(String(entry.source))
      || (typeof entry.value !== "boolean" && entry.value !== "mixed")) return [];
    return [{ source: entry.source as "aria-checked" | "data-state" | "class", value: entry.value as boolean | "mixed",
      detail: typeof entry.detail === "string" ? entry.detail.slice(0, 160) : "" }];
  }).slice(0, 12) : [];
  return {
    nativeChecked: record.nativeChecked as boolean | "mixed",
    binding: record.binding as "native" | "label" | "local-label",
    conflict: record.conflict === true,
    evidence,
    issues: Array.isArray(record.issues) ? record.issues.filter((item): item is string => typeof item === "string").slice(0, 4).map(item => item.slice(0, 320)) : []
  };
};
