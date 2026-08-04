import {
  validateLyraNestedAppCreateRequestV1,
  validateWorkspaceTabV2,
  type JsonValue,
  type LyraNestedAppCreateRequestV1,
  type LyraNestedAppSlotErrorCodeV1,
  type LyraNestedAppSlotResultV1,
  type LyraNestedAppSlotsV1,
  type WorkspaceTabV2
} from "@lyra/app-runtime";

export type NestedAppOwner = {
  readonly parentInstanceId: string;
  readonly slotId: string;
};

type NestedAppInstanceHandle = {
  readonly version: string;
  readonly snapshot: () => Promise<JsonValue>;
  readonly close: () => Promise<unknown>;
};

type NestedAppSlotRecord = NestedAppOwner & {
  readonly appId: string;
  readonly componentId: string;
  readonly version: string;
  readonly instanceId: string;
  readonly route: string;
  readonly handle: NestedAppInstanceHandle;
};

type NestedAppParent = {
  readonly instanceId: string;
};

type NestedAppComponentState = {
  readonly active: string;
  readonly activationInProgress: boolean;
};

type OpenNestedAppInstanceRequest = {
  readonly appId: string;
  readonly componentId: string;
  readonly version: string;
  readonly instanceId: string;
  readonly route: string;
  readonly opaqueState?: JsonValue;
  readonly restore: boolean;
  readonly nestedOwner: NestedAppOwner;
};

export type NestedAppSlotCoordinatorDependencies<Parent extends NestedAppParent> = {
  readonly resolveApp: (appId: string) => { readonly componentId: string } | undefined;
  readonly readComponentState: (
    componentId: string
  ) => NestedAppComponentState | undefined;
  readonly isParentAvailable: (parent: Parent) => boolean;
  readonly isInstanceOpen: (instanceId: string) => boolean;
  readonly isModuleLoaded: (componentId: string, version: string) => boolean;
  readonly isModuleSurfaceCapable: (
    componentId: string,
    version: string
  ) => boolean;
  readonly openInstance: (
    request: OpenNestedAppInstanceRequest
  ) => Promise<NestedAppInstanceHandle>;
  readonly mountInstance: (
    instanceId: string,
    container: HTMLElement
  ) => Promise<void>;
  readonly unmountInstance: (instanceId: string) => Promise<void>;
};

export type NestedAppSlotCoordinator<Parent extends NestedAppParent> = {
  readonly ownerForChild: (instanceId: string) => NestedAppOwner | undefined;
  readonly slotsFor: (parent: Parent) => LyraNestedAppSlotsV1;
  readonly closeForParent: (parent: Parent) => Promise<void>;
};

const ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;

const nestedSuccess = <T>(value: T): LyraNestedAppSlotResultV1<T> => ({
  ok: true,
  value
});

const nestedFailure = <T>(
  code: LyraNestedAppSlotErrorCodeV1,
  message: string,
  repairable: boolean,
  context: {
    readonly appId?: string;
    readonly appVersion?: string;
    readonly instanceId?: string;
  } = {}
): LyraNestedAppSlotResultV1<T> => ({
  ok: false,
  error: {
    code,
    message,
    repairable,
    ...(context.appId === undefined ? {} : { appId: context.appId }),
    ...(context.appVersion === undefined ? {} : { appVersion: context.appVersion }),
    ...(context.instanceId === undefined ? {} : { instanceId: context.instanceId })
  }
});

const nestedErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const normalizeNestedSlotId = (slotId: string): string | undefined => {
  const normalized = slotId.trim();
  return ID_PATTERN.test(normalized) ? normalized : undefined;
};

const requestContextFor = (
  request: LyraNestedAppCreateRequestV1 | WorkspaceTabV2
): {
  readonly appId?: string;
  readonly appVersion?: string;
  readonly instanceId?: string;
} => ({
  ...(typeof request === "object" && request !== null && typeof request.appId === "string"
    ? { appId: request.appId }
    : {}),
  ...(typeof request === "object" && request !== null && typeof request.appVersion === "string"
    ? { appVersion: request.appVersion }
    : {}),
  ...(typeof request === "object" && request !== null && typeof request.instanceId === "string"
    ? { instanceId: request.instanceId }
    : {})
});

