import { surfaceNameRuntime } from "./surface-name-runtime";
import { SURFACE_TARGET_LOOKUP } from "./surface-target";
import type { WebFrameMain } from "electron";
import type {
  WorkbenchBrowserAgentElement,
  WorkbenchBrowserAgentElementDiff,
  WorkbenchBrowserAgentElementState
} from "../types";
import { normalizeExecuteScriptTimeoutMs, runFrameScriptWithTimeout } from "./normalizers";

const PROBE_TIMEOUT_MS = 500;

const pressedHint = (hint: string | undefined): boolean | undefined => {
  if (hint === "pressed" || hint === "checked" || hint === "on") return true;
  if (hint === "unpressed" || hint === "unchecked" || hint === "off") return false;
  return undefined;
};

export const elementStateFromCached = (
  element: WorkbenchBrowserAgentElement
): WorkbenchBrowserAgentElementState => {
  const checked = element.checked ?? pressedHint(element.stateHint);
  return ({
  role: element.role,
  label: element.label,
  ...(checked === undefined ? {} : { checked }),
  ...(element.expanded === undefined ? {} : { expanded: element.expanded }),
  disabled: element.disabled,
  ...(element.textSnippet === undefined ? {} : { value: element.textSnippet }),
  ...(element.inputType === undefined ? {} : { inputType: element.inputType })
  });
};

const buildElementProbeScript = (targetRef: string): string => `
  (() => {
    ${SURFACE_TARGET_LOOKUP}
    const surfaceNames = ${surfaceNameRuntime};
    const normalizeText = (value, maxLength = 120) => {
      if (typeof value !== "string") return "";
      const normalized = value.replace(/\\s+/g, " ").trim();
      return normalized.length <= maxLength ? normalized : normalized.slice(0, maxLength - 3) + "...";
    };

    const isDisabled = (element) =>
      element.disabled === true
      || element.getAttribute?.("disabled") !== null
      || element.getAttribute?.("aria-disabled") === "true";

    const checkedState = (element) => {
      if (element.checked === true) return true;
      const checked = element.getAttribute?.("aria-checked");
      const pressed = element.getAttribute?.("aria-pressed");
      if (checked === "true" || pressed === "true") return true;
      if (checked === "false" || pressed === "false") return false;
      return undefined;
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

    const element = findSurfaceTarget(${JSON.stringify(targetRef)});
    if (!element || !element.isConnected) return { ok: false, errorKind: "element_not_found" };
    const win = element.ownerDocument?.defaultView || window;
    return {
      ok: true,
      role: normalizeText(element.getAttribute?.("role") || String(element.tagName || "element").toLowerCase(), 40),
      label: surfaceNames.label(element) || "(no label)",
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
  frame: WebFrameMain,
  element: WorkbenchBrowserAgentElement,
  timeoutMs?: number
): Promise<WorkbenchBrowserAgentElementState | null> => {
  try {
    const raw = await runFrameScriptWithTimeout(
      () => frame.executeJavaScript(buildElementProbeScript(element.targetRef), true),
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
  if ((before.value ?? "") !== (after.value ?? "")) {
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
