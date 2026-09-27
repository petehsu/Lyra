import type {
  AgentImportDetectRequest,
  AgentImportPreferences,
  AgentImportPreferencesUpdateRequest,
  AgentImportSyncRequest,
  AgentRuntimeEvent,
  AgentSessionSnapshot
} from "../../../../apps/desktop/src/shared/agent";
import type { WorkbenchBrowserEvent } from "../../../../apps/desktop/src/shared/workbench-browser";
import type { LyraDesktopApi } from "../../../../apps/desktop/src/shared/desktop-bridge";
import { readWorkbenchStateSync, writeWorkbenchStateSync, removeWorkbenchStateSync } from "../adapters/state-storage";
const now = "2026-08-15T06:00:00.000Z";
const unsubscribe = (): void => undefined;
const listen = (): (() => void) => unsubscribe;
const resolveVoid = async (): Promise<void> => undefined;
const resolveTrue = async (): Promise<boolean> => true;

const sessionListeners = new Set<(event: AgentRuntimeEvent) => void>();
const browserListeners = new Set<(event: WorkbenchBrowserEvent) => void>();
const terminalDataListeners = new Set<(event: { kind: "data"; sessionId: string; data: string }) => void>();
const bootedTerminalSessions = new Set<string>();
const terminalInputBySession = new Map<string, string>();
let promoTurnSent = false;

const TERMINAL_PROMPT = "lyra@MacBook-Pro Lyra % ";
const TERMINAL_BOOT_OUTPUT = [
  "Last login: Wed Sep 24 09:41:12 on ttys001",
  `${TERMINAL_PROMPT}pnpm dev:desktop`,
  "> lyra@0.1.0 dev:desktop /Users/lyra/Projects/Lyra",
  "> vite --host 127.0.0.1",
  "✓ Workbench ready at http://127.0.0.1:5180",
  TERMINAL_PROMPT
].join("\r\n");

const emitTerminalData = (sessionId: string, data: string): void => {
  terminalDataListeners.forEach((listener) => listener({
    kind: "data",
    sessionId,
    data
  }));
};

const emitTerminalCommandResult = (sessionId: string, command: string): void => {
  const normalized = command.trim();
  if (normalized === "clear") {
    emitTerminalData(sessionId, `\u001b[2J\u001b[H${TERMINAL_PROMPT}`);
    return;
  }

  const output = normalized === ""
    ? ""
    : normalized === "ls"
      ? "apps  crates  packages  services  web"
      : normalized === "git status"
        ? "On branch main\r\nnothing to commit, working tree clean"
        : normalized === "pwd"
          ? "/Users/lyra/Projects/Lyra"
          : `zsh: command not found: ${normalized.split(/\s+/u)[0] ?? normalized}`;
  emitTerminalData(
    sessionId,
    `${output.length > 0 ? `${output}\r\n` : ""}${TERMINAL_PROMPT}`
  );
};

const writeToPromoTerminal = (request: { sessionId: string; data: string }): void => {
  const { sessionId, data } = request;
  let input = terminalInputBySession.get(sessionId) ?? "";

  for (const character of data) {
    if (character === "\r" || character === "\n") {
      emitTerminalData(sessionId, "\r\n");
      emitTerminalCommandResult(sessionId, input);
      input = "";
      continue;
    }
    if (character === "\u007f") {
      if (input.length > 0) {
        input = input.slice(0, -1);
        emitTerminalData(sessionId, "\b \b");
      }
      continue;
    }
    if (character === "\u0003") {
      input = "";
      emitTerminalData(sessionId, `^C\r\n${TERMINAL_PROMPT}`);
      continue;
    }
    if (character === "\u001b") {
      continue;
    }
    input += character;
    emitTerminalData(sessionId, character);
  }

  terminalInputBySession.set(sessionId, input);
};

