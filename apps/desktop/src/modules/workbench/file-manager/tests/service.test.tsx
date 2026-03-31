import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { ContextMenuModel } from "../../context-menu";
import type { LyraDesktopApi } from "../../../../shared/desktop-bridge";
import type {
  FileManagerReadDirectoryResponse,
  FileManagerReadHomeResponse,
  FileManagerReadTrashResponse
} from "../../../../shared/file-manager";
import type { FileManagerSurfaceLabels } from "../types";
import { useFileManagerModel } from "../service";

const labels: FileManagerSurfaceLabels = {
  title: "文件管理",
  locationHome: "主目录",
  locationDesktop: "桌面",
  locationDocuments: "文稿",
  locationDownloads: "下载",
  locationTrash: "回收站",
  homeSectionFavorites: "收藏",
  homeSectionLocations: "位置",
  homeSectionDevices: "设备",
  homeSectionRecent: "最近",
  navigationBack: "后退",
  navigationForward: "前进",
  navigationUp: "上一级",
  refresh: "刷新",
  addFavorite: "添加收藏",
  removeFavorite: "移除收藏",
  newFolder: "新建文件夹",
  newFile: "新建文件",
  delete: "删除",
  restore: "恢复",
  emptyTrash: "清空回收站",
  noRecentLocations: "暂无最近位置",
  emptyDirectory: "目录为空",
  emptyTrashState: "回收站为空",
  loading: "加载中",
  unavailable: "文件能力不可用",
  diskAvailable: "可用",
  diskKindSystem: "本机磁盘",
  diskKindLocal: "本机附加盘",
  diskKindRemovable: "可移动磁盘",
  diskKindExternal: "外置盘",
  deviceUnmounted: "未挂载",
  nameColumn: "名称",
  locationColumn: "位置",
  originalLocationColumn: "原始位置",
  createPlaceholderFile: "输入文件名",
  createPlaceholderDirectory: "输入文件夹名",
  createConfirm: "确认",
  createCancel: "取消",
  contextOpen: "打开",
  contextMountDevice: "挂载",
  contextMoveToTrash: "移到回收站",
  contextRestore: "恢复",
  contextEmptyTrash: "清空回收站",
  contextEjectDevice: "弹出设备",
  viewList: "列表视图",
  viewLarge: "大视图"
};

const homeResponse: FileManagerReadHomeResponse = {
  location: {
    id: "home-root",
    title: "文件管理",
    kind: "home"
  },
  systemLocations: [
    {
      id: "documents",
      title: "Documents",
      kind: "special",
      path: "/home/lyra/Documents",
      specialId: "documents"
    }
  ],
  favorites: [],
  recentLocations: [],
  devices: [
    {
      id: "/dev/sdb",
      title: "SanDisk 3.2Gen1",
      devicePath: "/dev/sdb",
      displayPath: "/dev/sdb",
      fileSystem: "exfat",
      kind: "removable",
      osFlavor: "unknown",
      totalBytes: 115 * 1024 * 1024 * 1024,
      isRemovable: true,
      canMount: true,
      canEject: true
    }
  ],
  disks: [
    {
      id: "/",
      title: "System",
      mountPath: "/",
      devicePath: "/dev/nvme0n1p2",
      fileSystem: "ext4",
      kind: "system",
      osFlavor: "arch",
      totalBytes: 512 * 1024 * 1024 * 1024,
      availableBytes: 320 * 1024 * 1024 * 1024,
      usedBytes: 192 * 1024 * 1024 * 1024,
      usageRatio: 0.375,
      isRemovable: false,
      canEject: false
    }
  ]
};

const directoryResponse: FileManagerReadDirectoryResponse = {
  location: {
    id: "documents-dir",
    title: "Documents",
    kind: "directory",
    path: "/home/lyra/Documents"
  },
  parentPath: "/home/lyra",
  entries: [
    {
      id: "projects-dir",
      name: "Projects",
      path: "/home/lyra/Documents/Projects",
      kind: "directory",
      folderState: "non-empty",
      isHidden: false
    },
    {
      id: "readme-file",
      name: "README.md",
      path: "/home/lyra/Documents/README.md",
      kind: "file",
      extension: "md",
      isHidden: false,
      sizeBytes: 128,
      modifiedAt: "1711111111"
    }
  ]
};

