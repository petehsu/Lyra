import type {
  AgentRuntimeEvent,
  AgentSessionSnapshot
} from "../../../../apps/desktop/src/shared/agent";
import type { WorkbenchBrowserEvent } from "../../../../apps/desktop/src/shared/workbench-browser";
import type { LyraDesktopApi } from "../../../../apps/desktop/src/shared/desktop-bridge";
import { readDefaultWorkbenchState } from "./default-state";

const STORAGE_PREFIX = "lyra.promo.ui-studio.state.";
const now = "2026-08-15T06:00:00.000Z";
const unsubscribe = (): void => undefined;
const listen = (): (() => void) => unsubscribe;
const resolveVoid = async (): Promise<void> => undefined;
const resolveTrue = async (): Promise<boolean> => true;

const sessionListeners = new Set<(event: AgentRuntimeEvent) => void>();
const browserListeners = new Set<(event: WorkbenchBrowserEvent) => void>();
const terminalDataListeners = new Set<(event: { kind: "data"; sessionId: string; data: string }) => void>();
let promoTurnSent = false;

const demoSession: AgentSessionSnapshot = {
  id: "promo-session",
  title: "New session",
  sessionKind: "normal",
  agentMode: "solo",
  oma: null,
  workingDir: "/Users/petehsu/Documents/Lyra",
  projectBound: true,
  workingDirIsHome: false,
  messages: [],
  tools: [],
  todos: [],
  turnStatus: "idle",
  activeTurnId: null,
  follow: { running: false, activity: null },
  updatedAt: now
};

const demoSessionSummary = {
  id: demoSession.id,
  title: "Build the Lyra launch experience",
  customTitle: null,
  shortName: "launch-experience",
  status: "idle",
  providerKey: "openai",
  providerLabel: "OpenAI",
  model: "gpt-5",
  messageCount: 12,
  createdAt: "2026-08-15T05:40:00.000Z",
  updatedAt: now,
  lastActiveAt: now,
  saved: false,
  saveLabel: null,
  archived: false,
  workingDir: demoSession.workingDir
};

const emptyModelCatalog = {
  sessionId: demoSession.id,
  currentModel: "gpt-5",
  currentProvider: "openai",
  defaultModel: "gpt-5",
  defaultProvider: "openai",
  models: [
    {
      id: "openai:gpt-5",
      label: "GPT-5",
      model: "gpt-5",
      provider: "openai",
      providerId: "openai",
      providerLabel: "OpenAI",
      available: true,
      enabled: true,
      supportsImageInput: true,
      supportsToolCalling: true
    }
  ],
  routes: [],
  reasoningEffort: {
    current: "medium",
    options: ["low", "medium", "high"],
    supported: true
  },
  verbosity: { current: null, options: [], supported: false },
  serviceTier: { current: null, options: [], supported: false }
};

