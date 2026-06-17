import type { Frame } from "electron";
import type {
  WorkbenchBrowserAgentElement,
  WorkbenchBrowserAgentElementDiff,
  WorkbenchBrowserAgentElementState
} from "../types";
import { normalizeExecuteScriptTimeoutMs, runFrameScriptWithTimeout } from "./normalizers";

const PROBE_TIMEOUT_MS = 500;

export const elementStateFromCached = (
  element: WorkbenchBrowserAgentElement
): WorkbenchBrowserAgentElementState => ({
  role: element.role,
  label: element.label,
  ...(element.checked === undefined ? {} : { checked: element.checked }),
  ...(element.expanded === undefined ? {} : { expanded: element.expanded }),
  disabled: element.disabled,
  ...(element.textSnippet === undefined ? {} : { value: element.textSnippet }),
  ...(element.inputType === undefined ? {} : { inputType: element.inputType })
});

const buildElementProbeScript = (elementId: number): string => `
  (() => {
    const TARGET_ID = ${JSON.stringify(elementId)};
    const selector = [
      "a[href]",
      "button",
      "input",
      "select",
      "textarea",
      "summary",
      "[contenteditable]",
      "[tabindex]",
      "[role='button']",
      "[role='link']",
      "[role='checkbox']",
      "[role='textbox']",
      "[role='searchbox']",
      "[role='menuitem']",
      "[role='combobox']",
      "[role='listbox']",
      "[role='option']"
    ].join(",");

    const normalizeText = (value, maxLength = 120) => {
      if (typeof value !== "string") return "";
      const normalized = value.replace(/\\s+/g, " ").trim();
      return normalized.length <= maxLength ? normalized : normalized.slice(0, maxLength - 3) + "...";
    };

    const isDisabled = (element) =>
      element.disabled === true
      || element.getAttribute?.("disabled") !== null
      || element.getAttribute?.("aria-disabled") === "true";

    const isVisible = (element, win = window) => {
      const ElementCtor = win.Element || Element;
      if (!(element instanceof ElementCtor) || !element.isConnected) return false;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = win.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return false;
      if (Number.parseFloat(style.opacity || "1") <= 0) return false;
      return true;
    };

    const checkedState = (element) => {
      if (element.checked === true) return true;
      if (element.getAttribute?.("aria-checked") === "true") return true;
      return element.getAttribute?.("aria-checked") === "false" ? false : undefined;
    };

    const expandedState = (element) => {
      const value = element.getAttribute?.("aria-expanded");
      if (value === "true") return true;
      if (value === "false") return false;
      return undefined;
    };

    const valueFor = (element) => {
      const win = element?.ownerDocument?.defaultView || window;
      if (element instanceof win.HTMLInputElement || element instanceof win.HTMLTextAreaElement) {
        return normalizeText(element.value || "", 120);
      }
      if (element instanceof win.HTMLSelectElement) {
        const selected = element.selectedOptions?.[0];
        return normalizeText(selected?.textContent || selected?.value || element.value || "", 120);
      }
      return normalizeText(element.textContent || "", 120);
    };

    const collectCandidates = () => {
      const items = [];
      const seen = new Set();
      const crawl = (doc, win) => {
        for (const element of Array.from(doc.querySelectorAll(selector))) {
          if (!(element instanceof win.Element) || seen.has(element)) continue;
          seen.add(element);
          if (!isVisible(element, win) || isDisabled(element)) continue;
          if (element instanceof win.HTMLInputElement && element.type === "hidden") continue;
          items.push({ id: items.length + 1, element });
        }
        for (const host of Array.from(doc.querySelectorAll("*"))) {
          if (host.shadowRoot) {
            for (const element of Array.from(host.shadowRoot.querySelectorAll(selector))) {
              if (!(element instanceof win.Element) || seen.has(element)) continue;
              seen.add(element);
              if (!isVisible(element, win) || isDisabled(element)) continue;
              items.push({ id: items.length + 1, element });
            }
          }
        }
        for (const frame of Array.from(doc.querySelectorAll("iframe, frame"))) {
          try {
            const childDoc = frame.contentDocument || frame.contentWindow?.document;
            const childWin = frame.contentWindow;
            if (childDoc && childWin) crawl(childDoc, childWin);
          } catch (_error) {
            // Cross-origin frames are not probeable here.
          }
        }
      };
      crawl(document, window);
      return items;
    };

    const candidate = collectCandidates().find((item) => item.id === TARGET_ID);
    if (!candidate) return { ok: false, errorKind: "element_not_found" };
    const element = candidate.element;
    const win = element.ownerDocument?.defaultView || window;
    return {
      ok: true,
      role: normalizeText(element.getAttribute?.("role") || String(element.tagName || "element").toLowerCase(), 40),
      label: normalizeText([
        element.getAttribute?.("aria-label") || "",
        element.getAttribute?.("title") || "",
        element.textContent || ""
      ].join(" "), 120),
      checked: checkedState(element),
      expanded: expandedState(element),
      disabled: isDisabled(element),
      value: valueFor(element),
      inputType: element instanceof win.HTMLInputElement
        ? normalizeText(element.type || "", 32)
        : undefined
    };
  })()
`;

