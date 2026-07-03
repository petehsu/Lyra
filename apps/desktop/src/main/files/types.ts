import type {
  FileManagerCreateFileRequest,
  FileManagerCreateFolderRequest,
  FileManagerDirectoryPatch,
  FileManagerDirectoryMutationResponse,
  FileManagerEjectDeviceRequest,
  FileManagerEjectDeviceResult,
  FileManagerFavoritesPayload,
  FileReadResult,
  FileReadTextRequest,
  FileStatRequest,
  FileStatResult,
  FileManagerMountDeviceRequest,
  FileManagerMountDeviceResult,
  FileManagerMoveToTrashRequest,
  FileManagerReadDirectoryRequest,
  FileManagerReadDirectoryResponse,
  FileManagerReadHomeResponse,
  FileManagerReadTrashResponse,
  FileManagerRecentLocationsPayload,
  FileManagerRestoreFromTrashRequest,
  FileManagerSubscribeDirectoryResponse,
  FileWriteResult,
  FileWriteTextRequest
} from "../../shared/file-manager";

type StorageRootRequest = {
  readonly storageRoot: string;
};

export type NativeReadDirectoryRequest = FileManagerReadDirectoryRequest;
export type NativeSubscribeDirectoryRequest = FileManagerReadDirectoryRequest;
export type NativeUnsubscribeDirectoryRequest = {
  readonly subscriptionId: string;
};
export type NativeCreateFileRequest = FileManagerCreateFileRequest;
export type NativeCreateFolderRequest = FileManagerCreateFolderRequest;
export type NativeMoveToTrashRequest = FileManagerMoveToTrashRequest & StorageRootRequest;
export type NativeRestoreFromTrashRequest = FileManagerRestoreFromTrashRequest & StorageRootRequest;
export type NativeMountDeviceRequest = FileManagerMountDeviceRequest;
export type NativeEjectDeviceRequest = FileManagerEjectDeviceRequest;
export type NativeReadTextFileRequest = FileReadTextRequest;
export type NativeWriteTextFileRequest = FileWriteTextRequest;
export type NativeStatFileRequest = FileStatRequest;
export type NativeWorkbenchPathProbeRequest = {
  readonly path: string;
};
export type NativeWorkbenchPathProbeResult = {
  readonly normalizedPath: string;
  readonly existingPath?: string;
  readonly directoryPath?: string;
  readonly projectRoot?: string;
};
export type NativeWorkbenchCollectFilePathsRequest = {
  readonly rootPath: string;
  readonly basePath?: string;
};
export type NativeWorkbenchCollectedFilePath = {
  readonly path: string;
};

export type FilesNativeBindings = {
  readonly readHome: (request: StorageRootRequest) => Promise<FileManagerReadHomeResponse>;
  readonly readDirectory: (request: NativeReadDirectoryRequest) => Promise<FileManagerReadDirectoryResponse>;
  readonly subscribeDirectory: (
    request: NativeSubscribeDirectoryRequest
  ) => Promise<FileManagerSubscribeDirectoryResponse>;
  readonly unsubscribeDirectory: (request: NativeUnsubscribeDirectoryRequest) => Promise<boolean>;
  readonly pollDirectoryPatches: () => Promise<readonly FileManagerDirectoryPatch[]>;
  readonly readTrash: (request: StorageRootRequest) => Promise<FileManagerReadTrashResponse>;
  readonly createFile: (request: NativeCreateFileRequest) => Promise<FileManagerDirectoryMutationResponse>;
  readonly createFolder: (request: NativeCreateFolderRequest) => Promise<FileManagerDirectoryMutationResponse>;
  readonly moveToTrash: (request: NativeMoveToTrashRequest) => Promise<void>;
  readonly restoreFromTrash: (request: NativeRestoreFromTrashRequest) => Promise<void>;
  readonly emptyTrash: (request: StorageRootRequest) => Promise<void>;
  readonly mountDevice: (request: NativeMountDeviceRequest) => Promise<FileManagerMountDeviceResult>;
  readonly ejectDevice: (request: NativeEjectDeviceRequest) => Promise<FileManagerEjectDeviceResult>;
  readonly readFavorites: (request: StorageRootRequest) => Promise<FileManagerFavoritesPayload>;
  readonly writeFavorites: (request: StorageRootRequest & FileManagerFavoritesPayload) => Promise<FileManagerFavoritesPayload>;
  readonly readRecentLocations: (request: StorageRootRequest) => Promise<FileManagerRecentLocationsPayload>;
  readonly writeRecentLocations: (
    request: StorageRootRequest & FileManagerRecentLocationsPayload
  ) => Promise<FileManagerRecentLocationsPayload>;
  readonly readTextFile: (request: NativeReadTextFileRequest) => Promise<FileReadResult>;
  readonly writeTextFile: (request: NativeWriteTextFileRequest) => Promise<FileWriteResult>;
  readonly statFile: (request: NativeStatFileRequest) => Promise<FileStatResult>;
  readonly probeWorkbenchPath: (
    request: NativeWorkbenchPathProbeRequest
  ) => Promise<NativeWorkbenchPathProbeResult>;
  readonly collectWorkbenchFilePaths: (
    request: NativeWorkbenchCollectFilePathsRequest
  ) => Promise<readonly NativeWorkbenchCollectedFilePath[]>;
};

export type FilesNativeLoadResult =
  | {
      readonly ok: true;
      readonly bindings: FilesNativeBindings;
      readonly loadedFrom: string;
    }
  | {
      readonly ok: false;
      readonly errorMessage: string;
      readonly triedPaths: readonly string[];
    };
