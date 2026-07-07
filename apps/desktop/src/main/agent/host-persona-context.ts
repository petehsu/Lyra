import { app, screen } from "electron";
import * as os from "node:os";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import type { AppMetaPayload } from "../../shared/desktop-bridge";
import { resolveCurrentDesktopTarget } from "../platform-target";
import type { WorkbenchStateIpcBridge } from "../workbench-state/service";
import type { AgentHostCapabilityHandlers } from "./host-payload";

export type HostPersonaScreenInfo = {
  readonly width: number;
  readonly height: number;
  readonly scaleFactor: number;
  readonly displayCount: number;
};

export type HostPersonaContextPayload = {
  readonly currentTime?: string;
  readonly currentEpochMs?: number;
  readonly timezone?: string;
  readonly timezoneOffsetMinutes?: number;
  readonly locationLabel?: string;
  readonly deviceSummary?: string;
  readonly userName?: string;
  readonly screen?: HostPersonaScreenInfo;
};

const readString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const readAppMeta = (): AppMetaPayload => {
  let userName: string | undefined;
  try {
    userName = os.userInfo().username;
  } catch {
    userName = process.env.USER ?? process.env.USERNAME;
  }
  const desktopTarget = resolveCurrentDesktopTarget();
  return {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    desktopTargetId: desktopTarget.id,
    desktopSupportTier: desktopTarget.supportTier,
    linuxLibc: desktopTarget.libc,
    isPackaged: app.isPackaged,
    ...(userName === undefined || userName.trim().length === 0
      ? {}
      : { userName: userName.trim() }),
    hostName: os.hostname(),
    locale: app.getLocale(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
  };
};

const formatPlatformLabel = (platform: NodeJS.Platform): string => {
  if (platform === "darwin") {
    return "macOS";
  }
  if (platform === "win32") {
    return "Windows";
  }
  if (platform === "linux") {
    return "Linux";
  }
  return platform;
};

const formatCurrentTime = (
  locale: string | undefined,
  timeZone: string | undefined
): string | undefined => {
  if (timeZone === undefined || timeZone.trim().length === 0) {
    return undefined;
  }
  try {
    return new Intl.DateTimeFormat(locale ?? "en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
      timeZone
    }).format(new Date());
  } catch {
    return undefined;
  }
};

const formatDeviceSummary = (meta: AppMetaPayload): string | undefined => {
  const hostName = meta.hostName?.trim();
  if (hostName === undefined || hostName.length === 0) {
    return undefined;
  }
  const parts = [formatPlatformLabel(meta.platform)];
  if (meta.arch !== undefined && meta.arch.trim().length > 0) {
    parts.push(meta.arch);
  }
  parts.push(hostName);
  if (meta.version.trim().length > 0) {
    parts.push(`Lyra ${meta.version}`);
  }
  return parts.join(" · ");
};

const readLocationLabel = (
  workbenchState: WorkbenchStateIpcBridge
): string | undefined => {
  const raw = workbenchState.readState("location");
  if (raw === null || raw.trim().length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as {
      readonly consent?: unknown;
      readonly fix?: { readonly displayName?: unknown };
    };
    if (parsed.consent !== "granted") {
      return undefined;
    }
    return readString(parsed.fix?.displayName);
  } catch {
    return undefined;
  }
};

const readScreenInfo = (): HostPersonaScreenInfo | undefined => {
  try {
    const primary = screen.getPrimaryDisplay();
    const displays = screen.getAllDisplays();
    return {
      width: primary.size.width,
      height: primary.size.height,
      scaleFactor: primary.scaleFactor,
      displayCount: displays.length
    };
  } catch {
    return undefined;
  }
};

const readTimezoneInfo = (): {
  readonly timezone?: string;
  readonly offsetMinutes?: number;
  readonly epochMs?: number;
} => {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz === undefined || tz.trim().length === 0) {
      return {};
    }
    const now = new Date();
    const offsetMinutes = -now.getTimezoneOffset();
    return {
      timezone: tz,
      offsetMinutes,
      epochMs: now.getTime()
    };
  } catch {
    return {};
  }
};

