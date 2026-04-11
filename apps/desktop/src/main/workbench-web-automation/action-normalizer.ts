import type {
  WorkbenchWebAction,
  WorkbenchWebActionRequest,
  WorkbenchWebActionTarget,
  WorkbenchWebElementSignature,
  WorkbenchWebSelectorAddress,
} from "../../shared/workbench-web-automation";

const asRecord = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
};

const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const readBoolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const readNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const parseSelectorAddress = (value: unknown): WorkbenchWebSelectorAddress | undefined => {
  const record = asRecord(value);
  const frameTreeNodeId = readNumber(record.frameTreeNodeId);
  const path = readString(record.path);
  if (frameTreeNodeId === undefined || path === undefined) {
    return undefined;
  }
  return {
    frameTreeNodeId: Math.round(frameTreeNodeId),
    path,
  };
};

const parseStableSignature = (value: unknown): WorkbenchWebElementSignature | undefined => {
  const record = asRecord(value);
  const tagName = readString(record.tagName);
  if (tagName === undefined) {
    return undefined;
  }
  return {
    tagName,
    ...(readString(record.role) === undefined ? {} : { role: readString(record.role) }),
    ...(readString(record.inputType) === undefined ? {} : { inputType: readString(record.inputType) }),
    ...(readString(record.id) === undefined ? {} : { id: readString(record.id) }),
    ...(readString(record.name) === undefined ? {} : { name: readString(record.name) }),
    ...(readString(record.testId) === undefined ? {} : { testId: readString(record.testId) }),
    ...(readString(record.ariaLabel) === undefined ? {} : { ariaLabel: readString(record.ariaLabel) }),
    ...(readString(record.textHash) === undefined ? {} : { textHash: readString(record.textHash) }),
    ...(readString(record.structureHash) === undefined
      ? {}
      : { structureHash: readString(record.structureHash) }),
  };
};

const parseTarget = (value: unknown): WorkbenchWebActionTarget => {
  const record = asRecord(value);
  const selectorAddress = parseSelectorAddress(record.selectorAddress);
  const stableSignature = parseStableSignature(record.stableSignature);
  const candidateId = readString(record.candidateId);
  const scanSessionId = readString(record.scanSessionId);
  const nodeId = readString(record.nodeId);
  const cssSelector = readString(record.cssSelector) ?? readString(record.selector);

  return {
    ...(candidateId === undefined ? {} : { candidateId }),
    ...(scanSessionId === undefined ? {} : { scanSessionId }),
    ...(nodeId === undefined ? {} : { nodeId }),
    ...(cssSelector === undefined ? {} : { cssSelector }),
    ...(selectorAddress === undefined ? {} : { selectorAddress }),
    ...(stableSignature === undefined ? {} : { stableSignature }),
  };
};

const hasTarget = (target: WorkbenchWebActionTarget): boolean =>
  typeof target.candidateId === "string"
  || typeof target.scanSessionId === "string"
  || typeof target.nodeId === "string"
  || typeof target.cssSelector === "string"
  || target.selectorAddress !== undefined
  || target.stableSignature !== undefined;

const isWeakDocumentSelector = (value: string | undefined): boolean => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized === "body"
    || normalized === "html"
    || normalized === ":root"
    || normalized === "document"
    || normalized === "document.body"
    || normalized === "document.documentelement";
};

const normalizeLegacyKind = (rawKind: string): WorkbenchWebAction["kind"] | null => {
  switch (rawKind) {
    case "focus":
    case "hover":
    case "scroll_into_view":
    case "expand_probe":
    case "click":
    case "type":
    case "clear_and_type":
    case "select_option":
    case "set_checked":
    case "submit_form":
    case "press_key":
    case "goto_url":
    case "open_link_node":
    case "history_back":
    case "history_forward":
    case "reload":
      return rawKind;
    case "scroll":
      return "scroll_into_view";
    case "fill":
      return "clear_and_type";
    case "select":
      return "select_option";
    case "check":
      return "set_checked";
    case "submit":
      return "submit_form";
    case "goto":
    case "navigate":
    case "open_url":
      return "goto_url";
    case "back":
      return "history_back";
    case "forward":
      return "history_forward";
    default:
      return null;
  }
};

