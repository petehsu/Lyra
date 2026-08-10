import type {
  LoginManagerAuthMethodKind,
  LyraCapabilityRisk,
  LyraSoftwareActionManifest,
  LyraSoftwareManifest,
  UiuxListPacksResponse
} from "../../../shared/desktop-bridge";
import type { BrowserSettingsCategoryId } from "../browser-tabs/settings-surface-types";
import type { SoftwareStoreLabels } from "../software-store/types";

export const SETTING_CATEGORY_IDS = new Set<BrowserSettingsCategoryId>([
  "general",
  "appearance",
  "workspace",
  "notifications",
  "loginManager",
  "linux",
  "search",
  "ai",
  "models"
]);

export const LOGIN_MANAGER_AUTH_METHOD_KINDS: readonly LoginManagerAuthMethodKind[] = [
  "site_session",
  "password",
  "passkey",
  "oauth",
  "sso",
  "magic_link",
  "unknown"
];

const HIGH_RISK_CAPABILITIES = new Set<LyraCapabilityRisk>([
  "write",
  "external",
  "destructive"
]);

const createAction = (
  action: LyraSoftwareActionManifest
): LyraSoftwareActionManifest => action;

export const createBuiltinSoftware = (
  labels: SoftwareStoreLabels
): readonly LyraSoftwareManifest[] => {
  const actionsBySoftwareId = new Map<string, readonly LyraSoftwareActionManifest[]>([
    [
      "browser-search",
      [
        createAction({
          id: "browser-search.openUrl",
          title: "Open URL",
          description: "Open a URL in a new Lyra browser tab.",
          risk: "navigate",
          inputSchema: {
            type: "object",
            required: ["url"],
            properties: {
              url: { type: "string" },
              title: { type: "string" }
            }
          }
        }),
        createAction({
          id: "browser-search.search",
          title: "Search",
          description: "Open Lyra search results for a query.",
          risk: "navigate",
          inputSchema: {
            type: "object",
            required: ["query"],
            properties: {
              query: { type: "string" }
            }
          }
        }),
        createAction({
          id: "browser-search.readState",
          title: "Read Browser State",
          description: "Read current Lyra browser and search tab state.",
          risk: "read"
        }),
        createAction({
          id: "browser-search.readCurrentPage",
          title: "Read Current Page",
          description: "Read the current Lyra browser page runtime state.",
          risk: "read",
          inputSchema: {
            type: "object",
            properties: {
              tabId: {
                type: "string",
                description: "Use a tabId returned by openUrl, browser navigate, or Workbench list tabs. Never guess."
              }
            }
          }
        }),
        createAction({
          id: "browser-search.searchInPage",
          title: "Search In Page",
          description: "Search text within the current Lyra browser page and highlight matches when the page is live.",
          risk: "read",
          inputSchema: {
            type: "object",
            required: ["query"],
            properties: {
              tabId: {
                type: "string",
                description: "Use a tabId returned by openUrl, browser navigate, or Workbench list tabs. Never guess."
              },
              query: { type: "string" },
              caseSensitive: { type: "boolean" },
              maxMatches: { type: "number" }
            }
          }
        }),
        createAction({
          id: "browser-search.readDownloads",
          title: "Read Downloads",
          description: "Read Lyra Download Manager tasks related to browser downloads.",
          risk: "read"
        })
      ]
    ],
    [
      "file-manager",
      [
        createAction({
          id: "file-manager.openHome",
          title: "Open Home",
          description: "Open the File Manager home view.",
          risk: "navigate"
        }),
        createAction({
          id: "file-manager.openPath",
          title: "Open Path",
          description: "Open a directory path in File Manager.",
          risk: "navigate",
          inputSchema: {
            type: "object",
            required: ["path"],
            properties: {
              path: { type: "string" }
            }
          }
        }),
        createAction({
          id: "file-manager.readCurrentDirectory",
          title: "Read Current Directory",
          description: "Read the current File Manager directory listing.",
          risk: "read"
        }),
        createAction({
          id: "file-manager.selectEntry",
          title: "Select Entry",
          description: "Select a visible File Manager entry by id.",
          risk: "navigate",
          inputSchema: {
            type: "object",
            required: ["entryId"],
            properties: {
              entryId: { type: "string" }
            }
          }
        }),
        createAction({
          id: "file-manager.revealPath",
          title: "Reveal Path",
          description: "Open a path's containing folder in File Manager and select the matching entry when visible.",
          risk: "navigate",
          inputSchema: {
            type: "object",
            required: ["path"],
            properties: {
              path: { type: "string" }
            }
          }
        })
      ]
    ],
    [
      "settings",
      [
        createAction({
          id: "settings.openSection",
          title: "Open Section",
          description: "Open a Workbench settings section.",
          risk: "navigate",
          inputSchema: {
            type: "object",
            properties: {
              section: {
                type: "string",
                enum: [...SETTING_CATEGORY_IDS]
              }
            }
          }
        })
      ]
    ],
    [
      "login-manager",
      [
        createAction({
          id: "login-manager.readState",
          title: "Read Login Manager",
          description: "Read Lyra Browser site sessions and saved credential metadata. Password text is never returned.",
          risk: "read"
        }),
        createAction({
          id: "login-manager.open",
          title: "Open Login Manager",
          description: "Open the Lyra Login Manager settings section.",
          risk: "navigate"
        }),
        createAction({
          id: "login-manager.logoutSite",
          title: "Log Out Site",
          description: "Clear cookies, storage, cache, and service-worker site data for a Lyra Browser site after runtime permission is granted.",
          risk: "destructive",
          inputSchema: {
            type: "object",
            properties: {
              origin: { type: "string" },
              sessionId: { type: "string" },
              hostname: { type: "string" }
            }
          }
        }),
        createAction({
          id: "login-manager.updateAuthMethod",
          title: "Update Login Method",
          description: "Update a Login Manager session's account note, notes, or manually confirmed login method.",
          risk: "write",
          inputSchema: {
            type: "object",
            properties: {
              origin: { type: "string" },
              sessionId: { type: "string" },
              accountHint: { type: "string" },
              notes: { type: "string" },
              methodKind: {
                type: "string",
                enum: [...LOGIN_MANAGER_AUTH_METHOD_KINDS]
              },
              methodLabel: { type: "string" },
              providerDomain: { type: "string" }
            }
          }
        }),
        createAction({
          id: "login-manager.fillCredential",
          title: "Request Credential Fill",
          description: "Fill a saved credential into the matching Lyra Browser login form after runtime permission is granted. Password text is not returned.",
          risk: "write",
          inputSchema: {
            type: "object",
            properties: {
              credentialId: { type: "string" },
              sensitiveValueRef: {
                type: "object",
                description: "A lyra-sensitive-value-ref returned by Login Manager readState. The plaintext is not required or returned."
              },
              origin: { type: "string" },
              tabId: {
                type: "string",
                description: "Use a tabId returned by the corresponding open action or Workbench list tabs. Never guess."
              }
            }
          }
        })
      ]
    ],
    [
      "software-store",
      [
        createAction({
          id: "software-store.open",
          title: "Open Software Store",
          description: "Open the Lyra Software Store.",
          risk: "navigate"
        }),
        createAction({
          id: "software-store.listInstalledApps",
          title: "List Installed Apps",
          description: "Read installed Lyra built-in and trusted UIUX software adapters.",
          risk: "read"
        }),
        createAction({
          id: "software-store.openDetail",
          title: "Open App Detail",
          description: "Open Software Store and select a built-in software or UIUX pack detail.",
          risk: "navigate",
          inputSchema: {
            type: "object",
            properties: {
              softwareId: { type: "string" },
              packId: { type: "string" }
            }
          }
        }),
        createAction({
          id: "software-store.install",
          title: "Install UIUX Pack",
          description: "Install a UIUX pack from local path, git, or npm after runtime permission is granted.",
          risk: "external",
          inputSchema: {
            type: "object",
            required: ["sourceKind"],
            properties: {
              sourceKind: { type: "string", enum: ["local", "git", "npm"] },
              sourcePath: { type: "string" },
              url: { type: "string" },
              ref: { type: "string" },
              subdir: { type: "string" },
              packageName: { type: "string" },
              version: { type: "string" }
            }
          }
        }),
        createAction({
          id: "software-store.uninstall",
          title: "Uninstall UIUX Pack",
          description: "Uninstall an installed UIUX pack after runtime permission is granted.",
          risk: "destructive",
          inputSchema: {
            type: "object",
            required: ["packId"],
            properties: {
              packId: { type: "string" }
            }
          }
        })
      ]
    ],
    [
      "terminal",
      [
        createAction({
          id: "terminal.readVisibleBuffer",
          title: "Read Visible Terminal",
          description: "Read visible terminal tab metadata and the retained output projection for the active terminal pane.",
          risk: "read",
          inputSchema: {
            type: "object",
            properties: {
              sessionId: { type: "string" },
              maxBytes: { type: "number" },
              waitMs: { type: "number" }
            }
          }
        }),
        createAction({
          id: "terminal.sendControlledInput",
          title: "Send Controlled Input",
          description: "Send controlled input to a terminal session after an explicit risk-policy acknowledgement.",
          risk: "write",
          inputSchema: {
            type: "object",
            required: ["sessionId", "riskPolicyAccepted"],
            properties: {
              sessionId: { type: "string" },
              text: { type: "string" },
              riskPolicyAccepted: { type: "boolean" }
            }
          }
        })
      ]
    ],
    [
      "image-viewer",
      [
        createAction({
          id: "image-viewer.readMetadata",
          title: "Read Image Metadata",
          description: "Read native image metadata, viewport, and source path from Image Viewer.",
          risk: "read"
        }),
        createAction({
          id: "image-viewer.zoomPan",
          title: "Zoom And Pan",
          description: "Set Image Viewer zoom, pan, rotation, or background.",
          risk: "navigate",
          inputSchema: {
            type: "object",
            properties: {
              instanceId: { type: "string" },
              zoom: { type: "number" },
              offsetX: { type: "number" },
              offsetY: { type: "number" },
              rotation: { type: "number" },
              background: { type: "string", enum: ["checkerboard", "dark", "light"] }
            }
          }
        }),
        createAction({
          id: "image-viewer.openSource",
          title: "Open Source",
          description: "Reveal the image source path in File Manager.",
          risk: "navigate",
          inputSchema: {
            type: "object",
            properties: {
              instanceId: { type: "string" },
              path: { type: "string" }
            }
          }
        }),
        createAction({
          id: "image-viewer.prepareVisionFallback",
          title: "Prepare Vision Fallback",
          description: "Prepare current Image Viewer source, metadata, viewport, and open target for OCR or model vision fallback.",
          risk: "read",
          inputSchema: {
            type: "object",
            properties: {
              instanceId: { type: "string" }
            }
          }
        })
      ]
    ]
  ]);

  return labels.builtinApps.map((app) => {
    const rawActions = actionsBySoftwareId.get(app.id) ?? [];
    const actions = rawActions.map((action) => {
      const label = labels.actionLabels?.[action.id];
      return label
        ? { ...action, title: label.title, description: label.description }
        : action;
    });
    return {
      id: app.id,
      title: app.title,
      description: app.description,
      category: app.category,
      version: "1.0.0",
      source: "builtin" as const,
      actions
    };
  });
};

export const trustedExternalSoftware = (
  response: UiuxListPacksResponse | null,
  activeUiPackId: string
): readonly LyraSoftwareManifest[] => {
  if (response === null) {
    return [];
  }
  return response.installed
    .filter((pack) => pack.trustState === "trusted" && pack.id === activeUiPackId)
    .flatMap((pack) => pack.manifest.software);
};

export const softwareWithoutSchemas = (
  software: readonly LyraSoftwareManifest[]
): readonly LyraSoftwareManifest[] =>
  software.map((entry) => ({
    ...entry,
    actions: entry.actions.map((action) => ({
      id: action.id,
      title: action.title,
      description: action.description,
      risk: action.risk
    }))
  }));

export const isHighRiskCapability = (risk: LyraCapabilityRisk): boolean =>
  HIGH_RISK_CAPABILITIES.has(risk);
