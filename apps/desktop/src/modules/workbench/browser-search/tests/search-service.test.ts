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
            profile: "native" as const,
            recommendedProfile: "native" as const,
            safeMode: false,
            backend: "wayland" as const,
            gpuMode: "hardware" as const,
            profileSource: "auto" as const,
            backendSource: "auto" as const,
            gpuSource: "auto" as const,
            warnings: [],
            notes: [],
            appliedEnv: {},
            appliedSwitches: {},
            facts: {
              sessionType: "wayland" as const,
              architecture: "x64" as const,
              kernelRelease: "6.8.0",
              libc: "glibc" as const,
              desktop: "KDE",
              desktopRaw: "KDE",
              distributionId: "ubuntu",
              distributionVersion: "24.04",
              distributionLike: ["debian"],
              packageType: "dev" as const,
              waylandDisplay: "wayland-0",
              x11Display: null,
              isContainer: false,
              isRoot: false,
              gpu: {
                vendor: "intel" as const,
                deviceCount: 1,
                hasDiscreteGpu: false,
                driverHint: null,
                hardwareAccelerationEnabled: true,
                featureStatus: null
              }
            },
            recovery: {
              active: false,
              autoRestarted: false,
              launchId: "test",
              previousFailureReason: null
            },
            generatedAt: "2026-03-27T00:00:00.000Z"
          })),
          readConfig: vi.fn(async () => ({
            version: 1 as const,
            profile: "native" as const,
            updatedAt: "2026-03-27T00:00:00.000Z"
          })),
          updateConfig: vi.fn(async () => ({
            ok: true as const,
            config: {
              version: 1 as const,
              profile: "native" as const,
              updatedAt: "2026-03-27T00:00:00.000Z"
            }
          })),
          requestRestart: vi.fn(async () => ({ ok: true as const }))
        },
        search: {
          aggregate,
          local: vi.fn(async () => ({
            query: "lyra",
            scopePreset: "home" as const,
            roots: [],
            results: [],
            truncated: false,
            elapsedMs: 0,
            stats: {
              scannedFiles: 0,
              scannedDirs: 0,
              contentScannedFiles: 0,
              matchedFiles: 0,
              skippedUnreadable: 0,
              skippedBinaryOrTooLarge: 0,
              usedIndex: false
            }
          })),
          startLocalStream: vi.fn(async () => ({
            streamId: "stream-1",
            query: "lyra",
            scopePreset: "home" as const,
            roots: []
          })),
          readLocalStream: vi.fn(async () => ({
            streamId: "stream-1",
            query: "lyra",
            scopePreset: "home" as const,
            roots: [],
            results: [],
            truncated: false,
            elapsedMs: 0,
            stats: {
              scannedFiles: 0,
              scannedDirs: 0,
              contentScannedFiles: 0,
              matchedFiles: 0,
              skippedUnreadable: 0,
              skippedBinaryOrTooLarge: 0,
              usedIndex: false
            },
            done: true
          })),
          cancelLocalStream: vi.fn(async () => ({
            removed: true
          })),
          readIndexStatus: vi.fn(async () => ({
            state: "idle" as const,
            indexedFiles: 0,
            indexedDirs: 0
          })),
          rebuildIndex: vi.fn(async () => ({
            status: {
              state: "ready" as const,
              indexedFiles: 0,
              indexedDirs: 0
            },
            scopePreset: "home" as const,
            roots: []
          })),
          startDeepStream: vi.fn(async () => ({
            streamId: "deep-stream-1",
            snapshot: {
              query: "lyra",
              budgetPreset: "medium" as const,
              phase: "bootstrapping" as const,
              nodes: [],
              edges: [],
              web: {
                status: "loading" as const,
                engineBuckets: [],
                blendedCount: 0
              },
              local: {
                status: "loading" as const,
                scopePreset: "home" as const,
                roots: [],
                elapsedMs: 0,
                stats: {
                  scannedFiles: 0,
                  scannedDirs: 0,
                  contentScannedFiles: 0,
                  matchedFiles: 0,
                  skippedUnreadable: 0,
                  skippedBinaryOrTooLarge: 0,
                  usedIndex: false
                }
              },
              stats: {
                dedupedResults: 0,
                derivedQueries: 0,
                expansionRounds: 0
              },
              lastUpdatedAt: "2026-03-26T00:00:00.000Z"
            }
          })),
          readDeepStream: vi.fn(async () => ({
            streamId: "deep-stream-1",
            snapshot: {
              query: "lyra",
              budgetPreset: "medium" as const,
              phase: "completed" as const,
              nodes: [],
              edges: [],
              web: {
                status: "ready" as const,
                engineBuckets: [],
                blendedCount: 0
              },
              local: {
                status: "ready" as const,
                scopePreset: "home" as const,
                roots: [],
                elapsedMs: 0,
                stats: {
                  scannedFiles: 0,
                  scannedDirs: 0,
                  contentScannedFiles: 0,
                  matchedFiles: 0,
                  skippedUnreadable: 0,
                  skippedBinaryOrTooLarge: 0,
                  usedIndex: false
                }
              },
              stats: {
                dedupedResults: 0,
                derivedQueries: 0,
                expansionRounds: 0
              },
              lastUpdatedAt: "2026-03-26T00:00:00.000Z"
            },
            done: true
          })),
          cancelDeepStream: vi.fn(async () => ({
            removed: true
          })),
          expandDeepNode: vi.fn(async () => ({
            streamId: "deep-stream-1",
            accepted: true
          }))
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
          statFile: vi.fn(),
          selectAttachments: vi.fn(async () => []),
          selectDirectories: vi.fn(async () => [])
        },
        workbenchBrowser: {
          syncTopology: vi.fn(async () => undefined),
          syncLayout: vi.fn(async () => undefined),
          navigate: vi.fn(async (request) => ({
            address: request.address,
            tabId: request.tabId ?? "browser-tab-test",
            title: request.title ?? null
          })),
          goBack: vi.fn(async () => undefined),
          goForward: vi.fn(async () => undefined),
          reload: vi.fn(async () => undefined),
          stop: vi.fn(async () => undefined),
          readPageState: vi.fn(async () => null),
          setElementPickerMode: vi.fn(async () => undefined),
          applyWebTheme: vi.fn(async () => undefined),
          capturePage: vi.fn(async () => ({
            tabId: "browser-tab-test",
            mimeType: "image/png" as const,
            imageBase64: "",
            width: 1,
            height: 1,
            visibleOnly: true
          })),
          captureWindow: vi.fn(async () => ({
            tabId: "lyra-window",
            mimeType: "image/png" as const,
            imageBase64: "",
            width: 1,
            height: 1,
            visibleOnly: true
          })),
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
          read: vi.fn(async () => ({
            sessionId: "session-1",
            cursor: "0",
            output: "",
            running: false,
            exitCode: 0,
            truncated: false,
            source: "user" as const,
            mode: "shell" as const
          })),
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
        },
        uiux: {
          listPacks: vi.fn(async () => ({ builtin: [], installed: [] })),
          installFromLocal: vi.fn(),
          installFromGit: vi.fn(),
          installFromNpm: vi.fn(),
          setTrustState: vi.fn(),
          requestActivation: vi.fn(async (request) => ({
            packId: request.packId,
            reloadRequired: request.packId !== "classic",
            activated: request.packId === "classic"
          })),
          resolveRuntime: vi.fn(async () => null)
        },
        workbenchObservation: {
          registerHandler: vi.fn(() => () => undefined)
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
    const payload = createEmptySearchPayload({
      query: "lyra",
      scopePreset: "home"
    });
    expect(payload.query).toBe("lyra");
    expect(payload.web.payload.blendedResults).toEqual([]);
    expect(payload.web.payload.engineBuckets).toEqual([]);
    expect(payload.local.payload.results).toEqual([]);
  });
});
