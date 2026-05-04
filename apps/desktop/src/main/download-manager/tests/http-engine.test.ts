import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, test } from "vitest";

import { HttpDownloadController } from "../http-engine";

const servers: Server[] = [];
const tempDirs: string[] = [];

const listen = (server: Server): Promise<number> =>
  new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address !== null && typeof address === "object") {
        resolve(address.port);
      }
    });
  });

const createRangeServer = async (payload: Buffer): Promise<string> => {
  const server = createServer((request, response) => {
    response.setHeader("Accept-Ranges", "bytes");
    response.setHeader("Content-Type", "application/octet-stream");
    response.setHeader("Content-Length", String(payload.length));
    response.setHeader("Connection", "close");

    if (request.method === "HEAD") {
      response.statusCode = 200;
      response.end();
      return;
    }

    const range = request.headers.range;
    if (typeof range === "string") {
      const match = range.match(/^bytes=(\d+)-(\d+)$/u);
      if (match !== null) {
        const start = Number.parseInt(match[1] ?? "0", 10);
        const end = Number.parseInt(match[2] ?? String(payload.length - 1), 10);
        response.statusCode = 206;
        response.setHeader("Content-Range", `bytes ${start}-${end}/${payload.length}`);
        response.setHeader("Content-Length", String(end - start + 1));
        response.end(payload.subarray(start, end + 1));
        return;
      }
    }

    response.statusCode = 200;
    response.end(payload);
  });
  servers.push(server);
  const port = await listen(server);
  return `http://127.0.0.1:${port}/artifact.bin`;
};

afterEach(async () => {
  for (const server of servers.splice(0)) {
    const closed = new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    server.closeAllConnections?.();
    server.closeIdleConnections?.();
    await closed;
  }
  for (const tempDir of tempDirs.splice(0)) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe("HttpDownloadController", () => {
  test("downloads a range-capable file with multiple connections", async () => {
    const payload = randomBytes(2 * 1024 * 1024 + 513);
    const url = await createRangeServer(payload);
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "lyra-download-engine-"));
    tempDirs.push(tempDir);
    const savePath = path.join(tempDir, "artifact.bin");
    let maxConnections = 0;
    let completed = false;

    const controller = new HttpDownloadController({
      taskId: "download-test",
      url,
      savePath,
      partsRoot: path.join(tempDir, "parts"),
      connections: 4,
      onUpdate: (update) => {
        maxConnections = Math.max(maxConnections, update.connectionsActive);
      },
      onComplete: () => {
        completed = true;
      },
      onError: (error) => {
        throw error;
      },
      onPaused: () => undefined,
      onCanceled: () => undefined
    });

    await controller.start();

    expect(completed).toBe(true);
    expect(maxConnections).toBeGreaterThan(1);
    expect(await readFile(savePath)).toEqual(payload);
  });
});