export const readHostPersonaContextPayload = (
  workbenchState: WorkbenchStateIpcBridge
): HostPersonaContextPayload => {
  const meta = readAppMeta();
  const currentTime = formatCurrentTime(meta.locale, meta.timeZone);
  const locationLabel = readLocationLabel(workbenchState);
  const deviceSummary = formatDeviceSummary(meta);
  const tzInfo = readTimezoneInfo();
  const screenInfo = readScreenInfo();
  return {
    ...(currentTime === undefined ? {} : { currentTime }),
    ...(tzInfo.epochMs === undefined ? {} : { currentEpochMs: tzInfo.epochMs }),
    ...(tzInfo.timezone === undefined ? {} : { timezone: tzInfo.timezone }),
    ...(tzInfo.offsetMinutes === undefined
      ? {}
      : { timezoneOffsetMinutes: tzInfo.offsetMinutes }),
    ...(locationLabel === undefined ? {} : { locationLabel }),
    ...(deviceSummary === undefined ? {} : { deviceSummary }),
    ...(meta.userName === undefined ? {} : { userName: meta.userName }),
    ...(screenInfo === undefined ? {} : { screen: screenInfo })
  };
};

export const createHostPersonaContextHandlers = (
  workbenchState: WorkbenchStateIpcBridge
): {
  readonly "agent.readHostPersonaContext": () => Promise<HostPersonaContextPayload>;
  readonly "agent.readLocalSignals": () => Promise<LocalSignalsPayload>;
} => ({
  "agent.readHostPersonaContext": async () =>
    readHostPersonaContextPayload(workbenchState),
  "agent.readLocalSignals": async () => readLocalSignalsPayload()
});

// ── Local signal collection ──

export type LocalSignalsPayload = {
  readonly osUsername?: string;
  readonly osFullName?: string;
  readonly hostname?: string;
  readonly gitName?: string;
  readonly gitEmail?: string;
  readonly gitDominantEmail?: string;
  readonly gitGithubUser?: string;
  readonly gitRemoteUsernames: readonly string[];
  readonly sshKeyComments: readonly string[];
  readonly sshKnownHosts: readonly string[];
  readonly npmEmail?: string;
  readonly pipEmail?: string;
  readonly vscodeSyncEmail?: string;
  readonly browserAutofillNames: readonly string[];
  readonly browserAutofillEmails: readonly string[];
  readonly macosContactsName?: string;
  readonly macosContactsEmail?: string;
  readonly loginManagerHints: readonly string[];
  readonly lyraConfigEmail?: string;
};

