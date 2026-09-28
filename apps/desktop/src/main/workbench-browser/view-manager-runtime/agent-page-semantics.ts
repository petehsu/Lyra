import { FIELD_DESCRIPTION_RUNTIME } from "./field-description-runtime";
import { CHOICE_CONTROL_RUNTIME, readChoiceSemantics } from "./choice-control-runtime";
import { browserEditorStateRuntime } from "./agent-editor-state";
import { VISIBLE_TEXT_RUNTIME } from "./agent-visible-text";
import type { WorkbenchBrowserControlSemantics, WorkbenchBrowserPageNote } from "../types";

// Runs inside the page. Reads native/ARIA facts without focusing, hovering,
// validating via events, or activating anything. The bounded journal retains
// transient announcements between maps, including maps made during an action.
export const browserMapSemanticsScript = String.raw`(() => {
  const choices = ${CHOICE_CONTROL_RUNTIME};
  const text = (value, limit = 240) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
  const attr = (node, name) => node?.getAttribute?.(name);
  const parent = node => node?.parentElement || node?.getRootNode?.().host || null;
  const closest = (node, selector) => {
    for (let current = node; current; current = parent(current)) if (current.matches?.(selector)) return current;
    return null;
  };
  const exposed = node => {
    if (!node?.isConnected) return false;
    for (let current = node; current; current = parent(current)) {
      if (current.hidden || attr(current, "aria-hidden") === "true") return false;
      const style = current.ownerDocument.defaultView.getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
    }
    return true;
  };
  const related = (node, name) => {
    const root = node.getRootNode();
    return String(attr(node, name) || "").split(/\s+/).filter(Boolean)
      .map(id => root.getElementById?.(id)).filter(Boolean).slice(0, 8);
  };
  const relatedText = (node, name) => text(related(node, name).map(item => item.textContent).join(" "));
  const name = node => text(relatedText(node, "aria-labelledby") || attr(node, "aria-label")
    || (choices.isChoice(node) ? choices.labelText(node) : Array.from(node?.labels || []).map(label => label.textContent).join(" ")) || attr(node, "title") || "", 160);
  const disabled = node => node.disabled === true || node.matches(":disabled")
    || closest(node, "[aria-disabled=true],[inert]") !== null;
  const shortName = node => name(node) || text(node?.innerText || node?.textContent, 120);
  const tri = value => value === "true" ? true : value === "false" ? false : value === "mixed" ? "mixed" : undefined;
  const role = node => attr(node, "role") || node.tagName.toLowerCase();
  const isModal = node => { try { return node.matches(":modal"); } catch { return false; } };
  const visibleText = ${VISIBLE_TEXT_RUNTIME};
  const dialogName = node => name(node) || text(Array.from(node.querySelectorAll("h1,h2,h3,[role=heading]")).find(visibleText.exposed)?.textContent, 160) || "Dialog";
  const focusIn = doc => {
    let node = doc.activeElement;
    while (node?.shadowRoot?.activeElement) node = node.shadowRoot.activeElement;
    return node;
  };
  const control = node => {
    const result = {};
    const choice = choices.describe(node);
    const nativeCheck = node.tagName === "INPUT" && (node.type === "checkbox" || node.type === "radio");
    let checked = nativeCheck ? (node.indeterminate ? "mixed" : node.checked) : tri(attr(node, "aria-checked"));
    const checkRole = /^(switch|checkbox|radio|menuitemcheckbox|menuitemradio)$/.test(role(node));
    const dataState = attr(node, "data-state");
    if (checked === undefined && checkRole) {
      checked = ["checked", "on"].includes(dataState) ? true : ["unchecked", "off"].includes(dataState) ? false
        : dataState === "indeterminate" ? "mixed" : "unknown";
    }
    if (checked !== undefined) result.checked = checked;
    if (choice) {
      result.choice = choice;
      result.checked = choice.conflict ? "unknown" : choice.nativeChecked;
    }
    const pressed = tri(attr(node, "aria-pressed"));
    if (pressed !== undefined) result.pressed = pressed;
    const selected = tri(attr(node, "aria-selected"));
    if (typeof selected === "boolean") result.selected = selected;
    if (pressed === undefined && selected === undefined && (checked === undefined || checked === "unknown")) {
      const tokens = Array.from(node.classList || []);
      if (tokens.some(token => token === "active" || token === "selected" || token === "on" || token.endsWith("-active") || token.endsWith("--on"))) {
        result.appearance = "active class; logical state unconfirmed";
      }
    }
    if (node.tagName === "OPTION") result.selected = node.selected;
    const current = attr(node, "aria-current");
    if (current && current !== "false") result.current = text(current, 32);
    if (focusIn(node.ownerDocument) === node) result.focused = true;
    const busy = closest(node, "[aria-busy]");
    if (busy && attr(busy, "aria-busy") === "true") result.busy = true;
    if (node.readOnly === true || attr(closest(node, "[aria-readonly]"), "aria-readonly") === "true") result.readOnly = true;
    if (node.required === true || attr(node, "aria-required") === "true") result.required = true;
    const invalid = attr(node, "aria-invalid");
    if (invalid && invalid !== "false") result.invalid = text(invalid, 32);
    if (node.willValidate && node.validity?.valid === false) {
      result.invalid = result.invalid || "true";
      result.validationMessage = text(node.validationMessage);
    }
    if (result.invalid) result.validationMessage = relatedText(node, "aria-errormessage") || result.validationMessage;
    const description = relatedText(node, "aria-describedby") || attr(node, "aria-description") || attr(node, "title") || (${FIELD_DESCRIPTION_RUNTIME})(node);
    if (description) result.description = text(description);
    const constraints = {};
    if (node.draggable === true) constraints.draggable = "true";
    if (node.hasAttribute("ondrop") || node.hasAttribute("ondragover") || typeof node.ondrop === "function" || typeof node.ondragover === "function") constraints.dropTarget = "declared handler; acceptance is determined by the page";
    for (const key of ["min", "max", "step", "minlength", "maxlength", "pattern", "accept", "inputmode"]) {
      const value = attr(node, key);
      if (value !== null && value !== "") constraints[key] = text(value, 120);
    }
    if (node.multiple === true || attr(node, "aria-multiselectable") === "true") constraints.multiple = "true";
    if (node.tagName === "INPUT" && !["text", "hidden", "button", "submit", "reset"].includes(node.type)) constraints.type = node.type;
    if (Object.keys(constraints).length) result.constraints = constraints;
    if (node.tagName === "SELECT") result.valueText = text(Array.from(node.selectedOptions).map(option => option.textContent).join(", "));
    else if (attr(node, "aria-valuetext")) result.valueText = text(attr(node, "aria-valuetext"));
    else if (attr(node, "aria-valuenow") !== null) result.valueText = text(attr(node, "aria-valuenow"));
    if (attr(node, "aria-valuemin") !== null || attr(node, "aria-valuemax") !== null) {
      result.constraints = result.constraints || {};
      if (attr(node, "aria-valuemin") !== null) result.constraints.min = text(attr(node, "aria-valuemin"));
      if (attr(node, "aria-valuemax") !== null) result.constraints.max = text(attr(node, "aria-valuemax"));
    }
    const context = [];
    const dialog = closest(node, "dialog[open],[role=dialog],[role=alertdialog]");
    if (dialog) context.push("dialog: " + dialogName(dialog));
    const group = closest(node, "fieldset,[role=group],[role=radiogroup],form,[role=tabpanel]");
    if (group) {
      const label = name(group) || choices.groupName(group);
      if (label) context.push(role(group) + ": " + label);
    }
    const landmark = closest(node, "main,nav,aside,header,footer,[role=main],[role=navigation],[role=complementary],[role=banner],[role=contentinfo],[role=region]");
    if (landmark) context.push(role(landmark) + ": " + (name(landmark) || role(landmark)));
    const row = closest(parent(node), "tr,[role=row],li,[role=listitem]");
    if (row) {
      const label = name(row) || text(row.innerText || row.textContent, 160);
      if (label) context.push("row: " + label);
    }
    if (context.length) result.context = context;
    const controls = related(node, "aria-controls").map(item => role(item) + ": " + (name(item) || item.id));
    if (controls.length) result.controls = controls;
    const active = related(node, "aria-activedescendant")[0];
    if (active && exposed(active)) result.activeDescendant = role(active) + ': "' + shortName(active) + '"'
      + (attr(active, "aria-selected") === "true" ? " selected" : "");
    const popup = attr(node, "aria-haspopup");
    if (popup && popup !== "false") result.popup = text(popup, 32);
    return result;
  };

  const signals = "[role=status],[role=alert],[role=log],[aria-live]:not([aria-live=off]),output,progress,[role=progressbar],[aria-busy=true]";
  const dialogs = "dialog[open],[role=dialog],[role=alertdialog]";
  const state = window.__lyraMapSignals ??= {
    roots: new WeakMap(), ids: new WeakMap(), serial: 0, sequence: 0, journal: [], url: String(location.href)
  };
  if (state.url !== String(location.href)) { state.journal = []; state.url = String(location.href); }
  const idFor = node => {
    if (!state.ids.has(node)) state.ids.set(node, "note:" + (++state.serial));
    return state.ids.get(node);
  };
  const signal = node => {
    if (!exposed(node)) return null;
    const r = role(node);
    let kind = r === "alert" ? "alert" : "status";
    const contents = String(node.innerText ?? node.textContent ?? "").replace(/\s+/g, " ").trim();
    let value = r === "log" ? contents.slice(-320) : contents.slice(0, 320);
    if (r === "progressbar" || node.tagName === "PROGRESS") {
      kind = "progress";
      const now = attr(node, "aria-valuenow") ?? (node.hasAttribute("value") ? node.value : null);
      const max = attr(node, "aria-valuemax") ?? (node.tagName === "PROGRESS" ? node.max : null);
      value = (name(node) || "Progress") + ": " + (attr(node, "aria-valuetext") || (now === null ? "indeterminate" : now + (max === null ? "" : "/" + max)));
    } else if (attr(node, "aria-busy") === "true") {
      kind = "busy";
      value = (name(node) || r) + " is busy";
    }
    return value ? { id: idFor(node), kind, text: value } : null;
  };
  const watch = root => {
    if (state.roots.has(root)) return;
    const last = new WeakMap();
    const capture = node => {
      if (!node?.matches?.(signals)) return;
      const note = signal(node);
      if (!note) { last.delete(node); return; }
      const signature = note.kind + note.text;
      if (last.get(node) === signature) return;
      last.set(node, signature);
      state.journal.push({ ...note, id: "event:" + (++state.sequence), at: Date.now() });
      state.journal = state.journal.slice(-32);
    };
    const observer = new MutationObserver(records => {
      if (state.url !== String(location.href)) { state.journal = []; state.url = String(location.href); }
      const candidates = new Set();
      for (const record of records) {
        const node = record.target.nodeType === 1 ? record.target : record.target.parentElement;
        const owner = closest(node, signals);
        if (owner) candidates.add(owner);
        // Covered/offscreen controls leave the actionable map without being
        // deleted. Only a detached, actually stamped node is removal evidence.
        for (const removed of record.removedNodes) {
          if (removed.nodeType !== 1 || removed.isConnected) continue;
          for (const item of [removed, ...Array.from(removed.querySelectorAll('[data-lyra-surface]')).slice(0, 64)]) {
            const ref = window.__lyraSurfaceNodeRegistry?.nodes.get(item);
            if (!ref || item.isConnected) continue;
            state.journal.push({ id: "event:" + (++state.sequence), kind: "detached",
              text: ref + ' "' + shortName(item) + '"', at: Date.now() });
          }
          state.journal = state.journal.slice(-32);
        }
        for (const added of record.addedNodes) {
          if (added.nodeType !== 1) continue;
          if (added.matches(signals)) candidates.add(added);
          for (const item of Array.from(added.querySelectorAll(signals)).slice(0, 32)) candidates.add(item);
        }
        if (record.type === "attributes" && node) {
          for (const item of Array.from(node.querySelectorAll(signals)).slice(0, 32)) candidates.add(item);
        }
      }
      for (const node of Array.from(candidates).slice(0, 64)) capture(node);
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ["aria-busy", "aria-valuenow", "aria-valuetext", "value", "hidden", "aria-hidden", "class", "style", "role", "aria-live"] });
    state.roots.set(root, observer);
  };
  const roots = new Set();
  const observeRoot = root => { roots.add(root); watch(root); };
  const pageNotes = () => {
    const notes = [];
    const seen = new Set();
    for (const root of roots) {
      for (const node of root.querySelectorAll(dialogs + "," + signals)) {
        if (seen.has(node)) continue;
        seen.add(node);
        if (notes.length >= 24) break;
        if (!exposed(node)) continue;
        if (node.matches(dialogs)) {
          const body = visibleText.read(node, { limit: 1200, excludeControls: true });
          const description = body.text || relatedText(node, "aria-describedby");
          notes.push({ id: idFor(node), kind: "dialog", text: dialogName(node)
            + (attr(node, "aria-modal") === "true" || isModal(node) ? " (modal)" : "")
            + (description ? ": " + description : "") + (body.truncated ? " [dialog text truncated]" : "") });
        } else {
          const note = signal(node);
          if (note) notes.push(note);
        }
      }
      if (root.nodeType === 9) {
        const editor = ${browserEditorStateRuntime}(root);
        if (editor) notes.unshift({ id: "editor-state:" + idFor(root), kind: "focus", text: "Editor " + JSON.stringify(editor) });
        const focused = focusIn(root);
        if (focused && focused !== root.body && focused !== root.documentElement) {
          notes.push({ id: "focus:" + idFor(root), kind: "focus", text: role(focused) + ': "' + shortName(focused) + '"'
            + (focused.getAttribute("data-lyra-surface") ? " " + focused.getAttribute("data-lyra-surface") : "") });
        }
      }
    }
    if (notes.length >= 24) notes.push({ id: "coverage", kind: "coverage", text: "Page context limited to 24 entries." });
    state.journal = state.journal.filter(entry => Date.now() - entry.at < 30000);
    for (const entry of state.journal) {
      if (!notes.some(note => note.kind === entry.kind && note.text === entry.text)) {
        notes.push({ id: entry.id, kind: "recent", text: entry.kind + ": " + entry.text });
      }
    }
    return notes;
  };
  const cursorNote = (node, hint, page) => ({ id: 'cursor:' + idFor(node), kind: 'cursor',
    text: (page ? 'Page' : name(node) || text(node.tagName.toLowerCase(), 60)) + ': ' + hint + ' (CSS hint only)' });
  return { control, observeRoot, pageNotes, focusIn, name, disabled, cursorNote, choices };
})()`;