const parseModifierState = (
  rawAction: Record<string, unknown>
): {
  readonly ctrl?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
  readonly meta?: boolean;
} => {
  const modifierKey = readString(rawAction.modifierKey)?.toLowerCase();
  const ctrl = readBoolean(rawAction.ctrl) ?? readBoolean(rawAction.ctrlKey);
  const shift = readBoolean(rawAction.shift) ?? readBoolean(rawAction.shiftKey);
  const alt = readBoolean(rawAction.alt) ?? readBoolean(rawAction.altKey);
  const meta = readBoolean(rawAction.meta) ?? readBoolean(rawAction.metaKey);

  return {
    ...((ctrl === true || modifierKey === "ctrl" || modifierKey === "control") ? { ctrl: true } : {}),
    ...((shift === true || modifierKey === "shift") ? { shift: true } : {}),
    ...((alt === true || modifierKey === "alt") ? { alt: true } : {}),
    ...((meta === true || modifierKey === "meta" || modifierKey === "cmd" || modifierKey === "command")
      ? { meta: true }
      : {}),
  };
};

const parseLegacyKey = (rawAction: Record<string, unknown>): string | undefined => {
  const key = readString(rawAction.key);
  if (key !== undefined) {
    return key;
  }
  const keys = rawAction.keys;
  if (Array.isArray(keys)) {
    const first = keys.find((entry) => typeof entry === "string");
    if (typeof first === "string" && first.trim().length > 0) {
      return first.trim();
    }
  }
  return undefined;
};

const normalizeAction = (value: unknown): WorkbenchWebAction => {
  const rawAction = asRecord(value);
  const kindInput = readString(rawAction.kind) ?? readString(rawAction.type);
  if (kindInput === undefined) {
    throw new Error("action.kind is required");
  }
  const kind = normalizeLegacyKind(kindInput);
  if (kind === null) {
    throw new Error(`unsupported action kind: ${kindInput}`);
  }

  const target = parseTarget(rawAction.target ?? rawAction);

  if (kind === "goto_url") {
    const address = readString(rawAction.address) ?? readString(rawAction.url);
    if (address === undefined) {
      throw new Error("goto_url requires address");
    }
    return {
      kind: "goto_url",
      address,
      ...(readString(rawAction.target) === "new-tab" || readString(rawAction.target) === "active-tab"
        ? { target: readString(rawAction.target) as "new-tab" | "active-tab" }
        : {}),
    };
  }

  if (kind === "history_back" || kind === "history_forward" || kind === "reload") {
    return { kind };
  }

  if (kind === "type" || kind === "clear_and_type") {
    const normalizedTarget = isWeakDocumentSelector(target.cssSelector)
      ? {
          ...(target.nodeId === undefined ? {} : { nodeId: target.nodeId }),
          ...(target.selectorAddress === undefined ? {} : { selectorAddress: target.selectorAddress }),
          ...(target.stableSignature === undefined ? {} : { stableSignature: target.stableSignature }),
        }
      : target;
    const text = readString(rawAction.text);
    const parsedKey = parseLegacyKey(rawAction) ?? (text?.length === 1 ? text : undefined);
    const modifier = parseModifierState(rawAction);
    const hasModifier =
      modifier.alt === true
      || modifier.ctrl === true
      || modifier.meta === true
      || modifier.shift === true;

    if (hasModifier && parsedKey !== undefined) {
      return {
        kind: "press_key",
        target: normalizedTarget,
        key: parsedKey,
        ...modifier,
      };
    }
    if (text === undefined) {
      throw new Error(`${kind} requires text`);
    }
    return {
      kind,
      target: normalizedTarget,
      text,
      ...(readBoolean(rawAction.submit) === undefined ? {} : { submit: readBoolean(rawAction.submit)! }),
    };
  }

  if (kind === "select_option") {
    return {
      kind,
      target,
      ...(readString(rawAction.value) === undefined ? {} : { value: readString(rawAction.value) }),
      ...(readString(rawAction.text) === undefined ? {} : { text: readString(rawAction.text) }),
      ...(readNumber(rawAction.index) === undefined ? {} : { index: readNumber(rawAction.index) }),
    };
  }

  if (kind === "set_checked") {
    const checked = readBoolean(rawAction.checked);
    if (checked === undefined) {
      throw new Error("set_checked requires checked");
    }
    return {
      kind,
      target,
      checked,
    };
  }

  if (kind === "press_key") {
    const normalizedTarget = isWeakDocumentSelector(target.cssSelector)
      ? {
          ...(target.nodeId === undefined ? {} : { nodeId: target.nodeId }),
          ...(target.selectorAddress === undefined ? {} : { selectorAddress: target.selectorAddress }),
          ...(target.stableSignature === undefined ? {} : { stableSignature: target.stableSignature }),
        }
      : target;
    const key =
      parseLegacyKey(rawAction)
      ?? readString(rawAction.text);
    if (key === undefined) {
      throw new Error("press_key requires key");
    }
    return {
      kind,
      target: normalizedTarget,
      key,
      ...(readString(rawAction.code) === undefined ? {} : { code: readString(rawAction.code) }),
      ...parseModifierState(rawAction),
    };
  }

  if (kind === "focus" || kind === "hover" || kind === "scroll_into_view" || kind === "expand_probe") {
    const normalizedTarget =
      kind === "focus" && isWeakDocumentSelector(target.cssSelector)
        ? {
            ...(target.nodeId === undefined ? {} : { nodeId: target.nodeId }),
            ...(target.selectorAddress === undefined ? {} : { selectorAddress: target.selectorAddress }),
            ...(target.stableSignature === undefined ? {} : { stableSignature: target.stableSignature }),
          }
        : target;
    if (!hasTarget(normalizedTarget)) {
      throw new Error(`${kind} requires target`);
    }
    return {
      kind,
      target: normalizedTarget,
    };
  }

  if (kind === "click" || kind === "submit_form" || kind === "open_link_node") {
    if (!hasTarget(target)) {
      throw new Error(`${kind} requires target`);
    }
    return {
      kind,
      target,
    };
  }

  throw new Error(`unsupported action kind: ${kind}`);
};

