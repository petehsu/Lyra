import type {
  LyraSystemActivityActionRequest,
  LyraSystemActivityActionResult,
  LyraSystemSnapshot,
  LyraResourceLifecycleRequest,
  LyraResourceRegisterRequest,
  LyraResourceSnapshot
} from "../../shared/resource-runtime";

export type ResourcesNativeBindings = {
  readonly registerOrUpdateResourceJson: (payload: string) => number;
  readonly removeResource: (resourceId: string) => number;
  readonly requestLifecycle: (resourceId: string, targetState: string) => number;
  readonly readSnapshotJson: () => string;
  readonly readSystemSnapshotJson: () => string;
  readonly requestActivityActionJson: (payload: string) => string;
};

export type ResourcesNativeLoadResult =
  | {
      readonly ok: true;
      readonly bindings: ResourcesNativeBindings;
      readonly loadedFrom: string;
    }
  | {
      readonly ok: false;
      readonly errorMessage: string;
      readonly triedPaths: readonly string[];
    };

export type ResourceRuntimeService = {
  readonly dispose: () => void;
  readonly loadResult: Extract<ResourcesNativeLoadResult, { readonly ok: true }>;
  readonly readSnapshot: () => LyraResourceSnapshot;
  readonly readSystemSnapshot: () => LyraSystemSnapshot;
  readonly registerOrUpdate: (request: LyraResourceRegisterRequest) => number;
  readonly remove: (resourceId: string) => number;
  readonly requestLifecycle: (request: LyraResourceLifecycleRequest) => number;
  readonly requestActivityAction: (
    request: LyraSystemActivityActionRequest
  ) => LyraSystemActivityActionResult;
};