const trashResponse: FileManagerReadTrashResponse = {
  location: {
    id: "trash-root",
    title: "回收站",
    kind: "trash",
    specialId: "trash"
  },
  entries: []
};

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

const createDesktopApi = (): {
  readonly api: LyraDesktopApi;
  readonly readHome: ReturnType<typeof vi.fn>;
  readonly readDirectory: ReturnType<typeof vi.fn>;
  readonly readTrash: ReturnType<typeof vi.fn>;
  readonly mountDevice: ReturnType<typeof vi.fn>;
  readonly ejectDevice: ReturnType<typeof vi.fn>;
  readonly writeFavorites: ReturnType<typeof vi.fn>;
  readonly writeRecentLocations: ReturnType<typeof vi.fn>;
} => {
  const readHome = vi.fn(async () => homeResponse);
  const readDirectory = vi.fn(async () => directoryResponse);
  const readTrash = vi.fn(async () => trashResponse);
  const mountDevice = vi.fn(async () => ({
    mounted: true,
    mountPath: "/run/media/lyra/SanDisk",
    strategy: "test-mount"
  }));
  const ejectDevice = vi.fn(async () => ({
    ejected: true,
    poweredOff: false,
    strategy: "test-eject"
  }));
  const writeFavorites = vi.fn(async (payload) => payload);
  const writeRecentLocations = vi.fn(async (payload) => payload);

  const api: LyraDesktopApi = {
    windowControls: {
      minimize: async () => undefined,
      toggleMaximize: async () => undefined,
      close: async () => undefined
    },
    appMeta: {
      version: "0.1.0",
      platform: "linux",
      isPackaged: false
    },
    shellEvents: {
      onWindowStateChange: () => () => undefined
    },
    openExternal: async () => false,
    linuxCompat: {
      readStatus: async () => ({
        platform: "linux" as const,
        enabled: true,
        safeMode: false,
        backend: "wayland" as const,
        gpuMode: "hardware" as const,
        backendSource: "auto" as const,
        gpuSource: "auto" as const,
        warnings: [],
        notes: [],
        appliedEnv: {},
        appliedSwitches: {},
        facts: {
          sessionType: "wayland" as const,
          desktop: "KDE",
          waylandDisplay: "wayland-0",
          x11Display: null,
          isRoot: false
        },
        generatedAt: new Date().toISOString()
      }),
      exportDiagnostics: async () => ({
        ok: true,
        filePath: "/tmp/linux-compat.json"
      })
    },
    search: {
      aggregate: async () => ({
        query: "",
        blendedResults: [],
        engineBuckets: [],
        fetchedAt: new Date().toISOString(),
        elapsedMs: 0
      })
    },
    ai: {
      readProfiles: async () => [],
      readProviderCatalog: async () => [],
      readPresetCatalog: async () => [],
      upsertProfile: async () => {
        throw new Error("not implemented");
      },
      deleteProfile: async () => undefined,
      setDefaultProfile: async () => {
        throw new Error("not implemented");
      },
      validateProfile: async () => {
        throw new Error("not implemented");
      },
      discoverModels: async () => {
        throw new Error("not implemented");
      },
      refreshDiscoveredModels: async () => {
        throw new Error("not implemented");
      },
      readSession: async () => {
        throw new Error("not implemented");
      },
      readSessionHistory: async () => [],
      sendChatTurn: async () => {
        throw new Error("not implemented");
      },
      cancelChatTurn: async () => {
        throw new Error("not implemented");
      },
      onEvent: () => () => undefined
    },
    computer: {
      readSession: async () => ({
        sessionId: "test-session",
        hasBooted: false,
        powerState: "off" as const,
        openApps: [],
        activeAppId: null,
        updatedAt: new Date().toISOString()
      }),
      readHostStatus: async () => ({
        platform: "linux" as const,
        platformLabel: "Linux",
        hostname: "lyra",
        release: "test",
        osFlavor: "linux" as const
      }),
      powerOn: async () => ({
        sessionId: "test-session",
        hasBooted: true,
        powerState: "booting" as const,
        bootReason: "user" as const,
        openApps: [],
        activeAppId: null,
        updatedAt: new Date().toISOString()
      }),
      powerOff: async () => ({
        sessionId: "test-session",
        hasBooted: true,
        powerState: "shutting_down" as const,
        openApps: [],
        activeAppId: null,
        updatedAt: new Date().toISOString()
      }),
      openApp: async () => ({
        sessionId: "test-session",
        hasBooted: true,
        powerState: "on" as const,
        openApps: [],
        activeAppId: null,
        updatedAt: new Date().toISOString()
      }),
      focusApp: async () => ({
        sessionId: "test-session",
        hasBooted: true,
        powerState: "on" as const,
        openApps: [],
        activeAppId: null,
        updatedAt: new Date().toISOString()
      }),
      closeApp: async () => ({
        sessionId: "test-session",
        hasBooted: true,
        powerState: "on" as const,
        openApps: [],
        activeAppId: null,
        updatedAt: new Date().toISOString()
      }),
      moveAppWindow: async () => ({
        sessionId: "test-session",
        hasBooted: true,
        powerState: "on" as const,
        openApps: [],
        activeAppId: null,
        updatedAt: new Date().toISOString()
      }),
      resizeAppWindow: async () => ({
        sessionId: "test-session",
        hasBooted: true,
        powerState: "on" as const,
        openApps: [],
        activeAppId: null,
        updatedAt: new Date().toISOString()
      }),
      minimizeApp: async () => ({
        sessionId: "test-session",
        hasBooted: true,
        powerState: "on" as const,
        openApps: [],
        activeAppId: null,
        updatedAt: new Date().toISOString()
      }),
      maximizeApp: async () => ({
        sessionId: "test-session",
        hasBooted: true,
        powerState: "on" as const,
        openApps: [],
        activeAppId: null,
        updatedAt: new Date().toISOString()
      }),
      restoreApp: async () => ({
        sessionId: "test-session",
        hasBooted: true,
        powerState: "on" as const,
        openApps: [],
        activeAppId: null,
        updatedAt: new Date().toISOString()
      }),
      subscribeSession: () => () => undefined
    },
    systemImages: {
      readRegistry: async () => ({
        defaultImageId: "lyra-official",
        runtimeModeOverride: null,
        installedImages: []
      }),
      listInstalled: async () => [],
      installFromDirectory: async () => ({
        imageId: "lyra-official",
        title: "Lyra Official System",
        version: "1.0.0",
        source: "directory",
        installPath: "/tmp/system-images/lyra-official/1.0.0",
        installedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        manifest: {
          id: "lyra-official",
          title: "Lyra Official System",
          version: "1.0.0",
          apiVersion: { min: "1.0.0" },
          shellMode: "full-shell",
          defaultRuntimeMode: "sandbox",
          entryPath: "system/index.js",
          capabilities: [],
          platformArtifacts: []
        }
      }),
      installFromPackage: async () => ({
        imageId: "lyra-official",
        title: "Lyra Official System",
        version: "1.0.0",
        source: "package",
        installPath: "/tmp/system-images/lyra-official/1.0.0",
        installedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        manifest: {
          id: "lyra-official",
          title: "Lyra Official System",
          version: "1.0.0",
          apiVersion: { min: "1.0.0" },
          shellMode: "full-shell",
          defaultRuntimeMode: "sandbox",
          entryPath: "system/index.js",
          capabilities: [],
          platformArtifacts: []
        }
      }),
      installOfficialSeed: async () => ({
        imageId: "lyra-official",
        title: "Lyra Official System",
        version: "1.0.0",
        source: "builtin-seed",
        installPath: "/tmp/system-images/lyra-official/1.0.0",
        installedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        manifest: {
          id: "lyra-official",
          title: "Lyra Official System",
          version: "1.0.0",
          apiVersion: { min: "1.0.0" },
          shellMode: "full-shell",
          defaultRuntimeMode: "sandbox",
          entryPath: "system/index.js",
          capabilities: [],
          platformArtifacts: []
        }
      }),
      uninstall: async () => ({
        defaultImageId: null,
        runtimeModeOverride: null,
        installedImages: []
      }),
      setDefaultImage: async () => ({
        defaultImageId: "lyra-official",
        runtimeModeOverride: null,
        installedImages: []
      }),
      assignSessionImage: async () => ({
        sessionId: "test-session",
        resolvedSystemImageId: "lyra-official",
        effectiveRuntimeMode: "sandbox",
        effectiveShellMode: "full-shell",
        systemContextState: "on",
        updatedAt: new Date().toISOString()
      }),
      clearSessionImageOverride: async () => ({
        sessionId: "test-session",
        resolvedSystemImageId: "lyra-official",
        effectiveRuntimeMode: "sandbox",
        effectiveShellMode: "full-shell",
        systemContextState: "on",
        updatedAt: new Date().toISOString()
      }),
      setRuntimeModeOverride: async () => ({
        defaultImageId: "lyra-official",
        runtimeModeOverride: "sandbox",
        installedImages: []
      }),
      readResolvedSessionSystem: async () => ({
        sessionId: "test-session",
        resolvedSystemImageId: "lyra-official",
        effectiveRuntimeMode: "sandbox",
        effectiveShellMode: "full-shell",
        systemContextState: "on",
        updatedAt: new Date().toISOString()
      }),
      subscribeSystemEvents: () => () => undefined
    },
    mcp: {
      readCatalog: async () => [],
      readServers: async () => [],
      readEffectiveServers: async () => ({ servers: [] }),
      createServer: async () => {
        throw new Error("not implemented");
      },
      updateServer: async () => {
        throw new Error("not implemented");
      },
      deleteServer: async () => undefined,
      installTemplate: async () => {
        throw new Error("not implemented");
      },
      validateServer: async () => ({
        serverId: "",
        ok: true,
        checkedAt: "",
        summary: "",
        diagnostics: []
      }),
      startServer: async () => {
        throw new Error("not implemented");
      },
      stopServer: async () => {
        throw new Error("not implemented");
      },
      restartServer: async () => {
        throw new Error("not implemented");
      },
      readServerIntrospection: async () => ({
        serverId: "",
        fetchedAt: "",
        source: "none",
        note: "",
        tools: [],
        resources: [],
        prompts: []
      }),
      onEvent: () => () => undefined
    },
    skills: {
      readCatalog: async () => [],
      readInstalled: async () => [],
      readEffectiveSkills: async () => [],
      discoverImportSource: async () => ({
        sourcePath: "",
        detectedKind: "unknown",
        sourceKind: "unknown",
        summary: "",
        previewItems: [],
        parseErrors: []
      }),
      importSkills: async () => [],
      createLyraSkill: async () => ({
        skillId: "skill-test",
        scope: "global",
        manifest: {
          id: "skill-test",
          name: "Skill Test",
          version: "1.0.0",
          description: "Test",
          category: "test",
          iconKey: "sparkles",
          sourceKind: "lyra",
          skillType: "prompt",
          entryPath: "SKILL.md",
          assets: [],
          scripts: [],
          permissions: [],
          compatibility: {
            sourceKind: "lyra",
            detectedFrom: ["lyra"],
            notes: [],
            parseErrors: []
          }
        },
        packagePath: "/tmp/skill-test",
        trustState: "untrusted",
        enableState: "disabled",
        installedAt: "",
        updatedAt: "",
        sourceSummary: []
      }),
      updateSkillState: async () => ({
        skillId: "skill-test",
        scope: "global",
        manifest: {
          id: "skill-test",
          name: "Skill Test",
          version: "1.0.0",
          description: "Test",
          category: "test",
          iconKey: "sparkles",
          sourceKind: "lyra",
          skillType: "prompt",
          entryPath: "SKILL.md",
          assets: [],
          scripts: [],
          permissions: [],
          compatibility: {
            sourceKind: "lyra",
            detectedFrom: ["lyra"],
            notes: [],
            parseErrors: []
          }
        },
        packagePath: "/tmp/skill-test",
        trustState: "trusted",
        enableState: "enabled",
        installedAt: "",
        updatedAt: "",
        sourceSummary: []
      }),
      deleteSkill: async () => undefined,
      readSkillDetails: async () => null,
      onEvent: () => () => undefined
    },
    files: {
      readHome,
      readDirectory,
      readTrash,
      readTextFile: async () => ({
        kind: "unsupported",
        path: "",
        reason: "not-needed",
        readOnly: true,
        sizeBytes: 0
      }),
      writeTextFile: async () => ({
        ok: true,
        path: "",
        revision: "",
        encoding: "utf8",
        savedAt: ""
      }),
      statFile: async () => ({
        path: "",
        exists: false,
        isDirectory: false,
        readOnly: false,
        sizeBytes: 0
      }),
      createFile: async () => ({}),
      createFolder: async () => ({}),
      moveToTrash: async () => undefined,
      restoreFromTrash: async () => undefined,
      emptyTrash: async () => undefined,
      mountDevice,
      ejectDevice,
      readFavorites: async () => ({ favorites: [] }),
      writeFavorites,
      readRecentLocations: async () => ({ recentLocations: [] }),
      writeRecentLocations
    },
    lsp: {
      openDocument: async () => undefined,
      changeDocument: async () => undefined,
      saveDocument: async () => undefined,
      closeDocument: async () => undefined,
      completion: async () => ({
        items: [],
        isIncomplete: false
      }),
      onEvent: () => () => undefined
    },
    terminal: {
      createSession: async () => ({
        sessionId: "session-1",
        title: "Terminal",
        shell: "/usr/bin/bash",
        cols: 80,
        rows: 24,
        createdAt: new Date().toISOString()
      }),
      restoreSessions: async () => [],
      reloadPrompt: async () => ({ applied: false, deferred: false }),
      write: async () => undefined,
      resize: async () => undefined,
      closeSession: async () => undefined,
      onData: () => () => undefined,
      onExit: () => () => undefined,
      onError: () => () => undefined
    },
    workbenchState: {
      readSync: () => null,
      writeSync: () => undefined,
      removeSync: () => undefined
    }
  };

  return {
    api,
    readHome,
    readDirectory,
    readTrash,
    mountDevice,
    ejectDevice,
    writeFavorites,
    writeRecentLocations
  };
};