const coerceProbedState = (raw: unknown): WorkbenchBrowserAgentElementState | null => {
  if (raw === null || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (record.ok !== true) {
    return null;
  }
  return {
    role: typeof record.role === "string" ? record.role : "",
    label: typeof record.label === "string" ? record.label : "",
    ...(typeof record.checked === "boolean" ? { checked: record.checked } : {}),
    ...(typeof record.expanded === "boolean" ? { expanded: record.expanded } : {}),
    disabled: record.disabled === true,
    ...(typeof record.value === "string" ? { value: record.value } : {}),
    ...(typeof record.inputType === "string" ? { inputType: record.inputType } : {})
  };
};

export const probeElementState = async (
  frame: Frame,
  element: WorkbenchBrowserAgentElement,
  timeoutMs?: number
): Promise<WorkbenchBrowserAgentElementState | null> => {
  try {
    const raw = await runFrameScriptWithTimeout(
      () => frame.executeJavaScript(buildElementProbeScript(element.id), true),
      Math.min(
        PROBE_TIMEOUT_MS,
        normalizeExecuteScriptTimeoutMs(timeoutMs, PROBE_TIMEOUT_MS)
      )
    );
    return coerceProbedState(raw);
  } catch {
    return null;
  }
};

export const diffElementStates = (
  before: WorkbenchBrowserAgentElementState,
  after: WorkbenchBrowserAgentElementState
): readonly string[] => {
  const changes: string[] = [];
  if (before.role !== after.role) {
    changes.push(`role: ${before.role} -> ${after.role}`);
  }
  if (before.label !== after.label) {
    changes.push(`label: ${before.label} -> ${after.label}`);
  }
  if (before.value !== after.value) {
    changes.push(`value: ${before.value ?? ""} -> ${after.value ?? ""}`);
  }
  if (before.checked !== after.checked) {
    changes.push(`checked: ${String(before.checked)} -> ${String(after.checked)}`);
  }
  if (before.expanded !== after.expanded) {
    changes.push(`expanded: ${String(before.expanded)} -> ${String(after.expanded)}`);
  }
  if (before.disabled !== after.disabled) {
    changes.push(`disabled: ${String(before.disabled)} -> ${String(after.disabled)}`);
  }
  return changes;
};

export const buildElementDiff = (
  before: WorkbenchBrowserAgentElementState,
  after: WorkbenchBrowserAgentElementState | null
): WorkbenchBrowserAgentElementDiff | { readonly diffUnavailable: true } => {
  if (after === null) {
    return { diffUnavailable: true };
  }
  const changed = diffElementStates(before, after);
  return {
    before,
    after,
    changed,
    ...(changed.length === 0 ? { noObservableChange: true } : {})
  };
};