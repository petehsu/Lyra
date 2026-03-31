import type {
  FileManagerCreateFileRequest,
  FileManagerCreateFolderRequest,
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
  FileWriteResult,
  FileWriteTextRequest
} from "../../shared/file-manager";

type StorageRootRequest = {
  readonly storageRoot: string;
};

export type NativeReadDirectoryRequest = FileManagerReadDirectoryRequest;
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
  readonly readHome: (request: StorageRootRequest) => FileManagerReadHomeResponse;
  readonly readDirectory: (request: NativeReadDirectoryRequest) => FileManagerReadDirectoryResponse;
  readonly readTrash: (request: StorageRootRequest) => FileManagerReadTrashResponse;
  readonly createFile: (request: NativeCreateFileRequest) => FileManagerDirectoryMutationResponse;
  readonly createFolder: (request: NativeCreateFolderRequest) => FileManagerDirectoryMutationResponse;
  readonly moveToTrash: (request: NativeMoveToTrashRequest) => void;
  readonly restoreFromTrash: (request: NativeRestoreFromTrashRequest) => void;
  readonly emptyTrash: (request: StorageRootRequest) => void;
  readonly mountDevice: (request: NativeMountDeviceRequest) => FileManagerMountDeviceResult;
  readonly ejectDevice: (request: NativeEjectDeviceRequest) => FileManagerEjectDeviceResult;
  readonly readFavorites: (request: StorageRootRequest) => FileManagerFavoritesPayload;
  readonly writeFavorites: (request: StorageRootRequest & FileManagerFavoritesPayload) => FileManagerFavoritesPayload;
  readonly readRecentLocations: (request: StorageRootRequest) => FileManagerRecentLocationsPayload;
  readonly writeRecentLocations: (request: StorageRootRequest & FileManagerRecentLocationsPayload) => FileManagerRecentLocationsPayload;
  readonly readTextFile: (request: NativeReadTextFileRequest) => FileReadResult;
  readonly writeTextFile: (request: NativeWriteTextFileRequest) => FileWriteResult;
  readonly statFile: (request: NativeStatFileRequest) => FileStatResult;
  readonly probeWorkbenchPath: (
    request: NativeWorkbenchPathProbeRequest
  ) => NativeWorkbenchPathProbeResult;
  readonly collectWorkbenchFilePaths: (
    request: NativeWorkbenchCollectFilePathsRequest
  ) => readonly NativeWorkbenchCollectedFilePath[];
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