describe("file manager model", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("loads home state and reports app metadata", async () => {
    const desktop = createDesktopApi();
    const onMetaChange = vi.fn();

    const { result } = renderHook(() =>
      useFileManagerModel({
        desktopApi: desktop.api,
        contextMenuModel: createContextMenuModel(),
        labels,
        onMetaChange
      })
    );

    let appInstanceId = "";
    act(() => {
      const app = result.current.createInstance();
      appInstanceId = app.appInstanceId;
    });

    await act(async () => {
      await result.current.openHome(appInstanceId);
    });

    expect(desktop.readHome).toHaveBeenCalledTimes(1);
    expect(result.current.getState(appInstanceId)).toMatchObject({
      viewKind: "home",
      title: labels.title,
      iconKey: "file-manager-home",
      systemLocations: [
        {
          ...homeResponse.systemLocations[0],
          title: labels.locationDocuments
        }
      ],
      devices: homeResponse.devices,
      disks: homeResponse.disks
    });
    expect(onMetaChange).toHaveBeenLastCalledWith({
      appId: "file-manager",
      appInstanceId,
      title: labels.title,
      iconKey: "file-manager-home"
    });
  });

  test("opens directory and persists recent locations", async () => {
    const desktop = createDesktopApi();

    const { result } = renderHook(() =>
      useFileManagerModel({
        desktopApi: desktop.api,
        contextMenuModel: createContextMenuModel(),
        labels,
        onMetaChange: vi.fn()
      })
    );

    let appInstanceId = "";
    act(() => {
      const app = result.current.createInstance();
      appInstanceId = app.appInstanceId;
    });

    await act(async () => {
      await result.current.openDirectory(appInstanceId, "/home/lyra/Documents");
    });

    expect(desktop.readDirectory).toHaveBeenCalledWith({
      path: "/home/lyra/Documents"
    });
    expect(desktop.writeRecentLocations).toHaveBeenCalledTimes(1);
    expect(result.current.getState(appInstanceId)).toMatchObject({
      viewKind: "directory",
      title: "Documents",
      iconKey: "file-manager-directory-non-empty",
      parentPath: "/home/lyra",
      entries: directoryResponse.entries
    });
    expect(result.current.getState(appInstanceId)?.recentLocations).toHaveLength(1);
  });

  test("stores presentation mode per file manager instance", async () => {
    const desktop = createDesktopApi();

    const { result } = renderHook(() =>
      useFileManagerModel({
        desktopApi: desktop.api,
        contextMenuModel: createContextMenuModel(),
        labels,
        onMetaChange: vi.fn()
      })
    );

    let firstId = "";
    let secondId = "";
    act(() => {
      firstId = result.current.createInstance().appInstanceId;
      secondId = result.current.createInstance().appInstanceId;
    });

    act(() => {
      result.current.setPresentationMode(firstId, "large");
    });

    expect(result.current.getState(firstId)?.presentationMode).toBe("large");
    expect(result.current.getState(secondId)?.presentationMode).toBe("list");
  });

  test("syncTabInstances removes closed app state", async () => {
    const desktop = createDesktopApi();

    const { result } = renderHook(() =>
      useFileManagerModel({
        desktopApi: desktop.api,
        contextMenuModel: createContextMenuModel(),
        labels,
        onMetaChange: vi.fn()
      })
    );

    let firstId = "";
    let secondId = "";
    act(() => {
      firstId = result.current.createInstance().appInstanceId;
      secondId = result.current.createInstance().appInstanceId;
    });

    await act(async () => {
      await result.current.openHome(firstId);
      await result.current.openTrash(secondId);
    });

    act(() => {
      result.current.syncTabInstances([secondId]);
    });

    expect(result.current.getState(firstId)).toBeNull();
    expect(result.current.getState(secondId)).not.toBeNull();
    expect(desktop.readTrash).toHaveBeenCalledTimes(1);
  });

  test("falls back to unavailable state when native files api is missing", async () => {
    const { result } = renderHook(() =>
      useFileManagerModel({
        desktopApi: null,
        contextMenuModel: createContextMenuModel(),
        labels,
        onMetaChange: vi.fn()
      })
    );

    let appInstanceId = "";
    act(() => {
      appInstanceId = result.current.createInstance().appInstanceId;
    });

    await act(async () => {
      await result.current.openHome(appInstanceId);
    });

    expect(result.current.getState(appInstanceId)).toMatchObject({
      status: "error",
      errorMessage: labels.unavailable
    });
  });

  test("opens location context menu with favorite action", async () => {
    const desktop = createDesktopApi();
    const contextMenu = createContextMenuModel();

    const { result } = renderHook(() =>
      useFileManagerModel({
        desktopApi: desktop.api,
        contextMenuModel: contextMenu,
        labels,
        onMetaChange: vi.fn()
      })
    );

    let appInstanceId = "";
    act(() => {
      appInstanceId = result.current.createInstance().appInstanceId;
    });

    await act(async () => {
      await result.current.openHome(appInstanceId);
    });

    act(() => {
      result.current.openLocationContextMenu(
        appInstanceId,
        {
          id: "documents",
          title: labels.locationDocuments,
          kind: "special",
          path: "/home/lyra/Documents",
          specialId: "documents"
        },
        24,
        36
      );
    });

    expect(contextMenu.openMenu).toHaveBeenCalledTimes(1);
    expect(contextMenu.openMenu).toHaveBeenCalledWith(
      expect.objectContaining({
        anchorX: 24,
        anchorY: 36,
        items: expect.arrayContaining([
          expect.objectContaining({ label: labels.contextOpen }),
          expect.objectContaining({ label: labels.addFavorite })
        ])
      })
    );
  });

  test("opens trash background context menu with restore actions centralized", async () => {
    const desktop = createDesktopApi();
    const contextMenu = createContextMenuModel();

    const { result } = renderHook(() =>
      useFileManagerModel({
        desktopApi: desktop.api,
        contextMenuModel: contextMenu,
        labels,
        onMetaChange: vi.fn()
      })
    );

    let appInstanceId = "";
    act(() => {
      appInstanceId = result.current.createInstance().appInstanceId;
    });

    await act(async () => {
      await result.current.openTrash(appInstanceId);
    });

    act(() => {
      result.current.openTrashContextMenu(appInstanceId, 80, 120);
    });

    expect(contextMenu.openMenu).toHaveBeenCalledTimes(1);
    expect(contextMenu.openMenu).toHaveBeenCalledWith(
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({ label: labels.refresh }),
          expect.objectContaining({ label: labels.contextEmptyTrash, danger: true })
        ])
      })
    );
  });

  test("opens disk context menu with eject action for ejectable disks", async () => {
    const desktop = createDesktopApi();
    const contextMenu = createContextMenuModel();

    const { result } = renderHook(() =>
      useFileManagerModel({
        desktopApi: desktop.api,
        contextMenuModel: contextMenu,
        labels,
        onMetaChange: vi.fn()
      })
    );

    let appInstanceId = "";
    act(() => {
      appInstanceId = result.current.createInstance().appInstanceId;
    });

    await act(async () => {
      await result.current.openHome(appInstanceId);
    });

    act(() => {
      result.current.openDiskContextMenu(
        appInstanceId,
        {
          id: "/run/media/lyra/Ventoy",
          title: "/dev/sda1",
          mountPath: "/run/media/lyra/Ventoy",
          devicePath: "/dev/sda1",
          fileSystem: "exfat",
          kind: "removable",
          osFlavor: "unknown",
          totalBytes: 64 * 1024 * 1024 * 1024,
          availableBytes: 32 * 1024 * 1024 * 1024,
          usedBytes: 32 * 1024 * 1024 * 1024,
          usageRatio: 0.5,
          isRemovable: true,
          canEject: true
        },
        48,
        96
      );
    });

    expect(contextMenu.openMenu).toHaveBeenCalledWith(
      expect.objectContaining({
        anchorX: 48,
        anchorY: 96,
        items: expect.arrayContaining([
          expect.objectContaining({ label: labels.contextOpen }),
          expect.objectContaining({ label: labels.contextEjectDevice })
        ])
      })
    );
  });

  test("opens device context menu with mount action for mountable devices", async () => {
    const desktop = createDesktopApi();
    const contextMenu = createContextMenuModel();

    const { result } = renderHook(() =>
      useFileManagerModel({
        desktopApi: desktop.api,
        contextMenuModel: contextMenu,
        labels,
        onMetaChange: vi.fn()
      })
    );

    let appInstanceId = "";
    act(() => {
      appInstanceId = result.current.createInstance().appInstanceId;
    });

    await act(async () => {
      await result.current.openHome(appInstanceId);
    });

    act(() => {
      result.current.openDeviceContextMenu(
        appInstanceId,
        {
          id: "/dev/sdb1",
          title: "SanDisk",
          devicePath: "/dev/sdb1",
          displayPath: "/dev/sdb1",
          fileSystem: "exfat",
          kind: "removable",
          osFlavor: "unknown",
          totalBytes: 64 * 1024 * 1024 * 1024,
          isRemovable: true,
          canMount: true,
          canEject: true
        },
        52,
        108
      );
    });

    expect(contextMenu.openMenu).toHaveBeenCalledWith(
      expect.objectContaining({
        anchorX: 52,
        anchorY: 108,
        items: expect.arrayContaining([
          expect.objectContaining({ label: labels.contextMountDevice }),
          expect.objectContaining({ label: labels.contextEjectDevice })
        ])
      })
    );
  });

  test("mounts unmounted devices through the centralized context menu action", async () => {
    const desktop = createDesktopApi();
    const contextMenu = createContextMenuModel();

    const { result } = renderHook(() =>
      useFileManagerModel({
        desktopApi: desktop.api,
        contextMenuModel: contextMenu,
        labels,
        onMetaChange: vi.fn()
      })
    );

    let appInstanceId = "";
    act(() => {
      appInstanceId = result.current.createInstance().appInstanceId;
    });

    await act(async () => {
      await result.current.openHome(appInstanceId);
    });

    act(() => {
      result.current.openDeviceContextMenu(
        appInstanceId,
        {
          id: "/dev/sdb1",
          title: "SanDisk",
          devicePath: "/dev/sdb1",
          displayPath: "/dev/sdb1",
          fileSystem: "exfat",
          kind: "removable",
          osFlavor: "unknown",
          totalBytes: 64 * 1024 * 1024 * 1024,
          isRemovable: true,
          canMount: true,
          canEject: false
        },
        52,
        108
      );
    });

    const openMenuRequest = vi.mocked(contextMenu.openMenu).mock.calls.at(-1)?.[0];
    const mountItem = openMenuRequest?.items.find((item) => item.label === labels.contextMountDevice);

    expect(mountItem).toBeDefined();
    if (mountItem === undefined) {
      throw new Error("expected mount context menu item");
    }
    if (mountItem.onSelect === undefined) {
      throw new Error("expected mount context menu handler");
    }
    const handleMount = mountItem.onSelect;

    await act(async () => {
      handleMount();
      await Promise.resolve();
    });

    expect(desktop.mountDevice).toHaveBeenCalledWith({
      devicePath: "/dev/sdb1",
      kind: "removable"
    });
    expect(desktop.readHome).toHaveBeenCalledTimes(2);
    expect(desktop.readDirectory).toHaveBeenCalledWith({
      path: "/run/media/lyra/SanDisk"
    });
  });

  test("ejects removable disks through the centralized context menu action", async () => {
    const desktop = createDesktopApi();
    const contextMenu = createContextMenuModel();

    const { result } = renderHook(() =>
      useFileManagerModel({
        desktopApi: desktop.api,
        contextMenuModel: contextMenu,
        labels,
        onMetaChange: vi.fn()
      })
    );

    let appInstanceId = "";
    act(() => {
      appInstanceId = result.current.createInstance().appInstanceId;
    });

    await act(async () => {
      await result.current.openHome(appInstanceId);
    });

    act(() => {
      result.current.openDiskContextMenu(
        appInstanceId,
        {
          id: "/run/media/lyra/Ventoy",
          title: "/dev/sda1",
          mountPath: "/run/media/lyra/Ventoy",
          devicePath: "/dev/sda1",
          fileSystem: "exfat",
          kind: "removable",
          osFlavor: "unknown",
          totalBytes: 64 * 1024 * 1024 * 1024,
          availableBytes: 32 * 1024 * 1024 * 1024,
          usedBytes: 32 * 1024 * 1024 * 1024,
          usageRatio: 0.5,
          isRemovable: true,
          canEject: true
        },
        48,
        96
      );
    });

    const openMenuRequest = vi.mocked(contextMenu.openMenu).mock.calls.at(-1)?.[0];
    const ejectItem = openMenuRequest?.items.find((item) => item.label === labels.contextEjectDevice);

    expect(ejectItem).toBeDefined();
    if (ejectItem === undefined) {
      throw new Error("expected eject context menu item");
    }
    if (ejectItem.onSelect === undefined) {
      throw new Error("expected eject context menu handler");
    }
    const handleEject = ejectItem.onSelect;

    await act(async () => {
      handleEject();
      await Promise.resolve();
    });

    expect(desktop.ejectDevice).toHaveBeenCalledWith({
      mountPath: "/run/media/lyra/Ventoy",
      devicePath: "/dev/sda1",
      kind: "removable"
    });
    expect(desktop.readHome).toHaveBeenCalledTimes(2);
  });
});