export const readControlSemantics = (value: unknown): WorkbenchBrowserControlSemantics | undefined => {
  if (value === null || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  const choice = readChoiceSemantics(record.choice);
  if (choice) result.choice = choice;
  for (const key of ["checked", "pressed", "selected", "focused", "busy", "readOnly", "required"]) {
    const field = record[key];
    if (typeof field === "boolean" || ((key === "checked" || key === "pressed") && field === "mixed")
      || (key === "checked" && field === "unknown")) result[key] = field;
  }
  for (const key of ["current", "invalid", "validationMessage", "description", "valueText", "activeDescendant", "popup", "appearance"]) {
    if (typeof record[key] === "string") result[key] = record[key].slice(0, 320);
  }
  for (const key of ["context", "controls"]) {
    if (Array.isArray(record[key])) result[key] = record[key].filter((item): item is string => typeof item === "string").slice(0, 8).map(item => item.slice(0, 240));
  }
  if (record.constraints !== null && typeof record.constraints === "object") {
    result.constraints = Object.fromEntries(Object.entries(record.constraints).filter((entry): entry is [string, string] =>
      typeof entry[1] === "string" && ["min", "max", "step", "minlength", "maxlength", "pattern", "accept", "inputmode", "multiple", "type", "draggable", "dropTarget"].includes(entry[0])));
  }
  return result as WorkbenchBrowserControlSemantics;
};

export const readPageNotes = (value: unknown, frameRef: string): WorkbenchBrowserPageNote[] => {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 48).flatMap((entry: unknown) => {
    if (entry === null || typeof entry !== "object") return [];
    const note = entry as Record<string, unknown>;
    if (typeof note.id !== "string" || typeof note.text !== "string"
      || !["dialog", "status", "alert", "progress", "busy", "focus", "recent", "coverage", "cursor"].includes(String(note.kind))) return [];
    return [{ id: `${frameRef}:${note.id}`, kind: note.kind as WorkbenchBrowserPageNote["kind"], text: note.text.slice(0, note.kind === "dialog" ? 1600 : 480) }];
  });
};

export const formatPageNotes = (notes: readonly WorkbenchBrowserPageNote[] = []): string => notes.length === 0 ? ""
  : `Read-only page context (not action targets):\n${notes.map(note => `- ${note.kind}: ${note.text}`).join("\n")}`;