const agentApi = {
  readPersonaConsent: async () => ({ osintEnabled: false, grantedAt: null }),
  updatePersonaConsent: async (enabled: boolean) => ({
    osintEnabled: enabled,
    grantedAt: enabled ? now : null
  }),
  onEvent(listener: (event: AgentRuntimeEvent) => void) {
    sessionListeners.add(listener);
    return () => sessionListeners.delete(listener);
  },
  createSession: async () => demoSession,
  createTemporarySession: async () => demoSession,
  readSession: async () => demoSession,
  listSessions: async () => ({
    sessionsDir: "/Users/petehsu/.lyra/sessions",
    sessions: [demoSessionSummary]
  }),
  readUsageStats: async () => ({
    totalSessions: 1,
    totalTurns: 0,
    totalTokens: 0,
    totalToolCalls: 0,
    totalActiveSeconds: 0,
    peakDailyTokens: 0,
    longestTurnSeconds: 0,
    currentStreakDays: 0,
    longestStreakDays: 0,
    dailyBuckets: [],
    topModels: []
  }),
  listAgentModels: async () => emptyModelCatalog,
  refreshAgentModels: async () => emptyModelCatalog,
  switchAgentModel: async () => emptyModelCatalog,
  setAgentModelEnabled: async () => emptyModelCatalog,
  deleteAgentModel: async () => emptyModelCatalog,
  updateAgentProviderOptions: async () => emptyModelCatalog,
  readBrowserFollowMode: async () => ({ enabled: false }),
  updateBrowserFollowMode: async () => ({ enabled: false }),
  readActCache: async () => ({ enabled: false }),
  updateActCache: async () => ({ enabled: false }),
  readPermissionPolicy: async () => ({
    mode: "approval",
    effectiveMode: "approval",
    valid: true,
    configPath: "/Users/petehsu/.lyra/config.json",
    exists: true
  }),
  setPermissionPolicyMode: async () => ({
    mode: "approval",
    effectiveMode: "approval",
    valid: true,
    configPath: "/Users/petehsu/.lyra/config.json",
    exists: true
  }),
  readProtocolContract: async () => ({ protocolVersion: 1 }),
  readAgentConfig: async () => ({
    agentHome: "/Users/petehsu/.lyra",
    configPath: "/Users/petehsu/.lyra/config.json",
    config: {},
    commands: []
  }),
  readAgentProviderCatalog: async () => ({
    schemaVersion: "1",
    defaultProvider: "openai",
    defaultModel: "gpt-5",
    protocols: [],
    routes: [],
    profiles: []
  }),
  listAccounts: async () => ({
    defaultProvider: "openai",
    defaultModel: "gpt-5",
    authStatus: {},
    accounts: []
  }),
  listAgentSkills: async () => ({
    skills: [],
    store: { indexUrl: "", index: null, lastError: null }
  }),
  listMcpServers: async () => ({ servers: [] }),
  sendTurn: async (request: { text?: string }) => {
    const text = request.text?.trim() ?? "";
    startPromoAgentTurn(text);
    return { sessionId: demoSession.id, turnId: "promo-turn", status: "running" };
  },
  cancelTurn: async () => ({ sessionId: demoSession.id, status: "cancelling" }),
  bindProject: async () => demoSession,
  renameSession: resolveVoid,
  archiveSession: resolveVoid,
  deleteSession: async () => ({ sessionId: demoSession.id, deleted: true }),
  respondClarification: resolveVoid,
  respondPermission: resolveVoid,
  respondPlanReview: async () => demoSession,
  runImprove: resolveVoid,
  runRefactor: resolveVoid,
  runReview: resolveVoid,
  runJudge: resolveVoid,
  triggerPoke: async () => ({
    sessionId: demoSession.id,
    status: "idle",
    sent: false,
    incompleteTodoCount: 0
  }),
  previewRollback: async () => ({
    sessionId: demoSession.id,
    messageId: "",
    available: false,
    removedMessageCount: 0,
    changedFiles: []
  }),
  restoreRollback: async () => ({
    sessionId: demoSession.id,
    messageId: "",
    snapshot: demoSession,
    removedMessageCount: 0,
    restoredFileCount: 0
  }),
  readGitStatus: async () => ({
    workingDir: demoSession.workingDir,
    isRepository: true,
    repositoryRoot: demoSession.workingDir,
    branch: "main",
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
    entries: [],
    summary: { changed: 0, staged: 0, unstaged: 0, untracked: 0, conflicts: 0 },
    updatedAt: now
  }),
  readGitDiff: async () => ({
    workingDir: demoSession.workingDir,
    repositoryRoot: demoSession.workingDir,
    path: "",
    scope: "unstaged",
    diff: "",
    isBinary: false
  }),
  listProjectPlans: async () => ({ plans: [] }),
  listPrivateTerminals: async () => [],
  readMemorySnapshot: async () => null,
  readMemoryAudit: async () => ({ events: [] }),
  updateAgentConfig: async () => ({ config: {}, commands: [] }),
  saveAgentProviderProfile: async () => ({ config: {}, commands: [] }),
  refreshAgentSkillStore: async () => ({ store: { indexUrl: "", index: null } }),
  updateAgentSkillStoreConfig: async () => ({ store: { indexUrl: "", index: null } })
};

