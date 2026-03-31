import { describe, expect, test, vi } from "vitest";

import { createEmptySearchPayload, fetchAggregatedSearchPayload } from "../service";

const engines = [
  { id: "bing", label: "Bing", accentColor: "#008373" },
  { id: "brave", label: "Brave", accentColor: "#FB542B" }
] as const;

describe("aggregated search service", () => {
  test("returns empty payload for blank query", async () => {
    const payload = await fetchAggregatedSearchPayload({
      desktopApi: null,
      query: "  ",
      searchEngines: engines,
      resultsPerEngine: 3
    });

    expect(payload.blendedResults).toEqual([]);
    expect(payload.engineBuckets).toEqual([]);
  });

  test("proxies request to desktop bridge and normalizes response", async () => {
    const aggregate = vi.fn().mockResolvedValue({
      query: "lyra",
      blendedResults: [
        {
          id: "bing-1-example.com",
          title: "Lyra",
          url: "https://example.com",
          displayUrl: "example.com",
          snippet: "Example",
          sourceEngineIds: ["bing"]
        }
      ],
      engineBuckets: [
        {
          engine: engines[0],
          results: [
            {
              id: "bing-1-example.com",
              title: "Lyra",
              url: "https://example.com",
              displayUrl: "example.com",
              snippet: "Example",
              sourceEngineIds: ["bing"]
            }
          ],
          latencyMs: 10
        }
      ],
      fetchedAt: "2026-03-26T00:00:00.000Z",
      elapsedMs: 20
    });

    const payload = await fetchAggregatedSearchPayload({
      desktopApi: {
        appMeta: { version: "0.1.0", platform: "linux", isPackaged: false },
        windowControls: {
          minimize: vi.fn(),
          toggleMaximize: vi.fn(),
          close: vi.fn()
        },
        shellEvents: {
          onWindowStateChange: vi.fn(() => () => undefined)
        },
        openExternal: vi.fn(),
        linuxCompat: {
          readStatus: vi.fn(async () => ({
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
            generatedAt: "2026-03-27T00:00:00.000Z"
          })),
          exportDiagnostics: vi.fn(async () => ({
            ok: true,
            filePath: "/tmp/linux-compat.json"
          }))
        },
        search: {
          aggregate
        },
        ai: {
          readProfiles: vi.fn(async () => []),
          readProviderCatalog: vi.fn(async () => []),
          readPresetCatalog: vi.fn(async () => []),
          upsertProfile: vi.fn(),
          deleteProfile: vi.fn(),
          setDefaultProfile: vi.fn(),
          validateProfile: vi.fn(),
          discoverModels: vi.fn(),
          refreshDiscoveredModels: vi.fn(),
          readSession: vi.fn(),
          readSessionHistory: vi.fn(async () => []),
          sendChatTurn: vi.fn(),
          cancelChatTurn: vi.fn(),
          onEvent: vi.fn(() => () => undefined)
        },
        files: {
          readHome: vi.fn(),
          readDirectory: vi.fn(),
          readTrash: vi.fn(),
          createFile: vi.fn(),
          createFolder: vi.fn(),
          moveToTrash: vi.fn(),
          restoreFromTrash: vi.fn(),
          emptyTrash: vi.fn(),
          mountDevice: vi.fn(),
          ejectDevice: vi.fn(),
          readFavorites: vi.fn(),
          writeFavorites: vi.fn(),
          readRecentLocations: vi.fn(),
          writeRecentLocations: vi.fn(),
          readTextFile: vi.fn(),
          writeTextFile: vi.fn(),
          statFile: vi.fn()
        },
        computer: {
          readSession: vi.fn(async () => ({
            sessionId: "test-session",
            hasBooted: false,
            powerState: "off" as const,
            openApps: [],
            activeAppId: null,
            updatedAt: new Date().toISOString()
          })),
          readHostStatus: vi.fn(async () => ({
            platform: "linux" as const,
            platformLabel: "Linux",
            hostname: "lyra",
            release: "test",
            osFlavor: "linux" as const
          })),
          powerOn: vi.fn(async () => ({
            sessionId: "test-session",
            hasBooted: true,
            powerState: "booting" as const,
            bootReason: "user" as const,
            openApps: [],
            activeAppId: null,
            updatedAt: new Date().toISOString()
          })),
          powerOff: vi.fn(async () => ({
            sessionId: "test-session",
            hasBooted: true,
            powerState: "shutting_down" as const,
            openApps: [],
            activeAppId: null,
            updatedAt: new Date().toISOString()
          })),
          openApp: vi.fn(async () => ({
            sessionId: "test-session",
            hasBooted: true,
            powerState: "on" as const,
            openApps: [],
            activeAppId: null,
            updatedAt: new Date().toISOString()
          })),
          focusApp: vi.fn(async () => ({
            sessionId: "test-session",
            hasBooted: true,
            powerState: "on" as const,
            openApps: [],
            activeAppId: null,
            updatedAt: new Date().toISOString()
          })),
          closeApp: vi.fn(async () => ({
            sessionId: "test-session",
            hasBooted: true,
            powerState: "on" as const,
            openApps: [],
            activeAppId: null,
            updatedAt: new Date().toISOString()
          })),
          moveAppWindow: vi.fn(async () => ({
            sessionId: "test-session",
            hasBooted: true,
            powerState: "on" as const,
            openApps: [],
            activeAppId: null,
            updatedAt: new Date().toISOString()
          })),
          resizeAppWindow: vi.fn(async () => ({
            sessionId: "test-session",
            hasBooted: true,
            powerState: "on" as const,
            openApps: [],
            activeAppId: null,
            updatedAt: new Date().toISOString()
          })),
          minimizeApp: vi.fn(async () => ({
            sessionId: "test-session",
            hasBooted: true,
            powerState: "on" as const,
            openApps: [],
            activeAppId: null,
            updatedAt: new Date().toISOString()
          })),
          maximizeApp: vi.fn(async () => ({
            sessionId: "test-session",
            hasBooted: true,
            powerState: "on" as const,
            openApps: [],
            activeAppId: null,
            updatedAt: new Date().toISOString()
          })),
          restoreApp: vi.fn(async () => ({
            sessionId: "test-session",
            hasBooted: true,
            powerState: "on" as const,
            openApps: [],
            activeAppId: null,
            updatedAt: new Date().toISOString()
          })),
          subscribeSession: vi.fn(() => () => undefined)
        },
        systemImages: {
          readRegistry: vi.fn(async () => ({
            defaultImageId: "lyra-official",
            runtimeModeOverride: null,
            installedImages: []
          })),
          listInstalled: vi.fn(async () => []),
          installFromDirectory: vi.fn(async () => ({
            imageId: "lyra-official",
            title: "Lyra Official System",
            version: "1.0.0",
            source: "directory" as const,
            installPath: "/tmp/system-images/lyra-official/1.0.0",
            installedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            manifest: {
              id: "lyra-official",
              title: "Lyra Official System",
              version: "1.0.0",
              apiVersion: { min: "1.0.0" },
              shellMode: "full-shell" as const,
              defaultRuntimeMode: "sandbox" as const,
              entryPath: "system/index.js",
              capabilities: [],
              platformArtifacts: []
            }
          })),
          installFromPackage: vi.fn(async () => ({
            imageId: "lyra-official",
            title: "Lyra Official System",
            version: "1.0.0",
            source: "package" as const,
            installPath: "/tmp/system-images/lyra-official/1.0.0",
            installedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            manifest: {
              id: "lyra-official",
              title: "Lyra Official System",
              version: "1.0.0",
              apiVersion: { min: "1.0.0" },
              shellMode: "full-shell" as const,
              defaultRuntimeMode: "sandbox" as const,
              entryPath: "system/index.js",
              capabilities: [],
              platformArtifacts: []
            }
          })),
          installOfficialSeed: vi.fn(async () => ({
            imageId: "lyra-official",
            title: "Lyra Official System",
            version: "1.0.0",
            source: "builtin-seed" as const,
            installPath: "/tmp/system-images/lyra-official/1.0.0",
            installedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            manifest: {
              id: "lyra-official",
              title: "Lyra Official System",
              version: "1.0.0",
              apiVersion: { min: "1.0.0" },
              shellMode: "full-shell" as const,
              defaultRuntimeMode: "sandbox" as const,
              entryPath: "system/index.js",
              capabilities: [],
              platformArtifacts: []
            }
          })),
          uninstall: vi.fn(async () => ({
            defaultImageId: null,
            runtimeModeOverride: null,
            installedImages: []
          })),
          setDefaultImage: vi.fn(async () => ({
            defaultImageId: "lyra-official",
            runtimeModeOverride: null,
            installedImages: []
          })),
          assignSessionImage: vi.fn(async () => ({
            sessionId: "test-session",
            resolvedSystemImageId: "lyra-official",
            effectiveRuntimeMode: "sandbox" as const,
            effectiveShellMode: "full-shell" as const,
            systemContextState: "on" as const,
            updatedAt: new Date().toISOString()
          })),
          clearSessionImageOverride: vi.fn(async () => ({
            sessionId: "test-session",
            resolvedSystemImageId: "lyra-official",
            effectiveRuntimeMode: "sandbox" as const,
            effectiveShellMode: "full-shell" as const,
            systemContextState: "on" as const,
            updatedAt: new Date().toISOString()
          })),
          setRuntimeModeOverride: vi.fn(async () => ({
            defaultImageId: "lyra-official",
            runtimeModeOverride: "sandbox" as const,
            installedImages: []
          })),
          readResolvedSessionSystem: vi.fn(async () => ({
            sessionId: "test-session",
            resolvedSystemImageId: "lyra-official",
            effectiveRuntimeMode: "sandbox" as const,
            effectiveShellMode: "full-shell" as const,
            systemContextState: "on" as const,
            updatedAt: new Date().toISOString()
          })),
          subscribeSystemEvents: vi.fn(() => () => undefined)
        },
        mcp: {
          readCatalog: vi.fn(async () => []),
          readServers: vi.fn(async () => []),
          readEffectiveServers: vi.fn(async () => ({ servers: [] })),
          createServer: vi.fn(),
          updateServer: vi.fn(),
          deleteServer: vi.fn(),
          installTemplate: vi.fn(),
          validateServer: vi.fn(),
          startServer: vi.fn(),
          stopServer: vi.fn(),
          restartServer: vi.fn(),
          readServerIntrospection: vi.fn(),
          onEvent: vi.fn(() => () => undefined)
        },
        skills: {
          readCatalog: vi.fn(async () => []),
          readInstalled: vi.fn(async () => []),
          readEffectiveSkills: vi.fn(async () => []),
          discoverImportSource: vi.fn(),
          importSkills: vi.fn(),
          createLyraSkill: vi.fn(),
          updateSkillState: vi.fn(),
          deleteSkill: vi.fn(),
          readSkillDetails: vi.fn(),
          onEvent: vi.fn(() => () => undefined)
        },
        lsp: {
          openDocument: vi.fn(),
          changeDocument: vi.fn(),
          saveDocument: vi.fn(),
          closeDocument: vi.fn(),
          completion: vi.fn(async () => ({
            items: [],
            isIncomplete: false
          })),
          onEvent: vi.fn(() => () => undefined)
        },
        terminal: {
          createSession: vi.fn(),
          restoreSessions: vi.fn(),
          reloadPrompt: vi.fn(),
          write: vi.fn(),
          resize: vi.fn(),
          closeSession: vi.fn(),
          onData: vi.fn(() => () => undefined),
          onExit: vi.fn(() => () => undefined),
          onError: vi.fn(() => () => undefined)
        },
        workbenchState: {
          readSync: vi.fn(() => null),
          writeSync: vi.fn(),
          removeSync: vi.fn()
        }
      },
      query: "lyra",
      searchEngines: engines,
      resultsPerEngine: 5
    });

    expect(aggregate).toHaveBeenCalledWith({
      query: "lyra",
      limitPerEngine: 5,
      engines
    });
    expect(payload.blendedResults).toHaveLength(1);
    expect(payload.elapsedMs).toBe(20);
  });

  test("createEmptySearchPayload builds the empty shape", () => {
    const payload = createEmptySearchPayload("lyra");
    expect(payload.query).toBe("lyra");
    expect(payload.blendedResults).toEqual([]);
    expect(payload.engineBuckets).toEqual([]);
  });
});
