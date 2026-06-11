import type { AgentToolActivity } from "../../../../shared/agent";
import type { AgentImageAttachment, ToolActionTarget, ToolDetails, ToolPeek } from "../../ai-panel/agent-chat-demo/core/types";
import {
  asRecord,
  arrayField,
  isHttpUrl,
  numberField,
  stringField,
  toolInputRecord
} from "./common";

type ParsedLumenDetails = Extract<ToolDetails, { type: "lumen" }>;

type ParsedLumenElement = {
  readonly id: string;
  readonly role: string;
  readonly label: string;
};

export const LUMEN_ACTIONS = new Set([
  "map",
  "focus_scan",
  "act",
  "type",
  "press",
  "submit",
  "reveal",
  "navigate",
  "read",
  "see",
  "wait",
  "read_until",
  "follow_audit",
  "explain_target",
  "elevate"
]);

export const compactText = (value: string): string =>
  value.replace(/\s+/gu, " ").trim();

export const truncateText = (value: string, maxLength: number): string => {
  const compact = compactText(value);
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
};

export const urlHost = (url: string | undefined): string | undefined => {
  if (url === undefined) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
};

export const normalizeLumenAction = (value: string | undefined): string => {
  if (value === undefined) return "browser";
  const normalized = value.trim();
  if (normalized === "focusScan") return "focus_scan";
  return normalized.length === 0 ? "browser" : normalized;
};

export const lumenTargetMode = (input: Record<string, unknown>): string =>
  stringField(input, "target", "targetMode") === "live" ? "live" : "isolated";

export const lumenElementLabel = (input: Record<string, unknown>): string | undefined => {
  const elementId = input.element_id ?? input.elementId;
  if (typeof elementId === "string" && elementId.trim().length > 0) {
    return `element ${elementId.trim()}`;
  }
  if (typeof elementId === "number" && Number.isFinite(elementId)) {
    return `element ${Math.round(elementId)}`;
  }
  return undefined;
};

export const lumenTargetRefLabel = (input: Record<string, unknown>): string | undefined => {
  const targetRef = stringField(input, "lumenTargetRef", "targetRef");
  return targetRef === undefined ? undefined : `target ${targetRef}`;
};

export const lumenPointLabel = (input: Record<string, unknown>): string | undefined => {
  const point = asRecord(input.point);
  const x = typeof point.x === "number" ? point.x : Number.NaN;
  const y = typeof point.y === "number" ? point.y : Number.NaN;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return `point ${Math.round(x)},${Math.round(y)}`;
};

export const lumenElementFromRaw = (value: unknown): ParsedLumenElement | null => {
  const element = asRecord(value);
  if (Object.keys(element).length === 0) return null;
  const id =
    stringField(element, "id", "elementId")
    ?? (numberField(element, "id", "elementId") === undefined
      ? undefined
      : `${numberField(element, "id", "elementId")}`);
  const target = asRecord(element.target);
  const targetRef = stringField(element, "targetRef") ?? stringField(target, "targetRef");
  const role = stringField(element, "role", "tagName") ?? "element";
  const label = stringField(element, "label", "text", "name", "accessibleName") ?? targetRef ?? "";
  if (id === undefined && label.length === 0 && targetRef === undefined) return null;
  return {
    id: id ?? targetRef ?? "?",
    role,
    label
  };
};

export const parseStructuredLumenMap = (
  raw: Record<string, unknown>
): {
  readonly observationId?: string;
  readonly strategy?: string;
  readonly title?: string;
  readonly url?: string;
  readonly elements: readonly ParsedLumenElement[];
} | null => {
  const rawElements = Array.isArray(raw.elements) ? raw.elements : undefined;
  const isStructuredMap =
    raw.kind === "lyraLumenMap"
    || rawElements !== undefined
    || Array.isArray(raw.targets)
    || raw.semanticTree !== undefined
    || raw.coverage !== undefined;
  if (!isStructuredMap) return null;
  const elements = (rawElements ?? [])
    .map(lumenElementFromRaw)
    .filter((element): element is ParsedLumenElement => element !== null);
  const observationId = stringField(raw, "observationId");
  const strategy = stringField(raw, "strategy");
  const title = stringField(raw, "title");
  const url = stringField(raw, "url");
  return {
    ...(observationId === undefined ? {} : { observationId }),
    ...(strategy === undefined ? {} : { strategy }),
    ...(title === undefined ? {} : { title }),
    ...(url === undefined ? {} : { url }),
    elements
  };
};