const execGitConfig = (key: string): string | undefined => {
  try {
    const result = childProcess.execFileSync(
      "git",
      ["config", "--global", key],
      { timeout: 3000, encoding: "utf-8" }
    );
    const trimmed = result.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
};

const execGitDominantEmail = (): string | undefined => {
  try {
    const result = childProcess.execFileSync(
      "git",
      ["log", "--format=%ae", "--all", "-n", "500"],
      { timeout: 5000, encoding: "utf-8" }
    );
    const counts = new Map<string, number>();
    for (const line of result.split("\n")) {
      const email = line.trim();
      if (email.length > 0 && email.includes("@")) {
        counts.set(email, (counts.get(email) ?? 0) + 1);
      }
    }
    let best: string | undefined;
    let bestCount = 0;
    for (const [email, count] of counts) {
      if (count > bestCount) {
        best = email;
        bestCount = count;
      }
    }
    return best;
  } catch {
    return undefined;
  }
};

const execGitRemoteUsernames = (): string[] => {
  try {
    const result = childProcess.execFileSync("git", ["remote", "-v"], {
      timeout: 3000,
      encoding: "utf-8"
    });
    const usernames: string[] = [];
    for (const line of result.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue;
      const url = parts[1];
      const username = extractUsernameFromGitUrl(url);
      if (username !== undefined && !usernames.includes(username)) {
        usernames.push(username);
      }
    }
    return usernames;
  } catch {
    return [];
  }
};

const extractUsernameFromGitUrl = (url: string): string | undefined => {
  const trimmed = url.trim();

  // SCP-like: git@github.com:username/repo.git
  const colonPos = trimmed.lastIndexOf(":");
  if (colonPos !== -1) {
    const afterColon = trimmed.slice(colonPos + 1);
    const slashPos = afterColon.indexOf("/");
    if (slashPos !== -1) {
      const username = afterColon.slice(0, slashPos);
      if (isValidUsername(username)) return username;
    }
  }

  // URL-like: https://host/username/repo.git
  for (const prefix of ["https://", "http://", "ssh://", "git://"]) {
    if (trimmed.startsWith(prefix)) {
      const rest = trimmed.slice(prefix.length);
      const segments = rest.split("/").slice(1);
      if (segments.length > 0) {
        const first = segments[0];
        if (isValidUsername(first)) return first;
      }
    }
  }

  return undefined;
};

const isValidUsername = (s: string): boolean =>
  s.length > 0 &&
  s.length <= 39 &&
  !s.includes(" ") &&
  !s.includes(":") &&
  !s.endsWith(".git");

const readOsFullName = (username: string): string | undefined => {
  if (process.platform === "darwin") {
    try {
      const result = childProcess.execFileSync(
        "dscl",
        [".", "-read", `/Users/${username}`, "RealName"],
        { timeout: 3000, encoding: "utf-8" }
      );
      for (const line of result.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("RealName:")) {
          const value = trimmed.slice("RealName:".length).trim();
          if (value.length > 0) return value;
        }
        if (trimmed.length > 0 && !trimmed.includes(":")) {
          return trimmed;
        }
      }
    } catch {
      // dscl not available or user not found
    }
  } else if (process.platform === "linux") {
    try {
      const result = childProcess.execFileSync(
        "getent",
        ["passwd", username],
        { timeout: 3000, encoding: "utf-8" }
      );
      const firstLine = result.split("\n")[0] ?? "";
      const fields = firstLine.split(":");
      const gecos = fields[4] ?? "";
      const fullName = gecos.split(",")[0]?.trim();
      if (fullName && fullName.length > 0) return fullName;
    } catch {
      // getent not available
    }
  }
  return undefined;
};

const readSshKeyComments = (): string[] => {
  const home = os.homedir();
  const sshDir = path.join(home, ".ssh");
  const comments: string[] = [];
  try {
    const entries = fs.readdirSync(sshDir);
    for (const name of entries) {
      if (!name.endsWith(".pub")) continue;
      try {
        const content = fs.readFileSync(path.join(sshDir, name), "utf-8");
        const parts = content.trim().split(" ");
        if (parts.length >= 3) {
          const comment = parts.slice(2).join(" ").trim();
          if (comment.length > 0 && !comment.includes("\n")) {
            comments.push(comment);
          }
        }
      } catch {
        // skip unreadable key
      }
    }
  } catch {
    // .ssh directory not accessible
  }
  return comments;
};

const readSshKnownHosts = (): string[] => {
  const home = os.homedir();
  const knownHostsPath = path.join(home, ".ssh", "known_hosts");
  const hosts: string[] = [];
  try {
    const content = fs.readFileSync(knownHostsPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
      const firstField = trimmed.split(/\s+/)[0] ?? "";
      const host = firstField.split(",")[0] ?? "";
      const cleaned = host.replace(/^\[/, "").replace(/\]$/, "").replace(/:\d+$/, "");
      if (cleaned.length > 0 && !hosts.includes(cleaned)) {
        hosts.push(cleaned);
      }
    }
  } catch {
    // known_hosts not accessible
  }
  return hosts;
};

