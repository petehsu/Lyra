export const WORKSPACE_TAB_SCHEMA_VERSION = 2 as const;
export const HOST_API_VERSION = "1.0.0" as const;

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | { readonly [key: string]: JsonValue } | readonly JsonValue[];
export type MaybePromise<T> = T | Promise<T>;

export type HostCommandContributionV1 = {
  readonly id: string;
  readonly title: string;
  readonly requiredCapability?: string;
};

export type HostCapabilityContributionV1 = {
  readonly id: string;
  readonly version: string;
  readonly title: string;
};

export type HostSettingsContributionV1 = {
  readonly id: string;
  readonly title: string;
  readonly route: string;
};

export type HostStatusContributionV1 = {
  readonly id: string;
  readonly title: string;
};

export type HostEventContributionV1 = {
  readonly id: string;
  readonly title: string;
  readonly requiredCapability?: string;
};

export type HostContributionsV1 = {
  readonly commands?: readonly HostCommandContributionV1[];
  readonly capabilities?: readonly HostCapabilityContributionV1[];
  readonly settings?: readonly HostSettingsContributionV1[];
  readonly status?: readonly HostStatusContributionV1[];
  readonly events?: readonly HostEventContributionV1[];
};

export type HostRegistrationV1 = {
  dispose(): void;
};

export type HostHandlerV1 = (input: JsonValue) => MaybePromise<JsonValue>;
export type HostEventHandlerV1 = (input: JsonValue) => MaybePromise<void>;

export type LyraHostApiV1 = {
  readonly apiVersion: typeof HOST_API_VERSION;
  executeCommand(commandId: string, input: JsonValue): Promise<JsonValue>;
  invokeCapability(capabilityId: string, input: JsonValue): Promise<JsonValue>;
  registerCommand(commandId: string, handler: HostHandlerV1): HostRegistrationV1;
  registerCapability(capabilityId: string, handler: HostHandlerV1): HostRegistrationV1;
  subscribeEvent(eventId: string, handler: HostEventHandlerV1): HostRegistrationV1;
};

export type WorkspaceTabV2 = {
  readonly schemaVersion: typeof WORKSPACE_TAB_SCHEMA_VERSION;
  readonly appId: string;
  readonly appVersion: string;
  readonly instanceId: string;
  readonly route: string;
  readonly opaqueState: JsonValue;
};

/**
 * A request for a new child application. Core resolves and pins the active
 * version when appVersion is omitted, then returns a complete WorkspaceTabV2
 * descriptor for the parent to persist in its own opaque state.
 */
export type LyraNestedAppCreateRequestV1 = {
  readonly appId: string;
  readonly appVersion?: string;
  readonly instanceId: string;
  readonly route: string;
};

export type LyraNestedAppSlotErrorCodeV1 =
  | "invalid-request"
  | "parent-unavailable"
  | "app-unavailable"
  | "version-unavailable"
  | "surface-unavailable"
  | "cycle"
  | "duplicate-instance"
  | "slot-occupied"
  | "slot-empty"
  | "lifecycle-failed";

export type LyraNestedAppSlotErrorV1 = {
  readonly code: LyraNestedAppSlotErrorCodeV1;
  readonly message: string;
  /**
   * True when Module Manager can reasonably offer repair/reinstall/retry for
   * this failure. Contract or graph errors must instead be fixed by the app.
   */
  readonly repairable: boolean;
  readonly appId?: string;
  readonly appVersion?: string;
  readonly instanceId?: string;
};

export type LyraNestedAppSlotResultV1<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: LyraNestedAppSlotErrorV1 };

/**
 * Core-owned nested surface lifecycle, scoped to one parent app instance.
 * Core retains only slot/instance/version lifecycle metadata. The returned
 * WorkspaceTabV2 is the sole persistence hand-off for child business state.
 */
export type LyraNestedAppSlotsV1 = {
  create(
    slotId: string,
    request: LyraNestedAppCreateRequestV1
  ): Promise<LyraNestedAppSlotResultV1<WorkspaceTabV2>>;
  restore(
    slotId: string,
    descriptor: WorkspaceTabV2
  ): Promise<LyraNestedAppSlotResultV1<WorkspaceTabV2>>;
  mount(
    slotId: string,
    container: HTMLElement
  ): Promise<LyraNestedAppSlotResultV1<null>>;
  unmount(slotId: string): Promise<LyraNestedAppSlotResultV1<null>>;
  snapshot(
    slotId: string
  ): Promise<LyraNestedAppSlotResultV1<WorkspaceTabV2>>;
  close(
    slotId: string
  ): Promise<LyraNestedAppSlotResultV1<WorkspaceTabV2 | null>>;
};

export type LyraAppInstanceV1 = {
  readonly instanceId: string;
};

export type LyraAppCreateContextV1 = {
  readonly host: LyraHostApiV1;
  readonly appId: string;
  readonly instanceId: string;
  readonly route: string;
};

export type LyraAppRestoreContextV1 = LyraAppCreateContextV1 & {
  readonly opaqueState: JsonValue;
};

export type LyraAppSurfaceContextV1 = {
  readonly instance: LyraAppInstanceV1;
  readonly container: HTMLElement;
  readonly slots: LyraNestedAppSlotsV1;
};