export const parseTextLumenMap = (
  output: string
): {
  readonly observationId?: string;
  readonly strategy?: string;
  readonly title?: string;
  readonly url?: string;
  readonly elements: readonly ParsedLumenElement[];
} | null => {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const header = lines[0] ?? "";
  const headerMatch = header.match(/^Observation\s+(\S+)(?:\s+\(([^)]+)\))?(?:\s+for\s+(.+?))?(?:\s+-\s+(https?:\/\/\S+))?$/u);
  const elements = lines
    .map((line) => {
      const match = line.match(/^\[(\d+)\]\s+([^:]+):\s+"?([^"\[]*?)"?\s*(?:\[|at|\(|$)/u);
      if (match === null) return null;
      return {
        id: match[1] ?? "?",
        role: (match[2] ?? "element").trim(),
        label: (match[3] ?? "").trim()
      };
    })
    .filter((element): element is ParsedLumenElement => element !== null);
  if (headerMatch === null && elements.length === 0) return null;
  return {
    ...(headerMatch?.[1] === undefined ? {} : { observationId: headerMatch[1] }),
    ...(headerMatch?.[2] === undefined ? {} : { strategy: headerMatch[2] }),
    ...(headerMatch?.[3] === undefined ? {} : { title: headerMatch[3].trim() }),
    ...(headerMatch?.[4] === undefined ? {} : { url: headerMatch[4] }),
    elements
  };
};

export const parseStructuredLumenFocus = (
  raw: Record<string, unknown>
): {
  readonly direction?: string;
  readonly activeElementId?: string;
  readonly focused?: string;
  readonly trail: readonly string[];
} | null => {
  const rawTrail = Array.isArray(raw.focusTrail) ? raw.focusTrail : undefined;
  const focusedElement = lumenElementFromRaw(raw.focusedElement);
  const activeElementId =
    stringField(raw, "activeElementId")
    ?? (numberField(raw, "activeElementId") === undefined
      ? undefined
      : `${numberField(raw, "activeElementId")}`);
  const isStructuredFocus =
    raw.kind === "lyraLumenFocusResult"
    || rawTrail !== undefined
    || focusedElement !== null
    || activeElementId !== undefined;
  if (!isStructuredFocus) return null;
  const trail = (rawTrail ?? [])
    .map((entry) => {
      const record = asRecord(entry);
      const role = stringField(record, "role") ?? "element";
      const label = stringField(record, "label") ?? "";
      const elementId =
        stringField(record, "elementId")
        ?? (numberField(record, "elementId") === undefined
          ? undefined
          : `${numberField(record, "elementId")}`);
      return `${elementId === undefined ? "" : `[${elementId}] `}${role}${label.length === 0 ? "" : ` ${label}`}`.trim();
    })
    .filter((label) => label.length > 0);
  const direction = stringField(raw, "direction");
  return {
    ...(direction === undefined ? {} : { direction }),
    ...(activeElementId === undefined ? {} : { activeElementId }),
    ...(focusedElement === null
      ? {}
      : { focused: `${focusedElement.role}: ${focusedElement.label}`.trim() }),
    trail
  };
};

export const lumenTitle = (tool: AgentToolActivity): string => {
  const input = toolInputRecord(tool);
  const action = normalizeLumenAction(stringField(input, "action"));
  switch (action) {
    case "map":
      return "Mapped browser elements";
    case "focus_scan":
      return "Scanned browser focus";
    case "act": {
      const interaction = stringField(input, "interaction") ?? "click";
      return `${interaction.replace(/_/gu, " ")} browser element`;
    }
    case "type":
      return "Typed in browser";
    case "press":
      return "Pressed browser key";
    case "submit":
      return "Submitted browser control";
    case "reveal":
      return "Revealed browser controls";
    case "navigate":
      return "Navigated browser";
    case "read":
      return "Read browser text";
    case "see":
      return "Captured browser snapshot";
    case "wait":
      return "Waited in browser";
    case "read_until":
      return "Read browser until condition";
    case "follow_audit":
      return "Read browser follow audit";
    case "explain_target":
      return "Explained browser target";
    case "elevate":
      return "Elevated browser";
    default:
      return "Lyra Lumen";
  }
};

