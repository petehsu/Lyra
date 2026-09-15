import { EventEmitter } from "node:events";
import http from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ChildProcess } from "node:child_process";

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  bindSearxngRuntimeEnv,
  isLocalSearxngEndpoint,
  isSearxngSupervisorEnabled,
  probeSearxngEndpoint,
  resolveSearxngSearchUrl,
  resolveSearxngStartScript,
  startSearxngSupervisor
} from "./searxng-supervisor";

const startShCandidates = [
  path.join(process.cwd(), "tools/searxng/start.sh"),
  path.join(process.cwd(), "../../tools/searxng/start.sh")
];
const tempRoots: string[] = [];
const supervisors: Array<{ readonly dispose: () => void }> = [];

afterEach(async () => {
  for (const supervisor of supervisors.splice(0)) {
    supervisor.dispose();
  }
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true
  })));
});

const fakeChild = (): ChildProcess => {
  const child = new EventEmitter() as ChildProcess;
  child.pid = 4242;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = vi.fn(() => true);
  child.unref = vi.fn(() => child);
  return child;
};

const listen = async (): Promise<{ readonly url: string; readonly close: () => Promise<void> }> => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}");
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected tcp address");
  }
  return {
    url: `http://127.0.0.1:${address.port}/search`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error === undefined ? resolve() : reject(error));
    })
  };
};

describe("SearXNG supervisor helpers", () => {
  test("normalizes the default local search URL", () => {
    expect(resolveSearxngSearchUrl({})).toBe("http://127.0.0.1:8888/search");
    expect(resolveSearxngSearchUrl({ LYRA_SEARXNG_URL: "http://127.0.0.1:9999" }))
      .toBe("http://127.0.0.1:9999/search");
    const env: NodeJS.ProcessEnv = { LYRA_SEARXNG_URL: "http://127.0.0.1:8888/" };
    expect(bindSearxngRuntimeEnv(env)).toBe("http://127.0.0.1:8888/search");
    expect(env.LYRA_SEARXNG_URL).toBe("http://127.0.0.1:8888/search");
  });

  test("only supervises loopback endpoints", () => {
    expect(isLocalSearxngEndpoint("http://127.0.0.1:8888/search")).toBe(true);
    expect(isLocalSearxngEndpoint("http://localhost:8888/search")).toBe(true);
    expect(isLocalSearxngEndpoint("https://searx.example/search")).toBe(false);
  });

  test("stays off in Vitest unless explicitly enabled", () => {
    expect(isSearxngSupervisorEnabled({ VITEST: "true" })).toBe(false);
    expect(isSearxngSupervisorEnabled({ VITEST: "true", LYRA_SEARXNG_SUPERVISOR: "1" })).toBe(true);
    expect(isSearxngSupervisorEnabled({ LYRA_SEARXNG_SUPERVISOR: "0" })).toBe(false);
    expect(isSearxngSupervisorEnabled({})).toBe(true);
  });

  test("prefers an explicit start script, then packaged resources, then the repo copy", () => {
    expect(resolveSearxngStartScript({
      cwd: "/repo",
      resourcesPath: "/resources",
      env: { LYRA_SEARXNG_START: "/custom/start.sh" },
      existsSync: (filePath) => filePath === "/custom/start.sh"
    })).toBe("/custom/start.sh");
    expect(resolveSearxngStartScript({
      cwd: "/repo",
      resourcesPath: "/resources",
      env: {},
      existsSync: (filePath) => filePath === path.join("/resources", "searxng", "start.sh")
    })).toBe(path.join("/resources", "searxng", "start.sh"));
    expect(resolveSearxngStartScript({
      cwd: "/repo",
      resourcesPath: "/resources",
      env: {},
      existsSync: (filePath) => filePath === path.join("/repo", "tools", "searxng", "start.sh")
    })).toBe(path.join("/repo", "tools", "searxng", "start.sh"));
  });

  test("start.sh execs the webapp in the foreground so Electron can own the process", async () => {
    const startShPath = startShCandidates.find((candidate) => existsSync(candidate));
    if (startShPath === undefined) {
      throw new Error("missing tools/searxng/start.sh");
    }
    const source = await readFile(startShPath, "utf8");
    expect(source).toMatch(/LYRA_SEARXNG_FOREGROUND/);
    expect(source).toMatch(/exec "\$VENV_PY" -m searx\.webapp/);
    expect(source).toMatch(/curl .*127\.0\.0\.1:\$\{PORT\}\/search/);
  });
});