export const parseWorkbenchWebActionRequestPayload = (
  payload: Record<string, unknown>
): WorkbenchWebActionRequest => {
  const actionInput =
    payload.action !== undefined
      ? payload.action
      : payload;
  const action = normalizeAction(actionInput);
  return {
    ...(readString(payload.tabId) === undefined ? {} : { tabId: readString(payload.tabId) }),
    ...(readString(payload.graphId) === undefined ? {} : { graphId: readString(payload.graphId) }),
    action,
    ...(readNumber(payload.timeoutMs) === undefined ? {} : { timeoutMs: readNumber(payload.timeoutMs) }),
    ...(readNumber(payload.waitForNavigationMs) === undefined
      ? {}
      : { waitForNavigationMs: readNumber(payload.waitForNavigationMs) }),
  };
};

const SELECTOR_ADDRESS_SCHEMA = {
  type: "object",
  required: ["frameTreeNodeId", "path"],
  properties: {
    frameTreeNodeId: { type: "number" },
    path: { type: "string" },
  },
  additionalProperties: false,
} as const;

const STABLE_SIGNATURE_SCHEMA = {
  type: "object",
  required: ["tagName"],
  properties: {
    tagName: { type: "string" },
    role: { type: "string" },
    inputType: { type: "string" },
    id: { type: "string" },
    name: { type: "string" },
    testId: { type: "string" },
    ariaLabel: { type: "string" },
    textHash: { type: "string" },
    structureHash: { type: "string" },
  },
  additionalProperties: false,
} as const;