const readNpmrcEmail = (): string | undefined => {
  const npmrcPath = path.join(os.homedir(), ".npmrc");
  try {
    const content = fs.readFileSync(npmrcPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("email")) {
        const rest = trimmed.slice("email".length).trimStart();
        if (rest.startsWith("=")) {
          const val = rest
            .slice(1)
            .trim()
            .replace(/^["']|["']$/g, "");
          if (val.includes("@") && val.length > 0) return val;
        }
      }
    }
  } catch {
    // .npmrc not accessible
  }
  return undefined;
};

const readPypircEmail = (): string | undefined => {
  const pypircPath = path.join(os.homedir(), ".pypirc");
  try {
    const content = fs.readFileSync(pypircPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("email")) {
        const rest = trimmed.slice("email".length).trimStart();
        if (rest.startsWith("=")) {
          const val = rest
            .slice(1)
            .trim()
            .replace(/^["']|["']$/g, "");
          if (val.includes("@") && val.length > 0) return val;
        }
      }
    }
  } catch {
    // .pypirc not accessible
  }
  return undefined;
};

const readVscodeSettingsEmail = (): string | undefined => {
  const home = os.homedir();
  const candidates =
    process.platform === "darwin"
      ? [
          path.join(home, "Library/Application Support/Code/User/settings.json"),
          path.join(home, "Library/Application Support/Cursor/User/settings.json")
        ]
      : [
          path.join(home, ".config/Code/User/settings.json"),
          path.join(home, ".config/Cursor/User/settings.json")
        ];

  const emailRegex = /[\w.+-]+@[\w.-]+\.\w+/;
  for (const settingsPath of candidates) {
    try {
      const content = fs.readFileSync(settingsPath, "utf-8");
      const match = content.match(emailRegex);
      if (match?.[0]) return match[0];
    } catch {
      // settings.json not accessible
    }
  }
  return undefined;
};

// ── macOS Contacts — 通过 contacts CLI (macOS 14+) ──
// ponytail: `contacts` CLI 只在 macOS 14+ 存在。
// 旧版 macOS 需要 CNContactStore (Swift bridging) — 不做，YAGNI。
// 只取 "me" 卡片（当前用户自己的名片），不枚举全部联系人。
const readMacosContactsMe = (): { name?: string; email?: string } => {
  if (process.platform !== "darwin") return {};

  try {
    // contacts showMe --format json — macOS 14+
    const result = childProcess.execFileSync(
      "contacts",
      ["showMe", "--format", "json"],
      { timeout: 3000, encoding: "utf-8" }
    );
    const parsed = JSON.parse(result) as Record<string, unknown>;
    const name = readString(
      parsed.firstName && parsed.lastName
        ? `${parsed.firstName} ${parsed.lastName}`
        : parsed.firstName ?? parsed.lastName
    );
    const emails = parsed.emails;
    let email: string | undefined;
    if (Array.isArray(emails) && emails.length > 0) {
      email = readString(emails[0]);
    } else if (typeof emails === "string") {
      email = readString(emails);
    }
    return { name, email };
  } catch {
    // contacts CLI not available (macOS < 14) or permission denied
    return {};
  }
};

// ── Chromium Autofill — 读取 Chromium/Chrome/Edge autofill DB ──
// ponytail: Chromium autofill 数据在 SQLite DB 中。
// Electron 的 session.defaultSession 可触发 autofill 但无法直接读取 DB，
// 所以直接读 Chromium profile 目录下的 Web Data SQLite。
// 不依赖 better-sqlite3 — 用 childProcess 调 sqlite3 CLI（macOS/Linux 自带）。
const readChromiumAutofill = (): { names: string[]; emails: string[] } => {
  const home = os.homedir();
  // Chromium Web Data 路径候选
  const dbCandidates =
    process.platform === "darwin"
      ? [
          path.join(home, "Library/Application Support/Google/Chrome/Default/Web Data"),
          path.join(home, "Library/Application Support/Microsoft Edge/Default/Web Data"),
          path.join(home, "Library/Application Support/BraveSoftware/Brave-Browser/Default/Web Data")
        ]
      : [
          path.join(home, ".config/google-chrome/Default/Web Data"),
          path.join(home, ".config/microsoft-edge/Default/Web Data"),
          path.join(home, ".config/BraveSoftware/Brave-Browser/Default/Web Data")
        ];

  const names = new Set<string>();
  const emails = new Set<string>();

  for (const dbPath of dbCandidates) {
    if (!fs.existsSync(dbPath)) continue;
    // 查 autofill 表: name 字段为 "name" 或 "email"
    // ponytail: sqlite3 CLI 不一定装了；如果没装就跳过。
    // 不引入 better-sqlite3 依赖 — 这是 best-effort 信号源。
    const query = `SELECT value FROM autofill WHERE name IN ('name','full_name','email','E-mail') GROUP BY value LIMIT 20;`;
    try {
      const result = childProcess.execFileSync(
        "sqlite3",
        [dbPath, query],
        { timeout: 3000, encoding: "utf-8" }
      );
      for (const line of result.split("\n")) {
        const val = line.trim();
        if (val.length === 0) continue;
        if (val.includes("@") && val.includes(".")) {
          emails.add(val);
        } else if (val.length >= 2 && val.includes(" ") && !val.includes("@")) {
          // 看起来是全名（有空格，不含 @）
          names.add(val);
        }
      }
    } catch {
      // sqlite3 CLI not available or DB locked
    }
  }

  return { names: [...names], emails: [...emails] };
};

export const readLocalSignalsPayload = (): LocalSignalsPayload => {
  let osUsername: string | undefined;
  try {
    osUsername = os.userInfo().username;
  } catch {
    osUsername = process.env.USER ?? process.env.USERNAME;
  }
  osUsername = readString(osUsername);

  const osFullName = osUsername !== undefined ? readOsFullName(osUsername) : undefined;
  const hostname = readString(os.hostname());
  const gitName = execGitConfig("user.name");
  const gitEmail = execGitConfig("user.email");
  const gitGithubUser = execGitConfig("github.user");
  const gitDominantEmail = execGitDominantEmail();
  const gitRemoteUsernames = execGitRemoteUsernames();
  const sshKeyComments = readSshKeyComments();
  const sshKnownHosts = readSshKnownHosts();
  const npmEmail = readNpmrcEmail();
  const pipEmail = readPypircEmail();
  const vscodeSyncEmail = readVscodeSettingsEmail();
  const autofill = readChromiumAutofill();
  const contactsMe = readMacosContactsMe();

  return {
    ...(osUsername === undefined ? {} : { osUsername }),
    ...(osFullName === undefined ? {} : { osFullName }),
    ...(hostname === undefined ? {} : { hostname }),
    ...(gitName === undefined ? {} : { gitName }),
    ...(gitEmail === undefined ? {} : { gitEmail }),
    ...(gitGithubUser === undefined ? {} : { gitGithubUser }),
    ...(gitDominantEmail === undefined ? {} : { gitDominantEmail }),
    gitRemoteUsernames,
    sshKeyComments,
    sshKnownHosts,
    ...(npmEmail === undefined ? {} : { npmEmail }),
    ...(pipEmail === undefined ? {} : { pipEmail }),
    ...(vscodeSyncEmail === undefined ? {} : { vscodeSyncEmail }),
    browserAutofillNames: autofill.names,
    browserAutofillEmails: autofill.emails,
    ...(contactsMe.name === undefined ? {} : { macosContactsName: contactsMe.name }),
    ...(contactsMe.email === undefined ? {} : { macosContactsEmail: contactsMe.email }),
    loginManagerHints: []
  };
};