const createTerminalSnapshot = (request: Record<string, unknown>) => ({
  sessionId: String(request.sessionId ?? "promo-terminal"),
  title: String(request.title ?? "Terminal 1"),
  cwd: String(request.cwd ?? demoSession.workingDir),
  currentCwd: String(request.cwd ?? demoSession.workingDir),
  shell: "/bin/zsh",
  cols: Number(request.cols ?? 80),
  rows: Number(request.rows ?? 24),
  createdAt: now,
  source: "user",
  mode: "shell",
  persist: false,
  running: true,
  exitCode: null
});

const workbenchState = {
  readCached: (key: string) =>
    window.localStorage.getItem(`${STORAGE_PREFIX}${key}`) ?? readDefaultWorkbenchState(key),
  read: async (key: string) =>
    window.localStorage.getItem(`${STORAGE_PREFIX}${key}`) ?? readDefaultWorkbenchState(key),
  write: async (key: string, json: string) => {
    window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, json);
  },
  remove: async (key: string) => {
    window.localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
  },
  onDidChange: listen
};

const promoDesktopApi = {
  appMeta: {
    version: "0.1.0-preview.11",
    platform: "darwin",
    arch: "arm64",
    windowMaterialMode: "opaque",
    desktopTargetId: "macos-arm64",
    desktopSupportTier: "tier1",
    isPackaged: true,
    userName: "petehsu",
    hostName: "Mac",
    locale: "zh-CN",
    timeZone: "Asia/Shanghai"
  },
  windowControls: {
    minimize: resolveVoid,
    toggleMaximize: resolveVoid,
    close: resolveVoid,
    setThemeSource: resolveVoid
  },
  shellEvents: { onWindowStateChange: listen },
  screenshotPreview: { present: async () => ({ previewId: null }), dismiss: resolveVoid, onEvent: listen },
  openExternal: resolveTrue,
  detectEditors: async () => [],
  openInEditor: resolveTrue,
  revealInFolder: resolveTrue,
  identity: {
    readUserIcon: async () => null,
    resolveProjectIdentity: async () => ({
      rootPath: demoSession.workingDir,
      name: "Lyra",
      logo: null
    })
  },
  systemNotifications: {
    readStatus: async () => ({
      platform: "darwin",
      supported: true,
      permission: "granted",
      canNotify: true,
      canOpenSettings: true,
      actionSupport: "native"
    }),
    requestAccess: async () => ({
      platform: "darwin",
      supported: true,
      permission: "granted",
      canNotify: true,
      canOpenSettings: true,
      actionSupport: "native",
      openedSettings: false
    }),
    openSettings: async () => ({ opened: false }),
    show: async () => ({ status: "shown" }),
    onActivated: listen
  },
  appUpdate: {
    readStatus: async () => ({ state: "idle", currentVersion: "0.1.0-preview.11" }),
    check: async () => ({ state: "idle", currentVersion: "0.1.0-preview.11" }),
    download: async () => ({ state: "idle", currentVersion: "0.1.0-preview.11" }),
    install: resolveVoid,
    onStatusChanged: listen
  },
  linuxCompat: {
    readStatus: async () => ({ platform: "darwin", enabled: false, warnings: [], notes: [] }),
    readConfig: async () => ({}),
    updateConfig: async () => ({ ok: true }),
    requestRestart: async () => ({ ok: true })
  },
  search: {
    resolveWebSearchEngine: async (request: { engineId?: string }) => ({
      engineId: request.engineId ?? "google",
      available: true
    })
  },
  files: {
    readHome: async () => ({
      location: { id: "home", title: "Home", path: "/Users/petehsu", kind: "home" },
      systemLocations: [],
      favorites: [],
      recentLocations: [],
      disks: [],
      devices: []
    }),
    readDirectory: async (request: { path: string }) => ({
      location: { id: request.path, title: "Lyra", path: request.path, kind: "directory" },
      parentPath: "/Users/petehsu/Documents",
      entries: []
    }),
    subscribeDirectory: async (request: { path: string }) => ({
      subscriptionId: "promo-directory",
      snapshot: {
        generation: 1,
        location: { id: request.path, title: "Lyra", path: request.path, kind: "directory" },
        parentPath: "/Users/petehsu/Documents",
        entries: []
      }
    }),
    unsubscribeDirectory: resolveVoid,
    onDirectoryPatch: listen,
    readTrash: async () => ({
      location: { id: "trash", title: "Trash", path: "trash://", kind: "trash" },
      entries: []
    }),
    readFavorites: async () => ({ favorites: [] }),
    writeFavorites: async (payload: unknown) => payload,
    readRecentLocations: async () => ({ recentLocations: [] }),
    writeRecentLocations: async (payload: unknown) => payload,
    selectAttachments: async () => [],
    selectDirectories: async () => [],
    getPathForFile: () => "",
    createFile: async () => ({}),
    createFolder: async () => ({}),
    moveToTrash: resolveVoid,
    restoreFromTrash: resolveVoid,
    emptyTrash: resolveVoid,
    mountDevice: async () => ({ mounted: false, strategy: "promo" }),
    ejectDevice: async () => ({ ejected: true, poweredOff: false, strategy: "promo" }),
    readTextFile: async (request: { path: string }) => ({
      kind: "text",
      path: request.path,
      revision: "promo",
      encoding: "utf8",
      readOnly: false,
      sizeBytes: 0,
      content: ""
    }),
    writeTextFile: async () => ({ ok: true }),
    statFile: async () => ({ exists: false })
  },
  workbenchBrowser: {
    syncTopology: resolveVoid,
    syncLayout: () => undefined,
    navigate: async (request: { tabId: string; address: string }) => ({
      tabId: request.tabId,
      address: request.address,
      accepted: true
    }),
    goBack: resolveVoid,
    goForward: resolveVoid,
    reload: resolveVoid,
    stop: resolveVoid,
    readPageState: async () => null,
    readSessionSnapshot: async () => null,
    readStorageState: async () => ({ path: "" }),
    clearSiteData: async () => ({ cleared: true }),
    searchInPage: async () => ({ activeMatchOrdinal: 0, matches: 0, finalUpdate: true }),
    setChromePopover: resolveVoid,
    setElementPickerMode: resolveVoid,
    setModalOcclusion: resolveVoid,
    capturePage: async () => ({ imageBase64: "", mimeType: "image/png", width: 0, height: 0 }),
    captureWindow: async () => ({ imageBase64: "", mimeType: "image/png", width: 0, height: 0 }),
    executePageContextAction: resolveVoid,
    readActivePageDragCitation: () => null,
    consumePageDragCitation: () => undefined,
    onEvent(listener: (event: WorkbenchBrowserEvent) => void) {
      browserListeners.add(listener);
      return () => browserListeners.delete(listener);
    }
  },
  lsp: {
    openDocument: resolveVoid,
    changeDocument: resolveVoid,
    saveDocument: resolveVoid,
    closeDocument: resolveVoid,
    completion: async () => ({ items: [], isIncomplete: false }),
    onEvent: listen
  },
  terminal: {
    createSession: async (request: Record<string, unknown>) => createTerminalSnapshot(request),
    attachRenderer: async () => ({ attached: true }),
    detachRenderer: resolveVoid,
    ackData: resolveVoid,
    reloadPrompt: async () => ({ reloaded: true }),
    writeFast: () => false,
    write: resolveVoid,
    read: async (request: { sessionId: string }) => ({
      sessionId: request.sessionId,
      cursor: "0",
      output: "Last login: Fri Aug 15 16:42:08 on ttys001\r\npetehsu@Mac Lyra % ",
      running: true,
      exitCode: null,
      truncated: false,
      source: "user",
      mode: "shell",
      reason: "timeout"
    }),
    resize: resolveVoid,
    closeSession: resolveVoid,
    onData(listener: (event: { kind: "data"; sessionId: string; data: string }) => void) {
      terminalDataListeners.add(listener);
      return () => terminalDataListeners.delete(listener);
    },
    onExit: listen,
    onError: listen,
    onCwdChanged: listen
  },
  agent: agentApi,
  workbenchObservation: { registerHandler: listen },
  softwareCapabilities: { registerHandler: listen },
  uiux: {
    listPacks: async () => ({
      builtin: [{
        id: "classic",
        name: "Classic",
        description: "Current Lyra desktop layout and visual language."
      }],
      installed: []
    }),
    resolveRuntime: async () => null
  },
  workbenchState,
  location: {
    readHostCandidates: async () => ({ candidates: [] }),
    reverseGeocodeCandidates: async (request: { candidates: unknown[] }) => ({ candidates: request.candidates }),
    openSystemSettings: resolveTrue
  },
  i18n: {
    readLocalBundles: async () => ({}),
    readLanguageBundles: async () => ({ managed: {}, local: {} })
  },
  languagePacks: {
    listCatalog: async () => ({
      status: "ready",
      packs: [{
        locale: "zh-CN",
        nativeName: "简体中文",
        englishName: "Simplified Chinese",
        aliases: ["zh", "cn", "chinese", "中文", "简体"],
        version: "1.0.0",
        minAppVersion: "0.1.0",
        sourceContentHash: "a".repeat(64),
        keysetHash: "b".repeat(64),
        sha256: "c".repeat(64),
        asset: "zh-CN.json",
        signature: "zh-CN.json.sig"
      }]
    }),
    listInstalled: async () => [{
      locale: "zh-CN",
      version: "1.0.0",
      installedAt: now,
      updatedAt: now,
      sourceContentHash: "a".repeat(64),
      keysetHash: "b".repeat(64),
      sha256: "c".repeat(64)
    }],
    install: async (locale: string) => ({ locale, version: "1", installedAt: now, updatedAt: now, sourceContentHash: "", keysetHash: "", sha256: "" }),
    uninstall: resolveVoid,
    checkForUpdates: async () => ({
      status: "ready",
      packs: [{
        locale: "zh-CN",
        nativeName: "简体中文",
        englishName: "Simplified Chinese",
        aliases: ["zh", "cn", "chinese", "中文", "简体"],
        version: "1.0.0",
        minAppVersion: "0.1.0",
        sourceContentHash: "a".repeat(64),
        keysetHash: "b".repeat(64),
        sha256: "c".repeat(64),
        asset: "zh-CN.json",
        signature: "zh-CN.json.sig"
      }]
    }),
    onChanged: listen
  },
  components: {
    list: async () => [],
    onUpdateProgress: listen,
    readCoreProjectionStatus: async () => ({ state: "idle", componentId: "lyra.core" })
  }
} as unknown as LyraDesktopApi;