const demoSession: AgentSessionSnapshot = {
  id: "promo-session",
  title: "New session",
  sessionKind: "normal",
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

let importPreferences: AgentImportPreferences = {
  projectRoot: null,
  sources: {
    claude: { skills: true, mcp: true },
    cursor: { skills: true, mcp: true },
    codex: { skills: true, mcp: true },
    opencode: { skills: true, mcp: true },
    zed: { skills: true, mcp: true }
  }
};

const importSources = [
  { id: "claude" as const, label: "Claude", configPath: "/Users/petehsu/.claude" },
  { id: "cursor" as const, label: "Cursor", configPath: "/Users/petehsu/.cursor" },
  { id: "codex" as const, label: "Codex", configPath: "/Users/petehsu/.codex" },
  { id: "opencode" as const, label: "OpenCode", configPath: "/Users/petehsu/.config/opencode" },
  { id: "zed" as const, label: "Zed", configPath: "/Users/petehsu/.config/zed" }
];

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
  listImportSources: async () => ({ sources: importSources }),
  getImportPreferences: async () => importPreferences,
  setImportPreferences: async (request: AgentImportPreferencesUpdateRequest) => {
    const projectRoot = request.projectRoot === undefined
      ? importPreferences.projectRoot
      : request.projectRoot;
    if (request.sourceId === undefined) {
      importPreferences = { ...importPreferences, projectRoot };
      return importPreferences;
    }
    const current = importPreferences.sources[request.sourceId];
    importPreferences = {
      projectRoot,
      sources: {
        ...importPreferences.sources,
        [request.sourceId]: {
          skills: request.skills ?? current.skills,
          mcp: request.mcp ?? current.mcp
        }
      }
    };
    return importPreferences;
  },
  detectImport: async (request: AgentImportDetectRequest) => ({
    detectionId: `promo-${request.sourceId}`,
    sourceId: request.sourceId,
    projectRoot: request.projectRoot ?? importPreferences.projectRoot ?? null,
    counts: {},
    candidates: [],
    diagnostics: []
  }),
  syncImport: async (_request: AgentImportSyncRequest) => ({
    sourceId: "claude" as const,
    results: [],
    diagnostics: []
  }),
  sendTurn: async (request: { text?: string }) => {
    const text = request.text?.trim() ?? "";
    if (new URLSearchParams(location.search).get("film") === "1") {
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    }
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
  readCached: readWorkbenchStateSync,
  read: async (key: string) => readWorkbenchStateSync(key),
  write: async (key: string, json: string) => {
    writeWorkbenchStateSync(key, json);
  },
  remove: async (key: string) => {
    removeWorkbenchStateSync(key);
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
  browserShell: {
    syncTopology: resolveVoid,
    syncLayout: () => undefined,
    setChromePopover: resolveVoid,
    setModalOcclusion: resolveVoid,
    onEvent(listener: (event: WorkbenchBrowserEvent) => void) {
      browserListeners.add(listener);
      return () => browserListeners.delete(listener);
    }
  },
  browser: {
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
    setElementPickerMode: resolveVoid,
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
    createSession: async (request: Record<string, unknown>) => {
      const snapshot = createTerminalSnapshot(request);
      if (!bootedTerminalSessions.has(snapshot.sessionId)) {
        bootedTerminalSessions.add(snapshot.sessionId);
        window.setTimeout(() => emitTerminalData(snapshot.sessionId, TERMINAL_BOOT_OUTPUT), 0);
      }
      return snapshot;
    },
    attachRenderer: async () => ({ attached: true }),
    detachRenderer: resolveVoid,
    ackData: resolveVoid,
    reloadPrompt: async () => ({ reloaded: true }),
    writeFast: () => false,
    write: async (request: { sessionId: string; data: string }) => {
      writeToPromoTerminal(request);
    },
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
    readLanguageBundles: async () => ({ managed: {}, local:
      { "zh-CN": (await import("./film-language")).filmChinese } })
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
  // The real terminal generates session IDs; the old overlay hid this mismatch.
  const sessionId = bootedTerminalSessions.values().next().value;
  emitTerminalData(sessionId ?? "promo-terminal", data);
};
