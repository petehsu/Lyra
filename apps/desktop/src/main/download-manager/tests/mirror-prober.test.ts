import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, test } from "vitest";

import {
  probeDownloadMirrors,
  sortDownloadMirrorsByProbe
} from "../mirror-prober";

const servers: Server[] = [];

const listen = (server: Server): Promise<number> =>
  new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address !== null && typeof address === "object") {
        resolve(address.port);
      }
    });
  });

const createProbeServer = async (
  delayMs: number,
  requireAuthorization = false
): Promise<string> => {
  const server = createServer((request, response) => {
    const send = (): void => {
      if (
        requireAuthorization
        && request.headers.authorization !== "Bearer probe-token"
      ) {
        response.statusCode = 403;
        response.end();
        return;
      }
      response.statusCode = 200;
      response.setHeader("Content-Length", "1024");
      response.end();
    };
    setTimeout(send, delayMs);
  });
  servers.push(server);
  const port = await listen(server);
  return `http://127.0.0.1:${port}/file.bin`;
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
});

describe("download mirror probing", () => {
  test("orders reachable HTTP mirrors by measured latency", async () => {
    const slowUrl = await createProbeServer(120);
    const fastUrl = await createProbeServer(5);

    await expect(sortDownloadMirrorsByProbe({
      urls: [slowUrl, fastUrl],
      timeoutMs: 1000
    })).resolves.toEqual([fastUrl, slowUrl]);
  });

  test("passes request headers to authenticated mirrors", async () => {
    const url = await createProbeServer(5, true);
    const [withoutHeaders] = await probeDownloadMirrors({
      urls: [url],
      timeoutMs: 1000
    });
    const [withHeaders] = await probeDownloadMirrors({
      urls: [url],
      headers: {
        Authorization: "Bearer probe-token"
      },
      timeoutMs: 1000
    });

    expect(withoutHeaders?.ok).toBe(false);
    expect(withHeaders?.ok).toBe(true);
  });
});
