import {
  act,
  renderHook
} from "@testing-library/react";
import {
  describe,
  expect,
  test,
  vi
} from "vitest";

import type {
  FileManagerDevice,
  FileManagerFavorite
} from "../../../../shared/file-manager";
import type { ContextMenuModel } from "../../context-menu";
import type { FileManagerSurfaceLabels } from "../types";
import { useFileManagerContextMenusController } from "../context-menus";
import { createInitialState } from "../state-model";
import type { FileManagerStateStore } from "../state-store";

const labels = {
  title: "Files",
  downloadManagerTitle: "Downloads",
  contextOpen: "Open",
  contextMountDevice: "Mount",
  contextMoveToTrash: "Move to Trash",
  contextRestore: "Restore",
  contextEmptyTrash: "Empty Trash",
  contextEjectDevice: "Eject",
  addFavorite: "Add Favorite",
  removeFavorite: "Remove Favorite",
  newFolder: "New Folder",
  newFile: "New File",
  refresh: "Refresh"
} as FileManagerSurfaceLabels;

const createContextMenuModel = (): ContextMenuModel => ({
  state: {
    isOpen: false,
    anchorX: 0,
    anchorY: 0,
    items: []
  },
  openMenu: vi.fn(),
  closeMenu: vi.fn(),
  selectItem: vi.fn()
});

const renderController = (options: {
  readonly contextMenuModel?: ContextMenuModel;
  readonly state?: ReturnType<typeof createInitialState>;
  readonly mountDevice?: ReturnType<typeof vi.fn>;
} = {}) => {
  const contextMenuModel = options.contextMenuModel ?? createContextMenuModel();
  const store = {
    statesRef: {
      current: {
        instance: options.state ?? createInitialState("instance", labels)
      }
    }
  } as unknown as FileManagerStateStore;
  const mountDevice = options.mountDevice ?? vi.fn(async () => undefined);

  const hook = renderHook(() => useFileManagerContextMenusController({
    desktopApi: null,
    contextMenuModel,
    labels,
    platform: "linux",
    store,
    loadDirectory: vi.fn(async () => undefined),
    openLocation: vi.fn(async () => undefined),
    loadTrash: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    writeFavoritesForState: vi.fn(async () => undefined),
    isFavoritePath: vi.fn(() => false),
    toggleFavoriteForLocation: vi.fn(async () => undefined),
    toggleCurrentDirectoryFavorite: vi.fn(async () => undefined),
    ejectDisk: vi.fn(async () => undefined),
    ejectDevice: vi.fn(async () => undefined),
    mountDevice,
    selectEntry: vi.fn(),
    selectTrashEntry: vi.fn(),
    beginCreateDraft: vi.fn(),
    emptyTrash: vi.fn(async () => undefined)
  }));

  return {
    ...hook,
    contextMenuModel,
    mountDevice
  };
};

describe("file manager context menus", () => {
  test("disables the current directory favorite action outside directory views", () => {
    const { result, contextMenuModel } = renderController();

    act(() => {
      result.current.openDirectoryContextMenu("instance", 12, 24);
    });

    const request = vi.mocked(contextMenuModel.openMenu).mock.calls[0]?.[0];
    const favoriteItem = request?.items.find((item) => item.id === "toggle-favorite-instance");

    expect(request?.anchorX).toBe(12);
    expect(request?.anchorY).toBe(24);
    expect(favoriteItem?.disabled).toBe(true);
    expect(favoriteItem?.label).toBe("Add Favorite");
  });

  test("does not open a device menu when no mount or eject action is available", () => {
    const { result, contextMenuModel } = renderController();
    const device: FileManagerDevice = {
      id: "device-1",
      title: "Device",
      devicePath: "/dev/sdb",
      kind: "removable",
      isRemovable: true,
      canMount: false,
      canEject: false
    };

    act(() => {
      result.current.openDeviceContextMenu("instance", device, 0, 0);
    });

    expect(contextMenuModel.openMenu).not.toHaveBeenCalled();
  });

  test("binds mountable device menu items to the mount action", async () => {
    const mountDevice = vi.fn(async () => undefined);
    const { result, contextMenuModel } = renderController({ mountDevice });
    const device: FileManagerDevice = {
      id: "device-1",
      title: "Device",
      devicePath: "/dev/sdb",
      kind: "removable",
      isRemovable: true,
      canMount: true,
      canEject: false
    };

    act(() => {
      result.current.openDeviceContextMenu("instance", device, 10, 10);
    });

    const request = vi.mocked(contextMenuModel.openMenu).mock.calls[0]?.[0];
    const mountItem = request?.items.find((item) => item.label === "Mount");
    expect(mountItem).toBeDefined();

    await act(async () => {
      mountItem?.onSelect?.();
      await Promise.resolve();
    });

    expect(mountDevice).toHaveBeenCalledWith("instance", device);
  });

  test("favorite menu removal delegates to the favorite writer", () => {
    const favoriteWriter = vi.fn(async () => undefined);
    const contextMenuModel = createContextMenuModel();
    const favorite: FileManagerFavorite = {
      id: "favorite-1",
      title: "Projects",
      path: "/home/lyra/Projects"
    };
    const state = {
      ...createInitialState("instance", labels),
      favorites: [favorite]
    };
    const store = {
      statesRef: {
        current: {
          instance: state
        }
      }
    } as unknown as FileManagerStateStore;
    const { result } = renderHook(() => useFileManagerContextMenusController({
      desktopApi: null,
      contextMenuModel,
      labels,
      platform: "linux",
      store,
      loadDirectory: vi.fn(async () => undefined),
      openLocation: vi.fn(async () => undefined),
      loadTrash: vi.fn(async () => undefined),
      refresh: vi.fn(async () => undefined),
      writeFavoritesForState: favoriteWriter,
      isFavoritePath: vi.fn(() => true),
      toggleFavoriteForLocation: vi.fn(async () => undefined),
      toggleCurrentDirectoryFavorite: vi.fn(async () => undefined),
      ejectDisk: vi.fn(async () => undefined),
      ejectDevice: vi.fn(async () => undefined),
      mountDevice: vi.fn(async () => undefined),
      selectEntry: vi.fn(),
      selectTrashEntry: vi.fn(),
      beginCreateDraft: vi.fn(),
      emptyTrash: vi.fn(async () => undefined)
    }));

    act(() => {
      result.current.openFavoriteContextMenu("instance", favorite, 4, 8);
    });

    const request = vi.mocked(contextMenuModel.openMenu).mock.calls[0]?.[0];
    const removeItem = request?.items.find((item) => item.id === "remove-favorite-favorite-1");
    act(() => {
      removeItem?.onSelect?.();
    });

    expect(favoriteWriter).toHaveBeenCalledWith(state, expect.any(Function));
  });
});