export const toLumenDetails = (
  tool: AgentToolActivity,
  output: string,
  rawOutput: Record<string, unknown>,
  screenshot: string | undefined,
  screenshotImage: AgentImageAttachment | undefined,
  targets: readonly ToolActionTarget[]
): ParsedLumenDetails => {
  const input = toolInputRecord(tool);
  const action = normalizeLumenAction(stringField(input, "action"));
  const targetMode = lumenTargetMode(input);
  const chips = [targetMode];
  const structuredTarget = lumenTargetRefLabel(input);
  const followSessionId = stringField(input, "followSessionId", "sessionId");
  const followActionId = stringField(input, "followActionId", "actionId");
  if (structuredTarget !== undefined) chips.push(structuredTarget);
  if (followSessionId !== undefined) chips.push(`follow ${followSessionId}`);
  if (followActionId !== undefined) chips.push(`action ${followActionId}`);
  let excerpt: string | undefined;

  if (action === "map") {
    const parsed = parseStructuredLumenMap(rawOutput) ?? parseTextLumenMap(output);
    if (parsed !== null) {
      if (parsed.strategy !== undefined) chips.push(parsed.strategy);
      chips.push(`${parsed.elements.length} elements`);
      const host = urlHost(parsed.url);
      if (host !== undefined) chips.push(host);
      const labels = parsed.elements
        .map((element) => `${element.id} ${element.role} ${element.label}`)
        .filter((label) => label.trim().length > 0)
        .slice(0, 2);
      excerpt = labels.length > 0
        ? truncateText(labels.join(" / "), 120)
        : truncateText(parsed.title ?? output, 120);
    } else {
      excerpt = output.trim().length === 0 ? undefined : truncateText(output, 120);
    }
  } else if (action === "focus_scan") {
    const parsed = parseStructuredLumenFocus(rawOutput);
    if (parsed !== null) {
      chips.push(`${parsed.trail.length} tab stops`);
      if (parsed.activeElementId !== undefined) chips.push(`active ${parsed.activeElementId}`);
      excerpt = truncateText(parsed.focused ?? parsed.trail.slice(0, 2).join(" / "), 120);
    } else {
      excerpt = output.trim().length === 0 ? undefined : truncateText(output, 120);
    }
  } else if (action === "read") {
    const strategy = stringField(input, "strategy") ?? "focus";
    chips.push(strategy === "domFallback" ? "dom fallback" : "focus read");
    if (output.trim().length > 0) chips.push(`${output.length} chars`);
    excerpt = output.trim().length === 0 ? undefined : truncateText(output, 140);
  } else if (action === "see") {
    chips.push("visual fallback");
    excerpt = output.trim().length === 0 ? undefined : truncateText(output, 120);
  } else if (action === "type") {
    const text = stringField(input, "text") ?? "";
    chips.push(`${text.length} chars`);
    chips.push(structuredTarget ?? lumenElementLabel(input) ?? "focused element");
    chips.push("chromium keyboard");
    excerpt = output.trim().length === 0 ? undefined : truncateText(output, 120);
  } else if (action === "act") {
    chips.push((stringField(input, "interaction") ?? "click").replace(/_/gu, " "));
    const target = structuredTarget ?? lumenElementLabel(input) ?? lumenPointLabel(input);
    if (target !== undefined) chips.push(target);
    chips.push("chromium mouse");
    excerpt = output.trim().length === 0 ? undefined : truncateText(output, 120);
  } else if (action === "reveal") {
    chips.push((stringField(input, "interaction") ?? "hover").replace(/_/gu, " "));
    const target = structuredTarget ?? lumenElementLabel(input) ?? lumenPointLabel(input);
    if (target !== undefined) chips.push(target);
    excerpt = output.trim().length === 0 ? undefined : truncateText(output, 120);
  } else if (action === "press" || action === "submit") {
    chips.push(stringField(input, "key") ?? (action === "submit" ? "Enter" : "key"));
    chips.push(structuredTarget ?? lumenElementLabel(input) ?? "focused element");
    chips.push("chromium keyboard");
    excerpt = output.trim().length === 0 ? undefined : truncateText(output, 120);
  } else if (action === "follow_audit") {
    chips.push("compact");
    if (input.includeFrames === true) chips.push("frames");
    excerpt = output.trim().length === 0 ? undefined : truncateText(output, 140);
  } else if (action === "explain_target") {
    chips.push(structuredTarget ?? "target");
    excerpt = output.trim().length === 0 ? undefined : truncateText(output, 120);
  } else if (action === "navigate") {
    const url = stringField(input, "url");
    const host = urlHost(url);
    if (host !== undefined) chips.push(host);
    excerpt = truncateText(url ?? output, 120);
  } else if (action === "wait" || action === "read_until") {
    const timeout = input.timeout_ms ?? input.timeoutMs;
    if (typeof timeout === "number" && Number.isFinite(timeout)) {
      chips.push(`${Math.round(timeout)}ms`);
    }
    excerpt = output.trim().length === 0 ? undefined : truncateText(output, 120);
  } else if (LUMEN_ACTIONS.has(action)) {
    excerpt = output.trim().length === 0 ? undefined : truncateText(output, 120);
  }

  const peek: ToolPeek = {
    chips: [...new Set(chips.filter((chip) => chip.trim().length > 0))],
    ...(excerpt === undefined ? {} : { excerpt }),
    ...(screenshot === undefined
      ? {}
      : { thumbnail: { src: screenshot, alt: "Lyra Lumen snapshot" } })
  };

  return {
    type: "lumen",
    action,
    targetMode,
    peek,
    ...(output.trim().length === 0 ? {} : { text: output }),
    ...(screenshot === undefined ? {} : { screenshot }),
    ...(screenshotImage === undefined ? {} : { screenshotImage }),
    ...(targets.length === 0 ? {} : { targets: [...targets] })
  };
};