export type LyraAppModule = {
  readonly id: string;
  readonly version: string;
  readonly contributions?: HostContributionsV1;
  activate(host: LyraHostApiV1): MaybePromise<void>;
  create(context: LyraAppCreateContextV1): MaybePromise<LyraAppInstanceV1>;
  restore(context: LyraAppRestoreContextV1): MaybePromise<LyraAppInstanceV1>;
  snapshot(instance: LyraAppInstanceV1): MaybePromise<JsonValue>;
  /** Mounts an independently shipped renderer surface into a Core-owned slot. */
  mount?(context: LyraAppSurfaceContextV1): MaybePromise<void>;
  /** Removes all DOM and listeners previously installed by mount. */
  unmount?(instance: LyraAppInstanceV1): MaybePromise<void>;
  deactivate(): MaybePromise<void>;
  close(instance: LyraAppInstanceV1): MaybePromise<void>;
};

const ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const CAPABILITY_PATTERN = /^[a-z0-9-]+(?::[a-z0-9._-]+)*$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && Array.isArray(value) === false;

const isIdentifier = (value: unknown): value is string =>
  typeof value === "string" && ID_PATTERN.test(value);

const isCapabilityId = (value: unknown): value is string =>
  typeof value === "string" && CAPABILITY_PATTERN.test(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isJsonValue = (value: unknown, ancestors = new Set<object>()): value is JsonValue => {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value !== "object") {
    return false;
  }
  if (ancestors.has(value)) {
    return false;
  }

  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, ancestors))
    : Object.getPrototypeOf(value) === Object.prototype &&
      Object.values(value).every((item) => isJsonValue(item, ancestors));
  ancestors.delete(value);
  return valid;
};

const hasUniqueIds = (items: readonly { readonly id: string }[]): boolean =>
  new Set(items.map(({ id }) => id)).size === items.length;

const validateContributions = (value: unknown): value is HostContributionsV1 => {
  if (isRecord(value) === false) {
    return false;
  }

  const commands = value.commands ?? [];
  const capabilities = value.capabilities ?? [];
  const settings = value.settings ?? [];
  const status = value.status ?? [];
  const events = value.events ?? [];
  if (
    Array.isArray(commands) === false ||
    commands.some(
      (item) =>
        isRecord(item) === false ||
        isIdentifier(item.id) === false ||
        isNonEmptyString(item.title) === false ||
        (item.requiredCapability !== undefined && isCapabilityId(item.requiredCapability) === false)
    ) ||
    Array.isArray(capabilities) === false ||
    capabilities.some(
      (item) =>
        isRecord(item) === false ||
        isIdentifier(item.id) === false ||
        isNonEmptyString(item.title) === false ||
        typeof item.version !== "string" ||
        SEMVER_PATTERN.test(item.version) === false
    ) ||
    Array.isArray(settings) === false ||
    settings.some(
      (item) =>
        isRecord(item) === false ||
        isIdentifier(item.id) === false ||
        isNonEmptyString(item.title) === false ||
        isNonEmptyString(item.route) === false
    ) ||
    Array.isArray(status) === false ||
    status.some(
      (item) =>
        isRecord(item) === false ||
        isIdentifier(item.id) === false ||
        isNonEmptyString(item.title) === false
    ) ||
    Array.isArray(events) === false ||
    events.some(
      (item) =>
        isRecord(item) === false ||
        isIdentifier(item.id) === false ||
        isNonEmptyString(item.title) === false ||
        (item.requiredCapability !== undefined && isCapabilityId(item.requiredCapability) === false)
    )
  ) {
    return false;
  }

  return hasUniqueIds(commands as HostCommandContributionV1[]) &&
    hasUniqueIds(capabilities as HostCapabilityContributionV1[]) &&
    hasUniqueIds(settings as HostSettingsContributionV1[]) &&
    hasUniqueIds(status as HostStatusContributionV1[]) &&
    hasUniqueIds(events as HostEventContributionV1[]);
};

export const validateWorkspaceTabV2 = (value: unknown): value is WorkspaceTabV2 =>
  isRecord(value) &&
  value.schemaVersion === WORKSPACE_TAB_SCHEMA_VERSION &&
  isIdentifier(value.appId) &&
  typeof value.appVersion === "string" &&
  SEMVER_PATTERN.test(value.appVersion) &&
  isNonEmptyString(value.instanceId) &&
  isNonEmptyString(value.route) &&
  isJsonValue(value.opaqueState);

export const validateLyraNestedAppCreateRequestV1 = (
  value: unknown
): value is LyraNestedAppCreateRequestV1 =>
  isRecord(value) &&
  isIdentifier(value.appId) &&
  (
    value.appVersion === undefined ||
    (typeof value.appVersion === "string" && SEMVER_PATTERN.test(value.appVersion))
  ) &&
  isNonEmptyString(value.instanceId) &&
  isNonEmptyString(value.route);

export const validateLyraAppModule = (value: unknown): value is LyraAppModule =>
  isRecord(value) &&
  isIdentifier(value.id) &&
  typeof value.version === "string" &&
  SEMVER_PATTERN.test(value.version) &&
  (value.contributions === undefined || validateContributions(value.contributions)) &&
  typeof value.activate === "function" &&
  typeof value.create === "function" &&
  typeof value.restore === "function" &&
  typeof value.snapshot === "function" &&
  (
    (value.mount === undefined && value.unmount === undefined)
    || (typeof value.mount === "function" && typeof value.unmount === "function")
  ) &&
  typeof value.deactivate === "function" &&
  typeof value.close === "function";