export const installPromoDesktopApi = (): void => {
  Object.defineProperty(window, "lyraDesktop", {
    configurable: false,
    enumerable: true,
    writable: false,
    value: promoDesktopApi
  });
};

export const emitPromoAgentEvent = (event: AgentRuntimeEvent): void => {
  sessionListeners.forEach((listener) => listener(event));
};

export const resetPromoAgentDemo = (): void => {
  promoTurnSent = false;
  emitPromoAgentEvent({ kind: "sessionSnapshot", snapshot: demoSession });
};

export const hasPromoTurnStarted = (): boolean => promoTurnSent;

export const startPromoAgentTurn = (text: string): void => {
  if (promoTurnSent) return;
  promoTurnSent = true;
  emitPromoAgentEvent({
    kind: "messageCommitted",
    sessionId: demoSession.id,
    message: {
      id: "promo-user-message",
      role: "user",
      text,
      blocks: [{ type: "text", id: "promo-user-text", text }],
      createdAt: "2026-08-15T06:00:14.633Z"
    }
  });
  emitPromoAgentEvent({
    kind: "turnStarted",
    sessionId: demoSession.id,
    turnId: "promo-turn",
    state: "assembling_context"
  });
  emitPromoAgentEvent({
    kind: "messageCommitted",
    sessionId: demoSession.id,
    message: {
      id: "promo-assistant-message",
      role: "assistant",
      text: "",
      blocks: [{ type: "text", id: "promo-assistant-text", text: "" }],
      createdAt: "2026-08-15T06:00:14.700Z"
    }
  });
};

export const emitPromoBrowserEvent = (event: WorkbenchBrowserEvent): void => {
  browserListeners.forEach((listener) => listener(event));
};

export const emitPromoTerminalData = (data: string): void => {
  terminalDataListeners.forEach((listener) => listener({
    kind: "data",
    sessionId: "promo-terminal",
    data
  }));
};