export const createNestedAppSlotCoordinator = <Parent extends NestedAppParent>(
  dependencies: NestedAppSlotCoordinatorDependencies<Parent>
): NestedAppSlotCoordinator<Parent> => {
  const slotsByParent = new Map<string, Map<string, NestedAppSlotRecord>>();
  /** Includes reservations while a child is opening, preventing cross-parent races. */
  const ownerByChild = new Map<string, NestedAppOwner>();
  const lifecycleQueues = new WeakMap<Parent, { current: Promise<void> }>();
  const slotApis = new WeakMap<Parent, LyraNestedAppSlotsV1>();

  const enqueueLifecycle = async <T>(
    parent: Parent,
    operation: () => Promise<T>
  ): Promise<T> => {
    const queue = lifecycleQueues.get(parent) ?? { current: Promise.resolve() };
    lifecycleQueues.set(parent, queue);
    const previous = queue.current;
    let releaseQueue!: () => void;
    queue.current = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      releaseQueue();
    }
  };

  const slotMap = (
    parentInstanceId: string,
    create = false
  ): Map<string, NestedAppSlotRecord> | undefined => {
    const existing = slotsByParent.get(parentInstanceId);
    if (existing !== undefined || !create) {
      return existing;
    }
    const slots = new Map<string, NestedAppSlotRecord>();
    slotsByParent.set(parentInstanceId, slots);
    return slots;
  };

  const ownerMatches = (
    left: NestedAppOwner | undefined,
    right: NestedAppOwner
  ): boolean => left?.parentInstanceId === right.parentInstanceId
    && left.slotId === right.slotId;

  const wouldCreateCycle = (
    parentInstanceId: string,
    childInstanceId: string
  ): boolean => {
    const visited = new Set<string>();
    let current: string | undefined = parentInstanceId;
    while (current !== undefined) {
      if (current === childInstanceId || visited.has(current)) {
        return true;
      }
      visited.add(current);
      current = ownerByChild.get(current)?.parentInstanceId;
    }
    return false;
  };

  const snapshotSlot = async (
    slot: NestedAppSlotRecord
  ): Promise<WorkspaceTabV2> => ({
    schemaVersion: 2,
    appId: slot.appId,
    appVersion: slot.version,
    instanceId: slot.instanceId,
    route: slot.route,
    opaqueState: await slot.handle.snapshot()
  });

  const releaseOwnership = (slot: NestedAppSlotRecord): void => {
    const slots = slotsByParent.get(slot.parentInstanceId);
    if (slots?.get(slot.slotId) === slot) {
      slots.delete(slot.slotId);
      if (slots.size === 0) {
        slotsByParent.delete(slot.parentInstanceId);
      }
    }
    const owner = ownerByChild.get(slot.instanceId);
    if (ownerMatches(owner, slot)) {
      ownerByChild.delete(slot.instanceId);
    }
  };

  const disposeSlot = async (slot: NestedAppSlotRecord): Promise<void> => {
    await slot.handle.close();
    releaseOwnership(slot);
  };

  const openSlot = async (
    parent: Parent,
    slotId: string,
    request: LyraNestedAppCreateRequestV1 | WorkspaceTabV2,
    restore: boolean
  ): Promise<LyraNestedAppSlotResultV1<WorkspaceTabV2>> =>
    enqueueLifecycle(parent, async () => {
      const normalizedSlotId = normalizeNestedSlotId(slotId);
      const requestContext = requestContextFor(request);
      if (normalizedSlotId === undefined) {
        return nestedFailure(
          "invalid-request",
          `Nested application slot id is invalid: ${slotId}`,
          false,
          requestContext
        );
      }
      if (!dependencies.isParentAvailable(parent)) {
        return nestedFailure(
          "parent-unavailable",
          `Parent application instance is unavailable: ${parent.instanceId}`,
          false,
          requestContext
        );
      }
      if (
        (restore && !validateWorkspaceTabV2(request))
        || (!restore && !validateLyraNestedAppCreateRequestV1(request))
      ) {
        return nestedFailure(
          "invalid-request",
          "Nested application descriptor is invalid.",
          false,
          requestContext
        );
      }

      const validRequest = request as LyraNestedAppCreateRequestV1 | WorkspaceTabV2;
      const appId = validRequest.appId;
      const instanceId = validRequest.instanceId.trim();
      const route = validRequest.route;
      const app = dependencies.resolveApp(appId);
      if (app === undefined) {
        return nestedFailure(
          "app-unavailable",
          `Nested application is not installed: ${appId}`,
          true,
          requestContext
        );
      }
      const state = dependencies.readComponentState(app.componentId);
      if (state === undefined) {
        return nestedFailure(
          "app-unavailable",
          `Nested application component is not installed: ${app.componentId}`,
          true,
          requestContext
        );
      }
      const version = validRequest.appVersion ?? state.active;
      const context = { appId, appVersion: version, instanceId };
      const occupied = slotsByParent.get(parent.instanceId)?.get(normalizedSlotId);
      if (occupied !== undefined) {
        if (
          occupied.appId === appId
          && occupied.instanceId === instanceId
          && occupied.route === route
          && (
            validRequest.appVersion === undefined
            || occupied.version === validRequest.appVersion
          )
        ) {
          try {
            return nestedSuccess(await snapshotSlot(occupied));
          } catch (error) {
            return nestedFailure(
              "lifecycle-failed",
              nestedErrorMessage(error),
              true,
              context
            );
          }
        }
        return nestedFailure(
          "slot-occupied",
          `Nested application slot is already occupied: ${normalizedSlotId}`,
          false,
          context
        );
      }
      if (wouldCreateCycle(parent.instanceId, instanceId)) {
        return nestedFailure(
          "cycle",
          `Nested application would create an instance cycle: ${instanceId}`,
          false,
          context
        );
      }
      if (dependencies.isInstanceOpen(instanceId) || ownerByChild.has(instanceId)) {
        return nestedFailure(
          "duplicate-instance",
          `Nested application instance is already open: ${instanceId}`,
          false,
          context
        );
      }
      if (state.activationInProgress) {
        return nestedFailure(
          "version-unavailable",
          `Nested application activation is in progress: ${app.componentId}`,
          true,
          context
        );
      }
      if (!dependencies.isModuleLoaded(app.componentId, version)) {
        return nestedFailure(
          "version-unavailable",
          `Nested application version is unavailable: ${app.componentId}@${version}`,
          true,
          context
        );
      }
      if (!dependencies.isModuleSurfaceCapable(app.componentId, version)) {
        return nestedFailure(
          "surface-unavailable",
          `Nested application surface needs repair: ${app.componentId}@${version}`,
          true,
          context
        );
      }

      const owner = {
        parentInstanceId: parent.instanceId,
        slotId: normalizedSlotId
      };
      ownerByChild.set(instanceId, owner);
      let handle: NestedAppInstanceHandle | undefined;
      let registeredSlot = false;
      try {
        handle = await dependencies.openInstance({
          appId,
          componentId: app.componentId,
          version,
          instanceId,
          route,
          ...(restore
            ? { opaqueState: (validRequest as WorkspaceTabV2).opaqueState }
            : {}),
          restore,
          nestedOwner: owner
        });
        const slot: NestedAppSlotRecord = {
          ...owner,
          appId,
          componentId: app.componentId,
          version: handle.version,
          instanceId,
          route,
          handle
        };
        slotMap(parent.instanceId, true)!.set(normalizedSlotId, slot);
        registeredSlot = true;
        return nestedSuccess(await snapshotSlot(slot));
      } catch (error) {
        if (registeredSlot) {
          return nestedFailure(
            "lifecycle-failed",
            nestedErrorMessage(error),
            true,
            context
          );
        }
        if (handle !== undefined) {
          try {
            await handle.close();
          } catch (closeError) {
            return nestedFailure(
              "lifecycle-failed",
              `${nestedErrorMessage(error)} Cleanup also failed: ${nestedErrorMessage(closeError)}`,
              true,
              context
            );
          }
        }
        if (ownerMatches(ownerByChild.get(instanceId), owner)) {
          ownerByChild.delete(instanceId);
        }
        return nestedFailure(
          "lifecycle-failed",
          nestedErrorMessage(error),
          true,
          context
        );
      }
    });

  const createSlots = (parent: Parent): LyraNestedAppSlotsV1 => ({
    create: (slotId, request) => openSlot(parent, slotId, request, false),
    restore: (slotId, descriptor) => openSlot(parent, slotId, descriptor, true),
    mount: (slotId, container) => enqueueLifecycle(parent, async () => {
      const normalizedSlotId = normalizeNestedSlotId(slotId);
      if (normalizedSlotId === undefined) {
        return nestedFailure(
          "invalid-request",
          `Nested application slot id is invalid: ${slotId}`,
          false
        );
      }
      const slot = slotsByParent.get(parent.instanceId)?.get(normalizedSlotId);
      if (slot === undefined) {
        return nestedFailure(
          "slot-empty",
          `Nested application slot is empty: ${normalizedSlotId}`,
          false
        );
      }
      try {
        await dependencies.mountInstance(slot.instanceId, container);
        return nestedSuccess(null);
      } catch (error) {
        return nestedFailure(
          "surface-unavailable",
          nestedErrorMessage(error),
          true,
          { appId: slot.appId, appVersion: slot.version, instanceId: slot.instanceId }
        );
      }
    }),
    unmount: (slotId) => enqueueLifecycle(parent, async () => {
      const normalizedSlotId = normalizeNestedSlotId(slotId);
      if (normalizedSlotId === undefined) {
        return nestedFailure(
          "invalid-request",
          `Nested application slot id is invalid: ${slotId}`,
          false
        );
      }
      const slot = slotsByParent.get(parent.instanceId)?.get(normalizedSlotId);
      if (slot === undefined) {
        return nestedSuccess(null);
      }
      try {
        await dependencies.unmountInstance(slot.instanceId);
        return nestedSuccess(null);
      } catch (error) {
        return nestedFailure(
          "lifecycle-failed",
          nestedErrorMessage(error),
          true,
          { appId: slot.appId, appVersion: slot.version, instanceId: slot.instanceId }
        );
      }
    }),
    snapshot: (slotId) => enqueueLifecycle(parent, async () => {
      const normalizedSlotId = normalizeNestedSlotId(slotId);
      if (normalizedSlotId === undefined) {
        return nestedFailure(
          "invalid-request",
          `Nested application slot id is invalid: ${slotId}`,
          false
        );
      }
      const slot = slotsByParent.get(parent.instanceId)?.get(normalizedSlotId);
      if (slot === undefined) {
        return nestedFailure(
          "slot-empty",
          `Nested application slot is empty: ${normalizedSlotId}`,
          false
        );
      }
      try {
        return nestedSuccess(await snapshotSlot(slot));
      } catch (error) {
        return nestedFailure(
          "lifecycle-failed",
          nestedErrorMessage(error),
          true,
          { appId: slot.appId, appVersion: slot.version, instanceId: slot.instanceId }
        );
      }
    }),
    close: (slotId) => enqueueLifecycle(parent, async () => {
      const normalizedSlotId = normalizeNestedSlotId(slotId);
      if (normalizedSlotId === undefined) {
        return nestedFailure(
          "invalid-request",
          `Nested application slot id is invalid: ${slotId}`,
          false
        );
      }
      const slot = slotsByParent.get(parent.instanceId)?.get(normalizedSlotId);
      if (slot === undefined) {
        return nestedSuccess(null);
      }
      let descriptor: WorkspaceTabV2 | undefined;
      let snapshotError: unknown;
      try {
        descriptor = await snapshotSlot(slot);
      } catch (error) {
        snapshotError = error;
      }
      try {
        await disposeSlot(slot);
      } catch (error) {
        return nestedFailure(
          "lifecycle-failed",
          nestedErrorMessage(error),
          true,
          { appId: slot.appId, appVersion: slot.version, instanceId: slot.instanceId }
        );
      }
      if (snapshotError !== undefined || descriptor === undefined) {
        return nestedFailure(
          "lifecycle-failed",
          nestedErrorMessage(snapshotError),
          true,
          { appId: slot.appId, appVersion: slot.version, instanceId: slot.instanceId }
        );
      }
      return nestedSuccess(descriptor);
    })
  });

  return {
    ownerForChild: (instanceId) => ownerByChild.get(instanceId),
    slotsFor: (parent) => {
      const existing = slotApis.get(parent);
      if (existing !== undefined) {
        return existing;
      }
      const slots = createSlots(parent);
      slotApis.set(parent, slots);
      return slots;
    },
    closeForParent: (parent) => enqueueLifecycle(parent, async () => {
      const slots = [...(slotsByParent.get(parent.instanceId)?.values() ?? [])];
      const failures: unknown[] = [];
      for (const slot of slots) {
        try {
          await disposeSlot(slot);
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          `Failed to close nested applications for ${parent.instanceId}.`
        );
      }
    })
  };
};
