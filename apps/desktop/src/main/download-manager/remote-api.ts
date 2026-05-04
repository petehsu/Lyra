import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from "node:fs";
import { randomBytes } from "node:crypto";
import http, {
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";
import path from "node:path";

import type {
  DownloadManagerBatchRequest,
  DownloadManagerEnqueueRequest,
  DownloadManagerPriority,
  DownloadManagerRemoteApiStartRequest,
  DownloadManagerRemoteApiStatus,
  DownloadManagerSettings,
  DownloadManagerSnapshot,
  DownloadManagerTask,
  DownloadManagerUpdateSettingsRequest
} from "../../shared/download-manager";

const CONFIG_FILE_NAME = "remote-api.v1.json";
const DEFAULT_HOST = "127.0.0.1";
const MAX_BODY_BYTES = 1024 * 1024;
const REMOTE_WEB_UI_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Lyra Downloads</title>
  <style>
    :root { color-scheme: light dark; font: 13px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: Canvas; color: CanvasText; }
    main { max-width: 920px; margin: 0 auto; padding: 20px; display: grid; gap: 14px; }
    header, form, .toolbar, .row, .meta, .actions { display: flex; align-items: center; gap: 8px; }
    header { justify-content: space-between; }
    h1 { margin: 0; font-size: 16px; font-weight: 650; }
    input, textarea, button { font: inherit; color: inherit; }
    input, textarea { min-width: 0; border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); background: transparent; }
    input { height: 30px; padding: 0 8px; }
    textarea { width: 100%; min-height: 72px; padding: 8px; resize: vertical; }
    button { height: 30px; border: 0; background: transparent; opacity: .72; cursor: pointer; }
    button:hover { opacity: 1; }
    button:disabled { opacity: .32; cursor: default; }
    .token { flex: 1; }
    .list { display: grid; border-top: 1px solid color-mix(in srgb, CanvasText 14%, transparent); }
    .row { align-items: stretch; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, transparent); }
    .main { min-width: 0; display: grid; gap: 6px; flex: 1; }
    .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 620; }
    .meta { flex-wrap: wrap; color: color-mix(in srgb, CanvasText 58%, transparent); font-size: 12px; }
    .progress { height: 2px; background: color-mix(in srgb, CanvasText 14%, transparent); overflow: hidden; }
    .bar { height: 100%; width: 100%; transform-origin: left center; background: color-mix(in srgb, CanvasText 55%, transparent); }
    .actions { flex: 0 0 auto; align-self: center; }
    .error { color: #c0332b; font-size: 12px; }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Lyra Downloads</h1>
      <input id="token" class="token" placeholder="Remote API token">
      <button id="saveToken" type="button">Save</button>
      <button id="refresh" type="button">Refresh</button>
    </header>
    <form id="addForm">
      <textarea id="urls" placeholder="Paste one or more URLs, or Metalink XML"></textarea>
      <button type="submit">Add</button>
    </form>
    <div class="toolbar">
      <button id="pauseAll" type="button">Pause all</button>
      <button id="resumeAll" type="button">Resume all</button>
      <button id="cancelAll" type="button">Cancel all</button>
    </div>
    <section id="message" class="error"></section>
    <section id="list" class="list"></section>
  </main>
  <script>
    const tokenInput = document.getElementById("token");
    const list = document.getElementById("list");
    const message = document.getElementById("message");
    tokenInput.value = localStorage.getItem("lyraDownloadsToken") || new URL(location.href).searchParams.get("token") || "";
    const token = () => tokenInput.value.trim();
    const setMessage = (text) => { message.textContent = text || ""; };
    async function api(path, options = {}) {
      const headers = new Headers(options.headers || {});
      headers.set("authorization", "Bearer " + token());
      if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
      const response = await fetch(path, { ...options, headers });
      if (!response.ok) throw new Error((await response.text()) || response.statusText);
      return response.json();
    }
    const formatBytes = (value) => {
      if (!value) return "unknown";
      const units = ["B", "KB", "MB", "GB", "TB"];
      let size = value;
      let index = 0;
      while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
      return size.toFixed(size >= 100 || index === 0 ? 0 : 1) + " " + units[index];
    };
    const pct = (task) => task.totalBytes > 0 ? Math.max(0, Math.min(1, task.receivedBytes / task.totalBytes)) : task.state === "completed" ? 1 : 0;
    async function load() {
      if (!token()) { setMessage("Enter the remote API token."); return; }
      setMessage("");
      const snapshot = await api("/api/downloads");
      list.replaceChildren(...snapshot.tasks.map(renderTask));
    }
    function actionButton(label, path) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.onclick = async () => { await api(path, { method: "POST" }); await load(); };
      return button;
    }
    function renderTask(task) {
      const row = document.createElement("article");
      row.className = "row";
      const main = document.createElement("div");
      main.className = "main";
      const name = document.createElement("div");
      name.className = "name";
      name.textContent = task.fileName;
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = [task.state, formatBytes(task.receivedBytes) + " / " + formatBytes(task.totalBytes), formatBytes(task.speedBytesPerSecond) + "/s", task.protocol].join(" · ");
      const progress = document.createElement("div");
      progress.className = "progress";
      const bar = document.createElement("div");
      bar.className = "bar";
      bar.style.transform = "scaleX(" + pct(task) + ")";
      progress.append(bar);
      main.append(name, meta, progress);
      if (task.errorMessage) {
        const error = document.createElement("div");
        error.className = "error";
        error.textContent = task.errorMessage;
        main.append(error);
      }
      const actions = document.createElement("div");
      actions.className = "actions";
      if (task.state === "downloading" || task.state === "queued") actions.append(actionButton("Pause", "/api/downloads/" + encodeURIComponent(task.id) + "/pause"));
      if (task.state === "paused") actions.append(actionButton("Resume", "/api/downloads/" + encodeURIComponent(task.id) + "/resume"));
      if (task.state === "failed" || task.state === "canceled") actions.append(actionButton("Retry", "/api/downloads/" + encodeURIComponent(task.id) + "/retry"));
      if (task.state !== "completed" && task.state !== "failed" && task.state !== "canceled") actions.append(actionButton("Cancel", "/api/downloads/" + encodeURIComponent(task.id) + "/cancel"));
      actions.append(actionButton("Remove", "/api/downloads/" + encodeURIComponent(task.id) + "/remove"));
      row.append(main, actions);
      return row;
    }
    document.getElementById("saveToken").onclick = () => { localStorage.setItem("lyraDownloadsToken", token()); load().catch((error) => setMessage(error.message)); };
    document.getElementById("refresh").onclick = () => load().catch((error) => setMessage(error.message));
    document.getElementById("pauseAll").onclick = () => api("/api/downloads/pause-all", { method: "POST" }).then(load).catch((error) => setMessage(error.message));
    document.getElementById("resumeAll").onclick = () => api("/api/downloads/resume-all", { method: "POST" }).then(load).catch((error) => setMessage(error.message));
    document.getElementById("cancelAll").onclick = () => api("/api/downloads/cancel-all", { method: "POST" }).then(load).catch((error) => setMessage(error.message));
    document.getElementById("addForm").onsubmit = (event) => {
      event.preventDefault();
      api("/api/downloads", { method: "POST", body: JSON.stringify({ text: document.getElementById("urls").value }) }).then(() => {
        document.getElementById("urls").value = "";
        return load();
      }).catch((error) => setMessage(error.message));
    };
    load().catch((error) => setMessage(error.message));
  </script>