describe("probeSearxngEndpoint", () => {
  test("returns true for a live local HTTP search endpoint", async () => {
    const server = await listen();
    try {
      await expect(probeSearxngEndpoint(server.url)).resolves.toBe(true);
    } finally {
      await server.close();
    }
  });

  test("returns false when nothing is listening", async () => {
    const server = await listen();
    const url = server.url;
    await server.close();
    await expect(probeSearxngEndpoint(url, 200)).resolves.toBe(false);
  });
});

describe("startSearxngSupervisor", () => {
  test("does not spawn when a local instance is already healthy", async () => {
    const spawn = vi.fn();
    const probe = vi.fn(async () => true);
    const supervisor = startSearxngSupervisor({
      lyraRoot: "/lyra",
      resourcesPath: "/resources",
      cwd: "/repo",
      env: {},
      enabled: true,
      hooks: {
        probe,
        spawn,
        existsSync: () => true,
        openLog: () => "ignore",
        mkdirSync: () => undefined,
        resolveBash: async () => "/bin/bash"
      }
    });
    supervisors.push(supervisor);
    await vi.waitFor(() => {
      expect(probe).toHaveBeenCalled();
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  test("spawns start.sh in the foreground when the local endpoint is down", async () => {
    const child = fakeChild();
    const spawn = vi.fn(() => child);
    const root = await mkdtemp(path.join(tmpdir(), "lyra-searxng-"));
    tempRoots.push(root);
    const startScript = path.join(root, "start.sh");
    await writeFile(startScript, "#!/bin/bash\n");
    const supervisor = startSearxngSupervisor({
      lyraRoot: root,
      resourcesPath: "/resources",
      cwd: root,
      env: { LYRA_SEARXNG_START: startScript },
      enabled: true,
      hooks: {
        probe: async () => false,
        spawn,
        existsSync: (filePath) => filePath === startScript,
        openLog: () => "ignore",
        mkdirSync: () => undefined,
        resolveBash: async () => "/bin/bash"
      }
    });
    supervisors.push(supervisor);
    await vi.waitFor(() => {
      expect(spawn).toHaveBeenCalledTimes(1);
    });
    expect(spawn.mock.calls[0]?.[0]).toBe("/bin/bash");
    expect(spawn.mock.calls[0]?.[1]).toEqual([startScript]);
    expect(spawn.mock.calls[0]?.[2]).toEqual(expect.objectContaining({
      env: expect.objectContaining({
        LYRA_SEARXNG_FOREGROUND: "1",
        LYRA_SEARXNG_HOME: path.join(root, "searxng")
      })
    }));
  });

  test("does not spawn a second copy when the owned child is still starting", async () => {
    const child = fakeChild();
    const spawn = vi.fn(() => child);
    const queued: Array<() => void> = [];
    const supervisor = startSearxngSupervisor({
      lyraRoot: "/lyra",
      resourcesPath: "/resources",
      cwd: "/repo",
      env: { LYRA_SEARXNG_START: "/repo/tools/searxng/start.sh" },
      enabled: true,
      hooks: {
        probe: async () => false,
        spawn,
        existsSync: () => true,
        openLog: () => "ignore",
        mkdirSync: () => undefined,
        resolveBash: async () => "/bin/bash",
        schedule: (callback, delayMs) => {
          if (delayMs === 0) {
            const timer = setTimeout(callback, 0);
            return { clear: () => clearTimeout(timer) };
          }
          queued.push(callback);
          return {
            clear: () => {
              const index = queued.indexOf(callback);
              if (index >= 0) {
                queued.splice(index, 1);
              }
            }
          };
        }
      }
    });
    supervisors.push(supervisor);
    await vi.waitFor(() => {
      expect(spawn).toHaveBeenCalledTimes(1);
    });
    const pending = queued.splice(0);
    for (const callback of pending) {
      callback();
    }
    await Promise.resolve();
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  test("respawns after the owned child exits while the endpoint is still down", async () => {
    const children = [fakeChild(), fakeChild()];
    let spawnCount = 0;
    const spawn = vi.fn(() => children[spawnCount++] ?? fakeChild());
    const supervisor = startSearxngSupervisor({
      lyraRoot: "/lyra",
      resourcesPath: "/resources",
      cwd: "/repo",
      env: { LYRA_SEARXNG_START: "/repo/tools/searxng/start.sh" },
      enabled: true,
      hooks: {
        probe: async () => false,
        spawn,
        existsSync: () => true,
        openLog: () => "ignore",
        mkdirSync: () => undefined,
        resolveBash: async () => "/bin/bash"
      }
    });
    supervisors.push(supervisor);
    await vi.waitFor(() => {
      expect(spawn).toHaveBeenCalledTimes(1);
    });
    children[0]?.emit("exit", 1, null);
    await vi.waitFor(() => {
      expect(spawn).toHaveBeenCalledTimes(2);
    });
  });

  test("does not kill an instance it did not start", async () => {
    const terminate = vi.fn();
    const spawn = vi.fn();
    const supervisor = startSearxngSupervisor({
      lyraRoot: "/lyra",
      resourcesPath: "/resources",
      cwd: "/repo",
      env: {},
      enabled: true,
      hooks: {
        probe: async () => true,
        spawn,
        terminate,
        existsSync: () => true,
        openLog: () => "ignore",
        mkdirSync: () => undefined,
        resolveBash: async () => "/bin/bash"
      }
    });
    await vi.waitFor(() => {
      expect(spawn).not.toHaveBeenCalled();
    });
    supervisor.dispose();
    expect(terminate).not.toHaveBeenCalled();
  });

  test("terminates the owned child on dispose", async () => {
    const child = fakeChild();
    const terminate = vi.fn();
    const spawn = vi.fn(() => child);
    const supervisor = startSearxngSupervisor({
      lyraRoot: "/lyra",
      resourcesPath: "/resources",
      cwd: "/repo",
      env: { LYRA_SEARXNG_START: "/repo/tools/searxng/start.sh" },
      enabled: true,
      hooks: {
        probe: async () => false,
        spawn,
        terminate,
        existsSync: () => true,
        openLog: () => "ignore",
        mkdirSync: () => undefined,
        resolveBash: async () => "/bin/bash"
      }
    });
    await vi.waitFor(() => {
      expect(spawn).toHaveBeenCalledTimes(1);
    });
    supervisor.dispose();
    expect(terminate).toHaveBeenCalledWith(child);
  });

  test("does not spawn when the search URL is remote", async () => {
    const spawn = vi.fn();
    const supervisor = startSearxngSupervisor({
      lyraRoot: "/lyra",
      resourcesPath: "/resources",
      cwd: "/repo",
      env: { LYRA_SEARXNG_URL: "https://searx.example/search" },
      enabled: true,
      hooks: {
        probe: async () => false,
        spawn,
        existsSync: () => true,
        openLog: () => "ignore",
        mkdirSync: () => undefined,
        resolveBash: async () => "/bin/bash"
      }
    });
    supervisors.push(supervisor);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(spawn).not.toHaveBeenCalled();
  });
});
