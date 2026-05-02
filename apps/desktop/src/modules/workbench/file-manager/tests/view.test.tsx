import type { ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import {
  WorkbenchTitlebarContextProvider,
  WorkbenchTitlebarContextSlot,
  WorkbenchTitlebarScopeProvider
} from "../../shell/titlebar-context";
import type { FileManagerAppState, FileManagerModel, FileManagerSurfaceLabels } from "../types";
import { FileManagerSurface } from "../view";

const labels: FileManagerSurfaceLabels = {
  title: "Files",
  locationHome: "Home",
  locationDesktop: "Desktop",
  locationDocuments: "Documents",
  locationDownloads: "Downloads",
  locationTrash: "Trash",
  homeSectionFavorites: "Favorites",
  homeSectionLocations: "Locations",
  homeSectionDevices: "Devices",
  homeSectionRecent: "Recent",
  navigationBack: "Back",
  navigationForward: "Forward",
  navigationUp: "Up",
  refresh: "Refresh",
  addFavorite: "Add favorite",
  removeFavorite: "Remove favorite",
  newFolder: "New folder",
  newFile: "New file",
  delete: "Delete",
  restore: "Restore",
  emptyTrash: "Empty trash",
  noRecentLocations: "No recent",
  emptyDirectory: "Empty directory",
  emptyTrashState: "Empty trash state",
  noFavorites: "No favorites",
  loading: "Loading",
  unavailable: "Unavailable",
  diskAvailable: "available",
  diskKindSystem: "System disk",
  diskKindLocal: "Local disk",
  diskKindRemovable: "Removable disk",
  diskKindExternal: "External disk",
  deviceUnmounted: "Unmounted",
  nameColumn: "Name",
  locationColumn: "Location",
  originalLocationColumn: "Original location",
  createPlaceholderFile: "File name",
  createPlaceholderDirectory: "Folder name",
  createConfirm: "Confirm",
  createCancel: "Cancel",
  contextOpen: "Open",
  contextMountDevice: "Mount device",
  contextMoveToTrash: "Move to trash",
  contextRestore: "Restore",
  contextEmptyTrash: "Empty trash",
  contextEjectDevice: "Eject",
  viewList: "List view",
  viewLarge: "Large view",
  chooserBindProjectLabel: "Bind project",
  chooserSelectDirectoryPlaceholder: "Open a directory to bind"
};

const createState = (overrides: Partial<FileManagerAppState> = {}): FileManagerAppState => ({
  instanceId: "fm-1",
  status: "ready",
  viewKind: "directory",
  presentationMode: "list",
  title: "Files",
  iconKey: "file-manager-directory",
  currentLocation: {
    id: "project",
    title: "Project",
    kind: "directory",
    path: "/tmp/project"
  },
  parentPath: "/tmp",
  history: [
    {
      id: "tmp",
      title: "tmp",
      kind: "directory",
      path: "/tmp"
    },
    {
      id: "project",
      title: "Project",
      kind: "directory",
      path: "/tmp/project"
    }
  ],
  historyIndex: 1,
  systemLocations: [
    {
      id: "trash",
      title: "Trash",
      kind: "trash",
      specialId: "trash"
    }
  ],
  favorites: [],
  recentLocations: [],
  disks: [],
  devices: [],
  entries: [
    {
      id: "dir-1",
      name: "src",
      kind: "directory",
      path: "/tmp/project/src",
      folderState: "non-empty",
      isHidden: false
    },
    {
      id: "file-1",
      name: "README.md",
      kind: "file",
      path: "/tmp/project/README.md",
      isHidden: false
    }
  ],
  trashEntries: [],
  directorySubscriptionId: undefined,
  directoryGeneration: undefined,
  selectedEntryId: "file-1",
  selectedTrashEntryId: undefined,
  createDraft: undefined,
  errorMessage: undefined,
  ...overrides
});

const createModel = (): FileManagerModel => ({
  createInstance: vi.fn(),
  getState: vi.fn(),
  ensureInstance: vi.fn(),
  syncExternalInstances: vi.fn(),
  syncTabInstances: vi.fn(),
  openHome: vi.fn().mockResolvedValue(undefined),
  openDirectory: vi.fn().mockResolvedValue(undefined),
  openTrash: vi.fn().mockResolvedValue(undefined),
  goBack: vi.fn().mockResolvedValue(undefined),
  goForward: vi.fn().mockResolvedValue(undefined),
  goUp: vi.fn().mockResolvedValue(undefined),
  refresh: vi.fn().mockResolvedValue(undefined),
  setPresentationMode: vi.fn(),
  selectEntry: vi.fn(),
  selectTrashEntry: vi.fn(),
  beginCreateDraft: vi.fn(),
  updateCreateDraft: vi.fn(),
  cancelCreateDraft: vi.fn(),
  commitCreateDraft: vi.fn().mockResolvedValue(undefined),
  moveSelectionToTrash: vi.fn().mockResolvedValue(undefined),
  restoreSelectionFromTrash: vi.fn().mockResolvedValue(undefined),
  emptyTrash: vi.fn().mockResolvedValue(undefined),
  toggleCurrentDirectoryFavorite: vi.fn().mockResolvedValue(undefined),
  openEntryContextMenu: vi.fn(),
  openFavoriteContextMenu: vi.fn(),
  openLocationContextMenu: vi.fn(),
  openRecentLocationContextMenu: vi.fn(),
  openDiskContextMenu: vi.fn(),
  openDeviceContextMenu: vi.fn(),
  openTrashEntryContextMenu: vi.fn(),
  openDirectoryContextMenu: vi.fn(),
  openTrashContextMenu: vi.fn()
});

const renderFileManagerSurface = (
  props: ComponentProps<typeof FileManagerSurface>
) => {
  const scopeId = "file-manager-test";
  return render(
    <WorkbenchTitlebarContextProvider activeScopeId={scopeId}>
      <WorkbenchTitlebarScopeProvider scopeId={scopeId}>
        <FileManagerSurface {...props} />
      </WorkbenchTitlebarScopeProvider>
      <WorkbenchTitlebarContextSlot />
    </WorkbenchTitlebarContextProvider>
  );
};

describe("FileManagerSurface", () => {
  test("routes toolbar actions through the file manager model", () => {
    const model = createModel();
    renderFileManagerSurface({
      state: createState(),
      labels,
      model,
      onOpenFile: vi.fn()
    });

    fireEvent.click(screen.getByLabelText("Back"));
    fireEvent.click(screen.getByLabelText("Large view"));
    fireEvent.click(screen.getByLabelText("New file"));
    fireEvent.click(screen.getByLabelText("Delete"));

    expect(model.goBack).toHaveBeenCalledWith("fm-1");
    expect(model.setPresentationMode).toHaveBeenCalledWith("fm-1", "large");
    expect(model.beginCreateDraft).toHaveBeenCalledWith("fm-1", "file");
    expect(model.moveSelectionToTrash).toHaveBeenCalledWith("fm-1");
  });

  test("opens files and directories from directory rows", () => {
    const model = createModel();
    const onOpenFile = vi.fn();
    renderFileManagerSurface({
      state: createState(),
      labels,
      model,
      onOpenFile
    });

    fireEvent.doubleClick(screen.getByText("README.md").closest("button")!);
    fireEvent.doubleClick(screen.getByText("src").closest("button")!);

    expect(onOpenFile).toHaveBeenCalledWith("/tmp/project/README.md");
    expect(model.openDirectory).toHaveBeenCalledWith("fm-1", "/tmp/project/src");
  });

  test("routes special trash locations and chooser confirmation", () => {
    const model = createModel();
    const onConfirm = vi.fn();
    renderFileManagerSurface({
      state: createState(),
      labels,
      model,
      onOpenFile: vi.fn(),
      chooser: {
        kind: "ai-project-bind",
        confirmLabel: "Bind",
        onConfirm
      }
    });

    fireEvent.click(screen.getByText("Trash"));
    fireEvent.click(screen.getByRole("button", { name: "Bind" }));

    expect(model.openTrash).toHaveBeenCalledWith("fm-1");
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test("shows a directory-selection placeholder before chooser confirmation is available", () => {
    const model = createModel();
    renderFileManagerSurface({
      state: createState({
        viewKind: "home",
        currentLocation: null,
        parentPath: undefined,
        entries: [],
        selectedEntryId: undefined
      }),
      labels,
      model,
      onOpenFile: vi.fn(),
      chooser: {
        kind: "ai-project-bind",
        confirmLabel: "Bind",
        onConfirm: vi.fn()
      }
    });

    expect(screen.getByText("Open a directory to bind")).toBeInTheDocument();
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bind" })).toBeDisabled();
  });

  test("routes create draft input edits and keyboard decisions", () => {
    const model = createModel();
    renderFileManagerSurface({
      state: createState({
        createDraft: {
          kind: "file",
          value: "notes.md"
        }
      }),
      labels,
      model,
      onOpenFile: vi.fn()
    });

    const input = screen.getByPlaceholderText("File name");

    fireEvent.change(input, { target: { value: "plan.md" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(model.updateCreateDraft).toHaveBeenCalledWith("fm-1", "plan.md");
    expect(model.commitCreateDraft).toHaveBeenCalledWith("fm-1");
    expect(model.cancelCreateDraft).toHaveBeenCalledWith("fm-1");
  });
});