const ACTION_TARGET_SCHEMA = {
  type: "object",
  properties: {
    candidateId: { type: "string" },
    scanSessionId: { type: "string" },
    nodeId: { type: "string" },
    cssSelector: { type: "string" },
    selectorAddress: SELECTOR_ADDRESS_SCHEMA,
    stableSignature: STABLE_SIGNATURE_SCHEMA,
  },
  additionalProperties: false,
} as const;

const SAFE_ACTION_SCHEMA = {
  oneOf: [
    { type: "object", required: ["kind", "target"], properties: { kind: { enum: ["focus"] }, target: ACTION_TARGET_SCHEMA }, additionalProperties: false },
    { type: "object", required: ["kind", "target"], properties: { kind: { enum: ["hover"] }, target: ACTION_TARGET_SCHEMA }, additionalProperties: false },
    { type: "object", required: ["kind", "target"], properties: { kind: { enum: ["scroll_into_view"] }, target: ACTION_TARGET_SCHEMA }, additionalProperties: false },
    { type: "object", required: ["kind", "target"], properties: { kind: { enum: ["expand_probe"] }, target: ACTION_TARGET_SCHEMA }, additionalProperties: false },
  ],
} as const;

const MUTATE_ACTION_SCHEMA = {
  oneOf: [
    { type: "object", required: ["kind", "target"], properties: { kind: { enum: ["click"] }, target: ACTION_TARGET_SCHEMA }, additionalProperties: false },
    { type: "object", required: ["kind", "target", "text"], properties: { kind: { enum: ["type", "clear_and_type"] }, target: ACTION_TARGET_SCHEMA, text: { type: "string" }, submit: { type: "boolean" } }, additionalProperties: false },
    { type: "object", required: ["kind", "target"], properties: { kind: { enum: ["select_option"] }, target: ACTION_TARGET_SCHEMA, value: { type: "string" }, text: { type: "string" }, index: { type: "number" } }, additionalProperties: false },
    { type: "object", required: ["kind", "target", "checked"], properties: { kind: { enum: ["set_checked"] }, target: ACTION_TARGET_SCHEMA, checked: { type: "boolean" } }, additionalProperties: false },
    { type: "object", required: ["kind", "target"], properties: { kind: { enum: ["submit_form"] }, target: ACTION_TARGET_SCHEMA }, additionalProperties: false },
    { type: "object", required: ["kind", "target", "key"], properties: { kind: { enum: ["press_key"] }, target: ACTION_TARGET_SCHEMA, key: { type: "string" }, code: { type: "string" }, ctrl: { type: "boolean" }, shift: { type: "boolean" }, alt: { type: "boolean" }, meta: { type: "boolean" } }, additionalProperties: false },
  ],
} as const;

const NAVIGATE_ACTION_SCHEMA = {
  oneOf: [
    { type: "object", required: ["kind", "address"], properties: { kind: { enum: ["goto_url"] }, address: { type: "string" }, target: { enum: ["active-tab", "new-tab"] } }, additionalProperties: false },
    { type: "object", required: ["kind", "target"], properties: { kind: { enum: ["open_link_node"] }, target: ACTION_TARGET_SCHEMA }, additionalProperties: false },
    { type: "object", required: ["kind"], properties: { kind: { enum: ["history_back", "history_forward", "reload"] } }, additionalProperties: false },
  ],
} as const;

const baseActionInputSchema = (actionSchema: Record<string, unknown>) => ({
  type: "object",
  required: ["action"],
  properties: {
    tabId: { type: "string" },
    graphId: { type: "string" },
    action: actionSchema,
    timeoutMs: { type: "number" },
    waitForNavigationMs: { type: "number" },
  },
  additionalProperties: false,
});

export const WORKBENCH_WEB_SAFE_ACTION_INPUT_SCHEMA = baseActionInputSchema(SAFE_ACTION_SCHEMA);
export const WORKBENCH_WEB_MUTATE_ACTION_INPUT_SCHEMA = baseActionInputSchema(MUTATE_ACTION_SCHEMA);
export const WORKBENCH_WEB_NAVIGATE_ACTION_INPUT_SCHEMA = baseActionInputSchema(NAVIGATE_ACTION_SCHEMA);