</body>
</html>`;

type RemoteApiConfig = {
  readonly version: 1;
  readonly token: string;
  readonly host: string;
  readonly port: number;
};

type DownloadManagerRemoteApiHandlers = {
  readonly readSnapshot: () => DownloadManagerSnapshot;
  readonly enqueue: (request: DownloadManagerEnqueueRequest) => DownloadManagerSnapshot;
  readonly pauseTask: (taskId: string) => DownloadManagerTask | null;
  readonly resumeTask: (taskId: string) => DownloadManagerTask | null;
  readonly cancelTask: (taskId: string) => DownloadManagerTask | null;
  readonly retryTask: (taskId: string) => DownloadManagerTask | null;
  readonly removeTask: (taskId: string) => void;
  readonly setTaskPriority: (
    taskId: string,
    priority: DownloadManagerPriority
  ) => DownloadManagerTask | null;
  readonly pauseAll: (request?: DownloadManagerBatchRequest) => DownloadManagerSnapshot;
  readonly resumeAll: (request?: DownloadManagerBatchRequest) => DownloadManagerSnapshot;
  readonly cancelAll: (request?: DownloadManagerBatchRequest) => DownloadManagerSnapshot;
  readonly readSettings: () => DownloadManagerSettings;
  readonly updateSettings: (
    request: DownloadManagerUpdateSettingsRequest
  ) => DownloadManagerSettings;
};

export type DownloadManagerRemoteApiController = {
  readonly readStatus: () => DownloadManagerRemoteApiStatus;
  readonly start: (
    request?: DownloadManagerRemoteApiStartRequest
  ) => Promise<DownloadManagerRemoteApiStatus>;
  readonly stop: () => Promise<DownloadManagerRemoteApiStatus>;
  readonly dispose: () => void;
};

const createToken = (): string => randomBytes(32).toString("hex");

const writeConfig = (
  storageRoot: string,
  configFilePath: string,
  config: RemoteApiConfig
): void => {
  mkdirSync(storageRoot, { recursive: true });
  const tempPath = `${configFilePath}.tmp`;
  writeFileSync(tempPath, JSON.stringify(config, null, 2), "utf8");
  renameSync(tempPath, configFilePath);
};

const readConfig = (storageRoot: string): RemoteApiConfig => {
  const configFilePath = path.join(storageRoot, CONFIG_FILE_NAME);
  if (existsSync(configFilePath)) {
    try {
      const parsed = JSON.parse(readFileSync(configFilePath, "utf8")) as Partial<RemoteApiConfig>;
      if (
        parsed.version === 1
        && typeof parsed.token === "string"
        && parsed.token.length >= 32
      ) {
        const parsedPort = parsed.port;
        return {
          version: 1,
          token: parsed.token,
          host: typeof parsed.host === "string" && parsed.host.length > 0
            ? parsed.host
            : DEFAULT_HOST,
          port: typeof parsedPort === "number"
            && Number.isInteger(parsedPort)
            && parsedPort >= 0
            && parsedPort <= 65_535
            ? parsedPort
            : 0
        };
      }
    } catch {
      // Recreate below.
    }
  }
  const config: RemoteApiConfig = {
    version: 1,
    token: createToken(),
    host: DEFAULT_HOST,
    port: 0
  };
  writeConfig(storageRoot, configFilePath, config);
  return config;
};

const isLoopbackHost = (host: string): boolean =>
  host === "127.0.0.1" || host === "localhost" || host === "::1";

const normalizeStartRequest = (
  request: DownloadManagerRemoteApiStartRequest | undefined,
  current: RemoteApiConfig
): RemoteApiConfig => {
  const host = request?.host?.trim() || current.host || DEFAULT_HOST;
  if (isLoopbackHost(host) === false && request?.allowLan !== true) {
    throw new Error("LAN remote API requires allowLan=true");
  }
  const port = request?.port ?? current.port;
  if (Number.isInteger(port) === false || port < 0 || port > 65_535) {
    throw new Error("remote API port must be between 0 and 65535");
  }
  return {
    ...current,
    host,
    port
  };
};

const readRequestBody = (request: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("error", reject);
    request.on("end", () => {
      if (chunks.length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("request body must be JSON"));
      }
    });
  });

const sendJson = (
  response: ServerResponse,
  statusCode: number,
  payload: unknown
): void => {
  response.writeHead(statusCode, {
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
};

const sendNoContent = (response: ServerResponse): void => {
  response.writeHead(204, {
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-origin": "*",
    "cache-control": "no-store"
  });
  response.end();
};

const sendHtml = (
  response: ServerResponse,
  html: string
): void => {
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": "text/html; charset=utf-8"
  });
  response.end(html);
};

const readBearerToken = (request: IncomingMessage): string | null => {
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string") {
    return null;
  }
  const [scheme, token] = authorization.split(/\s+/u);
  return scheme?.toLowerCase() === "bearer" && token !== undefined ? token : null;
};

export const createDownloadManagerRemoteApi = ({
  storageRoot,
  handlers
}: {
  readonly storageRoot: string;
  readonly handlers: DownloadManagerRemoteApiHandlers;
}): DownloadManagerRemoteApiController => {
  const configFilePath = path.join(storageRoot, CONFIG_FILE_NAME);
  let config = readConfig(storageRoot);
  let server: Server | null = null;
  let runningHost = config.host;
  let runningPort: number | null = null;

  const readStatus = (): DownloadManagerRemoteApiStatus => ({
    running: server !== null,
    host: runningHost,
    port: runningPort,
    baseUrl: runningPort === null ? null : `http://${runningHost}:${runningPort}`,
    token: config.token
  });

  const handleApiRequest = async (
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> => {
    if (request.method === "OPTIONS") {
      sendNoContent(response);
      return;
    }
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    if (url.pathname === "/") {
      sendHtml(response, REMOTE_WEB_UI_HTML);
      return;
    }
    if (readBearerToken(request) !== config.token) {
      sendJson(response, 401, { error: "unauthorized" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/status") {
      sendJson(response, 200, readStatus());
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/downloads") {
      sendJson(response, 200, handlers.readSnapshot());
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/settings") {
      sendJson(response, 200, handlers.readSettings());
      return;
    }
    if (request.method === "PATCH" && url.pathname === "/api/settings") {
      const body = await readRequestBody(request);
      sendJson(
        response,
        200,
        handlers.updateSettings((body ?? {}) as DownloadManagerUpdateSettingsRequest)
      );
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/downloads") {
      const body = await readRequestBody(request);
      sendJson(response, 200, handlers.enqueue((body ?? {}) as DownloadManagerEnqueueRequest));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/downloads/pause-all") {
      const body = await readRequestBody(request);
      sendJson(response, 200, handlers.pauseAll(body as DownloadManagerBatchRequest | undefined));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/downloads/resume-all") {
      const body = await readRequestBody(request);
      sendJson(response, 200, handlers.resumeAll(body as DownloadManagerBatchRequest | undefined));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/downloads/cancel-all") {
      const body = await readRequestBody(request);
      sendJson(response, 200, handlers.cancelAll(body as DownloadManagerBatchRequest | undefined));
      return;
    }

    const actionMatch = /^\/api\/downloads\/([^/]+)\/(pause|resume|cancel|retry|remove)$/u.exec(url.pathname);
    if (request.method === "POST" && actionMatch !== null) {
      const taskId = decodeURIComponent(actionMatch[1]!);
      const action = actionMatch[2];
      if (action === "pause") {
        sendJson(response, 200, handlers.pauseTask(taskId));
        return;
      }
      if (action === "resume") {
        sendJson(response, 200, handlers.resumeTask(taskId));
        return;
      }
      if (action === "cancel") {
        sendJson(response, 200, handlers.cancelTask(taskId));
        return;
      }
      if (action === "retry") {
        sendJson(response, 200, handlers.retryTask(taskId));
        return;
      }
      handlers.removeTask(taskId);
      sendJson(response, 200, handlers.readSnapshot());
      return;
    }

    const priorityMatch = /^\/api\/downloads\/([^/]+)\/priority$/u.exec(url.pathname);
    if (request.method === "PATCH" && priorityMatch !== null) {
      const body = await readRequestBody(request) as { readonly priority?: unknown } | undefined;
      const priority = body?.priority;
      if (priority !== "low" && priority !== "normal" && priority !== "high") {
        sendJson(response, 400, { error: "priority must be low, normal, or high" });
        return;
      }
      sendJson(
        response,
        200,
        handlers.setTaskPriority(decodeURIComponent(priorityMatch[1]!), priority)
      );
      return;
    }

    sendJson(response, 404, { error: "not found" });
  };

  const start = async (
    request?: DownloadManagerRemoteApiStartRequest
  ): Promise<DownloadManagerRemoteApiStatus> => {
    if (server !== null) {
      return readStatus();
    }
    config = normalizeStartRequest(request, config);
    writeConfig(storageRoot, configFilePath, config);
    const nextServer = http.createServer((apiRequest, apiResponse) => {
      void handleApiRequest(apiRequest, apiResponse).catch((error: unknown) => {
        sendJson(apiResponse, 500, {
          error: error instanceof Error ? error.message : String(error)
        });
      });
    });
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        nextServer.off("listening", onListening);
        reject(error);
      };
      const onListening = (): void => {
        nextServer.off("error", onError);
        resolve();
      };
      nextServer.once("error", onError);
      nextServer.once("listening", onListening);
      nextServer.listen(config.port, config.host);
    });
    server = nextServer;
    runningHost = config.host;
    const address = nextServer.address();
    runningPort = typeof address === "object" && address !== null ? address.port : config.port;
    return readStatus();
  };

  const stop = async (): Promise<DownloadManagerRemoteApiStatus> => {
    const currentServer = server;
    if (currentServer === null) {
      return readStatus();
    }
    server = null;
    await new Promise<void>((resolve, reject) => {
      currentServer.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    runningPort = null;
    return readStatus();
  };

  return {
    readStatus,
    start,
    stop,
    dispose: () => {
      const currentServer = server;
      server = null;
      runningPort = null;
      currentServer?.close();
    }
  };
};
